import React, { useEffect, useMemo, useState } from "react";
import { api } from "../api.js";

export const ROSTER_COLORS = ["", "rose", "cyan", "yellow", "peach", "lavender", "mint"];

const COLOR_LABELS = {
  "": "None",
  rose: "Rose",
  cyan: "Cyan",
  yellow: "Yellow",
  peach: "Peach",
  lavender: "Lavender",
  mint: "Mint",
};

const emptyRow = () => ({ role: "", name: "", year: "", school: "", color: "" });

// Structural edits are all array swaps/splices on a cloned roster.
function move(list, index, delta) {
  const target = index + delta;
  if (target < 0 || target >= list.length) return list;
  const next = [...list];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
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
function fromDatabase(row, people) {
  const person = people.get(key(row.name));
  if (!person) return { ...row, linked: false };
  return {
    ...row,
    role: person.role || row.role,
    school: person.school || row.school,
    personId: person.id,
    linked: true,
  };
}

export default function Roster({ token, people = [] }) {
  const [roster, setRoster] = useState(null);
  const [draft, setDraft] = useState(null);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!token) return;
    const controller = new AbortController();
    let active = true;

    api
      .getRoster(token, controller.signal)
      .then((data) => {
        if (active) setRoster(data);
      })
      .catch((err) => {
        if (active && err.name !== "AbortError") setError(err.message);
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [token]);

  const shown = editing ? draft : roster;
  const total = useMemo(() => (shown ? countPeople(shown.groups) : 0), [shown]);

  const byName = useMemo(
    () => new Map(people.map((person) => [key(person.name), person])),
    [people]
  );

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
      const saved = await api.saveRoster(token, draft);
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
        <div className="panel-title">Loading roster…</div>
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
          ) : (
            <button className="btn btn-secondary btn-inline" onClick={startEditing}>
              Edit
            </button>
          )}
        </div>
      </div>

      {error && <div className="error-banner panel-notice">{error}</div>}

      {editing && (
        <>
          <p className="roster-hint">
            Type a name from the database and its Role and School fill themselves in.
            Arrange who sits under whom here; change their details on their record.
          </p>
          {/* Native autocomplete, so the browser does the filtering. */}
          <datalist id="roster-people">
            {people.map((person) => (
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
            {group.rows.map((raw, rowIndex) => {
              const row = fromDatabase(raw, byName);
              return editing ? (
                <div className="roster-row roster-row-edit" key={rowIndex}>
                  {row.linked ? (
                    <span className="roster-linked" title="From this person's record">
                      {row.role}
                    </span>
                  ) : (
                    <input
                      aria-label="Role"
                      placeholder="Role"
                      value={raw.role}
                      onChange={(e) => updateRow(groupIndex, rowIndex, "role", e.target.value)}
                    />
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
                    <select
                      aria-label="Highlight colour"
                      value={row.color}
                      onChange={(e) => updateRow(groupIndex, rowIndex, "color", e.target.value)}
                    >
                      {ROSTER_COLORS.map((c) => (
                        <option key={c || "none"} value={c}>
                          {COLOR_LABELS[c]}
                        </option>
                      ))}
                    </select>
                    <button
                      className="icon-btn"
                      title="Move up"
                      aria-label="Move person up"
                      onClick={() =>
                        updateGroups(
                          draft.groups.map((g, gi) =>
                            gi === groupIndex ? { ...g, rows: move(g.rows, rowIndex, -1) } : g
                          )
                        )
                      }
                    >
                      ↑
                    </button>
                    <button
                      className="icon-btn"
                      title="Move down"
                      aria-label="Move person down"
                      onClick={() =>
                        updateGroups(
                          draft.groups.map((g, gi) =>
                            gi === groupIndex ? { ...g, rows: move(g.rows, rowIndex, 1) } : g
                          )
                        )
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
                  className={`roster-row${row.color ? ` roster-tint-${row.color}` : ""}`}
                  key={row.id ?? rowIndex}
                >
                  <span className="roster-role">{row.role}</span>
                  <span className="roster-name">{row.name}</span>
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
                  onClick={() => updateGroups(move(draft.groups, groupIndex, -1))}
                >
                  Move group up
                </button>
                <button
                  className="link-btn"
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
