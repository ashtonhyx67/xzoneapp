import React, { createContext, Suspense, useCallback, useContext, useEffect, useLayoutEffect, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext.jsx";
import { initials } from "../lib/photo.js";
import { PERMISSIONS } from "../lib/permissions.js";
import { usePoll } from "../lib/usePoll.js";
import { onNavStatusChanged } from "../lib/navStatus.js";
import { api } from "../api.js";
import UpdatePrompt from "./UpdatePrompt.jsx";
import BrandMark from "./BrandMark.jsx";

const NAV_POLL_MS = 30000;

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
  // A map pin.
  outings: (
    <>
      <path d="M12 21.5s7-6.4 7-12a7 7 0 1 0-14 0c0 5.6 7 12 7 12Z" />
      <circle cx="12" cy="9.5" r="2.5" />
    </>
  ),
  // The wardrobe.
  narnia: (
    <>
      <rect x="5" y="3" width="14" height="16.5" rx="1.8" />
      <path d="M12 3v16.5" />
      <path d="M9.8 10.5v2.5M14.2 10.5v2.5" />
      <path d="M7.8 19.5V21.5M16.2 19.5V21.5" />
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
  // The rest are only on the All page.
  qr: (
    <>
      <rect x="3.5" y="3.5" width="6.5" height="6.5" rx="1.2" />
      <rect x="14" y="3.5" width="6.5" height="6.5" rx="1.2" />
      <rect x="3.5" y="14" width="6.5" height="6.5" rx="1.2" />
      <path d="M14 14h2.5v2.5H14zM20.5 14v2.5M14 20.5h2.5M19 20.5h1.5V19" />
    </>
  ),
  rooms: (
    <>
      <path d="M6 21V4.5A1.5 1.5 0 0 1 7.5 3h9A1.5 1.5 0 0 1 18 4.5V21" />
      <path d="M3.5 21h17" />
      <circle cx="14.5" cy="12.5" r="0.9" />
    </>
  ),
  history: (
    <>
      <path d="M4 12a8 8 0 1 0 2.6-5.9" />
      <path d="M4 4.5v4h4" />
      <path d="M12 8v4.5l3 1.8" />
    </>
  ),
  accounts: (
    <>
      <circle cx="9" cy="8" r="3.4" />
      <path d="M2.8 20a6.2 6.2 0 0 1 12.4 0" />
      <path d="M18.5 7.5v6M15.5 10.5h6" />
    </>
  ),
  me: (
    <>
      <circle cx="12" cy="8" r="3.8" />
      <path d="M4.5 20.5a7.5 7.5 0 0 1 15 0" />
    </>
  ),
  personality: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M8.5 14a4 4 0 0 0 7 0" />
      <path d="M9 9.5v.5M15 9.5v.5" />
    </>
  ),
  eye: (
    <>
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
      <circle cx="12" cy="12" r="2.8" />
    </>
  ),
};

export function NavIcon({ name, className = "nav-icon" }) {
  return (
    <svg
      className={className}
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
  const { token, user, can, group, isOwner, signOut, viewingAsMember, setViewAsMember } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();

  // What the menu itself depends on. Kept fresh on a timer, and on moving to another
  // page, so finishing an evaluation takes its mark away straight away.
  const [navStatus, setNavStatus] = useState(null);
  const loadNav = useCallback(async () => {
    try {
      setNavStatus(await api.navStatus(token));
    } catch {
      /* the menu simply keeps what it last knew */
    }
  }, [token]);
  usePoll(loadNav, NAV_POLL_MS);
  useEffect(() => {
    loadNav();
  }, [loadNav, pathname, viewingAsMember]);
  useEffect(() => onNavStatusChanged(loadNav), [loadNav]);

  async function exitMemberView() {
    try {
      await setViewAsMember(false);
      navigate("/admin");
    } catch {
      /* still in the preview, and the bar is still there to try again */
    }
  }

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

  const link = (to, icon, label, { extra = "", alsoActiveOn = [], mark = false } = {}) => (
    <NavLink
      to={to}
      className={({ isActive }) =>
        `${navClass({ isActive: isActive || alsoActiveOn.includes(pathname) })}${extra}`
      }
      onClick={(event) => toTop(event, to)}
    >
      <NavIcon name={icon} />
      <span className="nav-label">{label}</span>
      {mark && <span className="nav-mark" aria-label="Needs attention" />}
    </NavLink>
  );

  return (
    <div className={`dashboard-shell${viewingAsMember ? " dashboard-shell-previewing" : ""}`}>
      <aside className="sidebar">
        <div className="sidebar-wordmark">
          <BrandMark />
          <span className="wordmark-full">X Zone</span>
        </div>

        <nav className="sidebar-nav" aria-label="Main">
          {/* Home is its own thing — the page you come back to — so on a phone
              it sits apart from the working pages rather than in the row with
              them. */}
          {link("/dashboard", "home", "Dashboard", { extra: " nav-home" })}
          {can(PERMISSIONS.VIEW_DIRECTORY) && link("/members", "members", "Members")}
          {/* Attendance and seating are one tab with a switch inside it. Someone who
              cannot read the registers just has the seating. */}
          {can(PERMISSIONS.VIEW_DIRECTORY)
            ? link("/attendance", "attendance", "Weekly", { alsoActiveOn: ["/seating"] })
            : can(PERMISSIONS.VIEW_SEATING) && link("/seating", "seating", "Seating")}
          {link("/outings", "outings", "Outings", {
            mark: (navStatus?.outingsToEvaluate.length ?? 0) > 0,
          })}
          {/* Only while one is running. The rest of the time it is under All. */}
          {navStatus?.narniaRunning && link("/narnia", "narnia", "Narnia BM")}
          {/* Everyone needs somewhere to set a PIN and sign out, so All is always
              reachable; each account sees only the tiles it can open. */}
          {link("/admin", "admin", "All")}
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

      {/* Always on screen during a preview, so nobody forgets they are in one. */}
      {viewingAsMember && (
        <div className="member-view-bar" role="status">
          <NavIcon name="eye" className="member-view-icon" />
          <span>Member view</span>
          <button type="button" onClick={exitMemberView}>
            Exit
          </button>
        </div>
      )}

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
