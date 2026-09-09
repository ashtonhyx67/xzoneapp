import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api.js";
import { useAuth } from "../context/AuthContext.jsx";
import { PERMISSIONS } from "../lib/permissions.js";
import { CGS } from "../lib/teams.js";
import { isoWeek } from "../lib/weeks.js";
import { CATEGORIES, CATEGORY_KEYS, STATUSES, isPresent } from "../lib/attendance.js";
import AppShell from "../components/AppShell.jsx";
import WeekPicker from "../components/WeekPicker.jsx";

const SAVE_DELAY = 700;

let counter = 0;
const newKey = () => `new-${(counter += 1)}`;

// One week's register for one team, laid out the way the sheet is written: a
// heading, the legend, then people grouped by category with a count on each
// group and a total at the top. Each person carries one status for the week.
export default function Attendance() {
  const { token, can } = useAuth();
  const canView = can(PERMISSIONS.VIEW_DIRECTORY);

  const [team, setTeam] = useState("");
  const [when, setWhen] = useState(() => isoWeek());
  const [record, setRecord] = useState(null);
  const [title, setTitle] = useState("");
  const [people, setPeople] = useState([]);
  const [directory, setDirectory] = useState([]);
  const [status, setStatus] = useState("idle"); // idle | saving | error
  const [error, setError] = useState("");

  const timer = useRef(null);
  const inFlight = useRef(false);
  const dirty = useRef(false);

  useEffect(() => {
    if (!token || !canView) return;
    const controller = new AbortController();

    Promise.all([
      api.getTeams(token, controller.signal),
      api.getPeople(token, controller.signal),
    ])
      .then(([mine, all]) => {
        setDirectory(all.people);
        setTeam((current) => current || mine.editable[0] || mine.teams[0]?.key || "");
      })
      .catch((err) => {
        if (err.name !== "AbortError") setError(err.message);
      });

    return () => controller.abort();
  }, [token, canView]);

  useEffect(() => {
    if (!token || !team) return;
    const controller = new AbortController();
    let active = true;

    setRecord(null);
    api
      .getAttendance(token, { team, ...when }, controller.signal)
      .then((data) => {
        if (!active) return;
        setRecord(data);
        setTitle(data.title);
        setPeople(
          data.people.map((person) => ({
            key: `p-${person.id}`,
            personId: person.personId,
            name: person.name,
            status: person.status,
            category: person.category,
          }))
        );
        dirty.current = false;
        setError("");
      })
      .catch((err) => {
        if (active && err.name !== "AbortError") setError(err.message);
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [token, team, when]);

  const canEdit = Boolean(record?.canEdit);

  const stateRef = useRef({ people, title });
  stateRef.current = { people, title };

  const flush = useCallback(async () => {
    if (inFlight.current || !dirty.current || !record?.canEdit) return;

    const { people: rows, title: heading } = stateRef.current;
    // A nameless row is still being typed; it is not ready to be written.
    const ready = rows.filter((row) => row.name.trim());

    inFlight.current = true;
    setStatus("saving");
    try {
      const saved = await api.saveAttendance(token, {
        team,
        year: when.year,
        week: when.week,
        title: heading,
        people: ready.map((row) => ({
          personId: row.personId ?? null,
          name: row.name,
          status: row.status,
          category: row.category,
        })),
      });
      dirty.current = false;
      // Counts come back derived, so they can never drift from the register.
      setRecord(saved);
      setStatus("idle");
      setError("");
    } catch (err) {
      setError(err.message);
      setStatus("error");
    } finally {
      inFlight.current = false;
    }
  }, [record, team, token, when]);

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

  const update = useCallback(
    (key, patch) => {
      setPeople((list) => list.map((row) => (row.key === key ? { ...row, ...patch } : row)));
      schedule();
    },
    [schedule]
  );

  function setName(key, name) {
    const match = directory.find(
      (person) => person.name.trim().toLowerCase() === name.trim().toLowerCase()
    );
    // Matching a record links the row to it, which is what makes the category
    // follow the person rather than being restated every week.
    update(key, {
      name,
      personId: match?.id ?? null,
      ...(match ? {} : { category: "" }),
    });
  }

  function addPerson(category) {
    setPeople((list) => [
      ...list,
      { key: newKey(), personId: null, name: "", status: "", category },
    ]);
  }

  // The register, grouped the way the sheet groups it. Anyone whose category is
  // not set yet gets their own block at the end rather than being dropped.
  const groups = useMemo(() => {
    const blocks = CATEGORIES.map((category) => ({
      ...category,
      people: people.filter((person) => person.category === category.key),
    }));

    const ungrouped = people.filter((person) => !CATEGORY_KEYS.includes(person.category));
    if (ungrouped.length > 0) {
      blocks.push({
        key: "",
        label: "No category",
        description: "Set a category on their record so they are counted",
        people: ungrouped,
      });
    }

    return blocks;
  }, [people]);

  // Counted here as well as on the server so the numbers move as boxes are
  // ticked, rather than waiting for the save to come back.
  const total = useMemo(
    () => people.filter((person) => isPresent(person.status)).length,
    [people]
  );

  if (!canView) {
    return (
      <AppShell>
        <header className="page-head">
          <h1 className="page-title">Attendance</h1>
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
        <h1 className="page-title">Attendance</h1>
      </header>

      <div className="panel">
        <div className="sheet-toolbar attendance-toolbar">
          <WeekPicker value={when} onChange={setWhen} />

          <select
            className="roster-team-select"
            aria-label="Team"
            value={team}
            onChange={(e) => setTeam(e.target.value)}
          >
            {CGS.map((cg) => (
              <optgroup key={cg.key} label={cg.key}>
                {cg.teams.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>

          <span className="sheet-status">
            {status === "saving" ? "Saving…" : status === "error" ? "Not saved" : ""}
          </span>
        </div>

        {error && <div className="error-banner panel-notice">{error}</div>}
        {!canEdit && record && (
          <div className="panel-notice list-empty">Read-only — not your team</div>
        )}

        {!record ? (
          <div className="list-empty">Loading…</div>
        ) : (
          <>
            {/* The heading the sheet carries, e.g. "5/6 Sept Next Steps
                WEEKEND!". Free text, because it names what was on that week. */}
            {canEdit ? (
              <input
                className="register-title-input"
                value={title}
                placeholder={`${team} — what was on this week?`}
                aria-label="Week heading"
                onChange={(e) => {
                  setTitle(e.target.value);
                  schedule();
                }}
              />
            ) : (
              title && <h2 className="register-title">{title}</h2>
            )}

            <div className="register-total">
              <span className="register-total-label">Total attendance</span>
              <span className="register-total-value">{total}</span>
            </div>

            <details className="register-legend">
              <summary>Legend</summary>
              <div className="register-legend-list">
                {STATUSES.map((s) => (
                  <span className="legend-item" key={s.key}>
                    <span className="legend-emoji">{s.emoji}</span>
                    {s.label}
                    {!s.counts && <span className="legend-note">not counted</span>}
                  </span>
                ))}
              </div>
            </details>

            {groups.map((group) => (
              <section className="register-group" key={group.key || "none"}>
                <div className="register-group-head">
                  <h3 className="register-group-title" title={group.description}>
                    {group.label}
                  </h3>
                  <span className="register-group-count">
                    {group.people.filter((person) => isPresent(person.status)).length}
                  </span>
                  <span className="register-group-listed">of {group.people.length}</span>

                  {canEdit && group.key && (
                    <button className="link-btn" onClick={() => addPerson(group.key)}>
                      + Add
                    </button>
                  )}
                </div>

                {group.people.length === 0 ? (
                  <div className="list-empty">Nobody listed.</div>
                ) : (
                  <div className="register-rows">
                    {group.people.map((person) => (
                      <div
                        className={`register-row${
                          isPresent(person.status) ? " register-row-present" : ""
                        }`}
                        key={person.key}
                      >
                        {canEdit ? (
                          <input
                            className="register-name"
                            list="attendance-names"
                            value={person.name}
                            placeholder="Name"
                            aria-label="Name"
                            onChange={(e) => setName(person.key, e.target.value)}
                          />
                        ) : (
                          <span className="register-name-text">{person.name}</span>
                        )}

                        {/* One status for the week. The emoji is the label, so
                            the app reads the same as the sheet it replaces. */}
                        <select
                          className="register-status"
                          value={person.status}
                          disabled={!canEdit}
                          aria-label={`Status for ${person.name || "this person"}`}
                          onChange={(e) => update(person.key, { status: e.target.value })}
                        >
                          <option value="">—</option>
                          {STATUSES.map((s) => (
                            <option key={s.key} value={s.key}>
                              {s.emoji} {s.label}
                            </option>
                          ))}
                        </select>

                        {canEdit && (
                          <button
                            className="sheet-remove"
                            onClick={() => {
                              setPeople((list) =>
                                list.filter((row) => row.key !== person.key)
                              );
                              schedule();
                            }}
                            aria-label={`Remove ${person.name || "this row"}`}
                            title="Remove from this week"
                          >
                            ×
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </section>
            ))}

            <datalist id="attendance-names">
              {directory.map((person) => (
                <option key={person.id} value={person.name} />
              ))}
            </datalist>
          </>
        )}
      </div>
    </AppShell>
  );
}
