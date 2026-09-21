import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api.js";
import { useAuth } from "../context/AuthContext.jsx";
import { PERMISSIONS } from "../lib/permissions.js";
import { CURRENCIES, formatMoney } from "../lib/split.js";
import AppShell from "../components/AppShell.jsx";
import SearchBox from "../components/SearchBox.jsx";

const EMOJI = ["🧾", "🏕️", "🍜", "✈️", "🏠", "🎉", "⛪", "🎁", "🚐", "☕"];

// Everything the account is splitting, and where it stands overall. A group is
// opened from here; this page is the way in and the place that answers the one
// question people actually come with — am I up or down.
export default function Split() {
  const { token, can, user } = useAuth();

  const [data, setData] = useState(null);
  const [activity, setActivity] = useState([]);
  const [people, setPeople] = useState([]);
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);

  const [name, setName] = useState("");
  const [emoji, setEmoji] = useState(EMOJI[0]);
  const [currency, setCurrency] = useState("SGD");
  const [chosen, setChosen] = useState(() => new Set());
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (!token) return;
    const controller = new AbortController();

    api
      .splitGroups(token, controller.signal)
      .then(setData)
      .catch((err) => {
        if (err.name !== "AbortError") setError(err.message);
      });
    api
      .splitActivity(token, controller.signal)
      .then((result) => setActivity(result.activity))
      .catch(() => {});
    api
      .splitPeople(token, controller.signal)
      .then((result) => setPeople(result.people))
      .catch(() => {});

    return () => controller.abort();
  }, [token]);

  const matches = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const list = needle
      ? people.filter((person) => person.name.toLowerCase().includes(needle))
      : people;
    return list.slice(0, 60);
  }, [people, search]);

  function toggle(personId) {
    setChosen((current) => {
      const next = new Set(current);
      if (next.has(personId)) next.delete(personId);
      else next.add(personId);
      return next;
    });
  }

  async function create() {
    if (!name.trim()) return setError("Give the group a name.");
    setBusy(true);
    setError("");
    try {
      await api.createSplitGroup(token, {
        name,
        emoji,
        currency,
        members: [...chosen].map((personId) => ({ personId })),
      });
      setData(await api.splitGroups(token));
      setCreating(false);
      setName("");
      setChosen(new Set());
      setSearch("");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (!can(PERMISSIONS.USE_EXPENSES)) {
    return (
      <AppShell>
        <header className="page-head">
          <h1 className="page-title">Split</h1>
        </header>
        <p className="list-empty">You do not have access to shared expenses.</p>
      </AppShell>
    );
  }

  const groups = data?.groups ?? [];
  const active = groups.filter((group) => !group.archived);
  const archived = groups.filter((group) => group.archived);

  return (
    <AppShell>
      <header className="page-head">
        <h1 className="page-title">Split</h1>
        <button
          className="btn btn-primary btn-inline"
          onClick={() => setCreating((on) => !on)}
        >
          {creating ? "Cancel" : "New group"}
        </button>
      </header>

      {error && <div className="error-banner">{error}</div>}

      {/* An account that is not in the people database has nobody to be, so
          nothing below would ever have their name on it. Say so plainly
          rather than showing an empty page that looks broken. */}
      {data && !data.linked && (
        <div className="panel panel-notice">
          <strong>{user?.name}</strong> isn't in the people database yet, so expenses can't be put in
          your name. Ask a leader to add you — the two are matched by name.
        </div>
      )}

      {/* The headline: one line per currency, because this app does not invent
          an exchange rate between them. */}
      {data && (
        <section className="split-totals">
          {data.totals.length === 0 ? (
            <span className="split-total-level">You are all settled up.</span>
          ) : (
            data.totals.map((total) => (
              <span
                key={total.currency}
                className={`split-total split-total-${total.netCents > 0 ? "up" : "down"}`}
              >
                {total.netCents > 0 ? "You are owed " : "You owe "}
                <strong>{formatMoney(Math.abs(total.netCents), total.currency)}</strong>
              </span>
            ))
          )}
        </section>
      )}

      {creating && (
        <section className="section">
          <div className="section-head">
            <h2 className="section-title">New group</h2>
          </div>
          <div className="panel">
            <div className="split-row">
              <div className="field">
                <label htmlFor="group-new-name">Name</label>
                <input
                  id="group-new-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Camp 2026"
                  autoFocus
                />
              </div>
              <div className="field split-field-narrow">
                <label htmlFor="group-new-currency">Currency</label>
                <select
                  id="group-new-currency"
                  value={currency}
                  onChange={(event) => setCurrency(event.target.value)}
                >
                  {CURRENCIES.map((code) => (
                    <option key={code} value={code}>
                      {code}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="split-emoji-picker">
              {EMOJI.map((option) => (
                <button
                  key={option}
                  className={`split-emoji${emoji === option ? " split-emoji-on" : ""}`}
                  onClick={() => setEmoji(option)}
                  aria-label={`Use ${option}`}
                >
                  {option}
                </button>
              ))}
            </div>

            <div className="panel-row">
              <span>Who is in it</span>
              <span className="section-count">{chosen.size} chosen</span>
            </div>
            <SearchBox value={search} onChange={setSearch} label="Search people" />
            <div className="split-people-picker">
              {matches.map((person) => (
                <button
                  key={person.id}
                  className={`split-pick${chosen.has(person.id) ? " split-pick-on" : ""}`}
                  onClick={() => toggle(person.id)}
                >
                  {person.name}
                </button>
              ))}
            </div>
            <p className="panel-note">
              You are added automatically. Anyone can be added or taken out later.
            </p>

            <div className="panel-row panel-row-actions">
              <button className="btn btn-primary btn-inline" onClick={create} disabled={busy}>
                {busy ? "Creating…" : "Create group"}
              </button>
            </div>
          </div>
        </section>
      )}

      <section className="section">
        <div className="section-head">
          <h2 className="section-title">Groups</h2>
          <span className="section-count">{active.length}</span>
        </div>

        {!data ? (
          <p className="list-empty">Loading…</p>
        ) : active.length === 0 ? (
          <p className="list-empty">No groups yet. Start one for a trip, a flat, or an event.</p>
        ) : (
          <ul className="split-groups">
            {active.map((group) => (
              <li key={group.id}>
                <Link to={`/split/${group.id}`} className="split-group">
                  <span className="split-group-emoji" aria-hidden="true">
                    {group.emoji}
                  </span>
                  <span className="split-group-main">
                    <span className="split-group-name">{group.name}</span>
                    <span className="split-group-sub">
                      {group.memberCount} {group.memberCount === 1 ? "person" : "people"}
                    </span>
                  </span>
                  <span
                    className={`split-net split-net-${
                      group.yourNetCents > 0 ? "up" : group.yourNetCents < 0 ? "down" : "level"
                    }`}
                  >
                    {group.yourNetCents === 0
                      ? "settled"
                      : group.yourNetCents > 0
                        ? `owed ${formatMoney(group.yourNetCents, group.currency)}`
                        : `owe ${formatMoney(-group.yourNetCents, group.currency)}`}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}

        {archived.length > 0 && (
          <>
            <div className="section-head">
              <h3 className="split-month-label">Archived</h3>
            </div>
            <ul className="split-groups">
              {archived.map((group) => (
                <li key={group.id}>
                  <Link to={`/split/${group.id}`} className="split-group split-group-archived">
                    <span className="split-group-emoji" aria-hidden="true">
                      {group.emoji}
                    </span>
                    <span className="split-group-main">
                      <span className="split-group-name">{group.name}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      {activity.length > 0 && (
        <section className="section">
          <div className="section-head">
            <h2 className="section-title">Recent activity</h2>
          </div>
          <ul className="split-activity">
            {activity.slice(0, 20).map((entry) => (
              <li key={entry.id} className="split-activity-row">
                <span>
                  <span aria-hidden="true">{entry.emoji} </span>
                  <strong>{entry.actor}</strong> {entry.summary}
                  <span className="split-activity-group"> in {entry.groupName}</span>
                </span>
                <span className="split-activity-when">
                  {new Date(entry.createdAt).toLocaleDateString()}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </AppShell>
  );
}
