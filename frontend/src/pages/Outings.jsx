import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api.js";
import { useAuth } from "../context/AuthContext.jsx";
import { dayText, timesText } from "../lib/outings.js";
import { localDay } from "../lib/narnia.js";
import DateTile from "../components/DateTile.jsx";
import AppShell from "../components/AppShell.jsx";
import { SkeletonRows } from "../components/Skeleton.jsx";

function OutingCard({ outing }) {
  const times = timesText(outing);
  return (
    <Link className="outing-card" to={`/outings/${outing.id}`}>
      <DateTile date={outing.heldOn} />
      <span className="outing-card-main">
        <span className="outing-card-type">
          {outing.type}
          {outing.status === "active" && <span className="outing-live">Now</span>}
          {outing.toEvaluate && <span className="outing-live outing-live-soft">Evaluate</span>}
        </span>
        <span className="outing-card-line">
          {[dayText(outing.heldOn), times].filter(Boolean).join(" · ")}
        </span>
        {outing.location && (
          <span className="outing-card-line outing-card-place">{outing.location}</span>
        )}
      </span>
      <svg className="outing-card-chevron" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
        <path d="M9 5l7 7-7 7" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </Link>
  );
}

function Section({ title, outings }) {
  if (outings.length === 0) return null;
  return (
    <section className="section">
      <div className="section-head">
        <h2 className="section-title">{title}</h2>
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
          <Link className="outing-new" to="/outings/new">
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
              <path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
            </svg>
            New
          </Link>
        )}
      </header>

      {error && <div className="error-banner">{error}</div>}
      {!data && !error && <SkeletonRows count={4} label="Loading outings" />}
      {data && outings.length === 0 && (
        <div className="outing-empty">
          <DateTile date={localDay()} size="lg" />
          <p>No outings yet.</p>
          {data.canRun && <p className="outing-empty-hint">Tap New to plan one.</p>}
        </div>
      )}

      <Section title="To evaluate" outings={toEvaluate} />
      <Section title="Running" outings={others.filter((outing) => outing.status === "active")} />
      <Section title="Coming up" outings={planned} />
      <Section title="Past" outings={others.filter((outing) => outing.status === "ended")} />
    </AppShell>
  );
}
