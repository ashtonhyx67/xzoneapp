import React from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext.jsx";
import { initials } from "../lib/photo.js";
import { PERMISSIONS } from "../lib/permissions.js";
import UpdatePrompt from "./UpdatePrompt.jsx";

// The sidebar and page frame, shared by every signed-in page so the navigation
// lives in exactly one place. Which links appear is decided by permissions, not
// by group names, so adding a group never means editing this file.
export default function AppShell({ children }) {
  const { user, can, group, isOwner, signOut } = useAuth();
  const navigate = useNavigate();

  function handleSignOut() {
    signOut();
    navigate("/login");
  }

  const navClass = ({ isActive }) => `nav-item${isActive ? " active" : ""}`;

  return (
    <div className="dashboard-shell">
      <aside className="sidebar">
        <div className="sidebar-wordmark">X Zone</div>

        <nav className="sidebar-nav">
          {/* Home is its own thing — the page you come back to — so on a phone
              it sits apart from the working pages rather than in the row with
              them. Each link carries an emoji, drained of colour by CSS: the
              shapes are what makes a bottom bar readable at a glance, and a row
              of full-colour emoji would be louder than the page it sits under. */}
          <NavLink to="/dashboard" className={({ isActive }) => `${navClass({ isActive })} nav-home`}>
            <span className="nav-icon" aria-hidden="true">🏠</span>
            <span className="nav-label">Dashboard</span>
          </NavLink>

          {can(PERMISSIONS.VIEW_DIRECTORY) && (
            <NavLink to="/members" className={navClass}>
              <span className="nav-icon" aria-hidden="true">👤</span>
              <span className="nav-label">Members</span>
            </NavLink>
          )}
          {can(PERMISSIONS.VIEW_DIRECTORY) && (
            <NavLink to="/attendance" className={navClass}>
              <span className="nav-icon" aria-hidden="true">✅</span>
              <span className="nav-label">Attendance</span>
            </NavLink>
          )}
          {can(PERMISSIONS.VIEW_SEATING) && (
            <NavLink to="/seating" className={navClass}>
              <span className="nav-icon" aria-hidden="true">🪑</span>
              <span className="nav-label">Seating</span>
            </NavLink>
          )}
          {can(PERMISSIONS.EDIT_DATABASE) && (
            <NavLink to="/database" className={navClass}>
              <span className="nav-icon" aria-hidden="true">🗂️</span>
              <span className="nav-label">Database</span>
            </NavLink>
          )}
          {/* Everyone needs somewhere to set a PIN and sign out, so Admin is
              always reachable; what it contains is gated inside it. */}
          <NavLink to="/admin" className={navClass}>
            <span className="nav-icon" aria-hidden="true">⚙️</span>
            <span className="nav-label">Admin</span>
          </NavLink>
        </nav>

        <div className="sidebar-footer">
          <div className="user-chip">
            <div className="user-avatar">{initials(user?.name)}</div>
            <div className="user-identity">
              <div className="user-name">{user?.name}</div>
              <div className="user-email">{user?.email}</div>
            </div>
          </div>
          <div className="user-group">
            <span className={`group-pill${isOwner ? " group-pill-owner" : ""}`}>
              {isOwner ? "Owner" : group?.label || "No access"}
            </span>
          </div>
          <button className="signout-btn" onClick={handleSignOut}>
            Sign out
          </button>
        </div>
      </aside>

      <main className="main-content">{children}</main>

      {/* Sits above everything, on every signed-in page, because a stale app is
          stale wherever you happen to be standing in it. */}
      <UpdatePrompt />
    </div>
  );
}
