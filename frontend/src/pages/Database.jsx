import React, { useEffect, useState } from "react";
import { api } from "../api.js";
import { useAuth } from "../context/AuthContext.jsx";
import { PERMISSIONS } from "../lib/permissions.js";
import AppShell from "../components/AppShell.jsx";
import PeopleSheet from "../components/PeopleSheet.jsx";

// The whole people table as an editable grid — the spreadsheet the data used to
// live in, except it is the database, so an edit here is the real record.
export default function Database() {
  const { token, can } = useAuth();
  const canEdit = can(PERMISSIONS.EDIT_DATABASE);
  const [people, setPeople] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!token || !canEdit) {
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    let active = true;

    setLoading(true);
    api
      .getPeople(token, controller.signal)
      .then((data) => {
        if (active) setPeople(data.people);
      })
      .catch((err) => {
        if (active && err.name !== "AbortError") setError(err.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [token, canEdit]);

  if (!canEdit) {
    return (
      <AppShell>
        <header className="page-head">
          <h1 className="page-title">Database</h1>
        </header>
        <div className="panel">
          <div className="panel-title">You do not have access to this.</div>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <header className="page-head">
        <h1 className="page-title">Database</h1>
        <span className="page-count">{people.length}</span>
      </header>

      {error && <div className="error-banner">{error}</div>}

      {loading ? (
        <div className="panel">
          <div className="panel-title">Loading…</div>
        </div>
      ) : (
        <PeopleSheet token={token} people={people} onSaved={(saved) => setPeople(saved)} />
      )}
    </AppShell>
  );
}
