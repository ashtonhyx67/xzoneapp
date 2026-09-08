import React, { useCallback, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api.js";
import { useAuth } from "../context/AuthContext.jsx";
import PinPad, { PIN_LENGTH } from "../components/PinPad.jsx";

// Shown once, right after an account is created (and to anyone who signed up
// before PINs existed). Two passes: choose, then confirm.
export default function SetPin() {
  const navigate = useNavigate();
  const { token, setPinSet } = useAuth();

  const [step, setStep] = useState("choose"); // choose | confirm
  const [first, setFirst] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const save = useCallback(
    async (confirmed) => {
      setBusy(true);
      setError("");
      try {
        await api.setPin(token, confirmed);
        setPinSet(true);
        navigate("/dashboard", { replace: true });
      } catch (err) {
        setError(err.message);
        setStep("choose");
        setFirst("");
        setPin("");
      } finally {
        setBusy(false);
      }
    },
    [navigate, setPinSet, token]
  );

  const handleChange = useCallback(
    (next) => {
      setPin(next);
      if (next.length !== PIN_LENGTH || busy) return;

      if (step === "choose") {
        setError("");
        setFirst(next);
        setPin("");
        setStep("confirm");
        return;
      }

      if (next !== first) {
        setError("Those PINs didn't match. Start again.");
        setFirst("");
        setPin("");
        setStep("choose");
        return;
      }

      save(next);
    },
    [busy, first, save, step]
  );

  // Skipping is allowed — the password still works — but the prompt comes back
  // on the next sign-in until a PIN exists.
  function skip() {
    try {
      // Remembered for this session only, so the prompt comes back next launch.
      sessionStorage.setItem("pinPromptSkipped", "1");
    } catch {
      /* storage unavailable; the prompt simply reappears */
    }
    navigate("/dashboard", { replace: true });
  }

  return (
    <div className="auth-shell">
      <div className="auth-wordmark">X Zone App</div>
      <div className="auth-card auth-card-pin">
        <h1 className="auth-title">
          {step === "choose" ? "Create a PIN" : "Confirm your PIN"}
        </h1>
        <p className="auth-subtitle">
          {step === "choose"
            ? "You'll use these 4 digits to get back in each time you open the app."
            : "Enter the same 4 digits once more."}
        </p>

        {error && <div className="error-banner">{error}</div>}

        <PinPad value={pin} onChange={handleChange} disabled={busy} />

        <div className="auth-switch">
          <button type="button" className="link-btn" onClick={skip} disabled={busy}>
            Skip for now
          </button>
        </div>
      </div>
    </div>
  );
}
