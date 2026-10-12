import React, { useCallback, useEffect, useRef, useState } from "react";
import { faceIdErrorMessage } from "../lib/faceId.js";
import { buzz } from "../lib/pin.js";

// The app's own Face ID pop-up. The phone still shows its system Face ID sheet
// once the button is tapped — no website can replace that — but this is what
// greets the person, in the app's own look, and the system sheet only appears
// for the moment of the scan itself. Tapping the button is also what Safari
// wants before it will start Face ID at all.
//
// onScan() runs the scan and resolves with the session (or throws).
// onDone(session) is called after the tick has had a moment on screen.
// onDismiss(error?) closes it — "Use PIN instead", a tap outside, Escape.
export default function FaceIdSheet({ title, subtitle, dismissLabel, onScan, onDone, onDismiss }) {
  const [state, setState] = useState("idle"); // idle | scanning | success
  const [message, setMessage] = useState("");
  const [messageKey, setMessageKey] = useState(0);
  const [leaving, setLeaving] = useState(false);
  const buttonRef = useRef(null);
  const left = useRef(false);

  // Slide away first, then let the screen behind take over.
  const leave = useCallback((then) => {
    if (left.current) return;
    left.current = true;
    setLeaving(true);
    setTimeout(then, 240);
  }, []);

  useEffect(() => {
    buttonRef.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    function onKey(event) {
      if (event.key === "Escape" && state !== "scanning") leave(() => onDismiss());
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [leave, onDismiss, state]);

  async function scan() {
    setState("scanning");
    setMessage("");
    try {
      const session = await onScan();
      setState("success");
      setTimeout(() => onDone(session), 650);
    } catch (err) {
      setState("idle");
      buzz();
      // Face ID was removed from this account elsewhere: nothing to retry.
      if (err?.status === 404) {
        leave(() => onDismiss(err));
        return;
      }
      const cancelled = err?.name === "NotAllowedError" || err?.name === "AbortError";
      setMessage(cancelled ? "Face ID was cancelled. Tap to try again." : faceIdErrorMessage(err));
      setMessageKey((k) => k + 1);
    }
  }

  const status =
    state === "scanning" ? "Look at your phone…" : state === "success" ? "Unlocked" : subtitle;

  return (
    <div
      className={`fid-backdrop${leaving ? " fid-leaving" : ""}`}
      onClick={(event) => {
        if (event.target === event.currentTarget && state === "idle") leave(() => onDismiss());
      }}
    >
      <div className="fid-sheet" role="dialog" aria-modal="true" aria-labelledby="fid-title">
        <div className="fid-grabber" aria-hidden="true" />

        <div className={`fid-icon fid-icon-${state}`} aria-hidden="true">
          <svg viewBox="0 0 64 64" width="64" height="64">
            <g fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round">
              <g className="fid-corners">
                <path d="M8 22v-8a6 6 0 0 1 6-6h8" />
                <path d="M42 8h8a6 6 0 0 1 6 6v8" />
                <path d="M56 42v8a6 6 0 0 1-6 6h-8" />
                <path d="M22 56h-8a6 6 0 0 1-6-6v-8" />
              </g>
              <g className="fid-face">
                <path d="M24 25v5M40 25v5" />
                <path d="M32 25v11h-3" />
                <path d="M25 43c4 3.2 10 3.2 14 0" />
              </g>
              <path className="fid-check" d="M19 33l9 9 17-18" pathLength="1" />
            </g>
          </svg>
          <span className="fid-scanline" />
        </div>

        <h2 id="fid-title" className="fid-title">
          {title}
        </h2>
        <p className="fid-subtitle" aria-live="polite">
          {status}
        </p>

        {message && (
          <p key={messageKey} className="fid-message" role="alert">
            {message}
          </p>
        )}

        <button
          ref={buttonRef}
          type="button"
          className={`btn btn-primary fid-button${state === "success" ? " fid-button-done" : ""}`}
          onClick={scan}
          disabled={state !== "idle"}
        >
          {state === "scanning" ? (
            <span className="spinner" />
          ) : state === "success" ? (
            "Unlocked"
          ) : (
            "Use Face ID"
          )}
        </button>

        <button
          type="button"
          className="link-btn fid-secondary"
          onClick={() => leave(() => onDismiss())}
          disabled={state !== "idle"}
        >
          {dismissLabel}
        </button>
      </div>
    </div>
  );
}
