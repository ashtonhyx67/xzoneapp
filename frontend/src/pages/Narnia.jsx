import React, { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api.js";
import { useAuth } from "../context/AuthContext.jsx";
import { formatDay } from "../lib/narnia.js";
import { usePoll } from "../lib/usePoll.js";
import AppShell from "../components/AppShell.jsx";
import NarniaBoard from "../components/NarniaBoard.jsx";
import NarniaStandard from "../components/NarniaStandard.jsx";
import { SkeletonRows } from "../components/Skeleton.jsx";

const POLL_MS = 15000;

const TABS = [
  { key: "today", label: "Today" },
  { key: "standard", label: "The standard" },
  { key: "history", label: "History" },
];

function History() {
  const { token } = useAuth();
  const [sessions, setSessions] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    api
      .narniaHistory(token, controller.signal)
      .then((data) => setSessions(data.sessions))
      .catch((err) => {
        if (err.name !== "AbortError") setError(err.message);
      });
    return () => controller.abort();
  }, [token]);

  if (error) return <div className="error-banner">{error}</div>;
  if (!sessions) return <SkeletonRows count={3} label="Loading past clean-ups" />;
  if (sessions.length === 0) {
    return (
      <div className="list-empty">
        Past clean-ups, who came and who didn't will appear here. Only leaders can see this.
      </div>
    );
  }

  return (
    <div className="narnia-history">
      {sessions.map((session) => (
        <details className="panel narnia-history-row" key={session.id}>
          <summary>
            <span className="narnia-history-day">{formatDay(session.heldOn)}</span>
            <span className="narnia-hint">
              {session.came.length} came · {session.missed.length} didn't ·{" "}
              {session.tasksDone} {session.tasksDone === 1 ? "task" : "tasks"} done
            </span>
          </summary>
          <h3 className="narnia-subhead">Came</h3>
          <p className="narnia-history-names">{session.came.join(", ")}</p>
          <h3 className="narnia-subhead">Didn't come</h3>
          <p className="narnia-history-names">
            {session.missed.length > 0 ? session.missed.join(", ") : "Everyone with an account came."}
          </p>
          {session.withoutAccount.length > 0 && (
            <>
              <h3 className="narnia-subhead">Checked in without an account</h3>
              <p className="narnia-history-names">{session.withoutAccount.join(", ")}</p>
              <p className="narnia-hint">
                If one of these people has an account under a different spelling, they'll also show
                under Didn't come.
              </p>
            </>
          )}
        </details>
      ))}
    </div>
  );
}

// Everyone can read the standard here. Whoever runs BM also gets the board, and a
// person already checked in gets a way back to their own job.
export default function Narnia() {
  const { token } = useAuth();
  const [overview, setOverview] = useState(null);
  const [tab, setTab] = useState("today");
  const [error, setError] = useState("");

  // Bumped by every edit to the standard. A poll sent before an edit knows nothing
  // of it, and must not take the edit back off the screen when it answers.
  const revision = useRef(0);

  const load = useCallback(async () => {
    const at = revision.current;
    try {
      const data = await api.narnia(token);
      if (at === revision.current) setOverview(data);
      setError("");
    } catch (err) {
      setError(err.message);
    }
  }, [token]);

  usePoll(load, POLL_MS);

  const setRooms = useCallback((rooms) => {
    revision.current += 1;
    setOverview((current) => ({ ...current, rooms }));
  }, []);

  const canRun = Boolean(overview?.canRun);
  const showing = canRun ? tab : "standard";

  return (
    <AppShell>
      <header className="page-head">
        <h1 className="page-title">Narnia BM</h1>
      </header>

      {error && !overview && <div className="error-banner">{error}</div>}

      {overview?.myCode && (
        <Link className="panel narnia-my-job" to={`/narnia/in/${overview.myCode}`}>
          <span>
            <strong>You're checked in.</strong> See what you've been given to do.
          </span>
          <span aria-hidden="true">→</span>
        </Link>
      )}

      {overview?.running && !overview.myCode && !canRun && (
        <div className="panel narnia-my-job">
          <span>
            <strong>BM is on now.</strong> Scan the QR code with your phone's camera to check in.
          </span>
        </div>
      )}

      {canRun && (
        <div className="narnia-tabs" role="tablist" aria-label="Narnia BM">
          {TABS.map((item) => (
            <button
              type="button"
              key={item.key}
              role="tab"
              aria-selected={tab === item.key}
              className={`narnia-tab${tab === item.key ? " narnia-tab-on" : ""}`}
              onClick={() => setTab(item.key)}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}

      {!overview ? (
        !error && <SkeletonRows count={5} label="Loading Narnia BM" />
      ) : showing === "today" ? (
        <NarniaBoard />
      ) : showing === "standard" ? (
        <NarniaStandard rooms={overview.rooms} canRun={canRun} onRooms={setRooms} />
      ) : (
        <History />
      )}
    </AppShell>
  );
}
