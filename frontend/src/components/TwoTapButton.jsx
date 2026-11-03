import React, { useEffect, useRef, useState } from "react";

// For a change that is hard to take back. The first tap asks, the second does it,
// and leaving it alone puts it back, so a stray tap costs nothing.
export default function TwoTapButton({ onConfirm, confirmLabel, className, children, ...rest }) {
  const [armed, setArmed] = useState(false);
  const timer = useRef(null);

  useEffect(() => () => clearTimeout(timer.current), []);

  function handleClick(event) {
    event.stopPropagation();
    clearTimeout(timer.current);
    if (armed) {
      setArmed(false);
      onConfirm();
      return;
    }
    setArmed(true);
    timer.current = setTimeout(() => setArmed(false), 3500);
  }

  return (
    <button type="button" className={className} onClick={handleClick} {...rest}>
      {armed ? confirmLabel : children}
    </button>
  );
}
