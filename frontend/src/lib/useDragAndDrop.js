import { useCallback, useEffect, useRef, useState } from "react";

// Drag and drop built on pointer events, so a mouse, a finger and a pen all
// work the same way — the browser's own drag-and-drop does nothing on a phone.
//
// A finger has to hold still for a moment before the card lifts, so an
// ordinary swipe still scrolls the page. A mouse lifts it as soon as it moves.
// While dragging, a "ghost" copy follows the pointer (moved directly, not
// through React, so it keeps up with the finger), and the caller is told which
// drop target is under it whenever that changes.

const LONG_PRESS_MS = 200;
const TOUCH_SLOP = 8;
const MOUSE_SLOP = 4;
const EDGE = 64;

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

export function useDragAndDrop({ findTarget, sameTarget, onTargetChange, onDrop, scrollers }) {
  const [drag, setDrag] = useState(null);
  const session = useRef(null);
  const ghost = useRef(null);
  const suppressClickUntil = useRef(0);

  // The latest callbacks, read from inside listeners that outlive a render.
  const props = useRef(null);
  props.current = { findTarget, sameTarget, onTargetChange, onDrop, scrollers };

  const placeGhost = useCallback(() => {
    const s = session.current;
    if (!s || !ghost.current) return;
    ghost.current.style.transform = `translate3d(${s.x - s.offsetX}px, ${s.y - s.offsetY}px, 0) rotate(${s.tilt.toFixed(2)}deg)`;
  }, []);

  // React mounts the ghost; from then on only this hook moves it.
  const ghostRef = useCallback(
    (node) => {
      ghost.current = node;
      if (node) placeGhost();
    },
    [placeGhost]
  );

  // What is under the pointer now. Checked on every movement and again at the
  // release, not only once per animation frame: a busy phone can drop frames,
  // and a quick flick must land where the finger let go, not where it was.
  const updateTarget = useCallback(() => {
    const s = session.current;
    if (!s?.started) return;
    const target = props.current.findTarget(s.x, s.y, s);
    if (!props.current.sameTarget(target, s.target)) {
      s.target = target;
      props.current.onTargetChange?.(target, s);
      setDrag((d) => (d ? { ...d, target } : d));
    }
  }, []);

  const frame = useCallback(() => {
    const s = session.current;
    if (!s?.started) return;

    // A little tilt in the direction of travel, eased, so the card feels
    // carried rather than pinned to the cursor.
    const now = performance.now();
    const dt = Math.max(8, now - s.lastT);
    const vx = (s.x - s.lastX) / dt;
    s.lastX = s.x;
    s.lastT = now;
    s.tilt += (clamp(vx * 9, -7, 7) - s.tilt) * 0.18;
    placeGhost();

    // Near an edge, scroll toward it — faster the closer the pointer gets.
    // The bottom edge sits above the phone's floating bar.
    const bottomEdge = window.innerHeight - (window.innerWidth <= 768 ? EDGE + 70 : EDGE);
    let dy = 0;
    if (s.y < EDGE) dy = -((EDGE - s.y) / EDGE) * 16;
    else if (s.y > bottomEdge) dy = ((s.y - bottomEdge) / EDGE) * 16;
    if (dy) window.scrollBy(0, dy);

    for (const el of props.current.scrollers?.() || []) {
      if (!el || el.scrollWidth <= el.clientWidth) continue;
      const r = el.getBoundingClientRect();
      if (s.y < r.top || s.y > r.bottom) continue;
      if (s.x < r.left + EDGE) el.scrollLeft -= ((r.left + EDGE - s.x) / EDGE) * 14;
      else if (s.x > r.right - EDGE) el.scrollLeft += ((s.x - (r.right - EDGE)) / EDGE) * 14;
    }

    // Scrolling moves the page under a still finger, so look again.
    if (dy) updateTarget();

    s.raf = requestAnimationFrame(frame);
  }, [placeGhost, updateTarget]);

  const cleanup = useCallback(() => {
    const s = session.current;
    if (!s) return;
    clearTimeout(s.timer);
    cancelAnimationFrame(s.raf);
    window.removeEventListener("pointermove", s.onMove);
    window.removeEventListener("pointerup", s.onUp);
    window.removeEventListener("pointercancel", s.onCancel);
    window.removeEventListener("keydown", s.onKey);
    document.removeEventListener("touchmove", s.onTouchMove);
    document.body.classList.remove("is-dragging");
    session.current = null;
  }, []);

  const finish = useCallback(
    (dropped) => {
      const s = session.current;
      if (!s) return;
      const started = s.started;
      if (dropped && started) s.target = props.current.findTarget(s.x, s.y, s);
      const target = dropped ? s.target : null;
      const ghostRect = ghost.current?.getBoundingClientRect() || null;
      cleanup();
      if (!started) return;

      // The click that follows a mouse drag is not a tap on the card.
      suppressClickUntil.current = performance.now() + 400;
      props.current.onDrop(s.item, target, ghostRect, s);
      setDrag(null);
    },
    [cleanup]
  );

  const start = useCallback(() => {
    const s = session.current;
    if (!s || s.started) return;
    s.started = true;
    clearTimeout(s.timer);
    s.lastX = s.x;
    s.lastT = performance.now();
    s.target = props.current.findTarget(s.x, s.y, s);

    try {
      navigator.vibrate?.(8);
    } catch {
      /* no haptics here */
    }
    document.body.classList.add("is-dragging");
    window.getSelection?.()?.removeAllRanges();

    setDrag({ item: s.item, key: s.key, rect: s.rect, target: s.target });
    s.raf = requestAnimationFrame(frame);
  }, [frame]);

  const pointerDown = useCallback(
    (event, item, key) => {
      if (session.current) return;
      if (event.pointerType === "mouse" && event.button !== 0) return;
      // The × on a card, or a field, is its own control.
      if (event.target !== event.currentTarget && event.target.closest("button, input, select, textarea")) {
        return;
      }

      const el = event.currentTarget;
      const rect = el.getBoundingClientRect();
      const s = {
        item,
        key,
        pointerId: event.pointerId,
        touch: event.pointerType === "touch",
        startX: event.clientX,
        startY: event.clientY,
        x: event.clientX,
        y: event.clientY,
        offsetX: event.clientX - rect.left,
        offsetY: event.clientY - rect.top,
        rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
        started: false,
        tilt: 0,
        target: null,
      };

      s.onMove = (e) => {
        if (e.pointerId !== s.pointerId) return;
        s.x = e.clientX;
        s.y = e.clientY;
        if (s.started) {
          placeGhost();
          updateTarget();
          return;
        }
        const moved = Math.hypot(s.x - s.startX, s.y - s.startY);
        if (s.touch) {
          // Moved before the hold finished: this is a scroll, not a drag.
          if (moved > TOUCH_SLOP) cleanup();
        } else if (moved > MOUSE_SLOP) {
          start();
        }
      };
      s.onUp = (e) => {
        if (e.pointerId !== s.pointerId) return;
        s.x = e.clientX;
        s.y = e.clientY;
        finish(true);
      };
      s.onCancel = (e) => e.pointerId === s.pointerId && finish(false);
      s.onKey = (e) => e.key === "Escape" && finish(false);
      // Once a card is lifted the page must not scroll under the finger.
      // Only a non-passive touchmove listener can stop that on iOS.
      s.onTouchMove = (e) => {
        if (s.started && e.cancelable) e.preventDefault();
      };

      session.current = s;
      window.addEventListener("pointermove", s.onMove);
      window.addEventListener("pointerup", s.onUp);
      window.addEventListener("pointercancel", s.onCancel);
      window.addEventListener("keydown", s.onKey);
      document.addEventListener("touchmove", s.onTouchMove, { passive: false });

      if (s.touch) s.timer = setTimeout(start, LONG_PRESS_MS);
    },
    [cleanup, finish, placeGhost, start, updateTarget]
  );

  // Leaving the page mid-drag must not leave listeners or the body class behind.
  useEffect(() => cleanup, [cleanup]);

  const justDragged = useCallback(() => performance.now() < suppressClickUntil.current, []);

  return { drag, pointerDown, ghostRef, justDragged };
}
