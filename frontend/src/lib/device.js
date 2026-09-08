// What this device remembers between launches. The session token itself lives
// in sessionStorage, so closing the app signs the user out — but the app still
// needs to know *whose* device this is, so the next launch can open on the PIN
// screen instead of asking a returning user to create an account again.

const KEY = "deviceAccount";

export function getDeviceAccount() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed?.email ? parsed : null;
  } catch {
    // Corrupt or unavailable storage must never block sign-in.
    return null;
  }
}

export function rememberDeviceAccount({ email, name, hasPin }) {
  if (!email) return;
  try {
    const existing = getDeviceAccount();
    // A different person signing in on this device replaces the old record
    // rather than inheriting its PIN flag.
    const base = existing && existing.email === email ? existing : {};
    localStorage.setItem(
      KEY,
      JSON.stringify({
        ...base,
        email,
        name: name ?? base.name ?? "",
        hasPin: hasPin === undefined ? Boolean(base.hasPin) : Boolean(hasPin),
      })
    );
  } catch {
    // Private mode: the PIN screen just won't be pre-offered next launch.
  }
}

export function setDeviceHasPin(hasPin) {
  const existing = getDeviceAccount();
  if (existing) rememberDeviceAccount({ ...existing, hasPin });
}

// "Not me" on the PIN screen, or a PIN the server no longer recognizes.
export function forgetDeviceAccount() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* nothing to do */
  }
}
