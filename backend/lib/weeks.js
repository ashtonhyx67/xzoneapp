// Weeks, the way the rest of the app counts them.
//
// Attendance and seating are both recorded once a week, so a week needs a name
// that two people typing on two devices will always agree on. ISO week does
// that: weeks run Monday to Sunday, and week 1 is the one holding the first
// Thursday of the year. It is also what the dashboard banner shows, so the
// number a leader sees there is the number their records are filed under.

// The zone the app lives in. A server runs on UTC, which for eight months of
// the year disagrees with Singapore about what day it is between midnight and
// 8am — long enough to decide a register belongs to last week. Both ends work
// in this zone so they always name the same week.
const ZONE = "Asia/Singapore";

// The calendar date in Singapore, whatever the machine's own clock is set to.
function localParts(date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  const get = (type) => Number(parts.find((part) => part.type === type).value);
  return { year: get("year"), month: get("month"), day: get("day") };
}

// The ISO year and week a date falls in. They are returned together because at
// the turn of the year they disagree with the calendar year — 31 Dec 2026 is
// week 53 of ISO year 2026, but 1 Jan 2027 is week 53 of 2026 too, and filing
// those under different years would split one week into two.
function isoWeek(date = new Date()) {
  const { year, month, day } = localParts(date);
  const d = new Date(Date.UTC(year, month - 1, day));
  // Shift to the Thursday of this week, then count weeks from 1 January.
  d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return {
    year: d.getUTCFullYear(),
    week: Math.ceil(((d - yearStart) / 86400000 + 1) / 7),
  };
}

// How many ISO weeks a year has: 52, or 53 when it starts on a Thursday or is
// a leap year starting on a Wednesday. Needed to step back past week 1.
function weeksInYear(year) {
  const jan1 = new Date(Date.UTC(year, 0, 1)).getUTCDay();
  const isLeap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  return jan1 === 4 || (isLeap && jan1 === 3) ? 53 : 52;
}

// A week the caller asked for, or this one. Anything out of range falls back to
// the current week rather than being stored as a week that cannot exist.
function resolveWeek(rawYear, rawWeek) {
  const year = Number(rawYear);
  const week = Number(rawWeek);

  if (
    Number.isInteger(year) &&
    Number.isInteger(week) &&
    year >= 2000 &&
    year <= 2100 &&
    week >= 1 &&
    week <= weeksInYear(year)
  ) {
    return { year, week };
  }

  return isoWeek();
}

// The week before or after, rolling over the year end correctly.
function stepWeek({ year, week }, delta) {
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

module.exports = { ZONE, isoWeek, weeksInYear, resolveWeek, stepWeek };
