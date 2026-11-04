import { useCallback, useEffect, useRef, useState } from "react";
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
//
// Attendance and seating sit either side of one switch, so the week chosen on one is
// still chosen on the other. It is forgotten once the real week has moved on, or a
// page reopened days later would be back on the wrong week.
let remembered = null; // { week, currentWhenChosen }

function openingWeek() {
  const now = isoWeek();
  return remembered && sameWeek(remembered.currentWhenChosen, now) ? remembered.week : now;
}

export function useWeek() {
  const [week, setWeekState] = useState(openingWeek);

  const setWeek = useCallback((next) => {
    remembered = { week: next, currentWhenChosen: isoWeek() };
    setWeekState(next);
  }, []);

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
  }, [setWeek, week]);

  return [week, setWeek];
}
