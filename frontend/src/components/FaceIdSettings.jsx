import React, { useEffect, useMemo, useState } from "react";
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
  // null while unknown, then whether this device has a fingerprint or face set
  // up at all.
  const [builtIn, setBuiltIn] = useState(null);

  // A browser can support WebAuthn without the device having any biometrics
  // enrolled. Asking anyway is what makes Chrome offer a QR code or a
  // third-party passkey app instead, which is not what this button says it
  // does — so find out first and say so plainly.
  useEffect(() => {
    let active = true;
    if (!supported || !window.PublicKeyCredential?.isUserVerifyingPlatformAuthenticatorAvailable) {
      setBuiltIn(false);
      return undefined;
    }

    window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()
      .then((available) => active && setBuiltIn(available))
      .catch(() => active && setBuiltIn(false));

    return () => {
      active = false;
    };
  }, [supported]);

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
      // The browser's own wording for a cancelled or refused prompt is not
      // something to show as-is.
      const text =
        err?.name === "NotAllowedError"
          ? "Cancelled, or this device refused. Try again and approve the prompt."
          : err?.message || "Couldn't enable Face ID here.";
      setNotice({ type: "error", text });
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
          ) : builtIn === false ? (
            <span className="badge badge-off">Not available here</span>
          ) : (
            <button
              className="btn btn-secondary btn-inline"
              onClick={enable}
              disabled={busy || builtIn === null}
            >
              {busy ? "Waiting for device" : "Enable Face ID"}
            </button>
          )}
        </div>
      </div>

      {builtIn === false && !faceIdEnabled && (
        <p className="panel-note">
          This device has no fingerprint or face unlock set up, so there is nothing to
          enrol. Set one up in the device's own settings and this will offer it.
        </p>
      )}

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
