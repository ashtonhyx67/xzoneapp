import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { startRegistration, browserSupportsWebAuthn } from "@simplewebauthn/browser";
import { api } from "../api.js";
import { useAuth } from "../context/AuthContext.jsx";
import { rememberFaceIdDevice } from "../lib/faceId.js";
import AppShell from "../components/AppShell.jsx";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function formatDay(birthday) {
  const [, month, day] = birthday.split("-");
  return `${Number(day)} ${MONTHS[Number(month) - 1]}`;
}

function whenLabel(daysAway) {
  if (daysAway === 0) return "Today";
  if (daysAway === 1) return "Tomorrow";
  return `In ${daysAway} days`;
}

export default function Dashboard() {
  const { user, token, faceIdEnabled, setFaceIdEnabled, isAdmin } = useAuth();
  const [summary, setSummary] = useState(null);
  const [summaryError, setSummaryError] = useState("");
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
        if (active) setSummary(data);
      })
      .catch((err) => {
        if (active && err.name !== "AbortError") setSummaryError(err.message);
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

  const birthdays = summary?.birthdays ?? [];
  const followUps = summary?.followUps ?? [];

  return (
    <AppShell>
      <h1 className="page-title">Welcome back{firstName ? `, ${firstName}` : ""}</h1>

      {summaryError && <div className="error-banner">{summaryError}</div>}

      {isAdmin && (
        <>
          <div className="stat-grid">
            {(summary?.stats ?? []).map((stat) => (
              <div className="stat-card" key={stat.label}>
                <div className="stat-label">{stat.label}</div>
                <div className="stat-value">{stat.value}</div>
              </div>
            ))}
          </div>

          <div className="panel">
            <div className="panel-row">
              <div className="panel-title">Birthdays</div>
              <Link className="link-btn" to="/members">
                Members
              </Link>
            </div>
            {birthdays.length === 0 ? (
              <div className="reminder-empty">Nothing in the next 30 days.</div>
            ) : (
              <ul className="reminder-list">
                {birthdays.map((person) => (
                  <li className="reminder-row" key={person.id}>
                    <span className="reminder-name">{person.name}</span>
                    <span className="reminder-detail">
                      {formatDay(person.birthday)} · turning {person.turning}
                    </span>
                    <span className={`badge ${person.daysAway <= 1 ? "badge-on" : "badge-off"}`}>
                      {whenLabel(person.daysAway)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="panel">
            <div className="panel-row">
              <div className="panel-title">Follow-ups open</div>
              <Link className="link-btn" to="/members">
                Members
              </Link>
            </div>
            {followUps.length === 0 ? (
              <div className="reminder-empty">Everyone is marked Done.</div>
            ) : (
              <ul className="reminder-list">
                {followUps.map((person) => (
                  <li className="reminder-row" key={person.id}>
                    <span className="reminder-name">{person.name}</span>
                    <span className="reminder-detail">{person.role}</span>
                    <span className="badge badge-off">{person.status}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}

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
