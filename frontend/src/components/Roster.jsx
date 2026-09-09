import React, { useEffect, useMemo, useState } from "react";
import { api } from "../api.js";
import { ROLES, roleTint } from "../lib/roles.js";
import { CGS } from "../lib/teams.js";

const emptyRow = () => ({ role: "", name: "", year: "", school: "" });

// Structural edits are all array swaps/splices on a cloned roster.
function move(list, index, delta) {
  const target = index + delta;
  if (target < 0 || target >= list.length) return list;
  const next = [...list];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

// Moving a person up off the top of their group, or down off the bottom, puts
// them at the near end of the neighbouring group rather than stopping dead —
// that is how someone actually gets reassigned, and it is the whole reason to
// be dragging rows around in the first place.
function movePerson(groups, groupIndex, rowIndex, delta) {
  const group = groups[groupIndex];
  const withinGroup = rowIndex + delta >= 0 && rowIndex + delta < group.rows.length;

  if (withinGroup) {
    return groups.map((g, gi) =>
      gi === groupIndex ? { ...g, rows: move(g.rows, rowIndex, delta) } : g
    );
  }

  const targetIndex = groupIndex + delta;
  if (targetIndex < 0 || targetIndex >= groups.length) return groups;

  const person = group.rows[rowIndex];
  return groups.map((g, gi) => {
    if (gi === groupIndex) return { ...g, rows: g.rows.filter((_, ri) => ri !== rowIndex) };
    if (gi !== targetIndex) return g;
    // Going up lands at the bottom of the group above; going down lands at the
    // top of the group below.
    return { ...g, rows: delta < 0 ? [...g.rows, person] : [person, ...g.rows] };
  });
}

// Whether this person has anywhere left to go in that direction.
function canMove(groups, groupIndex, rowIndex, delta) {
  const withinGroup =
    rowIndex + delta >= 0 && rowIndex + delta < groups[groupIndex].rows.length;
  if (withinGroup) return true;
  const targetIndex = groupIndex + delta;
  return targetIndex >= 0 && targetIndex < groups.length;
}

function countPeople(groups) {
  return groups.reduce(
    (total, group) => total + group.rows.filter((r) => r.name.trim()).length,
    0
  );
}

const key = (name) => String(name ?? "").trim().toLowerCase();

// Role and School belong to the person, not to the structure, so the structure
// only stores who is where and reads the rest back out of the database. Editing
// someone's school on their record moves it here too, and there is one place to
// fix it rather than two. Year has no column on the person, so it stays typed
// in here.
function fromDatabase(row, people, team) {
  const person = people.get(key(row.name));
  if (!person) return { ...row, linked: false };
  return {
    ...row,
    role: person.role || row.role,
    school: person.school || row.school,
    personId: person.id,
    linked: true,
    // Someone on loan from another team, so it is obvious at a glance whose
    // they actually are.
    deployedFrom: person.team_key && person.team_key !== team ? person.team_key : "",
  };
}

export default function Roster({ token, people = [] }) {
  const [roster, setRoster] = useState(null);
  const [draft, setDraft] = useState(null);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  // Which team is on screen. Empty means "whichever is mine" — the server picks
  // on the first load, and its answer becomes the selection.
  const [team, setTeam] = useState("");

  useEffect(() => {
    if (!token) return;
    const controller = new AbortController();
    let active = true;

    setRoster(null);
    api
      .getRoster(token, team, controller.signal)
      .then((data) => {
        if (!active) return;
        setRoster(data);
        setTeam(data.team);
        setError("");
      })
      .catch((err) => {
        if (active && err.name !== "AbortError") setError(err.message);
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [token, team]);

  const shown = editing ? draft : roster;
  const total = useMemo(() => (shown ? countPeople(shown.groups) : 0), [shown]);

  // A team's structure is its own people plus anyone deployed into it — an X1
  // member sent to X3A belongs on X3A's structure even though they are still
  // counted under X1.
  const teamPeople = useMemo(
    () =>
      people.filter(
        (p) =>
          !roster?.team ||
          !p.team_key ||
          p.team_key === roster.team ||
          p.deployed_to === roster.team
      ),
    [people, roster]
  );

  const byName = useMemo(
    () => new Map(teamPeople.map((person) => [key(person.name), person])),
    [teamPeople]
  );

  // Another team's structure is readable but not editable, so the Edit button
  // is simply not offered there.
  const canEdit = Boolean(roster?.canEdit);

  function startEditing() {
    // Deep clone so Cancel can genuinely discard everything.
    setDraft(JSON.parse(JSON.stringify(roster)));
    setError("");
    setEditing(true);
  }

  function cancelEditing() {
    setDraft(null);
    setEditing(false);
    setError("");
  }

  async function save() {
    setSaving(true);
    setError("");
    try {
      const saved = await api.saveRoster(token, { ...draft, team: roster.team });
      setRoster(saved);
      setDraft(null);
      setEditing(false);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  const updateGroups = (groups) => setDraft((d) => ({ ...d, groups }));

  function updateRow(groupIndex, rowIndex, field, value) {
    const groups = draft.groups.map((group, gi) => {
      if (gi !== groupIndex) return group;
      const rows = group.rows.map((row, ri) =>
        ri === rowIndex ? { ...row, [field]: value } : row
      );
      return { ...group, rows };
    });
    updateGroups(groups);
  }

  if (error && !shown) {
    return (
      <div className="panel">
        <div className="error-banner panel-notice">{error}</div>
      </div>
    );
  }

  if (!shown) {
    return (
      <div className="panel">
        <div className="panel-title">Loading structure…</div>
      </div>
    );
  }

  return (
    <div className="panel roster-panel">
      <div className="panel-row roster-header">
        <div className="roster-heading">
          {editing ? (
            <input
              className="roster-title-input"
              value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              aria-label="Roster title"
            />
          ) : (
            <h2 className="roster-title">{roster.title}</h2>
          )}
          <span className="badge badge-off">{total}</span>
        </div>

        <div className="roster-actions">
          {/* Switching teams is a read: any team can be looked at, and the
              server decides whether this one can also be changed. Grouped by
              CG so the list matches how the zone is organised. Hidden while
              editing, so a switch cannot drop half-made changes. */}
          {!editing && (
            <select
              className="roster-team-select"
              aria-label="Team"
              value={roster.team ?? ""}
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
          )}

          {editing ? (
            <>
              <button
                className="btn btn-secondary btn-inline"
                onClick={cancelEditing}
                disabled={saving}
              >
                Cancel
              </button>
              <button className="btn btn-primary btn-inline" onClick={save} disabled={saving}>
                {saving ? "Saving…" : "Save"}
              </button>
            </>
          ) : canEdit ? (
            <button className="btn btn-secondary btn-inline" onClick={startEditing}>
              Edit
            </button>
          ) : (
            <span className="roster-readonly-note">Read-only — not your team</span>
          )}
        </div>
      </div>

      {error && <div className="error-banner panel-notice">{error}</div>}

      {editing && (
        <>
          {/* Native autocomplete, so the browser does the filtering. */}
          <datalist id="roster-people">
            {teamPeople.map((person) => (
              <option key={person.id} value={person.name} />
            ))}
          </datalist>
        </>
      )}

      <div className={`roster-table${editing ? " roster-table-edit" : ""}`}>
        <div className="roster-row roster-head">
          <span>Role</span>
          <span>Name</span>
          <span>Year</span>
          <span>School</span>
          {editing && <span className="roster-tools-head">Actions</span>}
        </div>

        {shown.groups.map((group, groupIndex) => (
          <div className="roster-group" key={group.id ?? groupIndex}>
            {editing && (
              <div className="roster-group-label">
                Group {groupIndex + 1}
                <span className="roster-group-size">
                  {group.rows.length} {group.rows.length === 1 ? "person" : "people"}
                </span>
              </div>
            )}
            {group.rows.map((raw, rowIndex) => {
              const row = fromDatabase(raw, byName, roster?.team);
              return editing ? (
                <div
                  className={`roster-row roster-row-edit${
                    roleTint(row.role) ? ` roster-tint-${roleTint(row.role)}` : ""
                  }`}
                  key={rowIndex}
                >
                  {row.linked ? (
                    <span
                      className={`roster-linked${
                        roleTint(row.role) ? ` tint-${roleTint(row.role)}` : ""
                      }`}
                      title="From this person's record"
                    >
                      {row.role || "—"}
                    </span>
                  ) : (
                    // Not in the database yet, so the role has to be picked
                    // here. The list is the standard one, so the colour still
                    // comes out right.
                    <select
                      aria-label="Role"
                      value={raw.role}
                      onChange={(e) => updateRow(groupIndex, rowIndex, "role", e.target.value)}
                    >
                      <option value="">Role</option>
                      {ROLES.map((role) => (
                        <option key={role.value} value={role.value}>
                          {role.label}
                        </option>
                      ))}
                      {raw.role && !ROLES.some((r) => r.value === raw.role) && (
                        <option value={raw.role}>{raw.role}</option>
                      )}
                    </select>
                  )}
                  <input
                    aria-label="Name"
                    placeholder="Name"
                    list="roster-people"
                    className={row.linked ? "roster-name-linked" : undefined}
                    value={raw.name}
                    onChange={(e) => updateRow(groupIndex, rowIndex, "name", e.target.value)}
                  />
                  <input
                    aria-label="Year"
                    placeholder="Year"
                    value={raw.year}
                    onChange={(e) => updateRow(groupIndex, rowIndex, "year", e.target.value)}
                  />
                  {row.linked ? (
                    <span className="roster-linked" title="From this person's record">
                      {row.school}
                    </span>
                  ) : (
                    <input
                      aria-label="School"
                      placeholder="School"
                      value={raw.school}
                      onChange={(e) => updateRow(groupIndex, rowIndex, "school", e.target.value)}
                    />
                  )}
                  <div className="roster-tools">
                    <button
                      className="icon-btn"
                      title="Move up (past the top, into the group above)"
                      aria-label="Move person up"
                      disabled={!canMove(draft.groups, groupIndex, rowIndex, -1)}
                      onClick={() =>
                        updateGroups(movePerson(draft.groups, groupIndex, rowIndex, -1))
                      }
                    >
                      ↑
                    </button>
                    <button
                      className="icon-btn"
                      title="Move down (past the bottom, into the group below)"
                      aria-label="Move person down"
                      disabled={!canMove(draft.groups, groupIndex, rowIndex, 1)}
                      onClick={() =>
                        updateGroups(movePerson(draft.groups, groupIndex, rowIndex, 1))
                      }
                    >
                      ↓
                    </button>
                    <button
                      className="icon-btn icon-btn-danger"
                      title="Remove"
                      aria-label="Remove person"
                      onClick={() =>
                        updateGroups(
                          draft.groups.map((g, gi) =>
                            gi === groupIndex
                              ? { ...g, rows: g.rows.filter((_, ri) => ri !== rowIndex) }
                              : g
                          )
                        )
                      }
                    >
                      ×
                    </button>
                  </div>
                </div>
              ) : (
                <div
                  className={`roster-row${
                    roleTint(row.role) ? ` roster-tint-${roleTint(row.role)}` : ""
                  }`}
                  key={raw.id ?? rowIndex}
                >
                  <span className="roster-role">{row.role}</span>
                  <span className="roster-name">
                    {row.name}
                    {row.deployedFrom && (
                      <span className="roster-on-loan" title={`Belongs to ${row.deployedFrom}`}>
                        {row.deployedFrom}
                      </span>
                    )}
                  </span>
                  <span className="roster-year">{row.year}</span>
                  <span className="roster-school">{row.school}</span>
                </div>
              );
            })}

            {editing && (
              <div className="roster-group-tools">
                <button
                  className="link-btn"
                  onClick={() =>
                    updateGroups(
                      draft.groups.map((g, gi) =>
                        gi === groupIndex ? { ...g, rows: [...g.rows, emptyRow()] } : g
                      )
                    )
                  }
                >
                  + Add person
                </button>
                <button
                  className="link-btn"
                  disabled={groupIndex === 0}
                  onClick={() => updateGroups(move(draft.groups, groupIndex, -1))}
                >
                  Move group up
                </button>
                <button
                  className="link-btn"
                  disabled={groupIndex === draft.groups.length - 1}
                  onClick={() => updateGroups(move(draft.groups, groupIndex, 1))}
                >
                  Move group down
                </button>
                <button
                  className="link-btn link-btn-danger"
                  onClick={() =>
                    updateGroups(draft.groups.filter((_, gi) => gi !== groupIndex))
                  }
                >
                  Delete group
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      {editing && (
        <button
          className="btn btn-secondary roster-add-group"
          onClick={() => updateGroups([...draft.groups, { rows: [emptyRow()] }])}
        >
          + Add group
        </button>
      )}
    </div>
  );
}
