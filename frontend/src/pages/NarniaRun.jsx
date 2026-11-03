import React from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext.jsx";
import { PERMISSIONS } from "../lib/permissions.js";
import AdminPage from "../components/AdminPage.jsx";
import NarniaBoard from "../components/NarniaBoard.jsx";

export default function NarniaRun() {
  const { can } = useAuth();
  if (!can(PERMISSIONS.RUN_NARNIA)) return <Navigate to="/admin" replace />;

  return (
    <AdminPage title="Run a BM">
      <NarniaBoard />
    </AdminPage>
  );
}
