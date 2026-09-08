import React, { useCallback, useMemo, useRef, useState } from "react";
import { api } from "../api.js";
import { ROLES, findRole, roleTint } from "../lib/roles.js";

// The columns of the people table, in spreadsheet order. `type` picks the kind
// of cell: a plain box, the standard-role dropdown, or a date picker. `readOnly`
// marks a value the server derives — Age comes from Birthday.
const COLUMNS = [
  { field: "name", label: "Name", width: 190, sticky: true },
  { field: "role", label: "Role", width: 120, type: "role" },
  { field: "team", label: "Team", width: 80 },
  { field: "contact", label: "Contact", width: 150 },
  { field: "telegram", label: "Telegram", width: 140 },
  { field: "instagram", label: "Instagram", width: 140 },
  { field: "ministry", label: "Ministry", width: 140 },
  { field: "birthday", label: "Birthday", width: 150, type: "date" },
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

function fingerprint(row) {
  // JSON keeps the field boundaries, so "ab" + "" cannot look like "a" + "b".
  return JSON.stringify(EDITABLE.map((f) => String(row[f] ?? "")));
}

function baselineOf(people) {
  return Object.fromEntries(people.map((p) => [`id-${p.id}`, fingerprint(toRow(p))]));
}

export default function PeopleSheet({ token, people, onSaved }) {
  const [rows, setRows] = useState(() => people.map(toRow));
  const [baseline, setBaseline] = useState(() => baselineOf(people));
  const [query, setQuery] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const gridRef = useRef(null);

  const pendingCount = useMemo(
    () =>
      rows.filter(
        (row) =>
          (row._deleted && !row._new) ||
          (!row._deleted && (row._new || fingerprint(row) !== baseline[row._key]))
      ).length,
    [rows, baseline]
  );

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

  // Up, down, and Enter walk the column the way a spreadsheet does; Tab already
  // walks the row.
  const focusCell = useCallback((rowIndex, colIndex) => {
    const cell = gridRef.current?.querySelector(
      `[data-r="${rowIndex}"][data-c="${colIndex}"]`
    );
    if (cell) {
      cell.focus();
      if (cell.select) cell.select();
    }
  }, []);

  const onCellKeyDown = useCallback(
    (event, rowIndex, colIndex) => {
      const isSelect = event.target.tagName === "SELECT";
      if (event.key === "Enter" || (event.key === "ArrowDown" && !isSelect)) {
        event.preventDefault();
        focusCell(rowIndex + 1, colIndex);
      } else if (event.key === "ArrowUp" && !isSelect) {
        event.preventDefault();
        focusCell(rowIndex - 1, colIndex);
      } else if (event.key === "Escape") {
        event.target.blur();
      }
    },
    [focusCell]
  );

  function addRow() {
    setNotice("");
    setQuery("");
    const nextIndex = rows.length;
    setRows((list) => [...list, blankRow()]);
    // Land in the new row's Name box, ready to type.
    requestAnimationFrame(() => focusCell(nextIndex, 0));
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
      setBaseline(baselineOf(result.people));
      const parts = [];
      if (result.created) parts.push(`${result.created} added`);
      if (result.updated) parts.push(`${result.updated} updated`);
      if (result.deleted) parts.push(`${result.deleted} removed`);
      setNotice(parts.length ? `Saved. ${parts.join(", ")}.` : "Saved.");
      onSaved?.(result.people);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  function renderCell(row, column, rowIndex, colIndex) {
    if (column.readOnly) {
      return <span className="sheet-readonly">{row[column.field] ?? ""}</span>;
    }

    const shared = {
      "data-r": rowIndex,
      "data-c": colIndex,
      disabled: row._deleted || saving,
      "aria-label": `${column.label}, row ${rowIndex + 1}`,
      onKeyDown: (e) => onCellKeyDown(e, rowIndex, colIndex),
    };

    if (column.type === "role") {
      const value = row.role ?? "";
      const tint = roleTint(value);
      // A role that isn't on the standard list is kept and shown, so nothing is
      // silently rewritten just because the list has moved on.
      const custom = value && !findRole(value);
      return (
        <select
          {...shared}
          className={`sheet-input sheet-select${tint ? ` tint-${tint}` : ""}`}
          value={value}
          onChange={(e) => setCell(row._key, "role", e.target.value)}
        >
          <option value=""></option>
          {ROLES.map((role) => (
            <option key={role.value} value={role.value}>
              {role.label}
            </option>
          ))}
          {custom && <option value={value}>{value}</option>}
        </select>
      );
    }

    return (
      <input
        {...shared}
        type={column.type === "date" ? "date" : "text"}
        className="sheet-input"
        value={row[column.field] ?? ""}
        onChange={(e) => setCell(row._key, column.field, e.target.value)}
      />
    );
  }

  return (
    <div className="panel sheet-panel">
      <div className="sheet-toolbar">
        <div className="sheet-heading">
          <span className="sheet-title">People</span>
          <span className="sheet-count">{rows.filter((r) => !r._deleted).length}</span>
          {pendingCount > 0 && <span className="sheet-pending">{pendingCount} unsaved</span>}
        </div>

        <div className="sheet-actions">
          <input
            className="sheet-search"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search"
            placeholder="Search"
          />
          <button className="btn btn-secondary btn-inline" onClick={addRow} disabled={saving}>
            Add row
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
            {saving ? "Saving" : "Save"}
          </button>
        </div>
      </div>

      {error && <div className="error-banner panel-notice">{error}</div>}
      {notice && <div className="success-banner panel-notice">{notice}</div>}

      <div className="sheet-scroll" ref={gridRef}>
        <table className="sheet">
          <thead>
            <tr>
              <th className="sheet-rownum" scope="col">
                #
              </th>
              {COLUMNS.map((column) => (
                <th
                  key={column.field}
                  scope="col"
                  className={column.sticky ? "sheet-sticky-col" : undefined}
                  style={{ minWidth: column.width }}
                >
                  {column.label}
                </th>
              ))}
              <th className="sheet-rowaction" scope="col" />
            </tr>
          </thead>
          <tbody>
            {visible.map((row, rowIndex) => (
              <tr
                key={row._key}
                className={`${row._deleted ? "sheet-row-deleted" : ""}${
                  row._new ? " sheet-row-new" : ""
                }`}
              >
                <td className="sheet-rownum">{rowIndex + 1}</td>
                {COLUMNS.map((column, colIndex) => (
                  <td
                    key={column.field}
                    className={column.sticky ? "sheet-sticky-col" : undefined}
                  >
                    {renderCell(row, column, rowIndex, colIndex)}
                  </td>
                ))}
                <td className="sheet-rowaction">
                  <button
                    type="button"
                    className="sheet-remove"
                    onClick={() => toggleDelete(row._key)}
                    disabled={saving}
                    aria-label={row._deleted ? "Keep this row" : "Remove this row"}
                    title={row._deleted ? "Keep this row" : "Remove this row"}
                  >
                    {row._deleted ? "↺" : "×"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {visible.length === 0 && <div className="sheet-empty">Nothing here</div>}
      </div>
    </div>
  );
}
