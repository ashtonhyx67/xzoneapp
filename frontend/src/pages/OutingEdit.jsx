import React, { useEffect, useMemo, useState } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router-dom";
import { api } from "../api.js";
import { useAuth } from "../context/AuthContext.jsx";
import { PERMISSIONS } from "../lib/permissions.js";
import { localDay } from "../lib/narnia.js";
import { HANGOUT_TYPES, dayText } from "../lib/outings.js";
import AppShell from "../components/AppShell.jsx";
import SearchBox from "../components/SearchBox.jsx";
import MonthCalendar from "../components/MonthCalendar.jsx";
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
  // The organiser is on the outing whatever else is picked: their person record
  // when the database has one, and their name either way.
  const [organiser, setOrganiser] = useState({ personId: null, name: "", isMe: true });
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
          setOrganiser({ personId: names.me, name: names.myName, isMe: true });
          return;
        }

        const { outing } = existing;
        const organiserRow = outing.people.find(
          (person) => person.name.toLowerCase() === outing.organiser.toLowerCase()
        );
        setOrganiser({
          personId: outing.isOrganiser ? names.me : organiserRow?.personId ?? null,
          name: outing.organiser,
          isMe: outing.isOrganiser,
        });
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
    if (personId === organiser.personId) return;
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
    () =>
      (people ?? []).filter(
        (person) => picked.has(person.id) && person.id !== organiser.personId
      ),
    [people, picked, organiser.personId]
  );
  const goingCount = chosen.length + 1;

  const whatDone =
    (form.type === OTHER ? form.otherType.trim() : form.type) && form.location.trim();

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
      personIds: [...picked].filter((personId) => personId !== organiser.personId),
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
        <form className="outing-form" onSubmit={submit} noValidate>
          <Step number={1} title="What are you doing?" done={Boolean(whatDone)}>
            <div className="outing-types">
              {[...HANGOUT_TYPES, OTHER].map((type) => (
                <button
                  type="button"
                  key={type}
                  className={`outing-type${form.type === type ? " outing-type-on" : ""}`}
                  aria-pressed={form.type === type}
                  onClick={() => setForm((current) => ({ ...current, type }))}
                >
                  {type}
                </button>
              ))}
            </div>

            {form.type === OTHER && (
              <input
                className="outing-input outing-other"
                aria-label="What kind of hangout"
                placeholder="What kind of hangout?"
                value={form.otherType}
                onChange={update("otherType")}
                maxLength={60}
                autoFocus
              />
            )}

            <label className="outing-label" htmlFor="outing-location">
              Where
            </label>
            <input
              id="outing-location"
              className="outing-input"
              placeholder="e.g. Bishan Park"
              value={form.location}
              onChange={update("location")}
              maxLength={160}
            />
          </Step>

          <Step
            number={2}
            title="When?"
            hint={form.heldOn ? dayText(form.heldOn) : ""}
            done={Boolean(form.heldOn && form.startTime)}
          >
            <MonthCalendar
              value={form.heldOn}
              onChange={(heldOn) => setForm((current) => ({ ...current, heldOn }))}
            />
            {/* Laid out like a new event in the iPhone's Calendar; tapping a time
                opens the phone's own time wheel. */}
            <div className="time-rows">
              <label className="time-row" htmlFor="outing-start">
                <span>Starts</span>
                <span className={`time-pill-wrap${form.startTime ? "" : " time-pill-empty"}`}>
                  <input
                    id="outing-start"
                    className="time-pill"
                    type="time"
                    value={form.startTime}
                    onChange={update("startTime")}
                  />
                </span>
              </label>
              <label className="time-row" htmlFor="outing-end">
                <span>Ends</span>
                <span className={`time-pill-wrap${form.endTime ? "" : " time-pill-empty"}`}>
                  <input
                    id="outing-end"
                    className="time-pill"
                    type="time"
                    value={form.endTime}
                    onChange={update("endTime")}
                  />
                </span>
              </label>
            </div>
          </Step>

          <Step number={3} title="Who's going?" hint={`${goingCount} going`} done>
            <div className="outing-chosen">
              <span className="outing-chip outing-chip-organiser">
                {organiser.isMe ? "You" : organiser.name || "Organiser"}
                <em>organiser</em>
              </span>
              {chosen.map((person) => (
                <button
                  type="button"
                  key={person.id}
                  className="outing-chip"
                  onClick={() => toggle(person.id)}
                  aria-label={`Take ${person.name} off`}
                >
                  {person.name}
                  <span aria-hidden="true">×</span>
                </button>
              ))}
            </div>
            <SearchBox value={search} onChange={setSearch} label="Search people" />
            <div className="outing-people">
              {visible.map((person) => {
                const isOrganiser = person.id === organiser.personId;
                return (
                  <label
                    className={`outing-person${isOrganiser ? " outing-person-fixed" : ""}`}
                    key={person.id}
                  >
                    <input
                      type="checkbox"
                      checked={isOrganiser || picked.has(person.id)}
                      disabled={isOrganiser}
                      onChange={() => toggle(person.id)}
                    />
                    <span className="outing-person-name">
                      {person.name}
                      {isOrganiser && <span className="outing-person-tag">Organiser</span>}
                      {!isOrganiser && !person.hasAccount && (
                        <span className="outing-person-badge">Not Onboarded</span>
                      )}
                    </span>
                    {person.team && <span className="pool-team">{person.team}</span>}
                  </label>
                );
              })}
              {visible.length === 0 && <div className="list-empty">Nothing here</div>}
            </div>
          </Step>

          <Step
            number={4}
            title="Bringing friends?"
            hint="Optional"
            done={Boolean(form.friendsCount || form.friendsWho)}
          >
            <div className="outing-friends">
              <div>
                <label className="outing-label" htmlFor="outing-count">
                  How many
                </label>
                <input
                  id="outing-count"
                  className="outing-input"
                  type="number"
                  inputMode="numeric"
                  min="0"
                  max="500"
                  placeholder="0"
                  value={form.friendsCount}
                  onChange={update("friendsCount")}
                />
              </div>
              <div>
                <label className="outing-label" htmlFor="outing-who">
                  Their names
                </label>
                <input
                  id="outing-who"
                  className="outing-input"
                  placeholder="e.g. Ben, Clara"
                  value={form.friendsWho}
                  onChange={update("friendsWho")}
                  maxLength={2000}
                />
              </div>
            </div>
          </Step>

          <Step number={5} title="Goals" hint="Optional" done={Boolean(form.goals.trim())}>
            <textarea
              id="outing-goals"
              className="outing-input outing-textarea"
              aria-label="Goals"
              placeholder="What do you hope comes out of it?"
              rows={3}
              value={form.goals}
              onChange={update("goals")}
              maxLength={2000}
            />
          </Step>

          {error && <div className="error-banner">{error}</div>}

          <button className="btn btn-primary outing-submit" type="submit" disabled={saving}>
            {saving ? <span className="spinner" /> : editing ? "Save changes" : "Add outing"}
          </button>
        </form>
      )}

      {!people && error && <div className="error-banner">{error}</div>}
    </AppShell>
  );
}

// One numbered section of the form. The number turns into a tick once the
// section has what it needs, so it is clear at a glance what is left to do.
function Step({ number, title, hint, done, children }) {
  return (
    <section className={`outing-step${done ? " outing-step-done" : ""}`}>
      <div className="outing-step-head">
        <span className="outing-step-num" aria-hidden="true">
          {done ? (
            <svg viewBox="0 0 16 16" width="13" height="13">
              <path
                d="M3.5 8.5l3 3 6-7"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          ) : (
            number
          )}
        </span>
        <h2 className="outing-step-title">{title}</h2>
        {hint && <span className="outing-step-hint">{hint}</span>}
      </div>
      <div className="outing-step-body">{children}</div>
    </section>
  );
}

