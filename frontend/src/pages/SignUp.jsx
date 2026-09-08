import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api.js";
import { useAuth } from "../context/AuthContext.jsx";
import PasswordField from "../components/PasswordField.jsx";

const MIN_PASSWORD_LENGTH = 8;

export default function SignUp() {
  const navigate = useNavigate();
  const { signIn } = useAuth();
  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  function update(field) {
    return (e) => setForm((prev) => ({ ...prev, [field]: e.target.value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");

    // Checked here as well as on the server, so the message reads the same as
    // every other error on this card instead of a browser tooltip.
    if (form.password.length < MIN_PASSWORD_LENGTH) {
      setError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }

    setLoading(true);
    try {
      const data = await api.signup(form);
      signIn(data.token, data.user, {
        permissions: data.permissions,
        group: data.group,
        isOwner: data.isOwner,
        pinSet: data.pinSet,
      });
      // Straight to choosing a PIN — it is how they will get back in from now on.
      navigate("/set-pin", { replace: true });
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
        <h1 className="auth-title">Create your account</h1>

        {error && <div className="error-banner">{error}</div>}

        <form onSubmit={handleSubmit} noValidate>
          <div className="field">
            <label htmlFor="name">Full name</label>
            <input
              id="name"
              type="text"
              autoComplete="name"
              value={form.name}
              onChange={update("name")}
              required
            />
          </div>
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
            autoComplete="new-password"
            minLength={MIN_PASSWORD_LENGTH}
          />
          <button className="btn btn-primary" type="submit" disabled={loading}>
            {loading ? <span className="spinner" /> : "Create account"}
          </button>
        </form>

        <div className="auth-switch">
          Already have an account? <Link to="/login">Sign in</Link>
        </div>
      </div>
    </div>
  );
}
