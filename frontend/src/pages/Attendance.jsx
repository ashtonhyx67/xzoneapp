import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api.js";
import { useAuth } from "../context/AuthContext.jsx";
import { PERMISSIONS } from "../lib/permissions.js";
import { CGS } from "../lib/teams.js";
import { isoWeek } from "../lib/weeks.js";
import { BUILTIN_STATUSES, CATEGORIES, CATEGORY_KEYS, categoryOf, isPresent } from "../lib/attendance.js";
import AppShell from "../components/AppShell.jsx";
import WeekPicker from "../components/WeekPicker.jsx";

const SAVE_DELAY = 700;

let counter = 0;
const newKey = () => `new-${(counter += 1)}`;

// One person's line. Memoised because a register can run to forty people and a
// tap changes exactly one of them — without this, every row and every mark on
// the page re-rendered on each tap, which is what made marking feel sticky.
// Toggling replaces only the person it touched, so every other row keeps its
// identity and React skips it.
const RegisterRow = React.memo(function RegisterRow({
  person,
  statuses,
  canEdit,
  onToggle,
  onRename,
  onRemove,
}) {
  const here = isPresent(person.statuses, statuses);

  return (
    <div className={`register-row${here ? " register-row-present" : ""}`}>
      {canEdit && !person.fromTeam ? (
        <input
          className="register-name"
          list="attendance-names"
          value={person.name}
          placeholder="Name"
          aria-label="Name"
          onChange={(e) => onRename(person.key, e.target.value)}
        />
      ) : (
        // Someone with a record: their name belongs to it, so it is changed
        // there rather than here.
        <span className="register-name-text">{person.name}</span>
      )}

      {/* Toggles rather than a dropdown: someone can be at more than one thing
          in a week, and a tap is quicker than opening a list on a phone. */}
      <span className="register-marks">
        {statuses.map((s) => (
          <button
            type="button"
            key={s.key}
            className={`mark${person.statuses.includes(s.key) ? " mark-on" : ""}`}
            disabled={!canEdit}
            aria-pressed={person.statuses.includes(s.key)}
            title={s.label + (s.counts ? "" : " (not counted)")}
            aria-label={`${s.label} for ${person.name || "this person"}`}
            onClick={() => onToggle(person.key, s.key)}
          >
            {s.emoji || s.label.slice(0, 2)}
          </button>
        ))}
      </span>

      {/* Only a name added by hand can be taken off. Anyone with a record is
          always listed; not coming is what an empty row of marks means. */}
      {canEdit && !person.fromTeam && (
        <button
          className="sheet-remove"
          onClick={() => onRemove(person.key)}
          aria-label={`Remove ${person.name || "this row"}`}
          title="Remove from this week"
        >
          ×
        </button>
      )}
    </div>
  );
});

