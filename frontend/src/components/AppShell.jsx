import React from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext.jsx";
import { initials } from "../lib/photo.js";
import { PERMISSIONS } from "../lib/permissions.js";

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
          <NavLink to="/dashboard" className={navClass}>
            Dashboard
          </NavLink>
          {can(PERMISSIONS.VIEW_DIRECTORY) && (
            <NavLink to="/members" className={navClass}>
              Members
            </NavLink>
          )}
          {can(PERMISSIONS.EDIT_DATABASE) && (
            <NavLink to="/database" className={navClass}>
              Database
            </NavLink>
          )}
          <NavLink to="/admin" className={navClass}>
            Admin
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
    </div>
  );
}
