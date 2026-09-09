// Registered so the app can be installed to a home screen: Chrome requires a
// service worker before it will offer, however complete the manifest is.
//
// It deliberately caches nothing. The app checks for new versions by asking the
// server for index.html, and a caching worker would answer that from its own
// copy and report that the app is up to date forever.

self.addEventListener("install", () => {
  // Take over straight away rather than waiting for every tab to close.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

// A fetch handler has to exist for the app to count as installable. Passing
// through is the whole of it: the network is the only source of truth here.
self.addEventListener("fetch", () => {});
