import React, { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../api.js";
import { useAuth } from "../context/AuthContext.jsx";
import { STATUS_LABELS, dayText, friendsText, timesText } from "../lib/outings.js";
import DateTile from "../components/DateTile.jsx";
import { initials } from "../lib/photo.js";
import { refreshNavStatus } from "../lib/navStatus.js";
import AppShell from "../components/AppShell.jsx";
import TwoTapButton from "../components/TwoTapButton.jsx";
import FriendCard from "../components/FriendCard.jsx";
import FriendFields, { blankFriend, friendFromSaved } from "../components/FriendFields.jsx";
import { SkeletonRows } from "../components/Skeleton.jsx";

function EvaluationForm({ outingId, mine, onSaved }) {
  const { token } = useAuth();
  const [how, setHow] = useState(mine?.how ?? "");
  const [metNf, setMetNf] = useState(mine ? mine.metNf : null);
  const [friends, setFriends] = useState(() => (mine?.friends ?? []).map(friendFromSaved));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      await api.submitOutingEvaluation(token, outingId, {
        how,
        metNf,
        friends: friends.map(({ key, photoUrl, personId, ...friend }) => friend),
      });
      onSaved();
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  return (
    <form className="panel outing-form" onSubmit={submit} noValidate>
      <div className="field">
        <label htmlFor="evaluation-how">How was the outing?</label>
        <textarea
          id="evaluation-how"
          className="outing-textarea"
          rows={4}
          value={how}
          onChange={(e) => setHow(e.target.value)}
          maxLength={2000}
        />
      </div>

      <div className="field">
        <label>Did we meet any unexpected NFs?</label>
        <div className="narnia-picks">
          {[
            ["Yes", true],
            ["No", false],
          ].map(([label, value]) => (
            <button
              type="button"
              key={label}
              className={`narnia-pick${metNf === value ? " narnia-pick-on" : ""}`}
              aria-pressed={metNf === value}
              onClick={() => {
                setMetNf(value);
                // Saying yes starts the first one, rather than asking for one more tap.
                if (value && friends.length === 0) setFriends([blankFriend()]);
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {metNf === true && (
        <div className="outing-friend-list">
          {friends.map((friend) => (
            <FriendFields
              key={friend.key}
              friend={friend}
              onChange={(change) =>
                setFriends((list) =>
                  list.map((item) => (item.key === friend.key ? { ...item, ...change } : item))
                )
              }
              onRemove={() =>
                setFriends((list) => list.filter((item) => item.key !== friend.key))
              }
            />
          ))}
          <button
            type="button"
            className="btn btn-secondary btn-inline outing-add-friend"
            onClick={() => setFriends((list) => [...list, blankFriend()])}
          >
            + Friend
          </button>
        </div>
      )}

      {error && <div className="error-banner">{error}</div>}

      <button className="btn btn-primary" type="submit" disabled={saving}>
        {saving ? <span className="spinner" /> : "Submit"}
      </button>
    </form>
  );
}

function Evaluation({ evaluation, showName, canAdd, onChanged }) {
  return (
    <div className="panel outing-evaluation">
      {showName && <div className="outing-evaluation-name">{evaluation.name}</div>}
      <p className="outing-evaluation-text">{evaluation.how}</p>
      <div className="narnia-subhead">Unexpected NFs</div>
      {evaluation.friends.length > 0 ? (
        evaluation.friends.map((friend) => (
          <FriendCard key={friend.id} friend={friend} canAdd={canAdd} onAdded={onChanged} />
        ))
      ) : (
        <p className="outing-evaluation-text">
          {evaluation.metNf ? evaluation.nfDetails : "No"}
        </p>
      )}
    </div>
  );
}

export default function OutingDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { token } = useAuth();
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [changing, setChanging] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await api.outing(token, id));
      setError("");
    } catch (err) {
      setError(err.message);
    }
  }, [id, token]);

  useEffect(() => {
    load();
  }, [load]);

  async function run(call) {
    setBusy(true);
    setError("");
    try {
      await call();
      await load();
      refreshNavStatus();
    } catch (err) {
      setError(err.message);
      // Someone else may have moved it on, so show where it actually is.
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    setError("");
    try {
      await api.deleteOuting(token, id);
      navigate("/outings", { replace: true });
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  const back = (
    <Link className="admin-back" to="/outings" aria-label="Back to Outings">
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M15 5l-7 7 7 7" />
      </svg>
    </Link>
  );

  if (!data) {
    return (
      <AppShell>
        <header className="page-head admin-page-head">
          {back}
          <h1 className="page-title">Outing</h1>
        </header>
        {error ? (
          <div className="error-banner">{error}</div>
        ) : (
          <SkeletonRows count={5} label="Loading the outing" />
        )}
      </AppShell>
    );
  }

  const { outing, canRun, evaluations } = data;
  const canEdit = outing.canEdit;
  const mine = evaluations.find((evaluation) => evaluation.mine);
  const others = evaluations.filter((evaluation) => !evaluation.mine);
  const ended = outing.status === "ended";
  const waiting = canRun && ended ? outing.people.filter((person) => !person.submitted) : [];

  return (
    <AppShell>
      <header className="od-head">
        {back}
        {canEdit && !ended && (
          <Link className="od-edit" to={`/outings/${id}/edit`}>
            Edit
          </Link>
        )}
      </header>

      <h1 className="od-title">{outing.type}</h1>
      <div className="od-meta">
        <span className={`od-status od-status-${outing.status}`}>
          {outing.status === "active" ? "Happening now" : STATUS_LABELS[outing.status]}
        </span>
        <span>
          Organised by {outing.isOrganiser ? "you" : outing.organiser || "a leader"}
        </span>
      </div>

      {error && <div className="error-banner">{error}</div>}

      <div className="panel od-card">
        <div className="od-when">
          <DateTile date={outing.heldOn} size="lg" />
          <div className="od-when-text">
            <div className="od-day">{dayText(outing.heldOn)}</div>
            <div className="od-line">{timesText(outing) || "Time not set"}</div>
            {outing.location && <div className="od-line od-place">{outing.location}</div>}
          </div>
        </div>

        <div className="od-section">
          <div className="od-label">Goals</div>
          {outing.goals ? (
            <p className="od-goals">{outing.goals}</p>
          ) : (
            <p className="od-empty">
              {canEdit && !ended ? (
                <Link to={`/outings/${id}/edit`}>Add goals</Link>
              ) : (
                "No goals set yet."
              )}
            </p>
          )}
        </div>

        <div className="od-section">
          <div className="od-label">Going · {outing.people.length}</div>
          <ul className="od-people">
            {outing.people.map((person) => (
              <li key={person.id}>
                <span className="od-avatar" aria-hidden="true">
                  {initials(person.name)}
                </span>
                <span className="od-name">{person.name}</span>
                {person.name.toLowerCase() === (outing.organiser || "").toLowerCase() && (
                  <span className="od-tag">Organiser</span>
                )}
              </li>
            ))}
          </ul>
          {friendsText(outing) && (
            <div className="od-friends">
              <span className="od-avatar od-avatar-plus" aria-hidden="true">
                +{outing.friendsCount ?? ""}
              </span>
              <span>
                {outing.friendsCount === 1 ? "1 friend" : outing.friendsCount ? `${outing.friendsCount} friends` : "Friends"}
                {outing.friendsWho && <span className="od-friends-who"> · {outing.friendsWho}</span>}
              </span>
            </div>
          )}
        </div>
      </div>

      {canEdit && (
        <div className="od-actions">
          {outing.status === "planned" && (
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy}
              onClick={() => run(() => api.startOuting(token, id))}
            >
              Start outing
            </button>
          )}
          {outing.status === "active" && (
            <TwoTapButton
              className="btn btn-primary"
              confirmLabel="Tap again to end"
              disabled={busy}
              onConfirm={() => run(() => api.endOuting(token, id))}
            >
              End outing
            </TwoTapButton>
          )}
          <TwoTapButton
            className="od-delete"
            confirmLabel="Tap again to delete"
            disabled={busy}
            onConfirm={remove}
          >
            Delete outing
          </TwoTapButton>
        </div>
      )}

      {ended && outing.mine && (
        <section className="section">
          <div className="section-head">
            <h2 className="section-title">Your evaluation</h2>
            {mine && !changing && (
              <button
                type="button"
                className="btn btn-secondary btn-inline outing-edit-evaluation"
                onClick={() => setChanging(true)}
              >
                Edit
              </button>
            )}
          </div>
          {!mine || changing ? (
            <EvaluationForm
              outingId={id}
              mine={mine}
              onSaved={() => {
                setChanging(false);
                load();
                refreshNavStatus();
              }}
            />
          ) : (
            <Evaluation evaluation={mine} canAdd={canRun} onChanged={load} />
          )}
        </section>
      )}

      {canRun && ended && (
        <section className="section">
          <div className="section-head">
            <h2 className="section-title">Evaluations</h2>
            <span className="section-count">
              {evaluations.length}/{outing.people.length}
            </span>
          </div>

          {waiting.length > 0 && (
            <div className="panel outing-waiting">
              <div className="narnia-subhead">Waiting for</div>
              <ul className="outing-waiting-list">
                {waiting.map((person) => (
                  <li key={person.id}>
                    {person.name}
                    {!person.hasAccount && <span className="pool-team">No account</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="outing-list">
            {others.map((evaluation) => (
              <Evaluation
                key={evaluation.name}
                evaluation={evaluation}
                showName
                canAdd={canRun}
                onChanged={load}
              />
            ))}
          </div>
        </section>
      )}
    </AppShell>
  );
}
