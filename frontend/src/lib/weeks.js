// Weeks, the way the rest of the app counts them. Mirrors backend/lib/weeks.js.
//
// Attendance and seating are recorded once a week, and the week they are filed
// under is the ISO week the dashboard banner shows — so the number a leader
// reads at the top of the app is the number their records live under.

// ISO week: weeks run Monday to Sunday, and week 1 holds the first Thursday of
// the year. The year is returned alongside because at the turn of the year the
// two disagree with the calendar year.
export function isoWeek(date = new Date()) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return {
    year: d.getUTCFullYear(),
    week: Math.ceil(((d - yearStart) / 86400000 + 1) / 7),
  };
}

export function weeksInYear(year) {
  const jan1 = new Date(Date.UTC(year, 0, 1)).getUTCDay();
  const isLeap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  return jan1 === 4 || (isLeap && jan1 === 3) ? 53 : 52;
}

// The week before or after, rolling over the year end correctly.
export function stepWeek({ year, week }, delta) {
  let nextYear = year;
  let nextWeek = week + delta;

  if (nextWeek < 1) {
    nextYear -= 1;
    nextWeek = weeksInYear(nextYear);
  } else if (nextWeek > weeksInYear(year)) {
    nextYear += 1;
    nextWeek = 1;
  }

  return { year: nextYear, week: nextWeek };
}

export const sameWeek = (a, b) => a.year === b.year && a.week === b.week;
