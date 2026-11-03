import React from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext.jsx";
import { PERMISSIONS } from "../lib/permissions.js";
import AdminPage from "../components/AdminPage.jsx";
import AccountsPanel from "../components/AccountsPanel.jsx";

export default function AdminAccounts() {
  const { can } = useAuth();
  if (!can(PERMISSIONS.MANAGE_ACCOUNTS)) return <Navigate to="/admin" replace />;

  return (
    <AdminPage title="Accounts">
      <AccountsPanel />
    </AdminPage>
  );
}
