import React, { useEffect } from "react";

const PIN_LENGTH = 4;
const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "back"];

// A 4-digit entry pad. The dots show progress; the keypad exists because this
// is mostly used on a phone, and a hardware keyboard works too.
export default function PinPad({ value, onChange, disabled = false, autoFocusKeyboard = true }) {
  const digits = String(value || "");

  useEffect(() => {
    if (!autoFocusKeyboard) return;

    function onKeyDown(event) {
      if (disabled || event.metaKey || event.ctrlKey || event.altKey) return;
      if (/^[0-9]$/.test(event.key)) {
        event.preventDefault();
        onChange((digits + event.key).slice(0, PIN_LENGTH));
      } else if (event.key === "Backspace") {
        event.preventDefault();
        onChange(digits.slice(0, -1));
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [digits, disabled, onChange, autoFocusKeyboard]);

  function press(key) {
    if (disabled) return;
    if (key === "back") onChange(digits.slice(0, -1));
    else onChange((digits + key).slice(0, PIN_LENGTH));
  }

  return (
    <div className="pinpad">
      <div className="pin-dots" role="status" aria-label={`${digits.length} of ${PIN_LENGTH} digits entered`}>
        {Array.from({ length: PIN_LENGTH }).map((_, i) => (
          <span key={i} className={`pin-dot${i < digits.length ? " filled" : ""}`} />
        ))}
      </div>

      <div className="pin-keys">
        {KEYS.map((key, i) =>
          key === "" ? (
            <span key={`gap-${i}`} className="pin-key-gap" />
          ) : (
            <button
              key={key}
              type="button"
              className={`pin-key${key === "back" ? " pin-key-back" : ""}`}
              onClick={() => press(key)}
              disabled={disabled || (key === "back" && digits.length === 0)}
              aria-label={key === "back" ? "Delete" : key}
            >
              {key === "back" ? "⌫" : key}
            </button>
          )
        )}
      </div>
    </div>
  );
}

export { PIN_LENGTH };
