import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api.js";
import { useAuth } from "../context/AuthContext.jsx";
import { STATUS_LABELS, whenText } from "../lib/outings.js";
import AppShell from "../components/AppShell.jsx";
import { SkeletonRows } from "../components/Skeleton.jsx";

function OutingCard({ outing }) {
  return (
    <Link className="panel outing-card" to={`/outings/${outing.id}`}>
      <span className="outing-card-main">
        <span className="outing-card-type">{outing.type}</span>
        {outing.location && <span className="outing-card-line">{outing.location}</span>}
        <span className="outing-card-line">{whenText(outing)}</span>
      </span>
      <span className={`outing-status outing-status-${outing.status}`}>
        {STATUS_LABELS[outing.status]}
      </span>
    </Link>
  );
}

function Section({ title, outings }) {
  if (outings.length === 0) return null;
  return (
    <section className="section">
      <div className="section-head">
        <h2 className="section-title">{title}</h2>
        <span className="section-count">{outings.length}</span>
      </div>
      <div className="outing-list">
        {outings.map((outing) => (
          <OutingCard key={outing.id} outing={outing} />
        ))}
      </div>
    </section>
  );
}

export default function Outings() {
  const { token } = useAuth();
  const [data, setData] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    api
      .outings(token, controller.signal)
      .then(setData)
      .catch((err) => {
        if (err.name !== "AbortError") setError(err.message);
      });
    return () => controller.abort();
  }, [token]);

  const outings = data?.outings ?? [];
  const toEvaluate = outings.filter((outing) => outing.toEvaluate);
  const others = outings.filter((outing) => !outing.toEvaluate);
  // Soonest first for what is coming; newest first, as they arrive, for what is past.
  const planned = others
    .filter((outing) => outing.status === "planned")
    .sort((a, b) => a.heldOn.localeCompare(b.heldOn));

  return (
    <AppShell>
      <header className="page-head">
        <h1 className="page-title">Outings</h1>
        {data?.canRun && (
          <Link className="btn btn-primary btn-inline outing-new" to="/outings/new">
            + Outing
          </Link>
        )}
      </header>

      {error && <div className="error-banner">{error}</div>}
      {!data && !error && <SkeletonRows count={4} label="Loading outings" />}
      {data && outings.length === 0 && <div className="list-empty">Nothing here</div>}

      <Section title="To evaluate" outings={toEvaluate} />
      <Section title="Running" outings={others.filter((outing) => outing.status === "active")} />
      <Section title="Planned" outings={planned} />
      <Section title="Past" outings={others.filter((outing) => outing.status === "ended")} />
    </AppShell>
  );
}
