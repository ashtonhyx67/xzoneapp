// The menu refreshes what it shows on a timer. This is for the moments it should not
// wait: starting or ending a BM, or answering the evaluation it is reminding you of.
const EVENT = "nav-status-changed";

export function refreshNavStatus() {
  window.dispatchEvent(new Event(EVENT));
}

export function onNavStatusChanged(listener) {
  window.addEventListener(EVENT, listener);
  return () => window.removeEventListener(EVENT, listener);
}
