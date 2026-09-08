import React, { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api.js";
import { useAuth } from "../context/AuthContext.jsx";
import PasswordField from "../components/PasswordField.jsx";
import { getDeviceAccount } from "../lib/device.js";

export default function Login() {
  const navigate = useNavigate();
  const { signIn } = useAuth();

  // A device that has been signed into before starts with the email filled in,
  // and can go straight to its PIN instead.
  const remembered = useMemo(() => getDeviceAccount(), []);

  const [form, setForm] = useState({ email: remembered?.email || "", password: "" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  function update(field) {
    return (e) => setForm((prev) => ({ ...prev, [field]: e.target.value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const data = await api.login(form);
      signIn(data.token, data.user, {
        faceIdEnabled: data.faceIdEnabled,
        permissions: data.permissions,
        group: data.group,
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

  return (
    <div className="auth-shell">
      <div className="auth-wordmark">X Zone App</div>
      <div className="auth-card">
        <h1 className="auth-title">Sign in</h1>

        {error && <div className="error-banner">{error}</div>}

        <form onSubmit={handleSubmit}>
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

        {remembered?.hasPin && (
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
