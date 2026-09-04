import React, { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { startAuthentication, browserSupportsWebAuthn } from "@simplewebauthn/browser";
import { api } from "../api.js";
import { useAuth } from "../context/AuthContext.jsx";

export default function Login() {
  const navigate = useNavigate();
  const { signIn } = useAuth();
  const [form, setForm] = useState({ email: "", password: "" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [faceIdLoading, setFaceIdLoading] = useState(false);
  const [supportsWebAuthn, setSupportsWebAuthn] = useState(false);

  useEffect(() => {
    setSupportsWebAuthn(browserSupportsWebAuthn());
  }, []);

  function update(field) {
    return (e) => setForm({ ...form, [field]: e.target.value });
  }

  async function handlePasswordSubmit(e) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const data = await api.login(form);
      signIn(data.token, data.user);
      navigate("/dashboard");
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleFaceId() {
    setError("");
    if (!form.email) {
      setError("Enter your email first, then tap Sign in with Face ID.");
      return;
    }
    setFaceIdLoading(true);
    try {
      const { options, userId } = await api.webauthnLoginOptions(form.email);
      const authResponse = await startAuthentication({ optionsJSON: options });
      const data = await api.webauthnLoginVerify(userId, authResponse);
      signIn(data.token, data.user);
      navigate("/dashboard");
    } catch (err) {
      setError(err.message || "Face ID sign-in was cancelled or failed.");
    } finally {
      setFaceIdLoading(false);
    }
  }

  return (
    <div className="auth-shell">
      <div className="auth-wordmark">Team App</div>
      <div className="auth-card">
        <h1 className="auth-title">Sign in</h1>
        <p className="auth-subtitle">Welcome back. Use your password or Face ID.</p>

        {error && <div className="error-banner">{error}</div>}

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
          <div className="field">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              value={form.password}
              onChange={update("password")}
              required
            />
          </div>
          <button className="btn btn-primary" type="submit" disabled={loading}>
            {loading ? <span className="spinner" /> : "Sign in"}
          </button>
        </form>

        {supportsWebAuthn && (
          <>
            <div className="divider">OR</div>
            <button
              type="button"
              className="btn btn-faceid"
              onClick={handleFaceId}
              disabled={faceIdLoading}
            >
              {faceIdLoading ? "Verifying…" : "Sign in with Face ID"}
            </button>
          </>
        )}

        <div className="auth-switch">
          New here? <Link to="/signup">Create an account</Link>
        </div>
      </div>
    </div>
  );
}
