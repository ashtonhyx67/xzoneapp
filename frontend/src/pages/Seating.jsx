import React, { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api.js";
import { useAuth } from "../context/AuthContext.jsx";
import { PERMISSIONS } from "../lib/permissions.js";
import { SEATING_CGS } from "../lib/teams.js";
import { useWeek } from "../lib/useWeek.js";
import AppShell from "../components/AppShell.jsx";
import WeekPicker from "../components/WeekPicker.jsx";

let counter = 0;
const newKey = () => `k-${(counter += 1)}`;

const emptyRow = () => ({ key: newKey(), label: "", seats: [] });

// Seating is arranged by hand, one leader per CG, from the names on that week's
// attendance. So this page is a layout tool, not a second register: it offers
// the roll and gets out of the way. X3 and X2 arrange seating; X1 does not.
export default function Seating() {
  const { token, can } = useAuth();
  const canView = can(PERMISSIONS.VIEW_DIRECTORY);

  const [cg, setCg] = useState("");
  const [when, setWhen] = useWeek();
  const [record, setRecord] = useState(null);
  const [rows, setRows] = useState([]);
  const [roll, setRoll] = useState([]);
  // What is being moved. Drag carries it on desktop; tapping picks it up on a
  // phone, where dragging across a scrolling list is close to unusable.
  const [held, setHeld] = useState(null);
  const [overRow, setOverRow] = useState(null);
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
        const myTeam = mine.mine[0] || mine.editable[0];
        setCg(
          (current) =>
            current ||
            SEATING_CGS.find((c) => c.teams.includes(myTeam))?.key ||
            SEATING_CGS[0].key
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

  // Puts a name into a row, taking it out of wherever it was first, so dragging
  // between rows moves rather than duplicates.
  function place(item, rowIndex) {
    if (!item || rowIndex == null) return;

    setRows((list) => {
      const next = list.map((row) => ({
        ...row,
        seats:
          item.from == null ? row.seats : row.seats.filter((seat) => seat.key !== item.key),
      }));
      next[rowIndex] = {
        ...next[rowIndex],
        seats: [...next[rowIndex].seats, { key: newKey(), name: item.name }],
      };
      return next;
    });

    setHeld(null);
    setOverRow(null);
  }

  function removeSeat(rowIndex, seatKey) {
    updateRow(rowIndex, {
      seats: rows[rowIndex].seats.filter((seat) => seat.key !== seatKey),
    });
  }

  // The same payload however it was picked up, so drop and tap share one path.
  function dragStart(event, item) {
    setHeld(item);
    event.dataTransfer.effectAllowed = "move";
    // Some browsers refuse to start a drag without data set on it.
    event.dataTransfer.setData("text/plain", item.name);
  }

  function dropOn(event, rowIndex) {
    event.preventDefault();
    place(held, rowIndex);
  }

  // Rows are drawn as columns, so moving one is sideways — the arrows say so.
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
        <h1 className="page-title">Seating Arrangement</h1>
      </header>

      <div className="panel">
        <div className="attendance-toolbar">
          <div className="picker-box">
            <WeekPicker value={when} onChange={setWhen} />

            <span className="picker-divider" aria-hidden="true" />

            <select
              className="picker-team"
              aria-label="CG"
              value={cg}
              onChange={(e) => setCg(e.target.value)}
            >
              {SEATING_CGS.map((group) => (
                <option key={group.key} value={group.key}>
                  {group.key} CG
                </option>
              ))}
            </select>
          </div>

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
                <div className="list-empty">No rows yet.</div>
              ) : (
                rows.map((row, rowIndex) => (
                  <div
                    className={`seating-row${
                      overRow === rowIndex ? " seating-row-over" : ""
                    }${held ? " seating-row-armed" : ""}`}
                    key={row.key}
                    onDragOver={(e) => {
                      if (!canEdit || !held) return;
                      e.preventDefault();
                      setOverRow(rowIndex);
                    }}
                    onDragLeave={() => setOverRow((r) => (r === rowIndex ? null : r))}
                    onDrop={(e) => canEdit && dropOn(e, rowIndex)}
                    // Tapping a row drops whoever is being carried into it, so
                    // the whole thing works without a drag on a phone.
                    onClick={() => canEdit && held && place(held, rowIndex)}
                  >
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
                            aria-label="Move this row left"
                            title="Move left"
                          >
                            ←
                          </button>
                          <button
                            className="icon-btn"
                            onClick={() => moveRow(rowIndex, 1)}
                            disabled={rowIndex === rows.length - 1}
                            aria-label="Move this row right"
                            title="Move right"
                          >
                            →
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
                        <span
                          className={`seat${
                            held?.key === seat.key ? " seat-held" : ""
                          }`}
                          key={seat.key}
                          draggable={canEdit}
                          onDragStart={(e) =>
                            dragStart(e, { name: seat.name, from: rowIndex, key: seat.key })
                          }
                          onDragEnd={() => {
                            setHeld(null);
                            setOverRow(null);
                          }}
                          onClick={(e) => {
                            if (!canEdit) return;
                            // Stop the row underneath treating this as a drop.
                            e.stopPropagation();
                            setHeld((current) =>
                              current?.key === seat.key
                                ? null
                                : { name: seat.name, from: rowIndex, key: seat.key }
                            );
                          }}
                        >
                          {seat.name}
                          {canEdit && (
                            <button
                              className="seat-remove"
                              onClick={(e) => {
                                e.stopPropagation();
                                removeSeat(rowIndex, seat.key);
                              }}
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
                    Nobody is marked present for week {when.week} yet. Mark the
                    register and they will appear here.
                  </div>
                ) : unplaced.length === 0 ? (
                  <div className="list-empty">Everyone has a seat.</div>
                ) : (
                  <div className="seating-pool-list">
                    {unplaced.map((person) => {
                      const item = { name: person.name, from: null, key: null };
                      const picked = held?.from === null && held?.name === person.name;
                      return (
                        <div
                          className={`pool-person${picked ? " pool-person-held" : ""}`}
                          key={`${person.team}-${person.name}`}
                          draggable
                          onDragStart={(e) => dragStart(e, item)}
                          onDragEnd={() => {
                            setHeld(null);
                            setOverRow(null);
                          }}
                          // Drag on a desktop, tap here then tap a row on a
                          // phone — the same move either way.
                          onClick={() => setHeld(picked ? null : item)}
                        >
                          <span className="pool-name">{person.name}</span>
                          <span className="pool-team">{person.team}</span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </aside>
            )}
          </div>
        )}
      </div>
      {/* Only while something is in hand. A phone cannot show a drag, so this
          is what says the tap registered and what happens next. */}
      {canEdit && held && (
        <div className="carrying" role="status">
          <span className="carrying-name">{held.name}</span>
          <span className="carrying-hint">tap a row</span>
          <button className="carrying-cancel" onClick={() => setHeld(null)}>
            Cancel
          </button>
        </div>
      )}
    </AppShell>
  );
}
