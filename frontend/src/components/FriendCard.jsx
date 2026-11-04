import React, { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api.js";
import { useAuth } from "../context/AuthContext.jsx";
import { CGS } from "../lib/teams.js";
import { formatDay } from "../lib/narnia.js";
import { initials } from "../lib/photo.js";

const TEAM_KEYS = CGS.flatMap((cg) => cg.teams);

// Moving a friend into the people database, under a name and team a leader chooses.
// Two people can easily meet the same friend, so a name already there can be linked
// to rather than added twice.
function AddToDatabase({ friend, onAdded }) {
  const { token } = useAuth();
  const [name, setName] = useState(friend.name);
  const [team, setTeam] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [taken, setTaken] = useState(false);

  async function add(link) {
    setBusy(true);
    setError("");
    try {
      await api.addOutingFriend(token, friend.id, { name, team, link });
      onAdded();
    } catch (err) {
      setError(err.message);
      setTaken(err.status === 409);
      setBusy(false);
    }
  }

  return (
    <div className="friend-add">
      {error && <div className="error-banner">{error}</div>}
      <div className="friend-add-row">
        <input
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setTaken(false);
          }}
          aria-label="Name in the database"
          maxLength={80}
        />
        <select value={team} onChange={(e) => setTeam(e.target.value)} aria-label="Team">
          <option value="">No team</option>
          {TEAM_KEYS.map((key) => (
            <option key={key} value={key}>
              {key}
            </option>
          ))}
        </select>
      </div>
      <div className="narnia-form-actions">
        <button
          type="button"
          className="btn btn-primary btn-inline"
          disabled={busy || !name.trim()}
          onClick={() => add(false)}
        >
          Add to database
        </button>
        {taken && (
          <button
            type="button"
            className="btn btn-secondary btn-inline"
            disabled={busy}
            onClick={() => add(true)}
          >
            Same person
          </button>
        )}
      </div>
    </div>
  );
}

export default function FriendCard({ friend, canAdd, onAdded }) {
  const details = [
    ["Age", friend.age],
    ["Birthday", friend.birthday && formatDay(friend.birthday)],
    ["Stage of life", friend.stage],
    ["School", friend.school],
    ["Contact", friend.contact],
    ["Telegram", friend.telegram],
    ["Instagram", friend.instagram],
    ["Religion", friend.religion],
    ["Notes", friend.notes],
  ].filter(([, value]) => value !== null && value !== "" && value !== undefined);

  return (
    <div className="friend-card">
      <div className="friend-card-head">
        {friend.photoUrl ? (
          <img className="friend-photo" src={friend.photoUrl} alt={friend.name} loading="lazy" />
        ) : (
          <span className="friend-photo friend-photo-empty" aria-hidden="true">
            {initials(friend.name)}
          </span>
        )}
        <span className="friend-name">{friend.name}</span>
        {friend.personId && canAdd && (
          <Link className="friend-in-database" to={`/members?person=${friend.personId}`}>
            In database →
          </Link>
        )}
      </div>

      {details.length > 0 && (
        <dl className="friend-details">
          {details.map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      )}

      {canAdd && !friend.personId && <AddToDatabase friend={friend} onAdded={onAdded} />}
    </div>
  );
}
