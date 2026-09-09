import React, { lazy, Suspense } from "react";
import { Routes, Route, Navigate, useLocation } from "react-router-dom";
import { useAuth } from "./context/AuthContext.jsx";
import { getDeviceAccount } from "./lib/device.js";
import SignUp from "./pages/SignUp.jsx";
import Login from "./pages/Login.jsx";
import Unlock from "./pages/Unlock.jsx";
import SetPin from "./pages/SetPin.jsx";
import Dashboard from "./pages/Dashboard.jsx";

// Everything past the dashboard is fetched when it is first opened rather than
// on the way in. The dashboard is what loads on launch, so it stays in the main
// bundle; the rest are a page each, and most sessions never touch all of them.
const Members = lazy(() => import("./pages/Members.jsx"));
const Database = lazy(() => import("./pages/Database.jsx"));
const Attendance = lazy(() => import("./pages/Attendance.jsx"));
const Seating = lazy(() => import("./pages/Seating.jsx"));
const Admin = lazy(() => import("./pages/Admin.jsx"));

// A signed-out visitor whose device already knows them goes to the PIN screen,
// not to the sign-up card.
function signedOutHome() {
  return getDeviceAccount()?.hasPin ? "/unlock" : "/login";
}

function ProtectedRoute({ children }) {
  const { token, loading, pinSet } = useAuth();
  const location = useLocation();

  if (loading) return null;
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
  return (
    <Suspense fallback={<div className="page-loading">Loading…</div>}>
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
      <Route
        path="/dashboard"
        element={
          <ProtectedRoute>
            <Dashboard />
          </ProtectedRoute>
        }
      />
      <Route
        path="/members"
        element={
          <ProtectedRoute>
            <Members />
          </ProtectedRoute>
        }
      />
      <Route
        path="/attendance"
        element={
          <ProtectedRoute>
            <Attendance />
          </ProtectedRoute>
        }
      />
      <Route
        path="/seating"
        element={
          <ProtectedRoute>
            <Seating />
          </ProtectedRoute>
        }
      />
      <Route
        path="/database"
        element={
          <ProtectedRoute>
            <Database />
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin"
        element={
          <ProtectedRoute>
            <Admin />
          </ProtectedRoute>
        }
      />
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </Suspense>
  );
}
