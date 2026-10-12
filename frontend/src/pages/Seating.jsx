import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "../api.js";
import { useAuth } from "../context/AuthContext.jsx";
import { PERMISSIONS } from "../lib/permissions.js";
import { SEATING_CGS } from "../lib/teams.js";
import { useWeek } from "../lib/useWeek.js";
import AppShell from "../components/AppShell.jsx";
import WeekPicker from "../components/WeekPicker.jsx";
import { useFlip } from "../lib/flip.js";
import { useDragAndDrop } from "../lib/useDragAndDrop.js";

let counter = 0;
const newKey = () => `k-${(counter += 1)}`;

const emptyRow = () => ({ key: newKey(), label: "", seats: [] });

const SAVE_DELAY = 700;

// One key per name in the "to place" list, so a card going back there can be
// matched to the one that appears.
const poolKey = (name) => `p-${name.trim().toLowerCase()}`;

const sameTarget = (a, b) =>
  a === b ||
  (Boolean(a?.pool) && Boolean(b?.pool)) ||
  (a != null && b != null && !a.pool && !b.pool && a.rowIndex === b.rowIndex && a.index === b.index);

// Moves a name into a row at a position, taking it out of wherever it was
// first, so moving between rows moves rather than duplicates. Returns the same
// list when nothing would change.
function moveInto(list, item, key, rowIndex, index) {
  if (item.from != null) {
    const fromSeats = list[item.from]?.seats || [];
    const was = fromSeats.findIndex((seat) => seat.key === item.key);
    if (item.from === rowIndex && was === index) return list;
  }
  const next = list.map((row) => ({
    ...row,
    seats: item.key == null ? row.seats : row.seats.filter((seat) => seat.key !== item.key),
  }));
  const seats = [...next[rowIndex].seats];
  seats.splice(Math.min(index, seats.length), 0, { key, name: item.name });
  next[rowIndex] = { ...next[rowIndex], seats };
  return next;
}

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
  const [finalised, setFinalised] = useState(false);
  const [status, setStatus] = useState("idle"); // idle | saving | error
  const [error, setError] = useState("");

  const timer = useRef(null);
  const layoutRef = useRef(null);
  const planRef = useRef(null);
  const flip = useFlip(layoutRef);
  const inFlight = useRef(false);
  const dirty = useRef(false);

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
    api
      .getSeating(token, { cg, ...when }, controller.signal)
      .then((plan) => {
        if (!active) return;
        setRecord(plan);
        setFinalised(Boolean(plan.finalised));
        setRows(
          plan.rows.map((row) => ({
            key: `r-${row.id}`,
            label: row.label,
            seats: row.seats.map((seat) => ({ key: `s-${seat.id}`, name: seat.name })),
          }))
        );
        dirty.current = false;
        setError("");

        // The roll comes from the registers, which a member cannot read — and
        // has no use for, since they are not arranging anything.
        if (!plan.canEdit) {
          setRoll([]);
          return;
        }

        return api
          .getAttendanceRoll(token, { cg, ...when }, controller.signal)
          .then((names) => active && setRoll(names.names))
          .catch(() => {
            /* the plan is still readable without the list to add from */
          });
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

  // Saved as it is arranged, like the register and the database grid. The same
  // guards those use: cleared before sending so a change made mid-request is
  // not wiped by the answer to one that predates it, and a save that finds more
  // waiting schedules another.
  const stateRef = useRef({ rows, finalised });
  stateRef.current = { rows, finalised };

  const flush = useCallback(async () => {
    if (!record?.canEdit) return;
    if (inFlight.current) return;
    if (!dirty.current) return;

    dirty.current = false;
    const { rows: plan, finalised: done } = stateRef.current;

    inFlight.current = true;
    setStatus("saving");
    try {
      await api.saveSeating(token, {
        cg,
        year: when.year,
        week: when.week,
        finalised: done,
        rows: plan.map((row) => ({
          label: row.label,
          seats: row.seats.filter((seat) => seat.name.trim()).map((seat) => ({ name: seat.name })),
        })),
      });
      setStatus("idle");
      setError("");
    } catch (err) {
      dirty.current = true;
      setError(err.message);
      setStatus("error");
    } finally {
      inFlight.current = false;
      if (dirty.current) setTimeout(() => flushRef.current(), 200);
    }
  }, [cg, record, token, when]);

  const flushRef = useRef(flush);
  flushRef.current = flush;

  const schedule = useCallback(() => {
    dirty.current = true;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      flushRef.current();
    }, SAVE_DELAY);
  }, []);

  // A pending write must not be lost on the way out. Empty deps: unmount only.
  useEffect(() => {
    return () => {
      if (timer.current) {
        clearTimeout(timer.current);
        flushRef.current();
      }
    };
  }, []);

  const updateRow = (index, patch) => {
    setRows((list) => list.map((row, i) => (i === index ? { ...row, ...patch } : row)));
    schedule();
  };

  // Puts a name at a position in a row: the end of it for a tap, wherever it
  // was dropped for a drag.
  function place(item, rowIndex, index = Infinity, from = null) {
    if (!item || rowIndex == null) return;
    const key = item.key ?? newKey();
    flip("seat", from ? { [key]: from } : undefined);
    const current = stateRef.current.rows;
    const next = moveInto(current, item, key, rowIndex, index === Infinity ? current[rowIndex].seats.length : index);
    setHeld(null);
    if (next !== current) {
      setRows(next);
      schedule();
    }
  }

  function removeSeat(rowIndex, seatKey, from = null) {
    const seat = rows[rowIndex]?.seats.find((s) => s.key === seatKey);
    flip("seat", seat && from ? { [poolKey(seat.name)]: from } : undefined);
    updateRow(rowIndex, {
      seats: rows[rowIndex].seats.filter((s) => s.key !== seatKey),
    });
  }

  // Finalising is what makes the plan visible to everyone else, so it saves at
  // once rather than waiting for the pause an edit waits for.
  function toggleFinalised() {
    setFinalised((done) => !done);
    dirty.current = true;
    if (timer.current) clearTimeout(timer.current);
    setTimeout(() => flushRef.current(), 0);
  }

  // Which row, and where in it, is under the pointer — or the "to place" list,
  // which takes a seated name back out of its row.
  const findTarget = useCallback((x, y, s) => {
    const el = document.elementFromPoint(x, y);
    if (!el) return null;
    if (el.closest("[data-drop-pool]")) return s.item.from != null ? { pool: true } : null;

    const rowEl = el.closest("[data-drop-row]");
    if (!rowEl) {
      // In the gap between two rows: keep the last answer, so the gap does not
      // flicker as the pointer crosses it.
      return el.closest(".seating-plan") ? s.target : null;
    }

    const list = rowEl.querySelector(".seating-seats");
    const top = list.getBoundingClientRect().top;
    const seats = [...list.querySelectorAll("[data-seat]")].filter(
      (node) => node.dataset.flipKey !== s.key
    );
    // Layout positions, not on-screen ones: a card still sliding out of the
    // way must not change the answer while it slides.
    let index = 0;
    for (const node of seats) {
      if (node.offsetTop + node.offsetHeight / 2 < y - top) index += 1;
      else break;
    }
    return { rowIndex: Number(rowEl.dataset.dropRow), index };
  }, []);

  const dnd = useDragAndDrop({
    findTarget,
    sameTarget,
    scrollers: () => [planRef.current],
    // The gap opening under the pointer: everyone around it slides aside.
    onTargetChange: () => flip("seat"),
    onDrop: (item, target, ghostRect) => {
      if (target?.pool) {
        removeSeat(item.from, item.key, ghostRect);
      } else if (target) {
        place(item, target.rowIndex, target.index, ghostRect);
      } else {
        // Dropped nowhere: it floats back to where it came from.
        flip("seat", { [item.key ?? poolKey(item.name)]: ghostRect });
      }
    },
  });
  const { drag } = dnd;

  // Rows are drawn as columns, so moving one is sideways — the arrows say so.
  function moveRow(index, delta) {
    const target = index + delta;
    if (target < 0 || target >= rows.length) return;
    flip("row");
    setRows((list) => {
      const next = [...list];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
    schedule();
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
                onClick={() => {
                  flip("row");
                  setRows((list) => [...list, emptyRow()]);
                  schedule();
                }}
              >
                + Row
              </button>

              {/* What makes the plan everyone else's to read. Until it is on,
                  a member sees nothing — a half-built arrangement is not
                  somewhere to go and sit. */}
              <button
                className={`btn btn-inline ${finalised ? "btn-secondary" : "btn-primary"}`}
                onClick={toggleFinalised}
                title={
                  finalised
                    ? "Everyone can see this. Press to take it back."
                    : "Nobody else can see this yet."
                }
              >
                {finalised ? "Finalised ✓" : "Finalise"}
              </button>

              <span className="sheet-status">
                {status === "saving" ? "Saving…" : status === "error" ? "Not saved" : ""}
              </span>
            </span>
          ) : (
            <span className="roster-readonly-note">
              {record?.finalised ? "Read-only" : ""}
            </span>
          )}
        </div>

        {error && <div className="error-banner panel-notice">{error}</div>}

        {!record ? (
          <div className="list-empty">Loading…</div>
        ) : (
          <div className="seating-layout" ref={layoutRef}>
            <div className={`seating-plan${drag ? " seating-plan-dragging" : ""}`} ref={planRef}>
              {rows.length === 0 ? (
                <div className="list-empty">No rows yet.</div>
              ) : (
                rows.map((row, rowIndex) => {
                  const target = drag?.target;
                  const gapHere = Boolean(target && !target.pool && target.rowIndex === rowIndex);
                  // The gap a dragged card will land in, the same height as the card.
                  const gap = (
                    <span
                      key="gap"
                      className="seat-gap"
                      data-flip="seat"
                      data-flip-key={`gap-${row.key}`}
                      style={{ height: drag?.rect.height }}
                      aria-hidden="true"
                    />
                  );

                  const items = [];
                  let shown = 0;
                  for (const seat of row.seats) {
                    const lifted = drag?.key === seat.key;
                    if (!lifted && gapHere && shown === target.index) items.push(gap);
                    const item = { name: seat.name, from: rowIndex, key: seat.key };
                    items.push(
                      <span
                        className={`seat${held?.key === seat.key ? " seat-held" : ""}${
                          lifted ? " seat-lifted" : ""
                        }`}
                        key={seat.key}
                        data-seat=""
                        data-flip="seat"
                        data-flip-key={seat.key}
                        role={canEdit ? "button" : undefined}
                        tabIndex={canEdit ? 0 : undefined}
                        onPointerDown={canEdit ? (e) => dnd.pointerDown(e, item, seat.key) : undefined}
                        onContextMenu={(e) => canEdit && e.preventDefault()}
                        onClick={(e) => {
                          if (!canEdit) return;
                          // Stop the row underneath treating this as a drop.
                          e.stopPropagation();
                          if (dnd.justDragged()) return;
                          setHeld((current) => (current?.key === seat.key ? null : item));
                        }}
                        onKeyDown={(e) => {
                          if (!canEdit || (e.key !== "Enter" && e.key !== " ")) return;
                          if (e.target !== e.currentTarget) return;
                          e.preventDefault();
                          e.stopPropagation();
                          setHeld((current) => (current?.key === seat.key ? null : item));
                        }}
                      >
                        <span className="seat-name">{seat.name}</span>
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
                    );
                    if (!lifted) shown += 1;
                  }
                  if (gapHere && target.index >= shown) items.push(gap);

                  return (
                    <div
                      className={`seating-row${gapHere ? " seating-row-target" : ""}${
                        held ? " seating-row-armed" : ""
                      }`}
                      key={row.key}
                      data-drop-row={rowIndex}
                      data-flip="row"
                      data-flip-key={row.key}
                      tabIndex={held ? 0 : undefined}
                      // Tapping a row drops whoever is being carried into it, so
                      // the whole thing also works as tap, then tap.
                      onClick={() => canEdit && held && !dnd.justDragged() && place(held, rowIndex)}
                      onKeyDown={(e) => {
                        if (canEdit && held && e.key === "Enter" && e.target === e.currentTarget) {
                          place(held, rowIndex);
                        }
                      }}
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
                              onClick={() => {
                                flip("row");
                                setRows((list) => list.filter((_, i) => i !== rowIndex));
                                schedule();
                              }}
                              aria-label="Delete row"
                            >
                              ×
                            </button>
                          </span>
                        )}
                      </div>

                      <div className="seating-seats">
                        {items}
                        {shown === 0 && !gapHere && <span className="seating-empty">Empty</span>}
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {canEdit && (
              <aside
                className={`seating-pool${drag?.target?.pool ? " seating-pool-over" : ""}${
                  drag && drag.item.from != null ? " seating-pool-armed" : ""
                }`}
                data-drop-pool=""
              >
                <div className="section-head">
                  <h2 className="section-title">To place</h2>
                  <span className="section-count">{unplaced.length}</span>
                </div>

                {drag && drag.item.from != null && (
                  <div className="seating-pool-hint">Drop here to take them out of their row</div>
                )}

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
                      const key = poolKey(person.name);
                      const picked = held?.from === null && held?.name === person.name;
                      return (
                        <div
                          className={`pool-person${picked ? " pool-person-held" : ""}${
                            drag?.key === key ? " pool-person-source" : ""
                          }`}
                          key={`${person.team}-${person.name}`}
                          data-flip="seat"
                          data-flip-key={key}
                          role="button"
                          tabIndex={0}
                          onPointerDown={(e) => dnd.pointerDown(e, item, key)}
                          onContextMenu={(e) => e.preventDefault()}
                          // Hold and drag, or tap here then tap a row: the same
                          // move either way.
                          onClick={() => !dnd.justDragged() && setHeld(picked ? null : item)}
                          onKeyDown={(e) => {
                            if (e.key !== "Enter" && e.key !== " ") return;
                            e.preventDefault();
                            setHeld(picked ? null : item);
                          }}
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
      {/* Only while something is in hand from a tap. It says the tap
          registered and what happens next. */}
      {canEdit && held && !drag && (
        <div className="carrying" role="status">
          <span className="carrying-name">{held.name}</span>
          <span className="carrying-hint">tap a row</span>
          <button className="carrying-cancel" onClick={() => setHeld(null)}>
            Cancel
          </button>
        </div>
      )}

      {/* The card in your hand. Drawn on the body, outside the page, so nothing
          the page does to its own layers can catch it; moved by the drag hook,
          not by React, so it keeps up with a finger. */}
      {drag &&
        createPortal(
          <div
            className="drag-ghost"
            ref={dnd.ghostRef}
            style={{ width: drag.rect.width, height: drag.rect.height }}
            aria-hidden="true"
          >
            <div className="drag-ghost-card">{drag.item.name}</div>
          </div>,
          document.body
        )}
    </AppShell>
  );
}
