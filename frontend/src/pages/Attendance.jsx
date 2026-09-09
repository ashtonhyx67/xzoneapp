import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api.js";
import { useAuth } from "../context/AuthContext.jsx";
import { PERMISSIONS } from "../lib/permissions.js";
import { CGS } from "../lib/teams.js";
import { isoWeek } from "../lib/weeks.js";
import AppShell from "../components/AppShell.jsx";
import WeekPicker from "../components/WeekPicker.jsx";

const SAVE_DELAY = 700;

let newRowCounter = 0;
const newKey = () => `new-${(newRowCounter += 1)}`;

// The register for one team for one week: people down the side, sessions across
// the top. Ticks are held against the session's *position*, not its id, because
// a save reissues the ids — position is the thing that survives.
export default function Attendance() {
  const { token, can } = useAuth();
  const canView = can(PERMISSIONS.VIEW_DIRECTORY);

  const [team, setTeam] = useState("");
  const [when, setWhen] = useState(() => isoWeek());
  const [record, setRecord] = useState(null);
  const [people, setPeople] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [directory, setDirectory] = useState([]);
  const [status, setStatus] = useState("idle"); // idle | saving | error
  const [error, setError] = useState("");

  const timer = useRef(null);
  const inFlight = useRef(false);
  const dirty = useRef(false);

  // Which team to open on, and the names to offer. Both come from the same
  // place the rest of the app gets them.
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
        setSessions(data.sessions.map((s) => ({ key: `s-${s.id}`, label: s.label })));
        setPeople(
          data.people.map((p) => ({
            key: `p-${p.id}`,
            personId: p.personId,
            name: p.name,
            // Ids off the wire become positions, which is what a save speaks.
            present: new Set(
              p.present
                .map((id) => data.sessions.findIndex((s) => s.id === id))
                .filter((index) => index >= 0)
            ),
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

  const stateRef = useRef({ people, sessions });
  stateRef.current = { people, sessions };

  const flush = useCallback(async () => {
    if (inFlight.current || !dirty.current || !record?.canEdit) return;

    const { people: rows, sessions: cols } = stateRef.current;
    // A nameless row is still being typed; it is not ready to be written.
    const ready = rows.filter((row) => row.name.trim());

    inFlight.current = true;
    setStatus("saving");
    try {
      await api.saveAttendance(token, {
        team,
        year: when.year,
        week: when.week,
        sessions: cols.map((c) => c.label),
        people: ready.map((row) => ({
          personId: row.personId ?? null,
          name: row.name,
          present: [...row.present],
        })),
      });
      dirty.current = false;
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

  function toggle(personKey, position) {
    setPeople((list) =>
      list.map((row) => {
        if (row.key !== personKey) return row;
        const present = new Set(row.present);
        if (present.has(position)) present.delete(position);
        else present.add(position);
        return { ...row, present };
      })
    );
    schedule();
  }

  function setName(personKey, name) {
    setPeople((list) =>
      list.map((row) => {
        if (row.key !== personKey) return row;
        // Typing a name that is in the database links the row to that record,
        // so the roll can tell a known person from a walk-in.
        const match = directory.find(
          (p) => p.name.trim().toLowerCase() === name.trim().toLowerCase()
        );
        return { ...row, name, personId: match?.id ?? null };
      })
    );
    schedule();
  }

  function addPerson() {
    setPeople((list) => [...list, { key: newKey(), personId: null, name: "", present: new Set() }]);
  }

  function removePerson(personKey) {
    setPeople((list) => list.filter((row) => row.key !== personKey));
    schedule();
  }

  function addSession() {
    setSessions((list) => [...list, { key: newKey(), label: `Session ${list.length + 1}` }]);
    schedule();
  }

  function renameSession(index, label) {
    setSessions((list) => list.map((s, i) => (i === index ? { ...s, label } : s)));
    schedule();
  }

  function removeSession(index) {
    setSessions((list) => list.filter((_, i) => i !== index));
    // Every tick past the removed column shifts down one, and ticks on the
    // column itself go with it.
    setPeople((list) =>
      list.map((row) => {
        const present = new Set();
        for (const position of row.present) {
          if (position < index) present.add(position);
          else if (position > index) present.add(position - 1);
        }
        return { ...row, present };
      })
    );
    schedule();
  }

  const totals = useMemo(
    () => sessions.map((_, index) => people.filter((row) => row.present.has(index)).length),
    [people, sessions]
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
        <span className="page-count">{people.length}</span>
      </header>

      <div className="panel sheet-panel">
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

          {canEdit && (
            <span className="attendance-actions">
              <button className="btn btn-secondary btn-inline" onClick={addPerson}>
                + Person
              </button>
              <button className="btn btn-secondary btn-inline" onClick={addSession}>
                + Session
              </button>
            </span>
          )}
        </div>

        {error && <div className="error-banner panel-notice">{error}</div>}
        {!canEdit && record && (
          <div className="panel-notice list-empty">Read-only — not your team</div>
        )}

        <datalist id="attendance-names">
          {directory.map((person) => (
            <option key={person.id} value={person.name} />
          ))}
        </datalist>

        {!record ? (
          <div className="list-empty">Loading…</div>
        ) : (
          <div className="sheet-scroll">
            <table className="sheet attendance-sheet">
              <thead>
                <tr>
                  <th className="sheet-sticky-col" scope="col" style={{ minWidth: 180 }}>
                    Name
                  </th>
                  {sessions.map((session, index) => (
                    <th key={session.key} scope="col" style={{ minWidth: 110 }}>
                      {canEdit ? (
                        <input
                          className="attendance-session-input"
                          value={session.label}
                          aria-label={`Session ${index + 1} name`}
                          onChange={(e) => renameSession(index, e.target.value)}
                        />
                      ) : (
                        session.label
                      )}
                      {canEdit && sessions.length > 1 && (
                        <button
                          className="attendance-remove-session"
                          onClick={() => removeSession(index)}
                          aria-label={`Remove ${session.label}`}
                          title="Remove this session"
                        >
                          ×
                        </button>
                      )}
                    </th>
                  ))}
                  {canEdit && <th className="sheet-rowaction" scope="col" />}
                </tr>
              </thead>

              <tbody>
                {people.length === 0 ? (
                  <tr>
                    <td colSpan={sessions.length + 2} className="list-empty">
                      Nobody on the list yet.
                    </td>
                  </tr>
                ) : (
                  people.map((row) => (
                    <tr key={row.key}>
                      <td className="sheet-sticky-col">
                        {canEdit ? (
                          <input
                            className="sheet-input"
                            list="attendance-names"
                            value={row.name}
                            placeholder="Name"
                            aria-label="Name"
                            onChange={(e) => setName(row.key, e.target.value)}
                          />
                        ) : (
                          <span className="sheet-readonly">{row.name}</span>
                        )}
                      </td>

                      {sessions.map((session, index) => (
                        <td key={session.key} className="attendance-cell">
                          <input
                            type="checkbox"
                            className="attendance-tick"
                            checked={row.present.has(index)}
                            disabled={!canEdit}
                            aria-label={`${row.name || "Unnamed"} at ${session.label}`}
                            onChange={() => toggle(row.key, index)}
                          />
                        </td>
                      ))}

                      {canEdit && (
                        <td className="sheet-rowaction">
                          <button
                            className="sheet-remove"
                            onClick={() => removePerson(row.key)}
                            aria-label={`Remove ${row.name || "this row"}`}
                            title="Remove from this week"
                          >
                            ×
                          </button>
                        </td>
                      )}
                    </tr>
                  ))
                )}
              </tbody>

              <tfoot>
                <tr>
                  <td className="sheet-sticky-col attendance-total-label">Present</td>
                  {totals.map((total, index) => (
                    <td key={sessions[index].key} className="attendance-cell attendance-total">
                      {total}
                    </td>
                  ))}
                  {canEdit && <td className="sheet-rowaction" />}
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </AppShell>
  );
}
