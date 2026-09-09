import React, { useCallback, useEffect, useState } from "react";
import { reloadApp, updateAvailable } from "../lib/updates.js";

// How often to ask, while the app is on screen. Long enough that it is never
// chatty, short enough that someone who leaves the app open all evening still
// gets told.
const EVERY = 15 * 60 * 1000;

// Tells you a new version has been deployed, and reloads into it. A home-screen
// app has no reload button of its own, so without this it keeps running the
// build it was opened with.
export default function UpdatePrompt() {
  const [ready, setReady] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [reloading, setReloading] = useState(false);

  const check = useCallback(async (signal) => {
    try {
      if (await updateAvailable(signal)) setReady(true);
    } catch {
      // Offline, or the check itself failed. Silence is right here: there is
      // nothing the reader could do about it, and it will be asked again.
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();

    check(controller.signal);
    const timer = setInterval(() => check(controller.signal), EVERY);

    // Coming back to the app is the moment a new deploy is most likely to have
    // happened since it was last looked at.
    const onFocus = () => {
      if (document.visibilityState === "visible") check(controller.signal);
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);

    return () => {
      controller.abort();
      clearInterval(timer);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [check]);

  if (!ready || dismissed) return null;

  return (
    <div className="update-prompt" role="status">
      <span className="update-prompt-text">A new version is ready.</span>

      <button
        className="btn btn-primary btn-inline"
        onClick={() => {
          setReloading(true);
          reloadApp();
        }}
        disabled={reloading}
      >
        {reloading ? "Updating…" : "Update"}
      </button>

      {/* Dismissing is for this session only — closing the app and coming back
          asks again. It does not nag in between: someone in the middle of
          marking a register should not be interrupted twice, and Admin carries
          a permanent Update button for whenever they are ready. */}
      <button
        className="update-prompt-later"
        onClick={() => setDismissed(true)}
        aria-label="Not now"
      >
        ×
      </button>
    </div>
  );
}
