import React, { useEffect, useRef, useState } from "react";

// What a page shows while its records are on the way.
//
// The word "Loading" tells someone the app is working but not what is coming,
// and swapping one line of text for a forty-row register is a jump. A block
// the shape of the thing being fetched answers both: the page is already laid
// out when the data lands, so nothing moves, and the wait reads as shorter
// than it is because there is something to look at.
export function SkeletonRows({ count = 6, label = "Loading" }) {
  return (
    <div className="skeleton-rows" role="status" aria-label={label}>
      {Array.from({ length: count }, (_, i) => (
        <div className="skeleton skeleton-row" key={i} />
      ))}
    </div>
  );
}

export function SkeletonBlock({ label = "Loading" }) {
  return <div className="skeleton skeleton-block" role="status" aria-label={label} />;
}

// A number that replays a small tick whenever it changes, so a count moving
// while you watch looks like it moved rather than like it was always that.
// The key is what restarts the animation; without it the class is already on
// the element and the browser has nothing to replay.
export function Ticker({ value, className = "" }) {
  const [key, setKey] = useState(0);
  const previous = useRef(value);

  useEffect(() => {
    if (previous.current !== value) {
      previous.current = value;
      setKey((k) => k + 1);
    }
  }, [value]);

  return (
    <span className={`ticking ${className}`.trim()} key={key}>
      {value}
    </span>
  );
}
