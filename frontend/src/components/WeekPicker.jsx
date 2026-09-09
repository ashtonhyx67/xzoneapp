import React from "react";
import { stepWeek } from "../lib/weeks.js";

// The Monday and Sunday a given ISO week covers, so the week number is not the
// only thing on offer — "Week 37" means little until you see the dates.
function weekRange({ year, week }) {
  // 4 January is always in week 1, so counting from the Monday of its week
  // lands on the Monday of any week without a special case for the year start.
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const monday = new Date(jan4);
  monday.setUTCDate(jan4.getUTCDate() - ((jan4.getUTCDay() || 7) - 1) + (week - 1) * 7);
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);

  const format = (date) =>
    date.toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

  return `${format(monday)} – ${format(sunday)}`;
}

// Steps through weeks. Shared by attendance and seating so both file records
// under the same week, named the same way the dashboard names it.
// Every page opens on the current week, so there is nothing to offer a way back
// to — leaving the page and returning does it.
export default function WeekPicker({ value, onChange }) {
  return (
    <div className="week-picker">
      <button
        type="button"
        className="icon-btn"
        onClick={() => onChange(stepWeek(value, -1))}
        aria-label="Previous week"
      >
        ←
      </button>

      <div className="week-picker-label">
        <span className="week-picker-week">Week {value.week}</span>
        <span className="week-picker-range">
          {weekRange(value)} · {value.year}
        </span>
      </div>

      <button
        type="button"
        className="icon-btn"
        onClick={() => onChange(stepWeek(value, 1))}
        aria-label="Next week"
      >
        →
      </button>

    </div>
  );
}
