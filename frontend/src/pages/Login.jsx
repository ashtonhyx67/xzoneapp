import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { startAuthentication, browserSupportsWebAuthn } from "@simplewebauthn/browser";
import { api } from "../api.js";
import { useAuth } from "../context/AuthContext.jsx";
import PasswordField from "../components/PasswordField.jsx";
import {
  getFaceIdDevice,
  rememberFaceIdDevice,
  forgetFaceIdDevice,
} from "../lib/faceId.js";
import { getDeviceAccount } from "../lib/device.js";

export default function Login() {
  const navigate = useNavigate();
  const { signIn } = useAuth();

  // If this device has Face ID enrolled we already know whose account it is,
  // so the email starts filled in.
  const enrolledDevice = useMemo(() => getFaceIdDevice(), []);
  // A device that already has a PIN can offer it here too, for anyone who
  // reached the password card by way of the browser's back button.
  const pinAvailable = useMemo(() => Boolean(getDeviceAccount()?.hasPin), []);
  const supportsWebAuthn = useMemo(() => browserSupportsWebAuthn(), []);

  const [form, setForm] = useState({
    email: enrolledDevice?.email || "",
    password: "",
  });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [faceIdLoading, setFaceIdLoading] = useState(false);
  const [faceIdAvailable, setFaceIdAvailable] = useState(
    Boolean(supportsWebAuthn && enrolledDevice)
  );

  function update(field) {
    return (e) => setForm((prev) => ({ ...prev, [field]: e.target.value }));
  }

  async function handlePasswordSubmit(e) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const data = await api.login(form);
      if (data.faceIdEnabled) rememberFaceIdDevice(data.user.email);
      signIn(data.token, data.user, {
        faceIdEnabled: data.faceIdEnabled,
        isAdmin: data.isAdmin,
        isOwner: data.isOwner,
        pinSet: data.pinSet,
      });
      navigate("/dashboard");
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  // `silent` is the prompt we raise on our own initiative when the page opens:
  // if the user waves it away, that's not an error worth shouting about.
  const runFaceId = useCallback(
    async (email, { silent = false } = {}) => {
      if (!email) {
        setError("Enter your email first, then tap Sign in with Face ID.");
        return;
      }
      setError("");
      setFaceIdLoading(true);
      try {
        const { options, userId } = await api.webauthnLoginOptions(email);
        const authResponse = await startAuthentication({ optionsJSON: options });
        const data = await api.webauthnLoginVerify(userId, authResponse);
        rememberFaceIdDevice(data.user.email);
        signIn(data.token, data.user, {
          faceIdEnabled: true,
          isAdmin: data.isAdmin,
          isOwner: data.isOwner,
          pinSet: data.pinSet,
        });
        navigate("/dashboard");
      } catch (err) {
        // The account no longer has a credential, so stop offering the button.
        if (err.status === 404) {
          forgetFaceIdDevice();
          setFaceIdAvailable(false);
        }
        if (!silent) {
          setError(err.message || "Face ID sign-in was cancelled or failed.");
        }
      } finally {
        setFaceIdLoading(false);
      }
    },
    [navigate, signIn]
  );

  // Offer Face ID straight away on a device that has it enrolled, so returning
  // after a sign-out is one glance rather than a typed password. Runs once, and
  // falls back to the form without complaint if it's dismissed.
  const autoPrompted = useRef(false);
  useEffect(() => {
    if (autoPrompted.current) return;
    if (!supportsWebAuthn || !enrolledDevice?.email) return;
    autoPrompted.current = true;
    runFaceId(enrolledDevice.email, { silent: true });
  }, [supportsWebAuthn, enrolledDevice, runFaceId]);

  return (
    <div className="auth-shell">
      <div className="auth-wordmark">Team App</div>
      <div className="auth-card">
        <h1 className="auth-title">Sign in</h1>

        {error && <div className="error-banner">{error}</div>}

        {faceIdAvailable && (
          <>
            <button
              type="button"
              className="btn btn-faceid"
              onClick={() => runFaceId(form.email)}
              disabled={faceIdLoading}
            >
              {faceIdLoading ? "Verifying…" : "Sign in with Face ID"}
            </button>
            <div className="divider">OR</div>
          </>
        )}

        <form onSubmit={handlePasswordSubmit}>
          <div className="field">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              value={form.email}
              onChange={update("email")}
              required
            />
          </div>
          <PasswordField
            value={form.password}
            onChange={update("password")}
            autoComplete="current-password"
          />
          <button className="btn btn-primary" type="submit" disabled={loading}>
            {loading ? <span className="spinner" /> : "Sign in"}
          </button>
        </form>

        {pinAvailable && (
          <div className="auth-switch">
            <Link to="/unlock">Use your PIN instead</Link>
          </div>
        )}

        <div className="auth-switch">
          New here? <Link to="/signup">Create an account</Link>
        </div>
      </div>
    </div>
  );
}
