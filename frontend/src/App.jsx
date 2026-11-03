import React, { lazy, Suspense, useEffect } from "react";
import { Routes, Route, Navigate, useLocation } from "react-router-dom";
import { useAuth } from "./context/AuthContext.jsx";
import { getDeviceAccount } from "./lib/device.js";
import SignUp from "./pages/SignUp.jsx";
import Login from "./pages/Login.jsx";
import Unlock from "./pages/Unlock.jsx";
import SetPin from "./pages/SetPin.jsx";
import Dashboard from "./pages/Dashboard.jsx";
import { ShellLayout } from "./components/AppShell.jsx";

// Everything past the dashboard is fetched when it is first opened rather than
// on the way in. The dashboard is what loads on launch, so it stays in the main
// bundle; the rest are a page each, and most sessions never touch all of them.
const pages = {
  Members: () => import("./pages/Members.jsx"),
  Database: () => import("./pages/Database.jsx"),
  Attendance: () => import("./pages/Attendance.jsx"),
  Seating: () => import("./pages/Seating.jsx"),
  Admin: () => import("./pages/Admin.jsx"),
  Narnia: () => import("./pages/Narnia.jsx"),
  NarniaRun: () => import("./pages/NarniaRun.jsx"),
  NarniaRooms: () => import("./pages/NarniaRooms.jsx"),
  NarniaHistory: () => import("./pages/NarniaHistory.jsx"),
  AdminAccount: () => import("./pages/AdminAccount.jsx"),
  AdminAccounts: () => import("./pages/AdminAccounts.jsx"),
};

const Members = lazy(pages.Members);
const Database = lazy(pages.Database);
const Attendance = lazy(pages.Attendance);
const Seating = lazy(pages.Seating);
const Admin = lazy(pages.Admin);
const Narnia = lazy(pages.Narnia);
const NarniaRun = lazy(pages.NarniaRun);
const NarniaRooms = lazy(pages.NarniaRooms);
const NarniaHistory = lazy(pages.NarniaHistory);
const AdminAccount = lazy(pages.AdminAccount);
const AdminAccounts = lazy(pages.AdminAccounts);
const NarniaCheckIn = lazy(() => import("./pages/NarniaCheckIn.jsx"));
const Personality = lazy(() => import("./pages/Personality.jsx"));

// Once someone is signed in and the dashboard has drawn, the other pages are
// fetched quietly in the background. A tap on the bar then opens a page that is
// already here, instead of waiting on the network with the old page frozen.
function usePrefetchPages(enabled) {
  useEffect(() => {
    if (!enabled) return undefined;
    const run = () => Object.values(pages).forEach((load) => load().catch(() => {}));
    if ("requestIdleCallback" in window) {
      const id = window.requestIdleCallback(run, { timeout: 4000 });
      return () => window.cancelIdleCallback(id);
    }
    const id = setTimeout(run, 1500);
    return () => clearTimeout(id);
  }, [enabled]);
}

// A signed-out visitor whose device already knows them goes to the PIN screen,
// not to the sign-up card.
function signedOutHome() {
  const account = getDeviceAccount();
  return account?.hasPin ? "/unlock" : "/login";
}

function ProtectedRoute({ children }) {
  const { token, loading, pinSet, personalityDue } = useAuth();
  const location = useLocation();

  if (loading) return <div className="boot-screen" aria-hidden="true" />;
  if (!token) return <Navigate to={signedOutHome()} replace />;

  // Every account does the quiz before anything else. Like the PIN it can be put
  // off, but only until the next launch, and until then it is not lost: the
  // answers so far are kept on the device.
  if (personalityDue && !sessionStorage.getItem("personalityPromptSkipped")) {
    if (location.pathname !== "/personality") {
      return <Navigate to="/personality" replace />;
    }
    return children;
  }

  // Everyone gets asked to choose a PIN once. "Skip for now" leaves the flag
  // set for this session only, so the prompt returns on the next launch.
  // The quiz is let through so someone without a PIN can still open it.
  if (!pinSet && !sessionStorage.getItem("pinPromptSkipped")) {
    if (location.pathname !== "/set-pin" && location.pathname !== "/personality") {
      return <Navigate to="/set-pin" replace />;
    }
  }

  return children;
}

export default function App() {
  const { token } = useAuth();
  usePrefetchPages(Boolean(token));

  return (
    <Suspense fallback={<div className="boot-screen" aria-hidden="true" />}>
      <Routes>
        <Route path="/signup" element={<SignUp />} />
        <Route path="/login" element={<Login />} />
        <Route path="/unlock" element={<Unlock />} />
        {/* Where a QR code lands. Outside the sign-in guard on purpose: someone
            with a broom in hand is not asked to set a PIN or take a quiz first. */}
        <Route path="/narnia/in/:code" element={<NarniaCheckIn />} />
        <Route
          path="/set-pin"
          element={
            <ProtectedRoute>
              <SetPin />
            </ProtectedRoute>
          }
        />
        <Route
          path="/personality"
          element={
            <ProtectedRoute>
              <Personality />
            </ProtectedRoute>
          }
        />

        {/* Every signed-in page shares one frame. It stays mounted while the
            page inside it changes, so the bar does not flicker on each tap and
            a page that is still loading waits inside the frame rather than
            blanking the whole screen. */}
        <Route
          element={
            <ProtectedRoute>
              <ShellLayout />
            </ProtectedRoute>
          }
        >
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/members" element={<Members />} />
          <Route path="/attendance" element={<Attendance />} />
          <Route path="/seating" element={<Seating />} />
          <Route path="/narnia" element={<Narnia />} />
          <Route path="/database" element={<Database />} />
          <Route path="/admin" element={<Admin />} />
          <Route path="/admin/account" element={<AdminAccount />} />
          <Route path="/admin/accounts" element={<AdminAccounts />} />
          <Route path="/admin/narnia" element={<NarniaRun />} />
          <Route path="/admin/narnia/rooms" element={<NarniaRooms />} />
          <Route path="/admin/narnia/history" element={<NarniaHistory />} />
        </Route>

        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </Suspense>
  );
}
