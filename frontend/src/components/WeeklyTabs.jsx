import React from "react";
import { NavLink } from "react-router-dom";
import { useAuth } from "../context/AuthContext.jsx";
import { PERMISSIONS } from "../lib/permissions.js";

// Attendance and seating are done together each week, so they are one tab with a
// switch at the top. Someone who can only see the seating gets its own title
// instead, since a switch with one side would be nothing to switch.
export default function WeeklyTabs() {
  const { can } = useAuth();

  if (!can(PERMISSIONS.VIEW_DIRECTORY)) {
    return (
      <header className="page-head">
        <h1 className="page-title">Seating</h1>
      </header>
    );
  }

  const tabClass = ({ isActive }) => `weekly-tab${isActive ? " weekly-tab-on" : ""}`;

  return (
    <header className="page-head weekly-head">
      <h1 className="page-title">Weekly</h1>
      {/* Replacing rather than adding to history, so Back leaves the tab instead of
          walking back through every switch. */}
      <nav className="weekly-tabs" aria-label="Weekly">
        <NavLink className={tabClass} to="/attendance" replace>
          Attendance
        </NavLink>
        <NavLink className={tabClass} to="/seating" replace>
          Seating
        </NavLink>
      </nav>
    </header>
  );
}
