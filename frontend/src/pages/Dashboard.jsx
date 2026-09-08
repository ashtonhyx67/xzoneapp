import React, { useEffect, useMemo, useState } from "react";
import { startRegistration, browserSupportsWebAuthn } from "@simplewebauthn/browser";
import { api } from "../api.js";
import { useAuth } from "../context/AuthContext.jsx";
import { rememberFaceIdDevice } from "../lib/faceId.js";
import AppShell from "../components/AppShell.jsx";
import Roster from "../components/Roster.jsx";

export default function Dashboard() {
  const { user, token, faceIdEnabled, setFaceIdEnabled } = useAuth();
  const [stats, setStats] = useState([]);
  const [statsError, setStatsError] = useState("");
  const [enrolling, setEnrolling] = useState(false);
  const [notice, setNotice] = useState(null); // { type: 'success' | 'error', text }

  const supportsWebAuthn = useMemo(() => browserSupportsWebAuthn(), []);
  const firstName = user?.name ? user.name.split(" ")[0] : "";

  useEffect(() => {
    if (!token) return;

    const controller = new AbortController();
    let active = true;

    api
      .dashboardSummary(token, controller.signal)
      .then((data) => {
        if (active) setStats(data.stats);
      })
      .catch((err) => {
        // A silent catch here left the page permanently blank with no reason.
        if (active && err.name !== "AbortError") setStatsError(err.message);
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [token]);

  async function handleEnableFaceId() {
    setNotice(null);
    setEnrolling(true);
    try {
      const options = await api.webauthnRegisterOptions(token);
      const regResponse = await startRegistration({ optionsJSON: options });
      await api.webauthnRegisterVerify(token, regResponse);
      // Lets the sign-in page offer Face ID next time this device is used.
      if (user?.email) rememberFaceIdDevice(user.email);
      setFaceIdEnabled(true);
      setNotice({ type: "success", text: "Face ID is now enabled for this device." });
    } catch (err) {
      setNotice({
        type: "error",
        text: err.message || "Couldn't enable Face ID on this device.",
      });
    } finally {
      setEnrolling(false);
    }
  }

  return (
    <AppShell>
      <h1 className="page-title">Welcome back{firstName ? `, ${firstName}` : ""}</h1>

      {statsError && <div className="error-banner">{statsError}</div>}

      <div className="stat-grid">
        {stats.map((stat) => (
          <div className="stat-card" key={stat.label}>
            <div className="stat-label">{stat.label}</div>
            <div className="stat-value">{stat.value}</div>
          </div>
        ))}
      </div>

      <Roster token={token} />

      {supportsWebAuthn && (
        <div className="panel">
          <div className="panel-row">
            <div className="panel-title">Face ID sign-in</div>
            {faceIdEnabled ? (
              <span className="badge badge-on">Enabled</span>
            ) : (
              <button
                className="btn btn-secondary btn-inline"
                onClick={handleEnableFaceId}
                disabled={enrolling}
              >
                {enrolling ? "Waiting for device…" : "Enable Face ID"}
              </button>
            )}
          </div>
          {notice && (
            <div
              className={`panel-notice ${
                notice.type === "success" ? "success-banner" : "error-banner"
              }`}
            >
              {notice.text}
            </div>
          )}
        </div>
      )}
    </AppShell>
  );
}
