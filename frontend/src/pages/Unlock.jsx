import React, { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api.js";
import { useAuth } from "../context/AuthContext.jsx";
import PinPad, { PIN_LENGTH } from "../components/PinPad.jsx";
import { getDeviceAccount, forgetDeviceAccount, setDeviceHasFaceId } from "../lib/device.js";
import { deviceHasBiometrics, signInWithFaceId, faceIdErrorMessage } from "../lib/faceId.js";
import { buzz } from "../lib/pin.js";

// The screen a returning user lands on. The session ended when they closed the
// app, but the device still knows who they are — so this replaces the sign-up
// card with four digits, or a glance at the camera.
export default function Unlock() {
  const navigate = useNavigate();
  const { signIn } = useAuth();
  const account = useRef(getDeviceAccount()).current;

  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [errorKey, setErrorKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const [lockedOut, setLockedOut] = useState(false);
  const [faceIdReady, setFaceIdReady] = useState(false);

  const firstName = account?.name ? account.name.split(" ")[0] : "";

  // Nothing remembered on this device means there is no PIN to ask for.
  useEffect(() => {
    if (!account?.hasPin && !account?.hasFaceId) navigate("/login", { replace: true });
  }, [account, navigate]);

  useEffect(() => {
    let active = true;
    if (account?.hasFaceId) {
      deviceHasBiometrics().then((ok) => active && setFaceIdReady(ok));
    }
    return () => {
      active = false;
    };
  }, [account]);

  const finish = useCallback(
    (data, usedFaceId = false) => {
      signIn(data.token, data.user, {
        faceIdEnabled: data.faceIdEnabled,
        usedFaceId,
        permissions: data.permissions,
        group: data.group,
        isOwner: data.isOwner,
        pinSet: data.pinSet,
      });
      navigate("/dashboard", { replace: true });
    },
    [navigate, signIn]
  );

  const fail = useCallback((message) => {
    setError(message);
    setErrorKey((k) => k + 1);
    buzz();
  }, []);

  const submit = useCallback(
    async (entered) => {
      setBusy(true);
      setError("");
      try {
        finish(await api.pinLogin(account.email, entered));
      } catch (err) {
        setPin("");
        fail(err.message);
        if (err.status === 429 || err.status === 423) setLockedOut(true);
      } finally {
        setBusy(false);
      }
    },
    [account, fail, finish]
  );

  async function useFaceId() {
    setBusy(true);
    setError("");
    try {
      finish(await signInWithFaceId(account.email), true);
    } catch (err) {
      // The account no longer has Face ID (removed on another device), so stop
      // offering a button that cannot work.
      if (err.status === 404) {
        setDeviceHasFaceId(false);
        setFaceIdReady(false);
      }
      fail(faceIdErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  // Four digits is the whole input, so there is nothing left to confirm.
  const handleChange = useCallback(
    (next) => {
      setPin(next);
      if (next.length === PIN_LENGTH && !busy) submit(next);
    },
    [busy, submit]
  );

  function useAnotherAccount() {
    forgetDeviceAccount();
    navigate("/login", { replace: true });
  }

  if (!account?.hasPin && !account?.hasFaceId) return null;

  return (
    <div className="auth-shell">
      <div className="auth-wordmark">X Zone App</div>
      <div className="auth-card auth-card-pin">
        <div className="auth-avatar" aria-hidden="true">
          {(firstName || account.email || "?").slice(0, 1).toUpperCase()}
        </div>
        <h1 className="auth-title">
          {firstName ? `Welcome back, ${firstName}` : "Welcome back"}
        </h1>
        <p className="auth-subtitle">
          {account.hasPin ? "Enter your 4-digit PIN to continue" : "Use Face ID to continue"}
        </p>

        {error && (
          <div className="error-banner" role="alert" key={errorKey}>
            {error}
          </div>
        )}

        {faceIdReady && (
          <button
            type="button"
            className="btn btn-primary faceid-btn"
            onClick={useFaceId}
            disabled={busy}
          >
            <FaceIdGlyph />
            Use Face ID
          </button>
        )}

        {account.hasPin && (
          <PinPad
            value={pin}
            onChange={handleChange}
            disabled={busy || lockedOut}
            errorKey={errorKey}
          />
        )}

        <div className="auth-switch">
          <button type="button" className="link-btn" onClick={() => navigate("/login")}>
            Use password instead
          </button>
        </div>
        <div className="auth-switch auth-switch-quiet">
          Not {account.name || account.email}?{" "}
          <button type="button" className="link-btn" onClick={useAnotherAccount}>
            Sign in as someone else
          </button>
        </div>
      </div>
    </div>
  );
}

function FaceIdGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" className="faceid-glyph">
      <g fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
        <path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2" />
        <path d="M9 9.5v1M15 9.5v1M12 9.5v3.5h-1" />
        <path d="M9 16c1.6 1.2 4.4 1.2 6 0" />
      </g>
    </svg>
  );
}

export { FaceIdGlyph };
