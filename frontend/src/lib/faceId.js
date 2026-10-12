import { startAuthentication, browserSupportsWebAuthn } from "@simplewebauthn/browser";
import { api } from "../api.js";

// Whether this device has a face or fingerprint unlock the browser can use.
// A browser can support WebAuthn without the device having either set up, and
// asking anyway is what makes Chrome offer a QR code or a password app instead.
export async function deviceHasBiometrics() {
  try {
    if (!browserSupportsWebAuthn()) return false;
    const check = window.PublicKeyCredential?.isUserVerifyingPlatformAuthenticatorAvailable;
    return check ? await check() : false;
  } catch {
    return false;
  }
}

// The whole Face ID sign-in: ask the server for a challenge, have the device
// sign it, and hand the signature back. Resolves to the same session payload a
// password sign-in returns.
export async function signInWithFaceId(email) {
  const { options, userId } = await api.webauthnLoginOptions(email);
  const response = await startAuthentication({ optionsJSON: options });
  return api.webauthnLoginVerify(userId, response);
}

// The browser's own wording for a cancelled prompt is not something to show.
export function faceIdErrorMessage(err, fallback = "Face ID didn't work. Try again.") {
  if (err?.name === "NotAllowedError" || err?.name === "AbortError") {
    return "Face ID was cancelled.";
  }
  return err?.message || fallback;
}
