import React, { useEffect, useState } from "react";
import { api } from "../api.js";
import { useAuth } from "../context/AuthContext.jsx";
import AppShell from "../components/AppShell.jsx";
import PeopleSheet from "../components/PeopleSheet.jsx";
import ImportPeople from "../components/ImportPeople.jsx";

// The whole people table as an editable grid — the spreadsheet the data used to
// live in, except it is the database, so an edit here is the real record.
export default function Database() {
  const { token, isAdmin } = useAuth();
  const [people, setPeople] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!token || !isAdmin) {
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
  }, [token, isAdmin, reloadKey]);

  if (!isAdmin) {
    return (
      <AppShell>
        <h1 className="page-title">Database</h1>
        <div className="panel">
          <div className="panel-title">You do not have access to this.</div>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <h1 className="page-title">Database</h1>

      {error && <div className="error-banner">{error}</div>}

      {loading ? (
        <div className="panel">
          <div className="panel-title">Loading…</div>
        </div>
      ) : (
        // Remounting after an import throws away the grid's drafts along with
        // the stale rows they were based on.
        <PeopleSheet
          key={reloadKey}
          token={token}
          people={people}
          onSaved={(saved) => setPeople(saved)}
        />
      )}

      <ImportPeople token={token} onImported={() => setReloadKey((n) => n + 1)} />
    </AppShell>
  );
}
