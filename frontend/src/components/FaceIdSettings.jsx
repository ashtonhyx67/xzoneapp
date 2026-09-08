import React, { useMemo, useState } from "react";
import { startRegistration, browserSupportsWebAuthn } from "@simplewebauthn/browser";
import { api } from "../api.js";
import { useAuth } from "../context/AuthContext.jsx";

// Enrolling this device's biometrics. Signing in with it is not offered on the
// sign-in screen yet — the PIN is the way back in — so this is here for when
// that is turned back on.
export default function FaceIdSettings() {
  const { token, faceIdEnabled, setFaceIdEnabled } = useAuth();
  const supported = useMemo(() => browserSupportsWebAuthn(), []);

  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);

  if (!supported) return null;

  async function enable() {
    setNotice(null);
    setBusy(true);
    try {
      const options = await api.webauthnRegisterOptions(token);
      const response = await startRegistration({ optionsJSON: options });
      await api.webauthnRegisterVerify(token, response);
      setFaceIdEnabled(true);
      setNotice({ type: "success", text: "Face ID is enabled on this device." });
    } catch (err) {
      setNotice({ type: "error", text: err.message || "Couldn't enable Face ID here." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel">
      <div className="panel-row">
        <div className="panel-title">Face ID</div>
        <div className="panel-row-actions">
          {faceIdEnabled ? (
            <span className="badge badge-on">Enrolled</span>
          ) : (
            <button className="btn btn-secondary btn-inline" onClick={enable} disabled={busy}>
              {busy ? "Waiting for device" : "Enable Face ID"}
            </button>
          )}
        </div>
      </div>

      {notice && (
        <div
          className={`panel-notice ${
            notice.type === "success" ? "success-banner" : "error-banner"
          }`}
        >
          {notice.text}
        </div>
      )}
    </div>
  );
}
