import React, { useEffect, useMemo, useState } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import { api } from "../api.js";
import { useAuth } from "../context/AuthContext.jsx";
import { PERMISSIONS } from "../lib/permissions.js";
import { localDay } from "../lib/narnia.js";
import { HANGOUT_TYPES } from "../lib/outings.js";
import AppShell from "../components/AppShell.jsx";
import SearchBox from "../components/SearchBox.jsx";
import { SkeletonRows } from "../components/Skeleton.jsx";

const OTHER = "Other";

const BLANK = {
  type: "",
  otherType: "",
  location: "",
  heldOn: "",
  startTime: "",
  endTime: "",
  goals: "",
  friendsCount: "",
  friendsWho: "",
};

// Planning a new outing, or changing one that has not ended.
export default function OutingEdit() {
  const { id } = useParams();
  const editing = Boolean(id);
  const navigate = useNavigate();
  const { token, can } = useAuth();
  const allowed = can(PERMISSIONS.RUN_OUTINGS);

  const [form, setForm] = useState(() => ({ ...BLANK, heldOn: localDay() }));
  const [picked, setPicked] = useState(() => new Set());
  const [people, setPeople] = useState(null);
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!allowed) return undefined;
    const controller = new AbortController();
    let active = true;

    Promise.all([
      api.outingPeople(token, controller.signal),
      editing ? api.outing(token, id, controller.signal) : null,
    ])
      .then(([names, existing]) => {
        if (!active) return;
        setPeople(names.people);

        if (!existing) {
          // Whoever plans an outing is usually on it. Easy to take off if not.
          if (names.me) setPicked(new Set([names.me]));
          return;
        }

        const { outing } = existing;
        const preset = HANGOUT_TYPES.includes(outing.type);
        setForm({
          type: preset ? outing.type : OTHER,
          otherType: preset ? "" : outing.type,
          location: outing.location,
          heldOn: outing.heldOn,
          startTime: outing.startTime,
          endTime: outing.endTime,
          goals: outing.goals,
          friendsCount: outing.friendsCount ?? "",
          friendsWho: outing.friendsWho,
        });
        setPicked(new Set(outing.people.map((person) => person.personId).filter(Boolean)));
      })
      .catch((err) => {
        if (active && err.name !== "AbortError") setError(err.message);
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [allowed, editing, id, token]);

  const update = (field) => (event) =>
    setForm((current) => ({ ...current, [field]: event.target.value }));

  function toggle(personId) {
    setPicked((current) => {
      const next = new Set(current);
      if (next.has(personId)) next.delete(personId);
      else next.add(personId);
      return next;
    });
  }

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return people ?? [];
    return (people ?? []).filter(
      (person) =>
        person.name.toLowerCase().includes(term) || person.team.toLowerCase().includes(term)
    );
  }, [people, search]);

  const chosen = useMemo(
    () => (people ?? []).filter((person) => picked.has(person.id)),
    [people, picked]
  );

  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    setError("");
    const body = {
      type: form.type === OTHER ? form.otherType : form.type,
      location: form.location,
      heldOn: form.heldOn,
      startTime: form.startTime,
      endTime: form.endTime,
      goals: form.goals,
      friendsCount: form.friendsCount,
      friendsWho: form.friendsWho,
      personIds: [...picked],
    };
    try {
      const saved = editing
        ? await api.updateOuting(token, id, body)
        : await api.createOuting(token, body);
      navigate(`/outings/${saved.id}`, { replace: true });
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  if (!allowed) return <Navigate to="/outings" replace />;

  return (
    <AppShell>
      <header className="page-head admin-page-head">
        <Link
          className="admin-back"
          to={editing ? `/outings/${id}` : "/outings"}
          aria-label="Back"
        >
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M15 5l-7 7 7 7" />
          </svg>
        </Link>
        <h1 className="page-title">{editing ? "Edit outing" : "New outing"}</h1>
      </header>

      {!people && !error && <SkeletonRows count={6} label="Loading" />}

      {people && (
        <form className="panel outing-form" onSubmit={submit} noValidate>
          <div className="field">
            <label>Type of hangout</label>
            <div className="narnia-picks">
              {[...HANGOUT_TYPES, OTHER].map((type) => (
                <button
                  type="button"
                  key={type}
                  className={`narnia-pick${form.type === type ? " narnia-pick-on" : ""}`}
                  aria-pressed={form.type === type}
                  onClick={() => setForm((current) => ({ ...current, type }))}
                >
                  {type}
                </button>
              ))}
            </div>
          </div>

          {form.type === OTHER && (
            <div className="field">
              <label htmlFor="outing-other">Other</label>
              <input
                id="outing-other"
                value={form.otherType}
                onChange={update("otherType")}
                maxLength={60}
                autoFocus
              />
            </div>
          )}

          <div className="field">
            <label htmlFor="outing-location">Location</label>
            <input
              id="outing-location"
              value={form.location}
              onChange={update("location")}
              maxLength={160}
            />
          </div>

          <div className="event-when">
            <div className="field">
              <label htmlFor="outing-date">Date</label>
              <input id="outing-date" type="date" value={form.heldOn} onChange={update("heldOn")} />
            </div>
            <div className="field">
              <label htmlFor="outing-start">From</label>
              <input
                id="outing-start"
                type="time"
                value={form.startTime}
                onChange={update("startTime")}
              />
            </div>
            <div className="field">
              <label htmlFor="outing-end">To</label>
              <input
                id="outing-end"
                type="time"
                value={form.endTime}
                onChange={update("endTime")}
              />
            </div>
          </div>

          <div className="field">
            <label htmlFor="outing-goals">Goals</label>
            <textarea
              id="outing-goals"
              className="outing-textarea"
              rows={3}
              value={form.goals}
              onChange={update("goals")}
              maxLength={2000}
            />
          </div>

          <div className="outing-friends">
            <div className="field">
              <label htmlFor="outing-count">Friends</label>
              <input
                id="outing-count"
                type="number"
                inputMode="numeric"
                min="0"
                max="500"
                value={form.friendsCount}
                onChange={update("friendsCount")}
              />
            </div>
            <div className="field">
              <label htmlFor="outing-who">Who</label>
              <input
                id="outing-who"
                value={form.friendsWho}
                onChange={update("friendsWho")}
                maxLength={2000}
              />
            </div>
          </div>

          <div className="field">
            <label>Who's going ({picked.size})</label>
            {chosen.length > 0 && (
              <div className="narnia-picks outing-chosen">
                {chosen.map((person) => (
                  <button
                    type="button"
                    key={person.id}
                    className="narnia-pick narnia-pick-on"
                    onClick={() => toggle(person.id)}
                    aria-label={`Take ${person.name} off`}
                  >
                    {person.name} ×
                  </button>
                ))}
              </div>
            )}
            <SearchBox value={search} onChange={setSearch} label="Search people" />
            <div className="outing-people">
              {visible.map((person) => (
                <label className="outing-person" key={person.id}>
                  <input
                    type="checkbox"
                    checked={picked.has(person.id)}
                    onChange={() => toggle(person.id)}
                  />
                  <span className="outing-person-name">{person.name}</span>
                  {person.team && <span className="pool-team">{person.team}</span>}
                </label>
              ))}
              {visible.length === 0 && <div className="list-empty">Nothing here</div>}
            </div>
          </div>

          {error && <div className="error-banner">{error}</div>}

          <button className="btn btn-primary" type="submit" disabled={saving}>
            {saving ? <span className="spinner" /> : editing ? "Save" : "Add outing"}
          </button>
        </form>
      )}

      {!people && error && <div className="error-banner">{error}</div>}
    </AppShell>
  );
}
