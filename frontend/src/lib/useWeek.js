import { useEffect, useRef, useState } from "react";
import { isoWeek, sameWeek } from "./weeks.js";

// The week a page is showing.
//
// Working out the current week once, when the page first mounts, is only right
// for a page that is opened and closed. Added to the home screen it is neither:
// the app is resumed rather than relaunched, so a page mounted on Sunday is
// still mounted on Wednesday and still showing Sunday's week. That is why
// attendance and seating opened on the wrong week without anyone touching the
// arrows.
//
// So the current week is re-checked whenever the app comes back to the front,
// and the page moves on if the week has genuinely rolled over. Someone reading
// last week's register is left where they are: only a real rollover moves the
// page, and only if they had not gone looking elsewhere.
export function useWeek() {
  const [week, setWeek] = useState(() => isoWeek());

  // What the current week was the last time this was checked. Comparing
  // against it is what separates "the week has rolled over" from "they are
  // deliberately looking at another week".
  const currentAtLastCheck = useRef(isoWeek());

  useEffect(() => {
    function recheck() {
      if (document.visibilityState !== "visible") return;

      const now = isoWeek();
      const rolledOver = !sameWeek(now, currentAtLastCheck.current);
      if (!rolledOver) return;

      const wasOnTheCurrentWeek = sameWeek(week, currentAtLastCheck.current);
      currentAtLastCheck.current = now;
      if (wasOnTheCurrentWeek) setWeek(now);
    }

    // Both, because a phone returning from the lock screen fires one and a
    // desktop tab being switched back to fires the other.
    window.addEventListener("focus", recheck);
    document.addEventListener("visibilitychange", recheck);
    // A rollover can also happen while the app simply sits open.
    const timer = setInterval(recheck, 60 * 1000);

    return () => {
      window.removeEventListener("focus", recheck);
      document.removeEventListener("visibilitychange", recheck);
      clearInterval(timer);
    };
  }, [week]);

  return [week, setWeek];
}
