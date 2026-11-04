import React, { useRef, useState } from "react";
import { localDay } from "../lib/narnia.js";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];

function parse(value) {
  const [year, month, day] = String(value || "").split("-").map(Number);
  return year && month && day ? { year, month: month - 1, day } : null;
}

function key(year, month, day) {
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

// A month at a time, the way the iPhone's Calendar shows one: today's number in
// red, the chosen day in a filled circle, arrows (or a swipe) between months.
// `value` and `onChange` use the same YYYY-MM-DD as a date input.
export default function MonthCalendar({ value, onChange, label = "Date" }) {
  const today = localDay();
  const selected = parse(value);
  const start = selected || parse(today);
  const [shown, setShown] = useState({ year: start.year, month: start.month });
  const swipe = useRef(null);

  function move(step) {
    setShown(({ year, month }) => {
      const next = new Date(year, month + step, 1);
      return { year: next.getFullYear(), month: next.getMonth() };
    });
  }

  const firstWeekday = new Date(shown.year, shown.month, 1).getDay();
  const daysInMonth = new Date(shown.year, shown.month + 1, 0).getDate();
  const cells = [
    ...Array.from({ length: firstWeekday }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];

  return (
    <div
      className="cal"
      role="group"
      aria-label={label}
      onTouchStart={(event) => {
        swipe.current = event.touches[0].clientX;
      }}
      onTouchEnd={(event) => {
        if (swipe.current === null) return;
        const distance = event.changedTouches[0].clientX - swipe.current;
        swipe.current = null;
        if (Math.abs(distance) > 50) move(distance < 0 ? 1 : -1);
      }}
    >
      <div className="cal-head">
        <span className="cal-title" aria-live="polite">
          {MONTHS[shown.month]} <span>{shown.year}</span>
        </span>
        <button type="button" className="cal-arrow" onClick={() => move(-1)} aria-label="Previous month">
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
            <path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <button type="button" className="cal-arrow" onClick={() => move(1)} aria-label="Next month">
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
            <path d="M9 5l7 7-7 7" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>

      <div className="cal-grid cal-weekdays" aria-hidden="true">
        {WEEKDAYS.map((day, i) => (
          <span key={i}>{day}</span>
        ))}
      </div>

      <div className="cal-grid">
        {cells.map((day, i) => {
          if (day === null) return <span key={`gap-${i}`} />;
          const date = key(shown.year, shown.month, day);
          const isSelected = date === value;
          const isToday = date === today;
          return (
            <button
              type="button"
              key={date}
              className={`cal-day${isSelected ? " cal-day-on" : ""}${isToday ? " cal-day-today" : ""}`}
              aria-pressed={isSelected}
              aria-label={new Date(shown.year, shown.month, day).toLocaleDateString(undefined, {
                weekday: "long",
                day: "numeric",
                month: "long",
              })}
              onClick={() => onChange(date)}
            >
              <span>{day}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
