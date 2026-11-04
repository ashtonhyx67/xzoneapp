import React, { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../api.js";
import { useAuth } from "../context/AuthContext.jsx";
import { STATUS_LABELS, friendsText, whenText } from "../lib/outings.js";
import { refreshNavStatus } from "../lib/navStatus.js";
import AppShell from "../components/AppShell.jsx";
import TwoTapButton from "../components/TwoTapButton.jsx";
import { SkeletonRows } from "../components/Skeleton.jsx";

function Detail({ label, children }) {
  if (!children) return null;
  return (
    <div className="outing-detail">
      <div className="narnia-subhead">{label}</div>
      <div className="outing-detail-value">{children}</div>
    </div>
  );
}

function EvaluationForm({ outingId, mine, onSaved }) {
  const { token } = useAuth();
  const [how, setHow] = useState(mine?.how ?? "");
  const [metNf, setMetNf] = useState(mine ? mine.metNf : null);
  const [nfDetails, setNfDetails] = useState(mine?.nfDetails ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      await api.submitOutingEvaluation(token, outingId, { how, metNf, nfDetails });
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
              onClick={() => setMetNf(value)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {metNf === true && (
        <div className="field">
          <label htmlFor="evaluation-who">Who?</label>
          <textarea
            id="evaluation-who"
            className="outing-textarea"
            rows={2}
            value={nfDetails}
            onChange={(e) => setNfDetails(e.target.value)}
            maxLength={2000}
          />
        </div>
      )}

      {error && <div className="error-banner">{error}</div>}

      <button className="btn btn-primary" type="submit" disabled={saving}>
        {saving ? <span className="spinner" /> : "Submit"}
      </button>
    </form>
  );
}

function Evaluation({ evaluation, showName }) {
  return (
    <div className="panel outing-evaluation">
      {showName && <div className="outing-evaluation-name">{evaluation.name}</div>}
      <p className="outing-evaluation-text">{evaluation.how}</p>
      <div className="narnia-subhead">Unexpected NFs</div>
      <p className="outing-evaluation-text">
        {evaluation.metNf ? evaluation.nfDetails : "No"}
      </p>
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
  const mine = evaluations.find((evaluation) => evaluation.mine);
  const others = evaluations.filter((evaluation) => !evaluation.mine);
  const ended = outing.status === "ended";
  const waiting = canRun && ended ? outing.people.filter((person) => !person.submitted) : [];

  return (
    <AppShell>
      <header className="page-head admin-page-head">
        {back}
        <h1 className="page-title">{outing.type}</h1>
        <span className={`outing-status outing-status-${outing.status}`}>
          {STATUS_LABELS[outing.status]}
        </span>
      </header>

      {error && <div className="error-banner">{error}</div>}

      <div className="panel outing-summary">
        <Detail label="When">{whenText(outing)}</Detail>
        <Detail label="Location">{outing.location}</Detail>
        <Detail label="Goals">{outing.goals}</Detail>
        <Detail label="Friends">{friendsText(outing)}</Detail>
        <Detail label="Who's going">
          <span className="narnia-logistics outing-names">
            {outing.people.map((person) => (
              <span className="outing-name" key={person.id}>
                {person.name}
              </span>
            ))}
          </span>
        </Detail>
      </div>

      {canRun && (
        <div className="outing-actions">
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
          <div className="outing-actions-row">
            {!ended && (
              <Link className="btn btn-secondary btn-inline" to={`/outings/${id}/edit`}>
                Edit
              </Link>
            )}
            <TwoTapButton
              className="btn btn-secondary btn-inline"
              confirmLabel="Tap again to delete"
              disabled={busy}
              onConfirm={remove}
            >
              Delete
            </TwoTapButton>
          </div>
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
            <Evaluation evaluation={mine} />
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
              <Evaluation key={evaluation.name} evaluation={evaluation} showName />
            ))}
          </div>
        </section>
      )}
    </AppShell>
  );
}
