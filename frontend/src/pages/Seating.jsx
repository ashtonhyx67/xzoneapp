import React, { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api.js";
import { useAuth } from "../context/AuthContext.jsx";
import { PERMISSIONS } from "../lib/permissions.js";
import { CGS } from "../lib/teams.js";
import { isoWeek } from "../lib/weeks.js";
import AppShell from "../components/AppShell.jsx";
import WeekPicker from "../components/WeekPicker.jsx";

let counter = 0;
const newKey = () => `k-${(counter += 1)}`;

const emptyRow = () => ({ key: newKey(), label: "", seats: [] });

// Seating is arranged by hand, one leader per CG, from the names on that week's
// attendance. So this page is a layout tool, not a second register: it offers
// the roll and gets out of the way.
export default function Seating() {
  const { token, can } = useAuth();
  const canView = can(PERMISSIONS.VIEW_DIRECTORY);

  const [cg, setCg] = useState("");
  const [when, setWhen] = useState(() => isoWeek());
  const [record, setRecord] = useState(null);
  const [rows, setRows] = useState([]);
  const [roll, setRoll] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  // Which CG to open on: the one containing a team this account runs.
  useEffect(() => {
    if (!token || !canView) return;
    const controller = new AbortController();

    api
      .getTeams(token, controller.signal)
      .then((mine) => {
        const held = mine.editable[0];
        setCg(
          (current) => current || CGS.find((c) => c.teams.includes(held))?.key || CGS[0].key
        );
      })
      .catch((err) => {
        if (err.name !== "AbortError") setError(err.message);
      });

    return () => controller.abort();
  }, [token, canView]);

  useEffect(() => {
    if (!token || !cg) return;
    const controller = new AbortController();
    let active = true;

    setRecord(null);
    Promise.all([
      api.getSeating(token, { cg, ...when }, controller.signal),
      api.getAttendanceRoll(token, { cg, ...when }, controller.signal),
    ])
      .then(([plan, names]) => {
        if (!active) return;
        setRecord(plan);
        setRows(
          plan.rows.map((row) => ({
            key: `r-${row.id}`,
            label: row.label,
            seats: row.seats.map((seat) => ({ key: `s-${seat.id}`, name: seat.name })),
          }))
        );
        setRoll(names.names);
        setError("");
      })
      .catch((err) => {
        if (active && err.name !== "AbortError") setError(err.message);
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [token, cg, when]);

  const canEdit = Boolean(record?.canEdit);

  // Who is on the roll but not yet placed anywhere. This is the list the
  // arrangement is built from, so it shrinking to nothing is the finish line.
  const seated = useMemo(() => {
    const taken = new Set();
    for (const row of rows) {
      for (const seat of row.seats) {
        if (seat.name.trim()) taken.add(seat.name.trim().toLowerCase());
      }
    }
    return taken;
  }, [rows]);

  const unplaced = useMemo(
    () => roll.filter((person) => !seated.has(person.name.trim().toLowerCase())),
    [roll, seated]
  );

  async function save() {
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const saved = await api.saveSeating(token, {
        cg,
        year: when.year,
        week: when.week,
        rows: rows.map((row) => ({
          label: row.label,
          seats: row.seats.filter((seat) => seat.name.trim()).map((seat) => ({ name: seat.name })),
        })),
      });
      setRecord(saved);
      setNotice("Saved.");
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  const updateRow = (index, patch) =>
    setRows((list) => list.map((row, i) => (i === index ? { ...row, ...patch } : row)));

  function place(name, rowIndex) {
    updateRow(rowIndex, {
      ...rows[rowIndex],
      seats: [...rows[rowIndex].seats, { key: newKey(), name }],
    });
  }

  function removeSeat(rowIndex, seatKey) {
    updateRow(rowIndex, {
      seats: rows[rowIndex].seats.filter((seat) => seat.key !== seatKey),
    });
  }

  function moveRow(index, delta) {
    const target = index + delta;
    if (target < 0 || target >= rows.length) return;
    setRows((list) => {
      const next = [...list];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  if (!canView) {
    return (
      <AppShell>
        <header className="page-head">
          <h1 className="page-title">Seating</h1>
        </header>
        <div className="panel">
          <div className="panel-title">You do not have access to this.</div>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <header className="page-head">
        <h1 className="page-title">Seating arrangement</h1>
      </header>

      <div className="panel">
        <div className="sheet-toolbar attendance-toolbar">
          <WeekPicker value={when} onChange={setWhen} />

          <select
            className="roster-team-select"
            aria-label="CG"
            value={cg}
            onChange={(e) => setCg(e.target.value)}
          >
            {CGS.map((group) => (
              <option key={group.key} value={group.key}>
                {group.key} CG
              </option>
            ))}
          </select>

          {canEdit ? (
            <span className="attendance-actions">
              <button
                className="btn btn-secondary btn-inline"
                onClick={() => setRows((list) => [...list, emptyRow()])}
              >
                + Row
              </button>
              <button className="btn btn-primary btn-inline" onClick={save} disabled={saving}>
                {saving ? "Saving…" : "Save"}
              </button>
            </span>
          ) : (
            <span className="roster-readonly-note">Read-only — not your CG</span>
          )}
        </div>

        {error && <div className="error-banner panel-notice">{error}</div>}
        {notice && <div className="panel-notice list-empty">{notice}</div>}

        {!record ? (
          <div className="list-empty">Loading…</div>
        ) : (
          <div className="seating-layout">
            <div className="seating-plan">
              {rows.length === 0 ? (
                <div className="list-empty">
                  No rows yet. Add one, then place people from the list.
                </div>
              ) : (
                rows.map((row, rowIndex) => (
                  <div className="seating-row" key={row.key}>
                    <div className="seating-row-head">
                      {canEdit ? (
                        <input
                          className="seating-row-label"
                          value={row.label}
                          placeholder={`Row ${rowIndex + 1}`}
                          aria-label={`Row ${rowIndex + 1} name`}
                          onChange={(e) => updateRow(rowIndex, { label: e.target.value })}
                        />
                      ) : (
                        <span className="seating-row-label-text">
                          {row.label || `Row ${rowIndex + 1}`}
                        </span>
                      )}

                      <span className="seating-row-count">{row.seats.length}</span>

                      {canEdit && (
                        <span className="seating-row-tools">
                          <button
                            className="icon-btn"
                            onClick={() => moveRow(rowIndex, -1)}
                            disabled={rowIndex === 0}
                            aria-label="Move row up"
                          >
                            ↑
                          </button>
                          <button
                            className="icon-btn"
                            onClick={() => moveRow(rowIndex, 1)}
                            disabled={rowIndex === rows.length - 1}
                            aria-label="Move row down"
                          >
                            ↓
                          </button>
                          <button
                            className="icon-btn icon-btn-danger"
                            onClick={() =>
                              setRows((list) => list.filter((_, i) => i !== rowIndex))
                            }
                            aria-label="Delete row"
                          >
                            ×
                          </button>
                        </span>
                      )}
                    </div>

                    <div className="seating-seats">
                      {row.seats.map((seat) => (
                        <span className="seat" key={seat.key}>
                          {seat.name}
                          {canEdit && (
                            <button
                              className="seat-remove"
                              onClick={() => removeSeat(rowIndex, seat.key)}
                              aria-label={`Take ${seat.name} out of this row`}
                            >
                              ×
                            </button>
                          )}
                        </span>
                      ))}
                      {row.seats.length === 0 && (
                        <span className="seating-empty">Empty</span>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>

            {canEdit && (
              <aside className="seating-pool">
                <div className="section-head">
                  <h2 className="section-title">To place</h2>
                  <span className="section-count">{unplaced.length}</span>
                </div>

                {roll.length === 0 ? (
                  <div className="list-empty">
                    Nobody on this CG's attendance for week {when.week} yet.
                  </div>
                ) : unplaced.length === 0 ? (
                  <div className="list-empty">Everyone has a seat.</div>
                ) : (
                  <div className="seating-pool-list">
                    {unplaced.map((person) => (
                      <div className="pool-person" key={`${person.team}-${person.name}`}>
                        <span className="pool-name">{person.name}</span>
                        <span className="pool-team">{person.team}</span>
                        {/* Placing into a named row rather than dragging: it
                            works the same on a phone, which is where this is
                            most likely to be done. */}
                        <select
                          className="pool-place"
                          value=""
                          aria-label={`Place ${person.name}`}
                          disabled={rows.length === 0}
                          onChange={(e) => {
                            if (e.target.value === "") return;
                            place(person.name, Number(e.target.value));
                          }}
                        >
                          <option value="">Place…</option>
                          {rows.map((row, index) => (
                            <option key={row.key} value={index}>
                              {row.label || `Row ${index + 1}`}
                            </option>
                          ))}
                        </select>
                      </div>
                    ))}
                  </div>
                )}
              </aside>
            )}
          </div>
        )}
      </div>
    </AppShell>
  );
}
