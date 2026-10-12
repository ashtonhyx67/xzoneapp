import React, { useEffect, useState } from "react";
import { api } from "../api.js";
import { useAuth } from "../context/AuthContext.jsx";
import { getDeviceAccount } from "../lib/device.js";
import { deviceHasBiometrics, enrollFaceId, faceIdErrorMessage } from "../lib/faceId.js";

// Face ID (or Touch ID, or a fingerprint) for this device. Once it is on, the
// PIN screen offers it first, and a successful scan also clears any wrong-PIN
// strikes on the account.
export default function FaceIdSettings() {
  const { token, faceIdEnabled, setFaceIdEnabled } = useAuth();

  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);
  // null while unknown, then whether this device has a face or fingerprint
  // unlock set up at all.
  const [builtIn, setBuiltIn] = useState(null);
  // On for *this* device. The account can have Face ID on another phone.
  const [onDevice, setOnDevice] = useState(
    () => Boolean(faceIdEnabled && getDeviceAccount()?.hasFaceId)
  );

  useEffect(() => {
    let active = true;
    deviceHasBiometrics().then((available) => active && setBuiltIn(available));
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!faceIdEnabled) setOnDevice(false);
  }, [faceIdEnabled]);

  async function enable() {
    setNotice(null);
    setBusy(true);
    try {
      await enrollFaceId(token);
      setFaceIdEnabled(true);
      setOnDevice(true);
      setNotice({ type: "success", text: "Face ID is on. The app will open with it from now on." });
    } catch (err) {
      setNotice({ type: "error", text: faceIdErrorMessage(err, "Couldn't turn on Face ID here.") });
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setNotice(null);
    setBusy(true);
    try {
      await api.removeFaceId(token);
      setFaceIdEnabled(false);
      setOnDevice(false);
      setNotice({
        type: "success",
        text: "Face ID is off for your account. You can also delete the saved passkey from your phone's password settings.",
      });
    } catch (err) {
      setNotice({ type: "error", text: err.message });
    } finally {
      setBusy(false);
    }
  }

  if (builtIn === false && !faceIdEnabled) {
    return (
      <div className="panel">
        <div className="panel-row">
          <div className="panel-title">Face ID</div>
          <span className="badge badge-off">Not available here</span>
        </div>
        <p className="panel-note">
          This device has no face or fingerprint unlock set up, so there is nothing to use.
          Turn one on in the device's settings and come back.
        </p>
      </div>
    );
  }

  return (
    <div className="panel">
      <div className="panel-row">
        <div className="panel-title">Face ID</div>
        <div className="panel-row-actions">
          {onDevice && <span className="badge badge-on">On</span>}
          {!onDevice && builtIn !== false && (
            <button
              className="btn btn-secondary btn-inline"
              onClick={enable}
              disabled={busy || builtIn === null}
            >
              {busy ? <span className="spinner spinner-dark" /> : "Turn on"}
            </button>
          )}
          {faceIdEnabled && (
            <button className="btn btn-secondary btn-inline" onClick={remove} disabled={busy}>
              Remove
            </button>
          )}
        </div>
      </div>

      {!onDevice && (
        <p className="panel-note">
          {faceIdEnabled
            ? "Face ID is set up on another device. Turn it on here too to use it on this one."
            : "Unlock with your face or fingerprint instead of typing your PIN."}{" "}
          When your phone asks where to save the passkey, pick <strong>iCloud Keychain</strong>{" "}
          (iPhone/iPad) or <strong>this device</strong> — not Microsoft Authenticator or another
          password app, or it will ask for that app instead of your face.
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
