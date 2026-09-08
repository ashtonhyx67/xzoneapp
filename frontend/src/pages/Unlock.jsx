import React, { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api.js";
import { useAuth } from "../context/AuthContext.jsx";
import PinPad, { PIN_LENGTH } from "../components/PinPad.jsx";
import { getDeviceAccount, forgetDeviceAccount } from "../lib/device.js";

// The screen a returning user lands on. The session ended when they closed the
// app, but the device still knows who they are — so this replaces the sign-up
// card with four digits.
export default function Unlock() {
  const navigate = useNavigate();
  const { signIn } = useAuth();
  const account = useRef(getDeviceAccount()).current;

  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [lockedOut, setLockedOut] = useState(false);

  const firstName = account?.name ? account.name.split(" ")[0] : "";

  // Nothing remembered on this device means there is no PIN to ask for.
  useEffect(() => {
    if (!account?.hasPin) navigate("/login", { replace: true });
  }, [account, navigate]);

  const submit = useCallback(
    async (entered) => {
      setBusy(true);
      setError("");
      try {
        const data = await api.pinLogin(account.email, entered);
        signIn(data.token, data.user, {
          faceIdEnabled: data.faceIdEnabled,
          permissions: data.permissions,
          group: data.group,
          isOwner: data.isOwner,
          pinSet: true,
        });
        navigate("/dashboard", { replace: true });
      } catch (err) {
        setPin("");
        setError(err.message);
        if (err.status === 429) setLockedOut(true);
      } finally {
        setBusy(false);
      }
    },
    [account, navigate, signIn]
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
      <div className="auth-wordmark">X Zone App</div>
      <div className="auth-card auth-card-pin">
        <h1 className="auth-title">
          {firstName ? `Welcome back, ${firstName}` : "Welcome back"}
        </h1>
        <p className="auth-subtitle">Enter your 4-digit PIN to continue</p>

        {error && <div className="error-banner">{error}</div>}

        <PinPad value={pin} onChange={handleChange} disabled={busy || lockedOut} />

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
