import React, { useState } from "react";
import { api } from "../api.js";
import { useAuth } from "../context/AuthContext.jsx";
import PinPad, { PIN_LENGTH } from "./PinPad.jsx";
import { isWeakPin, WEAK_PIN_ERROR, buzz } from "../lib/pin.js";

// Change, add, or turn off the PIN from inside the app. Changing one asks for
// the current PIN first, so an unlocked session left on a desk can't be used to
// lock the real owner out.
export default function PinSettings() {
  const { token, pinSet, setPinSet } = useAuth();

  const [open, setOpen] = useState(false);
  // current -> choose -> confirm
  const [step, setStep] = useState(pinSet ? "current" : "choose");
  const [entry, setEntry] = useState("");
  const [currentPin, setCurrentPin] = useState("");
  const [first, setFirst] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setErrorText] = useState("");
  const [errorKey, setErrorKey] = useState(0);
  const [notice, setNotice] = useState("");

  // Every rejection shakes the dots, so it is felt as well as read.
  function setError(message) {
    setErrorText(message);
    if (message) {
      setErrorKey((k) => k + 1);
      buzz();
    }
  }

  function reset(nextOpen) {
    setOpen(nextOpen);
    setStep(pinSet ? "current" : "choose");
    setEntry("");
    setCurrentPin("");
    setFirst("");
    setError("");
  }

  async function submit(pin, current) {
    setBusy(true);
    setError("");
    try {
      await api.setPin(token, pin, current);
      setPinSet(true);
      setNotice(pinSet ? "Your PIN has been changed." : "Your PIN is set.");
      reset(false);
    } catch (err) {
      setError(err.message);
      // A rejected current PIN means starting over from the first step.
      setStep(pinSet ? "current" : "choose");
      setEntry("");
      setCurrentPin("");
      setFirst("");
    } finally {
      setBusy(false);
    }
  }

  function handleChange(next) {
    setEntry(next);
    if (next.length !== PIN_LENGTH || busy) return;

    if (step === "current") {
      setCurrentPin(next);
      setEntry("");
      setError("");
      setStep("choose");
      return;
    }

    if (step === "choose") {
      if (isWeakPin(next)) {
        setEntry("");
        setError(WEAK_PIN_ERROR);
        return;
      }
      setFirst(next);
      setEntry("");
      setError("");
      setStep("confirm");
      return;
    }

    if (next !== first) {
      setError("Those PINs didn't match. Try again.");
      setFirst("");
      setEntry("");
      setStep("choose");
      return;
    }

    submit(next, currentPin);
  }

  async function turnOff() {
    setBusy(true);
    setError("");
    try {
      await api.removePin(token);
      setPinSet(false);
      setNotice("PIN sign-in is off.");
      reset(false);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const prompts = {
    current: "Current PIN",
    choose: "New PIN",
    confirm: "New PIN again",
  };

  return (
    <div className="panel">
      <div className="panel-row">
        <div className="panel-title">PIN sign-in</div>
        <div className="panel-row-actions">
          {pinSet && !open && <span className="badge badge-on">On</span>}
          <button
            className="btn btn-secondary btn-inline"
            onClick={() => {
              setNotice("");
              reset(!open);
            }}
            disabled={busy}
          >
            {open ? "Cancel" : pinSet ? "Change PIN" : "Set up a PIN"}
          </button>
          {pinSet && !open && (
            <button className="btn btn-secondary btn-inline" onClick={turnOff} disabled={busy}>
              Turn off
            </button>
          )}
        </div>
      </div>

      {error && <div className="error-banner panel-notice">{error}</div>}
      {notice && !open && <div className="success-banner panel-notice">{notice}</div>}

      {open && (
        <div className="pin-inline">
          <div className="list-empty">{prompts[step]}</div>
          <PinPad value={entry} onChange={handleChange} disabled={busy} errorKey={errorKey} />
        </div>
      )}
    </div>
  );
}
