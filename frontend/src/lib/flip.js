import { useCallback, useLayoutEffect, useRef } from "react";

// Animating a list as it changes, the "FLIP" way: note where every item is
// (First), let React re-render (Last), then start each item back where it was
// and let it slide to where it now is (Invert, Play). Items keep their place in
// the DOM the whole time, so nothing is animated that the layout does not
// already agree with.
//
// Usage: call capture(group) right before the state change, in the same event.
// Elements take part by carrying data-flip="<group>" and data-flip-key="<id>".
// `seeds` lets a caller say "this item is arriving from here" — how a dropped
// card glides from under the finger into its slot.

const EASE = "cubic-bezier(0.22, 1, 0.36, 1)";

function prefersReducedMotion() {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

export function useFlip(rootRef, { duration = 320 } = {}) {
  const pending = useRef(null);

  const capture = useCallback(
    (group, seeds) => {
      const root = rootRef.current;
      if (!root) return;

      // Two captures before one render (a drop that also clears the drag) keep
      // the earliest position of each item, which is where it visibly was.
      const before = pending.current?.group === group ? pending.current.rects : new Map();
      root.querySelectorAll(`[data-flip="${group}"]`).forEach((el) => {
        const key = el.dataset.flipKey;
        if (!before.has(key)) before.set(key, el.getBoundingClientRect());
      });
      if (seeds) {
        for (const [key, rect] of Object.entries(seeds)) if (rect) before.set(key, rect);
      }
      pending.current = { group, rects: before, at: performance.now() };
    },
    [rootRef]
  );

  // Runs after every commit, but only acts on a capture made for this one.
  useLayoutEffect(() => {
    const job = pending.current;
    if (!job) return;
    pending.current = null;

    const root = rootRef.current;
    // A capture that no render followed is stale by now; never replay it.
    if (!root || performance.now() - job.at > 120 || prefersReducedMotion()) return;

    root.querySelectorAll(`[data-flip="${job.group}"]`).forEach((el) => {
      if (typeof el.animate !== "function") return;
      const was = job.rects.get(el.dataset.flipKey);
      const now = el.getBoundingClientRect();
      if (now.width === 0 && now.height === 0) return;

      // New here: grow in rather than appear.
      if (!was) {
        el.animate(
          [
            { opacity: 0, transform: "scale(0.92)" },
            { opacity: 1, transform: "none" },
          ],
          { duration: 220, easing: EASE }
        );
        return;
      }

      const dx = was.left - now.left;
      const dy = was.top - now.top;
      const sx = was.width / now.width;
      const sy = was.height / now.height;
      const moved = Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5;
      const resized = Math.abs(sx - 1) > 0.02 || Math.abs(sy - 1) > 0.02;
      if (!moved && !resized) return;

      // The rect measured above already includes any slide still in flight,
      // so restarting from it continues the motion instead of jumping.
      el.getAnimations?.().forEach((a) => a.cancel());
      el.animate(
        [
          {
            transformOrigin: "top left",
            transform: `translate(${dx}px, ${dy}px) scale(${resized ? sx : 1}, ${resized ? sy : 1})`,
          },
          { transformOrigin: "top left", transform: "none" },
        ],
        { duration, easing: EASE }
      );
    });
  });

  return capture;
}
