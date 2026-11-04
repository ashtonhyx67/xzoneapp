import React from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext.jsx";
import AdminPage from "../components/AdminPage.jsx";
import PasswordSettings from "../components/PasswordSettings.jsx";
import PinSettings from "../components/PinSettings.jsx";
import AppVersion from "../components/AppVersion.jsx";
import InstallPrompt from "../components/InstallPrompt.jsx";

// Who is signed in, the way out, and the PIN. The sidebar carries the first two on
// a laptop, but on a phone it is a bar of icons with no room for them.
export default function AdminAccount() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();

  function handleSignOut() {
    signOut();
    navigate("/login");
  }

  return (
    <AdminPage title="My Account">
      <section className="section">
        <div className="panel account-panel">
          <div className="account-identity">
            <div className="account-name">{user?.name}</div>
            <div className="account-email">{user?.email}</div>
          </div>
          <button className="btn btn-secondary btn-inline" onClick={handleSignOut}>
            Sign out
          </button>
        </div>

        <PasswordSettings />

        <PinSettings />

        {/* Renders nothing once the app is installed, or where it cannot be —
            so this is only here for whoever said "maybe later". */}
        <InstallPrompt />
      </section>

      <section className="section">
        <div className="section-head">
          <h2 className="section-title">Version</h2>
        </div>
        <AppVersion />
      </section>
    </AdminPage>
  );
}
