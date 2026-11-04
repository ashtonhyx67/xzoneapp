import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext.jsx";
import { PERMISSIONS } from "../lib/permissions.js";
import AppShell from "../components/AppShell.jsx";
import AdminTile from "../components/AdminTile.jsx";

// Everything in the app, one tap away. Each account only sees what it can open, so
// a section with nothing in it is left out altogether.
export default function Admin() {
  const { can, setViewAsMember } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState("");

  async function viewAsMember() {
    setError("");
    try {
      await setViewAsMember(true);
      navigate("/dashboard");
    } catch (err) {
      setError(err.message);
    }
  }

  const canRun = can(PERMISSIONS.RUN_NARNIA);

  const sections = [
    {
      title: "Narnia BM",
      tiles: [
        { to: "/narnia", icon: "narnia", label: "Narnia BM" },
        canRun && { to: "/admin/narnia", icon: "qr", label: "Run a BM" },
        canRun && { to: "/admin/narnia/rooms", icon: "rooms", label: "Rooms & Tasks" },
        canRun && { to: "/admin/narnia/history", icon: "history", label: "History" },
      ],
    },
    {
      title: "People",
      tiles: [
        can(PERMISSIONS.VIEW_DIRECTORY) && { to: "/members", icon: "members", label: "Members" },
        can(PERMISSIONS.EDIT_DATABASE) && { to: "/database", icon: "database", label: "Database" },
        can(PERMISSIONS.MANAGE_ACCOUNTS) && {
          to: "/admin/accounts",
          icon: "accounts",
          label: "Accounts",
        },
      ],
    },
    {
      title: "Every Week",
      tiles: [
        { to: "/dashboard", icon: "home", label: "Dashboard" },
        can(PERMISSIONS.VIEW_DIRECTORY) && {
          to: "/attendance",
          icon: "attendance",
          label: "Attendance",
        },
        can(PERMISSIONS.VIEW_SEATING) && { to: "/seating", icon: "seating", label: "Seating" },
        { to: "/outings", icon: "outings", label: "Outings" },
      ],
    },
    {
      title: "Me",
      tiles: [
        { to: "/admin/account", icon: "me", label: "My Account" },
        {
          to: "/personality",
          state: { from: "/admin" },
          icon: "personality",
          label: "My Animal",
        },
        canRun && { onClick: viewAsMember, icon: "eye", label: "Member View" },
      ],
    },
  ];

  return (
    <AppShell>
      <header className="page-head">
        <h1 className="page-title admin-title">All</h1>
      </header>

      {error && <div className="error-banner">{error}</div>}

      <div className="admin-sections">
        {sections.map((section) => {
          const tiles = section.tiles.filter(Boolean);
          if (tiles.length === 0) return null;
          return (
            <section className="admin-card" key={section.title}>
              <h2 className="admin-card-title">{section.title}</h2>
              <div className="admin-grid">
                {tiles.map((tile) => (
                  <AdminTile key={tile.label} tile={tile} />
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </AppShell>
  );
}
