import React, { useState } from "react";
import { api } from "../api.js";
import { useAuth } from "../context/AuthContext.jsx";
import PasswordField from "./PasswordField.jsx";

const MIN_PASSWORD_LENGTH = 8;

// Changing your own password, which also needs the current one, so an unlocked
// phone left on a table cannot be used to lock its owner out.
export default function PasswordSettings() {
  const { token } = useAuth();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ currentPassword: "", newPassword: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const update = (field) => (event) =>
    setForm((current) => ({ ...current, [field]: event.target.value }));

  function close() {
    setOpen(false);
    setForm({ currentPassword: "", newPassword: "" });
    setError("");
  }

  async function submit(event) {
    event.preventDefault();
    setError("");
    if (form.newPassword.length < MIN_PASSWORD_LENGTH) {
      setError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
      return;
    }

    setBusy(true);
    try {
      await api.changePassword(token, form);
      close();
      setNotice("Your password has been changed.");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel">
      <div className="panel-row">
        <div className="panel-title">Password</div>
        <div className="panel-row-actions">
          <button
            className="btn btn-secondary btn-inline"
            onClick={() => {
              setNotice("");
              if (open) close();
              else setOpen(true);
            }}
            disabled={busy}
          >
            {open ? "Cancel" : "Change password"}
          </button>
        </div>
      </div>

      {notice && !open && <div className="success-banner panel-notice">{notice}</div>}

      {open && (
        <form className="password-form" onSubmit={submit} noValidate>
          {error && <div className="error-banner">{error}</div>}
          <PasswordField
            id="current-password"
            label="Current password"
            value={form.currentPassword}
            onChange={update("currentPassword")}
            autoComplete="current-password"
          />
          <PasswordField
            id="new-password"
            label="New password"
            value={form.newPassword}
            onChange={update("newPassword")}
            autoComplete="new-password"
            minLength={MIN_PASSWORD_LENGTH}
          />
          <button className="btn btn-primary" type="submit" disabled={busy}>
            {busy ? <span className="spinner" /> : "Save new password"}
          </button>
        </form>
      )}
    </div>
  );
}
