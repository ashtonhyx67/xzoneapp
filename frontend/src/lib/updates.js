// Noticing that a new version has been deployed.
//
// A home-screen app has no address bar and no reload button, so one left open
// for a week keeps running the build it started with — the server sends
// index.html with no-cache, but nothing ever asks for it again. So the app asks
// for it itself, and offers a way back.
//
// The build is identified by the name of the script Vite injects, which is
// fingerprinted with the contents of the bundle. No version file to remember to
// bump, and nothing to keep in step with the server.

const ASSET_SCRIPT = /src="([^"]*\/assets\/[^"]+\.js)"/;

function absolute(path) {
  return new URL(path, window.location.href).pathname;
}

// The build this page is running. Empty in development, where the entry point
// is source rather than a fingerprinted bundle — which is what keeps the check
// silent there.
export function runningBuild() {
  const script = document.querySelector('script[type="module"][src*="/assets/"]');
  return script ? absolute(script.getAttribute("src")) : "";
}

// The build the server would hand a browser asking right now.
export async function deployedBuild(signal) {
  // Cache-busted twice over: no-store tells the browser not to use or keep a
  // copy, and the query defeats any proxy in between that ignores it.
  const response = await fetch(`/index.html?checked=${Date.now()}`, {
    cache: "no-store",
    signal,
  });
  if (!response.ok) throw new Error(`Could not check for updates (${response.status}).`);

  const match = ASSET_SCRIPT.exec(await response.text());
  return match ? absolute(match[1]) : "";
}

// Whether there is a newer build than the one running. Both empty — in
// development, or if the HTML ever comes back unrecognisable — reads as "no",
// so a failed check never nags.
export async function updateAvailable(signal) {
  const running = runningBuild();
  if (!running) return false;
  return (await deployedBuild(signal)) !== running;
}

// Added to the home screen, so there is no browser chrome to reload from.
export function isStandalone() {
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    // iOS predates the media query and still reports it this way.
    window.navigator.standalone === true
  );
}

export async function reloadApp() {
  // Anything a service worker or the browser has stored for this app is dropped
  // first, so the reload genuinely goes to the server rather than being served
  // the shell it already has.
  if ("caches" in window) {
    try {
      const keys = await caches.keys();
      await Promise.all(keys.map((key) => caches.delete(key)));
    } catch {
      // Storage can be blocked outright; the reload is still worth doing.
    }
  }

  window.location.reload();
}
