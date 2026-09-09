import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api.js";
import { ROLES, findRole, roleTint, roleRank } from "../lib/roles.js";
import { CGS, TEAM_KEYS } from "../lib/teams.js";

// The columns of the people table, in spreadsheet order. `type` picks the kind
// of cell: a plain box, the standard-role dropdown, or a date picker. `readOnly`
// marks a value the server derives — Age comes from Birthday.
const COLUMNS = [
  { field: "name", label: "Name", width: 138, sticky: true },
  { field: "team_key", label: "Team", width: 64, type: "team" },
  { field: "role", label: "Role", width: 70, type: "role" },
  { field: "contact", label: "Contact", width: 94 },
  { field: "telegram", label: "Telegram", width: 88 },
  { field: "instagram", label: "Instagram", width: 88 },
  { field: "ministry", label: "Ministry", width: 86 },
  { field: "birthday", label: "Birthday", width: 108, type: "date" },
  { field: "age", label: "Age", width: 36, readOnly: true },
  { field: "school", label: "School", width: 78 },
  { field: "follow_up", label: "Followup", width: 84 },
  { field: "came_church", label: "Came Church", width: 92 },
  { field: "invited_by", label: "Invited By", width: 88 },
  { field: "religion", label: "Religion", width: 78 },
  { field: "general_information", label: "General Information", width: 168 },
  { field: "updates", label: "Updates", width: 168 },
  { field: "next_steps", label: "Next Steps", width: 168 },
  { field: "photo_url", label: "Photo URL", width: 118 },
];

const EDITABLE = COLUMNS.filter((c) => !c.readOnly).map((c) => c.field);

// How long to wait after the last keystroke before writing. Removing a row
// waits longer, so there is a moment to put it back.
const SAVE_DELAY = 800;
const DELETE_DELAY = 2500;

let newRowCounter = 0;

function toRow(person) {
  const row = { _key: `id-${person.id}`, id: person.id, _deleted: false };
  for (const { field } of COLUMNS) row[field] = person[field] ?? "";
  return row;
}

function blankRow() {
  newRowCounter += 1;
  const row = { _key: `new-${newRowCounter}`, id: null, _deleted: false };
  for (const { field } of COLUMNS) row[field] = "";
  return row;
}

function fingerprint(row) {
  // JSON keeps the field boundaries, so "ab" + "" cannot look like "a" + "b".
  return JSON.stringify(EDITABLE.map((f) => String(row[f] ?? "")));
}

// Excel and Google Sheets put a tab between columns and a newline between rows,
// so a copied block arrives as delimited text. Text copied off a screen instead
// tends to be column-aligned with runs of spaces, so those work too. A single
// space is left alone: it is far likelier to be inside a name than between two
// columns.
function parseClipboardGrid(text) {
  const lines = text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .filter((line) => line.trim() !== "");

  const byTab = text.includes("\t");
  return lines.map((line) =>
    (byTab ? line.split("\t") : line.trim().split(/ {2,}/)).map((cell) => cell.trim())
  );
}

// The date box only accepts YYYY-MM-DD, but a spreadsheet hands over whatever
// it was displaying. Day-first, the way the source sheet wrote them.
function coerceDate(value) {
  const text = String(value).trim();
  if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(text)) {
    const [year, month, day] = text.split("-");
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }
  const parts = text.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (!parts) return "";
  const [, day, month, year] = parts;
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

// Grouped by team, and inside a team by role then name — the same order the
// server hands the table back in, so a reflow never fights it. TEAM_KEYS is
// already in CG order, so the teams of a CG end up next to each other.
function teamRank(team) {
  const index = TEAM_KEYS.indexOf(String(team ?? "").trim().toUpperCase());
  // Anyone not filed into a team yet sits at the end, where they are obvious.
  return index === -1 ? TEAM_KEYS.length : index;
}

const byName = (a, b) => String(a.name ?? "").localeCompare(String(b.name ?? ""));

