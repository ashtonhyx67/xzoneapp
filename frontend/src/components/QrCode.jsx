import React, { useMemo } from "react";
import { encode } from "uqr";

// Drawn as one SVG path, so it stays sharp at any size, from a card on a phone to
// a projector. Black on white whatever the page around it is doing, since that is
// what a camera reads most reliably.
export default function QrCode({ value, label, className = "" }) {
  const { size, path } = useMemo(() => {
    const { size: modules, data } = encode(value, { ecc: "M", border: 2 });
    let d = "";
    data.forEach((row, y) => {
      row.forEach((dark, x) => {
        if (dark) d += `M${x} ${y}h1v1h-1z`;
      });
    });
    return { size: modules, path: d };
  }, [value]);

  return (
    <svg
      className={`qr-code ${className}`}
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label={label}
      shapeRendering="crispEdges"
    >
      <rect width={size} height={size} fill="#fff" />
      <path d={path} fill="#000" />
    </svg>
  );
}
