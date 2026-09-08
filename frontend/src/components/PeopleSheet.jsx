import React, { useCallback, useMemo, useState } from "react";
import { api } from "../api.js";

// The columns of the source spreadsheet, in its order. `readOnly` marks values
// the server derives — Age comes from Birthday and can't be typed over.
const COLUMNS = [
  { field: "name", label: "Name", width: 190 },
  { field: "role", label: "Status", width: 130 },
  { field: "team", label: "Team", width: 80 },
  { field: "contact", label: "Contact", width: 150 },
  { field: "telegram", label: "Telegram", width: 140 },
  { field: "instagram", label: "Instagram", width: 140 },
  { field: "ministry", label: "Ministry", width: 140 },
  { field: "birthday", label: "Birthday", width: 130, placeholder: "YYYY-MM-DD" },
  { field: "age", label: "Age", width: 64, readOnly: true },
  { field: "school", label: "School", width: 160 },
  { field: "follow_up", label: "Followup", width: 130 },
  { field: "came_church", label: "Came Church", width: 150 },
  { field: "invited_by", label: "Invited By", width: 150 },
  { field: "religion", label: "Religion", width: 130 },
  { field: "general_information", label: "General Information", width: 260 },
  { field: "updates", label: "Updates", width: 260 },
  { field: "next_steps", label: "Next Steps", width: 260 },
  { field: "photo_url", label: "Photo URL", width: 220 },
];

const EDITABLE = COLUMNS.filter((c) => !c.readOnly).map((c) => c.field);

let newRowCounter = 0;

function toRow(person) {
  const row = { _key: `id-${person.id}`, id: person.id, _new: false, _deleted: false };
  for (const { field } of COLUMNS) row[field] = person[field] ?? "";
  return row;
}

function blankRow() {
  newRowCounter += 1;
  const row = { _key: `new-${newRowCounter}`, id: null, _new: true, _deleted: false };
  for (const { field } of COLUMNS) row[field] = "";
  return row;
}

