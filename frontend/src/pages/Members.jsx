import React, { useEffect, useMemo, useState } from "react";
import { api } from "../api.js";
import { useAuth } from "../context/AuthContext.jsx";
import AppShell from "../components/AppShell.jsx";
import PersonCard from "../components/PersonCard.jsx";
import ImportPeople from "../components/ImportPeople.jsx";
import Roster from "../components/Roster.jsx";

export default function Members() {
  const { token, isAdmin } = useAuth();
  const [people, setPeople] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [draft, setDraft] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!token || !isAdmin) {
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
        // Keep the current selection if that person still exists.
        setSelectedId((current) =>
          data.people.some((p) => p.id === current) ? current : data.people[0]?.id ?? null
        );
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
  }, [token, isAdmin, reloadKey]);

  const selected = useMemo(
    () => people.find((p) => p.id === selectedId) || null,
    [people, selectedId]
  );

  const shown = draft ?? selected;

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

  if (!isAdmin) {
    return (
      <AppShell>
        <h1 className="page-title">Members</h1>
        <div className="panel">
          <div className="panel-title">You do not have access to this.</div>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <h1 className="page-title">Members</h1>

      {error && <div className="error-banner">{error}</div>}

      <Roster token={token} />

      {loading ? (
        <div className="panel">
          <div className="panel-title">Loading…</div>
        </div>
      ) : people.length === 0 ? (
        <div className="panel">
          <div className="panel-title">No one in the database yet.</div>
          <div className="reminder-empty">
            Import your spreadsheet below to fill this in.
          </div>
        </div>
      ) : (
        <PersonCard
          person={shown}
          people={people}
          onSelect={(id) => {
            setSelectedId(id);
            setDraft(null);
          }}
          editing={Boolean(draft)}
          canEdit={isAdmin}
          onEdit={() => setDraft({ ...selected })}
          onCancel={() => {
            setDraft(null);
            setError("");
          }}
          onChange={(field, value) => setDraft((d) => ({ ...d, [field]: value }))}
          onSave={save}
          saving={saving}
        />
      )}

      <ImportPeople token={token} onImported={() => setReloadKey((n) => n + 1)} />
    </AppShell>
  );
}
