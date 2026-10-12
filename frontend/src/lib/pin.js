// The same rule the server applies in backend/lib/credentials.js, checked here
// too so a guessable PIN is turned away the moment it is typed rather than
// after it has been confirmed and sent.

const COMMON_PINS = new Set(["2580", "0852", "1004", "2000", "2001", "1998", "1999", "6969"]);

export function isWeakPin(pin) {
  const digits = String(pin).split("").map(Number);
  if (digits.length !== 4) return false;
  const [a, b, c, d] = digits;

  if (digits.every((n) => n === a)) return true; // 1111
  const steps = [b - a, c - b, d - c];
  if (steps.every((s) => s === 1) || steps.every((s) => s === -1)) return true; // 1234, 4321
  if (a === c && b === d) return true; // 1212
  if (a === b && c === d) return true; // 1122
  return COMMON_PINS.has(String(pin));
}

export const WEAK_PIN_ERROR =
  "That PIN is too easy to guess. Avoid repeats and runs like 1111, 1234 or 1212.";

// A short buzz on a wrong PIN, where the device can. Nothing happens on iOS,
// which does not expose vibration to the web.
export function buzz() {
  try {
    navigator.vibrate?.([30, 40, 30]);
  } catch {
    /* not supported */
  }
}
