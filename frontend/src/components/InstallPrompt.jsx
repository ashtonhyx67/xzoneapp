import React, { useEffect, useState } from "react";
import {
  canInstall,
  canPromptToInstall,
  isInstalled,
  isIos,
  onInstallChange,
  promptToInstall,
} from "../lib/install.js";

// Offered once the PIN is set, because that is the moment the app becomes worth
// keeping: there is a quick way back in, and on the home screen there is no
// address bar to type. On Chrome this is the real install dialog; on iOS,
// where no such dialog exists, it is the two taps that do the same thing.
export default function InstallPrompt({ onDone }) {
  const [, refresh] = useState(0);
  const [showSteps, setShowSteps] = useState(false);
  const [busy, setBusy] = useState(false);

  // beforeinstallprompt can arrive after this has mounted.
  useEffect(() => onInstallChange(() => refresh((n) => n + 1)), []);

  if (isInstalled() || !canInstall()) return null;

  async function install() {
    setBusy(true);
    const accepted = await promptToInstall();
    setBusy(false);
    if (accepted) onDone?.();
  }

  return (
    <div className="install-card">
      <div className="install-icon" aria-hidden="true">
        📲
      </div>

      <div className="install-body">
        <div className="install-title">Add to your home screen</div>
        <p className="install-text">
          Opens like an app, and keeps you signed in.
        </p>

        {/* Chrome and Edge can do it in one tap. */}
        {canPromptToInstall() && (
          <button className="btn btn-primary install-btn" onClick={install} disabled={busy}>
            {busy ? "Waiting…" : "Add to Home Screen"}
          </button>
        )}

        {/* iOS has no install dialog at all — the Share menu is the only way,
            so the useful thing to offer is which taps. */}
        {!canPromptToInstall() && !isIos() && (
          <>
            <button
              className="btn btn-primary install-btn"
              onClick={() => setShowSteps((open) => !open)}
            >
              {showSteps ? "Hide steps" : "Show me how"}
            </button>

            {showSteps && (
              <ol className="install-steps">
                <li>
                  Open your browser's menu
                  <span className="install-glyph" aria-hidden="true">
                    {" "}
                    ⋮
                  </span>
                </li>
                <li>
                  Tap <strong>Add to Home screen</strong> or <strong>Install app</strong>
                </li>
                <li>
                  Confirm with <strong>Install</strong>
                </li>
              </ol>
            )}
          </>
        )}

        {!canPromptToInstall() && isIos() && (
          <>
            <button
              className="btn btn-primary install-btn"
              onClick={() => setShowSteps((open) => !open)}
            >
              {showSteps ? "Hide steps" : "Show me how"}
            </button>

            {showSteps && (
              <ol className="install-steps">
                <li>
                  Tap <strong>Share</strong> at the bottom of Safari
                  <span className="install-glyph" aria-hidden="true">
                    {" "}
                    ⬆︎
                  </span>
                </li>
                <li>
                  Scroll down and tap <strong>Add to Home Screen</strong>
                </li>
                <li>
                  Tap <strong>Add</strong>
                </li>
              </ol>
            )}
          </>
        )}
      </div>
    </div>
  );
}
