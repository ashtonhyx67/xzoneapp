// Adding the app to the home screen.
//
// Two browsers, two different jobs. Chrome and Edge fire beforeinstallprompt
// and hand over an object that can show the real install dialog — but they fire
// it once, early, and often before React has mounted, so it is caught here at
// import time and kept. Safari on iOS has no such event and never will: the
// only way in is the Share menu, so there the job is to say which taps.

let deferred = null;
const listeners = new Set();

function announce() {
  for (const listener of listeners) listener();
}

// Registered at import rather than in a component: the event has usually
// already fired by the time anything renders, and it does not fire twice.
if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (event) => {
    // Without this Chrome shows its own bar, which is not the moment we want to
    // ask — the point is to ask once the PIN is set.
    event.preventDefault();
    deferred = event;
    announce();
  });

  window.addEventListener("appinstalled", () => {
    deferred = null;
    announce();
  });
}

// Already added, so there is nothing to offer.
export function isInstalled() {
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    // iOS predates the media query and still reports it this way.
    window.navigator.standalone === true
  );
}

export function isIos() {
  const ua = window.navigator.userAgent;
  return (
    /iPad|iPhone|iPod/.test(ua) ||
    // An iPad on iPadOS 13+ claims to be a Mac; a touch screen gives it away.
    (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)
  );
}

// Chrome and Edge on iOS are Safari underneath and share its restriction, so
// the Share-menu instructions are right for every browser on the platform.
export const canPromptToInstall = () => deferred !== null;

// Whether there is anything worth showing at all: a real prompt to offer, or an
// iOS device where the manual route is the only route.
export function canInstall() {
  if (isInstalled()) return false;
  return canPromptToInstall() || isIos();
}

// Lets a component re-render when the event arrives after it mounted.
export function onInstallChange(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// Shows the browser's own install dialog. Resolves to whether they accepted.
// The object is single-use: once shown it cannot be shown again, so it is
// dropped either way.
export async function promptToInstall() {
  if (!deferred) return false;

  const event = deferred;
  deferred = null;
  announce();

  try {
    await event.prompt();
    const { outcome } = await event.userChoice;
    return outcome === "accepted";
  } catch {
    return false;
  }
}
