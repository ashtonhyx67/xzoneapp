import React from "react";
import { Link } from "react-router-dom";
import AppShell from "./AppShell.jsx";

// A page opened from the Admin dashboard, with the way back to it.
export default function AdminPage({ title, children }) {
  return (
    <AppShell>
      <header className="page-head admin-page-head">
        <Link className="admin-back" to="/admin" aria-label="Back to Admin">
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M15 5l-7 7 7 7" />
          </svg>
        </Link>
        <h1 className="page-title">{title}</h1>
      </header>
      {children}
    </AppShell>
  );
}
