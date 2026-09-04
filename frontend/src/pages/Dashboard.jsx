import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { startRegistration, browserSupportsWebAuthn } from "@simplewebauthn/browser";
import { api } from "../api.js";
import { useAuth } from "../context/AuthContext.jsx";

function initials(name = "") {
  return name
    .split(" ")
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

export default function Dashboard() {
  const { user, token, signOut } = useAuth();
  const navigate = useNavigate();
  const [stats, setStats] = useState([]);
  const [faceIdEnabled, setFaceIdEnabled] = useState(false);
  const [enrolling, setEnrolling] = useState(false);
  const [notice, setNotice] = useState(null); // { type: 'success' | 'error', text }
  const supportsWebAuthn = browserSupportsWebAuthn();

  useEffect(() => {
    api
      .dashboardSummary(token)
      .then((data) => setStats(data.stats))
      .catch(() => {});
  }, [token]);

  function handleSignOut() {
    signOut();
    navigate("/login");
  }

  async function handleEnableFaceId() {
    setNotice(null);
    setEnrolling(true);
    try {
      const options = await api.webauthnRegisterOptions(token);
      const regResponse = await startRegistration({ optionsJSON: options });
      await api.webauthnRegisterVerify(token, regResponse);
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
    <div className="dashboard-shell">
      <aside className="sidebar">
        <div className="sidebar-wordmark">Team App</div>

        <div className="nav-item active">Dashboard</div>
        <div className="nav-item">Members</div>
        <div className="nav-item">Settings</div>

        <div className="sidebar-footer">
          <div className="user-chip">
            <div className="user-avatar">{initials(user?.name)}</div>
            <div>
              <div className="user-name">{user?.name}</div>
              <div className="user-email">{user?.email}</div>
            </div>
          </div>
          <button className="signout-btn" onClick={handleSignOut}>
            Sign out
          </button>
        </div>
      </aside>

      <main className="main-content">
        <h1 className="page-title">Welcome back{user?.name ? `, ${user.name.split(" ")[0]}` : ""}</h1>
        <p className="page-subtitle">Here's what's happening with your team.</p>

        <div className="stat-grid">
          {stats.map((s) => (
            <div className="stat-card" key={s.label}>
              <div className="stat-label">{s.label}</div>
              <div className="stat-value">{s.value}</div>
            </div>
          ))}
        </div>

        {supportsWebAuthn && (
          <div className="panel">
            <div className="faceid-row">
              <div>
                <div className="panel-title">Face ID sign-in</div>
                <p className="panel-body">
                  Enable Face ID, Touch ID, or your device's biometric unlock so you can skip
                  typing a password next time.
                </p>
              </div>
              <div>
                {faceIdEnabled ? (
                  <span className="badge badge-on">Enabled</span>
                ) : (
                  <button
                    className="btn btn-secondary"
                    style={{ width: "auto", whiteSpace: "nowrap" }}
                    onClick={handleEnableFaceId}
                    disabled={enrolling}
                  >
                    {enrolling ? "Waiting for device…" : "Enable Face ID"}
                  </button>
                )}
              </div>
            </div>
            {notice && (
              <div
                className={notice.type === "success" ? "success-banner" : "error-banner"}
                style={{ marginTop: 16, marginBottom: 0 }}
              >
                {notice.text}
              </div>
            )}
          </div>
        )}

        <div className="panel">
          <div className="panel-title">This is your dashboard shell</div>
          <p className="panel-body">
            Add more sections here as the app grows — projects, tasks, activity, whatever your
            50 members need. The sidebar, stat cards, and panel styles are ready to reuse.
          </p>
        </div>
      </main>
    </div>
  );
}
