import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../api.js";
import { useAuth } from "../context/AuthContext.jsx";
import { PERMISSIONS } from "../lib/permissions.js";
import AppShell from "../components/AppShell.jsx";
import PersonCard from "../components/PersonCard.jsx";
import MemberRow from "../components/MemberRow.jsx";
import Roster from "../components/Roster.jsx";
import { CGS, cgOf } from "../lib/teams.js";
import SearchBox from "../components/SearchBox.jsx";

// The member list and the scorecard side by side: pick anyone on the left, read
// or edit their record on the right. Both are the same database rows the
// Database tab edits in bulk.
export default function Members() {
  const { token, can } = useAuth();
  const canView = can(PERMISSIONS.VIEW_DIRECTORY);
  const canEdit = can(PERMISSIONS.EDIT_DATABASE);

  const [searchParams, setSearchParams] = useSearchParams();
  const [people, setPeople] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [draft, setDraft] = useState(null);
  const [query, setQuery] = useState("");
  // "" is everyone; otherwise a CG key or a team key. One control does both,
  // because picking X3 and picking X3A are the same kind of decision.
  const [scope, setScope] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  // A link from the dashboard names the person to open.
  const requestedId = Number(searchParams.get("person")) || null;

  useEffect(() => {
    if (!token || !canView) {
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    let active = true;

    api
      .getPeople(token, controller.signal)
      .then((data) => {
        if (!active) return;
        setPeople(data.people);
        setSelectedId((current) => {
          const wanted = requestedId ?? current;
          return data.people.some((p) => p.id === wanted) ? wanted : data.people[0]?.id ?? null;
        });
      })
      .catch((err) => {
        if (active && err.name !== "AbortError") setError(err.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [token, canView, requestedId]);

  const selected = useMemo(
    () => people.find((p) => p.id === selectedId) || null,
    [people, selectedId]
  );

  const shown = draft ?? selected;

  // A CG matches every team inside it; a team matches only itself.
  const inScope = useCallback(
    (person) => {
      if (!scope) return true;
      if (CGS.some((cg) => cg.key === scope)) return cgOf(person.team_key) === scope;
      return person.team_key === scope;
    },
    [scope]
  );

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return people.filter((p) => {
      if (!inScope(p)) return false;
      if (!q) return true;
      return [p.name, p.role, p.team_key, p.school, p.ministry]
        .map((v) => String(v ?? "").toLowerCase())
        .some((v) => v.includes(q));
    });
  }, [people, query, inScope]);

  function select(id) {
    setSelectedId(id);
    setDraft(null);
    setError("");
    // Keep the address bar honest, so a reload or a shared link reopens the
    // same person.
    setSearchParams(id ? { person: String(id) } : {}, { replace: true });
  }

  async function save() {
    setSaving(true);
    setError("");
    try {
      const { person } = await api.updatePerson(token, draft.id, draft);
      setPeople((list) => list.map((p) => (p.id === person.id ? person : p)));
      setSelectedId(person.id);
      setDraft(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  if (!canView) {
    return (
      <AppShell>
        <header className="page-head">
          <h1 className="page-title">Members</h1>
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
        <h1 className="page-title">Members</h1>
        <span className="page-count">{visible.length}</span>
      </header>

      {error && <div className="error-banner">{error}</div>}

      {loading ? (
        <div className="panel">
          <div className="panel-title">Loading…</div>
        </div>
      ) : people.length === 0 ? (
        <div className="panel">
          <div className="panel-title">No one in the database yet.</div>
        </div>
      ) : (
        <div className="members-layout">
          <aside className="panel member-list-panel">
            <SearchBox value={query} onChange={setQuery} label="Search members" />
            {/* A dropdown rather than a row of chips: it is one choice, it
                sits beside the search box at the same size, and it does not
                take a line of its own to offer nine options. */}
            <label className="scope-filter">
              <span className="scope-filter-label">Show</span>
              <select
                className="scope-select"
                value={scope}
                aria-label="Filter by CG or team"
                onChange={(e) => setScope(e.target.value)}
              >
                <option value="">Everyone</option>
                {CGS.map((cg) => (
                  <optgroup key={cg.key} label={`${cg.key} CG`}>
                    {/* The whole CG first, then its teams — picking a group and
                        picking one of its teams are the same kind of choice. */}
                    <option value={cg.key}>All of {cg.key}</option>
                    {cg.teams.length > 1 &&
                      cg.teams.map((team) => (
                        <option key={team} value={team}>
                          {team}
                        </option>
                      ))}
                  </optgroup>
                ))}
              </select>
            </label>

            <div className="member-list">
              {visible.map((person) => (
                <MemberRow
                  key={person.id}
                  person={person}
                  detail={[person.team_key, person.school]
                    .filter(Boolean)
                    .join(" · ")}
                  onClick={() => select(person.id)}
                  active={person.id === selectedId}
                />
              ))}
              {visible.length === 0 && <div className="list-empty">Nothing here</div>}
            </div>
          </aside>

          <div className="member-detail-pane">
            <PersonCard
              person={shown}
              editing={Boolean(draft)}
              canEdit={canEdit}
              onEdit={() => setDraft({ ...selected })}
              onCancel={() => {
                setDraft(null);
                setError("");
              }}
              onChange={(field, value) => setDraft((d) => ({ ...d, [field]: value }))}
              onSave={save}
              saving={saving}
            />
          </div>
        </div>
      )}

      {canEdit && <Roster token={token} people={people} />}
    </AppShell>
  );
}
