// A platform credential (Face ID / Touch ID / Windows Hello) lives on the
// device that created it, so "is Face ID available here?" is a question about
// this browser, not about the account. Remembering it locally lets the sign-in
// page stay quiet until there is actually something to offer — and avoids
// asking the server about an email before anyone has signed in.

const KEY = "faceIdDevice";

export function getFaceIdDevice() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed?.email ? parsed : null;
  } catch {
    // Corrupt or unavailable storage should never break sign-in.
    return null;
  }
}

export function rememberFaceIdDevice(email) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ email }));
  } catch {
    // Private mode and similar: Face ID just won't be pre-offered next time.
  }
}

// Called when the server says this account has no credential, so a stale flag
// (credential removed, database reset) stops offering a button that can't work.
export function forgetFaceIdDevice() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* nothing to do */
  }
}