// One week's register for one team, laid out the way the sheet is written:
// people grouped by their role, a count on each group, and the total across the
// top. A person can carry more than one status, so the statuses are toggles.
export default function Attendance() {
  const { token, can } = useAuth();
  const canView = can(PERMISSIONS.VIEW_DIRECTORY);

  const [team, setTeam] = useState("");
  const [when, setWhen] = useState(() => isoWeek());
  const [record, setRecord] = useState(null);
  const [statuses, setStatuses] = useState(BUILTIN_STATUSES);
  const [people, setPeople] = useState([]);
  const [adding, setAdding] = useState(false);
  const [newStatus, setNewStatus] = useState({ label: "", emoji: "", counts: true });
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
        // Their own team first: every account may edit every team now, so the
        // first editable one is X3A for everybody, which would open every
        // leader on someone else's register.
        setTeam((current) => current || mine.mine[0] || mine.editable[0] || "");
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
        setStatuses(data.statuses ?? BUILTIN_STATUSES);
        setPeople(
          data.people.map((person) => ({
            key: `p-${person.id}`,
            personId: person.personId,
            name: person.name,
            statuses: person.statuses ?? [],
            category: person.category,
            fromTeam: person.fromTeam,
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

  const stateRef = useRef({ people });
  stateRef.current = { people };

  const flush = useCallback(async () => {
    if (!record?.canEdit) return;

    // A save is already going. Leave the work marked as outstanding and let the
    // one in flight pick it up when it lands — dropping out here without that
    // is what lost marks made while a save was on the wire.
    if (inFlight.current) return;
    if (!dirty.current) return;

    // Cleared before sending, not after: anything ticked from here on marks it
    // dirty again, so a mark made mid-request survives instead of being wiped
    // by the response to a request that predates it.
    dirty.current = false;

    const { people: rows } = stateRef.current;
    // A nameless row is still being typed; it is not ready to be written.
    const ready = rows.filter((row) => row.name.trim());

    inFlight.current = true;
    setStatus("saving");
    try {
      const saved = await api.saveAttendance(token, {
        team,
        year: when.year,
        week: when.week,
        people: ready.map((row) => ({
          personId: row.personId ?? null,
          name: row.name,
          statuses: row.statuses,
          category: row.category,
        })),
      });
      // Anyone the server put back — added to the team since this page was
      // loaded — is taken on. Merged rather than replacing the list wholesale,
      // so a mark made while the save was in the air is not overwritten by a
      // response that predates it. When there is nobody new the same array is
      // returned, so React has no re-render to do and marking stays smooth.
      setPeople((list) => {
        const known = new Set(list.map((row) => row.personId).filter(Boolean));
        const added = (saved.people ?? [])
          .filter((person) => person.personId && !known.has(person.personId))
          .map((person) => ({
            key: `p-${person.id}`,
            personId: person.personId,
            name: person.name,
            statuses: person.statuses ?? [],
            category: person.category,
            fromTeam: person.fromTeam,
          }));
        return added.length ? [...list, ...added] : list;
      });

      setStatus("idle");
      setError("");
    } catch (err) {
      // Still unsaved, so it must go out again rather than be forgotten.
      dirty.current = true;
      setError(err.message);
      setStatus("error");
    } finally {
      inFlight.current = false;
      // Whatever was ticked while this was in the air, or a failed write worth
      // retrying.
      if (dirty.current) setTimeout(() => flushRef.current(), 200);
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

  const setName = useCallback((key, name) => {
    const match = directory.find(
      (person) => person.name.trim().toLowerCase() === name.trim().toLowerCase()
    );
    // Matching a record links the row to it, which is what makes the group
    // follow the person rather than being restated every week. A name that
    // matches nothing keeps the group it was added under — clearing it would
    // throw a guest into "No category" on the first keystroke, before they had
    // finished typing their own name.
    update(key, {
      name,
      personId: match?.id ?? null,
      ...(match ? { category: categoryOf(match.role) } : {}),
    });
  }, [directory, update]);

  // A person can be at more than one thing in a week, so a status is toggled
  // rather than chosen. Wrapped so its identity is stable: a row below is
  // memoised, and a callback rebuilt every render would defeat that.
  const toggleStatus = useCallback((personKey, statusKey) => {
    // The order marks are offered in, so a row always reads the same way.
    const order = statuses.map((s) => s.key);
    const rank = (key) => {
      const index = order.indexOf(key);
      // A mark the register no longer offers keeps its place at the end rather
      // than being dropped. Rebuilding the row from the offered list instead is
      // what made ticking one box clear another.
      return index === -1 ? order.length : index;
    };

    setPeople((list) =>
      list.map((row) => {
        if (row.key !== personKey) return row;
        const next = row.statuses.includes(statusKey)
          ? row.statuses.filter((key) => key !== statusKey)
          : [...row.statuses, statusKey];
        return { ...row, statuses: next.sort((a, b) => rank(a) - rank(b)) };
      })
    );
    schedule();
  }, [statuses, schedule]);

  const removePerson = useCallback(
    (personKey) => {
      setPeople((list) => list.filter((row) => row.key !== personKey));
      schedule();
    },
    [schedule]
  );

  async function addStatus(event) {
    event.preventDefault();
    if (!newStatus.label.trim()) return;
    setError("");
    try {
      const { statuses: saved } = await api.addAttendanceStatus(token, newStatus);
      setStatuses(saved);
      setNewStatus({ label: "", emoji: "", counts: true });
      setAdding(false);
    } catch (err) {
      setError(err.message);
    }
  }

  async function removeStatus(key) {
    setError("");
    try {
      const { statuses: saved } = await api.removeAttendanceStatus(token, key);
      setStatuses(saved);
      setPeople((list) =>
        list.map((row) => ({ ...row, statuses: row.statuses.filter((k) => k !== key) }))
      );
    } catch (err) {
      setError(err.message);
    }
  }

  function addPerson(category) {
    setPeople((list) => [
      ...list,
      { key: newKey(), personId: null, name: "", statuses: [], category },
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
    () => people.filter((person) => isPresent(person.statuses, statuses)).length,
    [people, statuses]
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
        <div className="attendance-toolbar">
          {/* Week and team sit together: they are the two things that decide
              which register is on screen, so they read as one control. */}
          <div className="picker-box">
            <WeekPicker value={when} onChange={setWhen} />

            <span className="picker-divider" aria-hidden="true" />

            <select
              className="picker-team"
              aria-label="Team"
              value={team}
              onChange={(e) => setTeam(e.target.value)}
            >
              {CGS.map((cg) => (
                <optgroup key={cg.key} label={`${cg.key} CG`}>
                  {cg.teams.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>

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
            <div className="tally">
              <div className="tally-total">
                <span className="tally-total-label">Total attendance</span>
                <span className="tally-total-value">{total}</span>
              </div>

              <div className="tally-groups">
                {CATEGORIES.map((category) => {
                  const listed = people.filter((p) => p.category === category.key);
                  const here = listed.filter((p) => isPresent(p.statuses, statuses)).length;
                  return (
                    <div className="tally-group" key={category.key} title={category.description}>
                      <span className="tally-group-name">{category.label}</span>
                      <span className="tally-group-value">{here}</span>
                      <span className="tally-group-of">/ {listed.length}</span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* The legend sits with the button that adds to it, so what the
                marks mean and how to add one are in the same place. */}
            <div className="legend-bar">
              <div className="legend-items">
                {statuses.map((s) => (
                  <span
                    className={`legend-chip${s.counts ? "" : " legend-chip-muted"}`}
                    key={s.key}
                    title={s.counts ? "Counts towards the total" : "Not counted"}
                  >
                    <span className="legend-chip-emoji">{s.emoji || "•"}</span>
                    {s.label}
                  </span>
                ))}
              </div>

              {canEdit && (
                <button
                  type="button"
                  className="btn btn-secondary btn-inline legend-add"
                  onClick={() => setAdding((open) => !open)}
                >
                  {adding ? "Cancel" : "+ Status"}
                </button>
              )}
            </div>

            {/* A status added here applies to every register, because one week
                is read next to another. */}
            {canEdit && adding && (
              <form className="status-form" onSubmit={addStatus}>
                <input
                  className="status-form-emoji"
                  value={newStatus.emoji}
                  maxLength={4}
                  placeholder="🎯"
                  aria-label="Emoji"
                  onChange={(e) => setNewStatus((v) => ({ ...v, emoji: e.target.value }))}
                />
                <input
                  className="status-form-label"
                  value={newStatus.label}
                  placeholder="What is it called?"
                  aria-label="Status name"
                  onChange={(e) => setNewStatus((v) => ({ ...v, label: e.target.value }))}
                />
                <label className="status-form-counts">
                  <input
                    type="checkbox"
                    checked={newStatus.counts}
                    onChange={(e) => setNewStatus((v) => ({ ...v, counts: e.target.checked }))}
                  />
                  Counts towards the total
                </label>
                <button className="btn btn-primary btn-inline" type="submit">
                  Add
                </button>
              </form>
            )}

            {canEdit && statuses.some((s) => !s.builtin) && (
              <div className="status-extras">
                {statuses
                  .filter((s) => !s.builtin)
                  .map((s) => (
                    <span className="status-extra" key={s.key}>
                      {s.emoji} {s.label}
                      <button
                        className="seat-remove"
                        onClick={() => removeStatus(s.key)}
                        aria-label={`Remove the ${s.label} status`}
                        title="Remove this status everywhere"
                      >
                        ×
                      </button>
                    </span>
                  ))}
              </div>
            )}

            {groups.map((group) => (
              <section className="register-group" key={group.key || "none"}>
                <div className="register-group-head">
                  <h3 className="register-group-title" title={group.description}>
                    {group.label}
                  </h3>
                  <span className="register-group-count">
                    {group.people.filter((person) => isPresent(person.statuses, statuses)).length}
                  </span>
                  <span className="register-group-listed">of {group.people.length}</span>

                  {canEdit && group.key && (
                    <button className="link-btn" onClick={() => addPerson(group.key)}>
                      + Add
                    </button>
                  )}
                </div>

                {group.people.length > 0 && (
                  <div className="register-rows">
                    {group.people.map((person) => (
                      <RegisterRow
                        key={person.key}
                        person={person}
                        statuses={statuses}
                        canEdit={canEdit}
                        onToggle={toggleStatus}
                        onRename={setName}
                        onRemove={removePerson}
                      />
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
