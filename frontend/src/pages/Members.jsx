import React, { useEffect, useMemo, useState } from "react";
import { api } from "../api.js";
import { useAuth } from "../context/AuthContext.jsx";
import AppShell from "../components/AppShell.jsx";
import PersonCard from "../components/PersonCard.jsx";

export default function Members() {
  const { token, isAdmin } = useAuth();
  const [people, setPeople] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [draft, setDraft] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

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
        setSelectedId((current) => current ?? data.people[0]?.id ?? null);
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
  }, [token, isAdmin]);

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

      {loading ? (
        <div className="panel">
          <div className="panel-title">Loading…</div>
        </div>
      ) : people.length === 0 ? (
        <div className="panel">
          <div className="panel-title">No one in the database yet.</div>
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
    </AppShell>
  );
}
