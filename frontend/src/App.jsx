import React from "react";
import { Routes, Route, Navigate, useLocation } from "react-router-dom";
import { useAuth } from "./context/AuthContext.jsx";
import { getDeviceAccount } from "./lib/device.js";
import SignUp from "./pages/SignUp.jsx";
import Login from "./pages/Login.jsx";
import Unlock from "./pages/Unlock.jsx";
import SetPin from "./pages/SetPin.jsx";
import Dashboard from "./pages/Dashboard.jsx";
import Members from "./pages/Members.jsx";
import Database from "./pages/Database.jsx";
import Admin from "./pages/Admin.jsx";

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
  );
}
