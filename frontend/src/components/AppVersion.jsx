import React, { useState } from "react";
import { isStandalone, reloadApp, updateAvailable } from "../lib/updates.js";

// A permanent way to update, for anyone who dismissed the prompt or simply
// wants to be sure they are on the current version. On the home screen there is
// no address bar to reload from, which is the whole reason this exists.
export default function AppVersion() {
  const [state, setState] = useState("idle"); // idle | checking | current | ready
  const [error, setError] = useState("");

  async function check() {
    setState("checking");
    setError("");
    try {
      setState((await updateAvailable()) ? "ready" : "current");
    } catch (err) {
      setState("idle");
      setError(err.message);
    }
  }

  return (
    <div className="panel account-panel">
      <div className="account-identity">
        <div className="account-name">This app</div>
        <div className="account-email">
          {state === "ready"
            ? "A new version is ready to install."
            : state === "current"
              ? "You are on the latest version."
              : isStandalone()
                ? "Added to your home screen."
                : "Running in the browser."}
        </div>
        {error && <div className="account-email">{error}</div>}
      </div>

      {state === "ready" ? (
        <button className="btn btn-primary btn-inline" onClick={reloadApp}>
          Update
        </button>
      ) : (
        <button
          className="btn btn-secondary btn-inline"
          onClick={check}
          disabled={state === "checking"}
        >
          {state === "checking" ? "Checking…" : "Check for updates"}
        </button>
      )}
    </div>
  );
}
