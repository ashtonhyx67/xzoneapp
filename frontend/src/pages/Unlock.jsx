import React, { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api.js";
import { useAuth } from "../context/AuthContext.jsx";
import PinPad, { PIN_LENGTH } from "../components/PinPad.jsx";
import { getDeviceAccount, forgetDeviceAccount } from "../lib/device.js";
import { buzz } from "../lib/pin.js";
import BrandMark from "../components/BrandMark.jsx";

// The screen a returning user lands on. The session ended when they closed the
// app, but the device still knows who they are — so this replaces the sign-up
// card with four digits.
export default function Unlock() {
  const navigate = useNavigate();
  const { signIn } = useAuth();
  const account = useRef(getDeviceAccount()).current;

  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [errorKey, setErrorKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const [lockedOut, setLockedOut] = useState(false);

  const firstName = account?.name ? account.name.split(" ")[0] : "";

  // Nothing remembered on this device means there is no PIN to ask for.
  useEffect(() => {
    if (!account?.hasPin) navigate("/login", { replace: true });
  }, [account, navigate]);

  const finish = useCallback(
    (data) => {
      signIn(data.token, data.user, {
        permissions: data.permissions,
        group: data.group,
        isOwner: data.isOwner,
        pinSet: data.pinSet,
      });
      navigate("/dashboard", { replace: true });
    },
    [navigate, signIn]
  );

  const submit = useCallback(
    async (entered) => {
      setBusy(true);
      setError("");
      try {
        finish(await api.pinLogin(account.email, entered));
      } catch (err) {
        setPin("");
        setError(err.message);
        setErrorKey((k) => k + 1);
        buzz();
        if (err.status === 429 || err.status === 423) setLockedOut(true);
      } finally {
        setBusy(false);
      }
    },
    [account, finish]
  );

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

  if (!account?.hasPin) return null;

  return (
    <div className="auth-shell">
      <div className="auth-wordmark">
        <BrandMark />
        X Zone App
      </div>
      <div className="auth-card auth-card-pin">
        <div className="auth-avatar" aria-hidden="true">
          {(firstName || account.email || "?").slice(0, 1).toUpperCase()}
        </div>
        <h1 className="auth-title">
          {firstName ? `Welcome back, ${firstName}` : "Welcome back"}
        </h1>
        <p className="auth-subtitle auth-subtitle-email">{account.email}</p>

        {error && (
          <div className="error-banner" role="alert" key={errorKey}>
            {error}
          </div>
        )}

        {lockedOut ? (
          // A locked PIN can't be fixed from here, so the way forward is the
          // one big button rather than a keypad that does nothing.
          <button
            type="button"
            className="btn btn-primary unlock-locked-btn"
            onClick={() => navigate("/login")}
          >
            Sign in with password
          </button>
        ) : (
          <>
            <p className="unlock-prompt">{busy ? "Checking…" : "Enter your PIN"}</p>
            <PinPad
              value={pin}
              onChange={handleChange}
              disabled={busy}
              checking={busy}
              errorKey={errorKey}
            />
          </>
        )}

        <div className="unlock-links">
          {!lockedOut && (
            <button type="button" className="link-btn" onClick={() => navigate("/login")}>
              Forgot PIN? Use password
            </button>
          )}
          <button type="button" className="link-btn link-btn-quiet" onClick={useAnotherAccount}>
            Not {firstName || "you"}? Switch account
          </button>
        </div>
      </div>
    </div>
  );
}
