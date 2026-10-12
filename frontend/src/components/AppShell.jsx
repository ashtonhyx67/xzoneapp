import React, { createContext, Suspense, useContext, useLayoutEffect } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext.jsx";
import { initials } from "../lib/photo.js";
import { PERMISSIONS } from "../lib/permissions.js";
import UpdatePrompt from "./UpdatePrompt.jsx";
import BrandMark from "./BrandMark.jsx";

// Set while a page is being drawn inside the shared frame, so a page that still
// wraps itself in <AppShell> does not draw a second frame inside the first.
const InFrame = createContext(false);

// Line icons, drawn in the text colour so they follow the bar's states. Shapes
// read faster than words on a bar this size, and unlike emoji they look the same
// on every phone.
const ICONS = {
  home: (
    <>
      <path d="M3.5 10.5 12 3.5l8.5 7" />
      <path d="M5.5 9v11h13V9" />
      <path d="M10 20v-5.5h4V20" />
    </>
  ),
  members: (
    <>
      <circle cx="9" cy="8" r="3.4" />
      <path d="M2.8 20a6.2 6.2 0 0 1 12.4 0" />
      <path d="M15.5 4.8a3.4 3.4 0 0 1 0 6.4" />
      <path d="M18 14.3a6.2 6.2 0 0 1 3.2 5.7" />
    </>
  ),
  attendance: (
    <>
      <rect x="4.5" y="4" width="15" height="17" rx="2.5" />
      <path d="M9 4V2.8h6V4" />
      <path d="m8.8 12.8 2.3 2.3 4.4-4.6" />
    </>
  ),
  seating: (
    <>
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.8" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1.8" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1.8" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="1.8" />
    </>
  ),
  split: (
    <>
      <path d="M4 7.5A2.5 2.5 0 0 1 6.5 5H18v3.5" />
      <path d="M4 7.5V18a2 2 0 0 0 2 2h14V9H6.5A2.5 2.5 0 0 1 4 7.5Z" />
      <circle cx="16" cy="14.5" r="1.3" />
    </>
  ),
  database: (
    <>
      <ellipse cx="12" cy="5.5" rx="7.5" ry="2.5" />
      <path d="M4.5 5.5v13c0 1.4 3.4 2.5 7.5 2.5s7.5-1.1 7.5-2.5v-13" />
      <path d="M4.5 12c0 1.4 3.4 2.5 7.5 2.5s7.5-1.1 7.5-2.5" />
    </>
  ),
  admin: (
    <>
      <path d="M4 6.5h9M17 6.5h3M4 12h3M11 12h9M4 17.5h11M19 17.5h1" />
      <circle cx="15" cy="6.5" r="2" />
      <circle cx="9" cy="12" r="2" />
      <circle cx="17" cy="17.5" r="2" />
    </>
  ),
};

function NavIcon({ name }) {
  return (
    <svg
      className="nav-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {ICONS[name]}
    </svg>
  );
}

function Frame({ children }) {
  const { user, can, group, isOwner, signOut } = useAuth();
  const navigate = useNavigate();

  function handleSignOut() {
    signOut();
    navigate("/login");
  }

  const navClass = ({ isActive }) => `nav-item${isActive ? " active" : ""}`;

  // Tapping the page you are already on takes you back to its top — the
  // behaviour every phone app has taught people to expect from a tab bar.
  function toTop(event, to) {
    if (window.location.pathname === to) {
      event.preventDefault();
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }

  const link = (to, icon, label, extra = "") => (
    <NavLink
      to={to}
      className={({ isActive }) => `${navClass({ isActive })}${extra}`}
      onClick={(event) => toTop(event, to)}
    >
      <NavIcon name={icon} />
      <span className="nav-label">{label}</span>
    </NavLink>
  );

  return (
    <div className="dashboard-shell">
      <aside className="sidebar">
        <div className="sidebar-wordmark">
          <BrandMark />
          <span className="wordmark-full">X Zone</span>
        </div>

        <nav className="sidebar-nav" aria-label="Main">
          {/* Home is its own thing — the page you come back to — so on a phone
              it sits apart from the working pages rather than in the row with
              them. */}
          {link("/dashboard", "home", "Dashboard", " nav-home")}
          {can(PERMISSIONS.VIEW_DIRECTORY) && link("/members", "members", "Members")}
          {can(PERMISSIONS.VIEW_DIRECTORY) && link("/attendance", "attendance", "Attendance")}
          {can(PERMISSIONS.VIEW_SEATING) && link("/seating", "seating", "Seating")}
          {can(PERMISSIONS.USE_EXPENSES) && link("/split", "split", "Split")}
          {can(PERMISSIONS.EDIT_DATABASE) && link("/database", "database", "Database")}
          {/* Everyone needs somewhere to set a PIN and sign out, so Admin is
              always reachable; what it contains is gated inside it. */}
          {link("/admin", "admin", "Admin")}
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

// While a page's code is still arriving: the shape of a page rather than a
// word, so the moment it lands nothing jumps.
function PageSkeleton() {
  return (
    <div className="page-skeleton" aria-busy="true" aria-label="Loading">
      <div className="skeleton skeleton-title" />
      <div className="skeleton skeleton-block" />
      <div className="skeleton skeleton-block skeleton-short" />
    </div>
  );
}

// The frame every signed-in route renders into (see App.jsx).
export function ShellLayout() {
  const { pathname } = useLocation();

  // A new page starts at its top, not wherever the last one was scrolled to.
  useLayoutEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);

  return (
    <Frame>
      <InFrame.Provider value>
        <Suspense fallback={<PageSkeleton />}>
          {/* Keyed on the address, so each page plays its entrance once. */}
          <div className="page" key={pathname}>
            <Outlet />
          </div>
        </Suspense>
      </InFrame.Provider>
    </Frame>
  );
}

// Pages still wrap themselves in this. Inside the shared frame it adds nothing;
// rendered on its own (outside the router layout) it draws the frame itself.
export default function AppShell({ children }) {
  const inFrame = useContext(InFrame);
  if (inFrame) return <>{children}</>;
  return <Frame>{children}</Frame>;
}
