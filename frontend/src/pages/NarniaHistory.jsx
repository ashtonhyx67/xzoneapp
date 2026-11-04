import React, { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { api } from "../api.js";
import { useAuth } from "../context/AuthContext.jsx";
import { formatDay } from "../lib/narnia.js";
import { PERMISSIONS } from "../lib/permissions.js";
import AdminPage from "../components/AdminPage.jsx";
import { SkeletonRows } from "../components/Skeleton.jsx";

// Who came and who didn't, for leaders only. A clean-up is not a service, so none
// of this feeds the weekly registers.
export default function NarniaHistory() {
  const { token, can } = useAuth();
  const allowed = can(PERMISSIONS.RUN_NARNIA);
  const [sessions, setSessions] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!allowed) return undefined;
    const controller = new AbortController();
    api
      .narniaHistory(token, controller.signal)
      .then((data) => setSessions(data.sessions))
      .catch((err) => {
        if (err.name !== "AbortError") setError(err.message);
      });
    return () => controller.abort();
  }, [allowed, token]);

  if (!allowed) return <Navigate to="/admin" replace />;

  return (
    <AdminPage title="History">
      {error && <div className="error-banner">{error}</div>}
      {!sessions && !error && <SkeletonRows count={3} label="Loading past clean-ups" />}
      {sessions?.length === 0 && <div className="list-empty">Nothing here</div>}
      {sessions?.length > 0 && (
        <div className="narnia-history">
          {sessions.map((session) => (
            <details className="panel narnia-history-row" key={session.id}>
              <summary>
                <span className="narnia-history-day">{formatDay(session.heldOn)}</span>
                <span className="narnia-hint">
                  {session.came.length} came · {session.missed.length} didn't
                </span>
              </summary>
              <h3 className="narnia-subhead">Came</h3>
              <p className="narnia-history-names">{session.came.join(", ")}</p>
              {session.missed.length > 0 && (
                <>
                  <h3 className="narnia-subhead">Didn't come</h3>
                  <p className="narnia-history-names">{session.missed.join(", ")}</p>
                </>
              )}
              {session.withoutAccount.length > 0 && (
                <>
                  <h3 className="narnia-subhead">No account</h3>
                  <p className="narnia-history-names">{session.withoutAccount.join(", ")}</p>
                </>
              )}
            </details>
          ))}
        </div>
      )}
    </AdminPage>
  );
}
