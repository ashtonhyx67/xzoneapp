import React from "react";
import { useAuth } from "../context/AuthContext.jsx";
import { PERMISSIONS } from "../lib/permissions.js";
import AppShell from "../components/AppShell.jsx";
import PinSettings from "../components/PinSettings.jsx";
import FaceIdSettings from "../components/FaceIdSettings.jsx";
import AccountsPanel from "../components/AccountsPanel.jsx";

// Everything about signing in lives here — your own PIN and Face ID, and, for
// anyone who can manage accounts, everyone else's access.
export default function Admin() {
  const { can, group, isOwner } = useAuth();

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
        <PinSettings />
        <FaceIdSettings />
      </section>

      {can(PERMISSIONS.MANAGE_ACCOUNTS) && <AccountsPanel />}
    </AppShell>
  );
}