// How the table can be ordered. Team is the default and the only one that
// groups, since the blocks are teams; the others are a flat list.
const SORTS = {
  team: {
    label: "Team",
    grouped: true,
    compare: (a, b) =>
      teamRank(a.team_key) - teamRank(b.team_key) ||
      roleRank(a.role) - roleRank(b.role) ||
      byName(a, b),
  },
  role: {
    label: "Role",
    grouped: false,
    compare: (a, b) => roleRank(a.role) - roleRank(b.role) || byName(a, b),
  },
  name: { label: "Name", grouped: false, compare: byName },
};

const byTeamThenRole = SORTS.team.compare;

// Rows in display order, split into one block per team. A new row is held in
// place until the next reflow, so a half-typed name does not jump around.
function groupRows(rows) {
  const blocks = [];
  let current = null;

  for (const row of rows) {
    const team = row.team_key || "";
    if (!current || current.team !== team) {
      current = { team, rows: [] };
      blocks.push(current);
    }
    current.rows.push(row);
  }

  return blocks;
}

function baselineOf(rows) {
  return Object.fromEntries(rows.map((row) => [row._key, fingerprint(row)]));
}

export default function PeopleSheet({ token, people, onSaved }) {
  const initial = useMemo(() => people.map(toRow).sort(byTeamThenRole), [people]);

  const [rows, setRows] = useState(initial);
  const [query, setQuery] = useState("");
  const [sortBy, setSortBy] = useState("team");
  const [status, setStatus] = useState("idle"); // idle | saving | error
  const [error, setError] = useState("");

  const gridRef = useRef(null);
  const baseline = useRef(baselineOf(initial));
  // The writer reads the rows through a ref, so it never has to be rebuilt when
  // they change — a rebuilt writer would restart the timer on every keystroke.
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const timer = useRef(null);
  const inFlight = useRef(false);
  // After a rejected write, stop writing until something else changes, so a
  // duplicate name cannot put the grid in a retry loop.
  const blocked = useRef(false);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((row) =>
      COLUMNS.some((c) => String(row[c.field] ?? "").toLowerCase().includes(q))
    );
  }, [rows, query]);

  // Whatever is on screen, split into one block per team. Built from `visible`
  // so a search narrows the blocks rather than hiding the grouping.
  // Only the team ordering groups; the others are one flat list, so the whole
  // table becomes a single unlabelled block.
  const blocks = useMemo(
    () => (SORTS[sortBy].grouped ? groupRows(visible) : [{ team: null, rows: visible }]),
    [visible, sortBy]
  );

  // Rows the server has not seen in their current state. A new row is held back
  // until it has a name, since the database will not take it without one.
  const pending = useCallback((list) => {
    const upserts = list.filter(
      (row) =>
        !row._deleted &&
        fingerprint(row) !== baseline.current[row._key] &&
        String(row.name ?? "").trim()
    );
    const deletes = list.filter((row) => row._deleted && row.id);
    return { upserts, deletes };
  }, []);

  const flush = useCallback(async () => {
    if (inFlight.current || blocked.current) return;

    const { upserts, deletes } = pending(rowsRef.current);
    if (upserts.length === 0 && deletes.length === 0) return;

    // What is being written, remembered per row, so edits made while the
    // request is in the air stay dirty and go in the next write.
    const sent = Object.fromEntries(upserts.map((row) => [row._key, fingerprint(row)]));

    inFlight.current = true;
    setStatus("saving");

    try {
      const result = await api.bulkSavePeople(token, {
        upserts: upserts.map((row) => {
          const payload = { id: row.id };
          for (const field of EDITABLE) payload[field] = row[field] ?? "";
          return payload;
        }),
        deletes: deletes.map((row) => row.id),
      });

      const saved = new Map(result.people.map((p) => [p.name.trim().toLowerCase(), p]));
      const removed = new Set(deletes.map((row) => row._key));

      setRows((list) =>
        list
          .filter((row) => !removed.has(row._key))
          .map((row) => {
            // Only the server's own columns are taken back; everything else is
            // left alone so it cannot overwrite what is being typed right now.
            const match = saved.get(String(row.name ?? "").trim().toLowerCase());
            if (!match) return row;
            baseline.current[row._key] = sent[row._key] ?? baseline.current[row._key];
            return { ...row, id: match.id, age: match.age };
          })
      );

      for (const row of deletes) delete baseline.current[row._key];

      // A row is put in its place once it has been written, not while it is
      // being typed. React keys are stable, so the DOM node moves with the row
      // and a cursor inside it goes along too.
      setRows((list) => [...list].sort(SORTS[sortRef.current].compare));

      setError("");
      setStatus("idle");
      onSaved?.(result.people);
    } catch (err) {
      blocked.current = true;
      setError(err.message);
      setStatus("error");
    } finally {
      inFlight.current = false;
    }
  }, [onSaved, pending, token]);

  const flushRef = useRef(flush);
  flushRef.current = flush;

  // The writer reads the sort through a ref for the same reason it reads the
  // rows that way: so changing it never rebuilds the writer mid-keystroke.
  const sortRef = useRef(sortBy);
  sortRef.current = sortBy;

  // Every change schedules a write; the timer restarts on each keystroke, so a
  // burst of typing is one request.
  const schedule = useCallback((delay = SAVE_DELAY) => {
    blocked.current = false;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      flushRef.current();
    }, delay);
  }, []);

  // Leaving the page with a write still pending would lose it, so it goes out
  // on the way out. Empty deps: this must run at unmount and nowhere else.
  useEffect(() => {
    return () => {
      if (timer.current) {
        clearTimeout(timer.current);
        flushRef.current();
      }
    };
  }, []);

  const setCell = useCallback(
    (key, field, value) => {
      setRows((list) =>
        list.map((row) => (row._key === key ? { ...row, [field]: value } : row))
      );
      schedule();
    },
    [schedule]
  );

  // Pasting a block from a spreadsheet fills across and down from the cell it
  // lands on, the way a spreadsheet does, adding rows at the bottom if the
  // paste is taller than what is there. A plain one-cell paste is left to the
  // browser.
  const onCellPaste = useCallback(
    (event, rowIndex, colIndex) => {
      const text = event.clipboardData?.getData("text/plain") ?? "";
      const grid = parseClipboardGrid(text);
      if (grid.length === 0) return;
      if (grid.length === 1 && grid[0].length <= 1) return;

      event.preventDefault();

      const targets = visible.slice(rowIndex, rowIndex + grid.length).map((row) => row._key);
      const appended = Array.from({ length: Math.max(grid.length - targets.length, 0) }, () =>
        blankRow()
      );

      const patch = new Map();
      grid.forEach((cells, r) => {
        const key = targets[r] ?? appended[r - targets.length]._key;
        const values = {};
        cells.forEach((cell, c) => {
          const column = COLUMNS[colIndex + c];
          // Past the last column, or on Age — which the server derives from
          // Birthday. Its slot is still consumed so a sheet that has an Age
          // column stays lined up with this one.
          if (!column || column.readOnly) return;
          values[column.field] = column.type === "date" ? coerceDate(cell) : cell;
        });
        patch.set(key, values);
      });

      setRows((list) =>
        [...list, ...appended].map((row) =>
          patch.has(row._key) ? { ...row, ...patch.get(row._key) } : row
        )
      );

      // New rows would land outside a filtered view, so drop the filter rather
      // than leave the paste looking like it did nothing.
      if (appended.length > 0) setQuery("");
      schedule();
    },
    [schedule, visible]
  );

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

  function reflow(mode = sortBy) {
    setQuery("");
    setRows((list) => [...list].sort(SORTS[mode].compare));
  }

  // One place to add someone: a blank row at the bottom to type into. Once it
  // saves it sorts itself into the right team, so there is nothing to file by
  // hand.
  function addRow() {
    setQuery("");
    const nextIndex = rows.length;
    setRows((list) => [...list, blankRow()]);
    // Land in the new row's Name box, ready to type.
    requestAnimationFrame(() => focusCell(nextIndex, 0));
  }

  function toggleDelete(key) {
    setRows((list) =>
      list
        // A row that was never saved can just disappear.
        .filter((row) => !(row._key === key && !row.id))
        .map((row) => (row._key === key ? { ...row, _deleted: !row._deleted } : row))
    );
    schedule(DELETE_DELAY);
  }

  function renderCell(row, column, rowIndex, colIndex) {
    if (column.readOnly) {
      return <span className="sheet-readonly">{row[column.field] ?? ""}</span>;
    }

    const shared = {
      "data-r": rowIndex,
      "data-c": colIndex,
      disabled: row._deleted,
      "aria-label": `${column.label}, row ${rowIndex + 1}`,
      onKeyDown: (e) => onCellKeyDown(e, rowIndex, colIndex),
      onPaste: (e) => onCellPaste(e, rowIndex, colIndex),
    };

    if (column.type === "team") {
      return (
        <select
          {...shared}
          className="sheet-input sheet-select"
          value={row[column.field] ?? ""}
          onChange={(e) => setCell(row._key, column.field, e.target.value)}
        >
          <option value="">—</option>
          {/* Grouped by CG, so the list reads the way the zone is actually
              organised rather than as five flat options. */}
          {CGS.map((cg) => (
            <optgroup key={cg.key} label={cg.key}>
              {cg.teams.map((team) => (
                <option key={team} value={team}>
                  {team}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      );
    }

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
        <div className="sheet-actions">
          <div className="sheet-search-wrap">
            <svg className="sheet-search-icon" viewBox="0 0 16 16" aria-hidden="true">
              <circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
              <line
                x1="10.4"
                y1="10.4"
                x2="14"
                y2="14"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
              />
            </svg>
            <input
              className="sheet-search"
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Search"
            />
          </div>
          <button className="btn btn-secondary btn-inline" onClick={addRow}>
            Add row
          </button>

          <label className="sheet-sort">
            Sort by
            <select
              value={sortBy}
              aria-label="Sort the table by"
              onChange={(e) => {
                setSortBy(e.target.value);
                reflow(e.target.value);
              }}
            >
              {Object.entries(SORTS).map(([key, sort]) => (
                <option key={key} value={key}>
                  {sort.label}
                </option>
              ))}
            </select>
          </label>
          <span
            className={`sheet-status sheet-status-${status}`}
            role="status"
            aria-label={status === "saving" ? "Saving" : "Saved"}
          />
        </div>
      </div>

      {error && <div className="error-banner panel-notice">{error}</div>}

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
            {blocks.map((block) => (
              <React.Fragment key={block.team || "unassigned"}>
                {/* One heading per team, so the grid reads as blocks rather
                    than one long undifferentiated list. Only when the table is
                    ordered by team — the other orders are a flat list. */}
                {block.team !== null && (
                  <tr className="sheet-group-row">
                    <td className="sheet-group-cell" colSpan={COLUMNS.length + 2}>
                      <span className="sheet-group-chip">
                        <span className="sheet-group-name">{block.team || "No team"}</span>
                        <span className="sheet-group-count">{block.rows.length}</span>
                      </span>
                    </td>
                  </tr>
                )}

                {block.rows.map((row) => {
                  const rowIndex = visible.indexOf(row);
                  return (
              <tr key={row._key} className={row._deleted ? "sheet-row-deleted" : undefined}>
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
                    aria-label={row._deleted ? "Keep this row" : "Remove this row"}
                    title={row._deleted ? "Keep this row" : "Remove this row"}
                  >
                    {row._deleted ? "↺" : "×"}
                  </button>
                </td>
              </tr>
                  );
                })}
              </React.Fragment>
            ))}
          </tbody>
        </table>

        {visible.length === 0 && <div className="sheet-empty">Nothing here</div>}
      </div>
    </div>
  );
}
