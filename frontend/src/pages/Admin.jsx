import React from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext.jsx";
import { PERMISSIONS } from "../lib/permissions.js";
import AppShell from "../components/AppShell.jsx";
import PinSettings from "../components/PinSettings.jsx";
import FaceIdSettings from "../components/FaceIdSettings.jsx";
import AccountsPanel from "../components/AccountsPanel.jsx";
import AppVersion from "../components/AppVersion.jsx";

// Everything about signing in lives here — your own PIN and Face ID, and, for
// anyone who can manage accounts, everyone else's access.
export default function Admin() {
  const { user, can, group, isOwner, signOut } = useAuth();
  const navigate = useNavigate();

  function handleSignOut() {
    signOut();
    navigate("/login");
  }

  return (
    <AppShell>
      <header className="page-head">
        <h1 className="page-title">Admin</h1>
        <span className={`group-pill${isOwner ? " group-pill-owner" : ""}`}>
          {isOwner ? "Owner" : group?.label || "No access"}
        </span>
      </header>

      <section className="section">
        <div className="section-head">
          <h2 className="section-title">Your sign-in</h2>
        </div>

        {/* Who is signed in, and the way out. The sidebar carried both, but on a
            phone the sidebar is a bar of icons with no room for them, so they
            live here — where everything else about signing in already is. */}
        <div className="panel account-panel">
          <div className="account-identity">
            <div className="account-name">{user?.name}</div>
            <div className="account-email">{user?.email}</div>
          </div>
          <button className="btn btn-secondary btn-inline" onClick={handleSignOut}>
            Sign out
          </button>
        </div>

        <PinSettings />
        <FaceIdSettings />
      </section>

      <section className="section">
        <div className="section-head">
          <h2 className="section-title">Version</h2>
        </div>
        <AppVersion />
      </section>

      {can(PERMISSIONS.MANAGE_ACCOUNTS) && <AccountsPanel />}
    </AppShell>
  );
}
