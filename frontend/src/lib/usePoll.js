import { useEffect, useRef } from "react";

// Keeps a page current by asking again every so often. Once as soon as it is
// enabled; not at all while the page is hidden, since a phone in a pocket has
// nobody to show it to; and once more the moment it is looked at again.
export function usePoll(load, intervalMs, enabled = true) {
  const latest = useRef(load);
  latest.current = load;

  useEffect(() => {
    if (!enabled) return undefined;

    const tick = () => {
      if (!document.hidden) latest.current();
    };

    tick();
    const timer = setInterval(tick, intervalMs);
    document.addEventListener("visibilitychange", tick);

    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [enabled, intervalMs]);
}
