import React from "react";

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

// The date as the iPhone's Calendar icon draws it: the month in red over a
// large day number.
export default function DateTile({ date, size = "md" }) {
  const [year, month, day] = String(date || "").split("-").map(Number);
  if (!year) return null;
  return (
    <span className={`date-tile date-tile-${size}`} aria-hidden="true">
      <span className="date-tile-month">{MONTHS[month - 1]}</span>
      <span className="date-tile-day">{day}</span>
    </span>
  );
}
