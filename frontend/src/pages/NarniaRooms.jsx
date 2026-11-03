import React, { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { api } from "../api.js";
import { useAuth } from "../context/AuthContext.jsx";
import { PERMISSIONS } from "../lib/permissions.js";
import AdminPage from "../components/AdminPage.jsx";
import NarniaStandard from "../components/NarniaStandard.jsx";
import { SkeletonRows } from "../components/Skeleton.jsx";

// Where the rooms, their photos, their logistics and their tasks are edited.
export default function NarniaRooms() {
  const { token, can } = useAuth();
  const allowed = can(PERMISSIONS.RUN_NARNIA);
  const [rooms, setRooms] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!allowed) return undefined;
    const controller = new AbortController();
    api
      .narnia(token, controller.signal)
      .then((data) => setRooms(data.rooms))
      .catch((err) => {
        if (err.name !== "AbortError") setError(err.message);
      });
    return () => controller.abort();
  }, [allowed, token]);

  if (!allowed) return <Navigate to="/admin" replace />;

  return (
    <AdminPage title="Rooms & Tasks">
      {error && <div className="error-banner">{error}</div>}
      {rooms ? (
        <NarniaStandard rooms={rooms} onRooms={setRooms} />
      ) : (
        !error && <SkeletonRows count={5} label="Loading the rooms" />
      )}
    </AdminPage>
  );
}
