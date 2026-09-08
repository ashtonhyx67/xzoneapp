import React, { useState } from "react";

// Shared by sign up and sign in so the reveal toggle behaves identically in both.
export default function PasswordField({
  id = "password",
  label = "Password",
  value,
  onChange,
  autoComplete = "current-password",
  minLength,
}) {
  const [revealed, setRevealed] = useState(false);

  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div className="input-with-action">
        <input
          id={id}
          type={revealed ? "text" : "password"}
          autoComplete={autoComplete}
          value={value}
          onChange={onChange}
          minLength={minLength}
          required
        />
        <button
          type="button"
          className="input-action"
          onClick={() => setRevealed((shown) => !shown)}
          aria-pressed={revealed}
          aria-controls={id}
          aria-label={revealed ? "Hide password" : "Show password"}
        >
          {revealed ? "Hide" : "Show"}
        </button>
      </div>
    </div>
  );
}
