import React, { useEffect, useState } from "react";
import { useAuth } from "../context/AuthContext.jsx";
import { getDeviceAccount } from "../lib/device.js";
import { deviceHasBiometrics, enrollFaceId, faceIdErrorMessage } from "../lib/faceId.js";

const DISMISSED = "faceIdOfferDismissed";

function wasDismissed() {
  try {
    return localStorage.getItem(DISMISSED) === "1";
  } catch {
    return false;
  }
}

// Offered once, on a device that could open the app with Face ID but has not
// been set up to. Turning it on is one tap here instead of a trip to Admin; "Not
// now" is remembered on this device, and Admin still has the switch.
export default function FaceIdOffer() {
  const { token, setFaceIdEnabled } = useAuth();
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  useEffect(() => {
    let active = true;
    if (wasDismissed() || getDeviceAccount()?.hasFaceId) return undefined;
    deviceHasBiometrics().then((ok) => active && setShow(ok));
    return () => {
      active = false;
    };
  }, []);

  function dismiss() {
    try {
      localStorage.setItem(DISMISSED, "1");
    } catch {
      /* it will simply be offered again */
    }
    setShow(false);
  }

  async function turnOn() {
    setBusy(true);
    setError("");
    try {
      await enrollFaceId(token);
      setFaceIdEnabled(true);
      setDone(true);
      setTimeout(() => setShow(false), 2200);
    } catch (err) {
      setError(faceIdErrorMessage(err, "Couldn't turn on Face ID here."));
    } finally {
      setBusy(false);
    }
  }

  if (!show) return null;

  return (
    <div className="panel faceid-offer" role="region" aria-label="Face ID">
      <div className="faceid-offer-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="26" height="26">
          <g fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
            <path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2" />
            <path d="M9 9.5v1M15 9.5v1M12 9.5v3.5h-1" />
            <path d="M9 16c1.6 1.2 4.4 1.2 6 0" />
          </g>
        </svg>
      </div>
      <div className="faceid-offer-body">
        {done ? (
          <div className="faceid-offer-title">Done — the app will open with Face ID.</div>
        ) : (
          <>
            <div className="faceid-offer-title">Open the app with Face ID</div>
            <p className="faceid-offer-text">
              Skip the PIN: next time, just look at your phone. If it asks where to save
              the passkey, choose iCloud Keychain or this device.
            </p>
            {error && <div className="error-banner panel-notice">{error}</div>}
            <div className="faceid-offer-actions">
              <button className="btn btn-primary btn-inline" onClick={turnOn} disabled={busy}>
                {busy ? <span className="spinner" /> : "Turn on Face ID"}
              </button>
              <button className="btn btn-secondary btn-inline" onClick={dismiss} disabled={busy}>
                Not now
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
