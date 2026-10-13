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
  Split: () => import("./pages/Split.jsx"),
  SplitGroup: () => import("./pages/SplitGroup.jsx"),
};

const Members = lazy(pages.Members);
const Database = lazy(pages.Database);
const Attendance = lazy(pages.Attendance);
const Seating = lazy(pages.Seating);
const Admin = lazy(pages.Admin);
const Split = lazy(pages.Split);
const SplitGroup = lazy(pages.SplitGroup);

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
  const { token, loading, pinSet } = useAuth();
  const location = useLocation();

  if (loading) return <div className="boot-screen" aria-hidden="true" />;
  if (!token) return <Navigate to={signedOutHome()} replace />;

  // Everyone gets asked to choose a PIN once. "Skip for now" leaves the flag
  // set for this session only, so the prompt returns on the next launch.
  if (!pinSet && !sessionStorage.getItem("pinPromptSkipped")) {
    if (location.pathname !== "/set-pin") {
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
        <Route
          path="/set-pin"
          element={
            <ProtectedRoute>
              <SetPin />
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
          <Route path="/split" element={<Split />} />
          {/* A group is its own address, so a link to one can be shared and the
              back button steps out of it rather than out of the app. */}
          <Route path="/split/:groupId" element={<SplitGroup />} />
          <Route path="/database" element={<Database />} />
          <Route path="/admin" element={<Admin />} />
        </Route>

        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </Suspense>
  );
}