// What actually gets compared for "has this changed?" — the editable cells only.
function fingerprint(row) {
  // JSON keeps the field boundaries, so "ab" + "" cannot look like "a" + "b".
  return JSON.stringify(EDITABLE.map((f) => String(row[f] ?? "")));
}

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export default function PeopleSheet({ token, people, onSaved }) {
  const [rows, setRows] = useState(() => people.map(toRow));
  const [baseline, setBaseline] = useState(() =>
    Object.fromEntries(people.map((p) => [`id-${p.id}`, fingerprint(toRow(p))]))
  );
  const [query, setQuery] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const changed = useMemo(
    () =>
      rows.filter(
        (row) =>
          (row._deleted && !row._new) ||
          (!row._deleted && (row._new || fingerprint(row) !== baseline[row._key]))
      ),
    [rows, baseline]
  );

  const pendingCount = changed.length;

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((row) =>
      COLUMNS.some((c) => String(row[c.field] ?? "").toLowerCase().includes(q))
    );
  }, [rows, query]);

  const setCell = useCallback((key, field, value) => {
    setRows((list) =>
      list.map((row) => (row._key === key ? { ...row, [field]: value } : row))
    );
  }, []);

  function addRow() {
    setNotice("");
    setRows((list) => [...list, blankRow()]);
  }

  function toggleDelete(key) {
    setRows((list) =>
      list
        // A new row that was never saved can just disappear.
        .filter((row) => !(row._key === key && row._new))
        .map((row) => (row._key === key ? { ...row, _deleted: !row._deleted } : row))
    );
  }

  function discard() {
    setRows(people.map(toRow));
    setError("");
    setNotice("");
  }

  async function save() {
    setSaving(true);
    setError("");
    setNotice("");

    const upserts = rows
      .filter((row) => !row._deleted && (row._new || fingerprint(row) !== baseline[row._key]))
      .map((row) => {
        const payload = { id: row._new ? null : row.id };
        for (const field of EDITABLE) payload[field] = row[field] ?? "";
        return payload;
      });
    const deletes = rows.filter((row) => row._deleted && !row._new).map((row) => row.id);

    if (upserts.some((row) => !String(row.name).trim())) {
      setSaving(false);
      setError("Every row needs a name before it can be saved.");
      return;
    }

    try {
      const result = await api.bulkSavePeople(token, { upserts, deletes });
      setRows(result.people.map(toRow));
      setBaseline(
        Object.fromEntries(result.people.map((p) => [`id-${p.id}`, fingerprint(toRow(p))]))
      );
      const parts = [];
      if (result.created) parts.push(`${result.created} added`);
      if (result.updated) parts.push(`${result.updated} updated`);
      if (result.deleted) parts.push(`${result.deleted} removed`);
      setNotice(parts.length ? `Saved — ${parts.join(", ")}.` : "Saved.");
      onSaved?.(result.people);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  // Export takes what is on screen, so a filtered view exports just that.
  function exportCsv() {
    const header = COLUMNS.map((c) => csvCell(c.label)).join(",");
    const body = visible
      .filter((row) => !row._deleted)
      .map((row) => COLUMNS.map((c) => csvCell(row[c.field])).join(","));
    const csv = [header, ...body].join("\r\n");

    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `people-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="panel sheet-panel">
      <div className="panel-row sheet-toolbar">
        <div className="panel-title">
          Database
          <span className="sheet-count">
            {rows.filter((r) => !r._deleted).length} people
            {pendingCount > 0 && ` · ${pendingCount} unsaved`}
          </span>
        </div>

        <div className="sheet-actions">
          <input
            className="sheet-search"
            type="search"
            placeholder="Search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search the database"
          />
          <button className="btn btn-secondary btn-inline" onClick={addRow} disabled={saving}>
            Add row
          </button>
          <button className="btn btn-secondary btn-inline" onClick={exportCsv} disabled={saving}>
            Export CSV
          </button>
          {pendingCount > 0 && (
            <button className="btn btn-secondary btn-inline" onClick={discard} disabled={saving}>
              Discard
            </button>
          )}
          <button
            className="btn btn-primary btn-inline"
            onClick={save}
            disabled={saving || pendingCount === 0}
          >
            {saving ? "Saving…" : `Save${pendingCount ? ` (${pendingCount})` : ""}`}
          </button>
        </div>
      </div>

      {error && <div className="error-banner panel-notice">{error}</div>}
      {notice && <div className="success-banner panel-notice">{notice}</div>}

      <div className="sheet-scroll">
        <table className="sheet">
          <thead>
            <tr>
              <th className="sheet-rownum" scope="col">
                #
              </th>
              {COLUMNS.map((column) => (
                <th key={column.field} scope="col" style={{ minWidth: column.width }}>
                  {column.label}
                </th>
              ))}
              <th className="sheet-rowaction" scope="col">
                Row
              </th>
            </tr>
          </thead>
          <tbody>
            {visible.map((row, index) => (
              <tr
                key={row._key}
                className={`${row._deleted ? "sheet-row-deleted" : ""}${
                  row._new ? " sheet-row-new" : ""
                }`}
              >
                <td className="sheet-rownum">{index + 1}</td>
                {COLUMNS.map((column) => (
                  <td key={column.field}>
                    {column.readOnly ? (
                      <span className="sheet-readonly">{row[column.field] ?? ""}</span>
                    ) : (
                      <input
                        className="sheet-input"
                        value={row[column.field] ?? ""}
                        placeholder={column.placeholder || ""}
                        disabled={row._deleted || saving}
                        aria-label={`${column.label}, row ${index + 1}`}
                        onChange={(e) => setCell(row._key, column.field, e.target.value)}
                      />
                    )}
                  </td>
                ))}
                <td className="sheet-rowaction">
                  <button
                    type="button"
                    className="sheet-remove"
                    onClick={() => toggleDelete(row._key)}
                    disabled={saving}
                    title={row._deleted ? "Keep this row" : "Remove this row"}
                  >
                    {row._deleted ? "Undo" : "Remove"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {visible.length === 0 && (
          <div className="reminder-empty sheet-empty">
            {query ? `Nothing matches "${query}".` : "No one in the database yet."}
          </div>
        )}
      </div>

      <p className="sheet-hint">
        Edit any cell, then Save. Removed rows stay struck through until you save, so
        Undo puts one back.
      </p>
    </div>
  );
}
