// Putting an event in people's calendars.
//
// There is no mail server here and no Google sign-in, and most members have a
// Telegram handle rather than an email address on file — so an invite that
// lands in an inbox is not something this app can send. What it can do is
// build the event once and hand back two ways to pass it on: a Google Calendar
// link to paste into the group chat, and a .ics file for anyone not on Google.
// Both carry the same event, and whoever opens one saves it to their own
// calendar, which is the part that actually matters.

// Calendar times are written in UTC with a trailing Z. A datetime input gives
// back wall-clock time in the browser's own zone, which `new Date` reads
// correctly, so the conversion is just formatting.
function utcStamp(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return (
    String(date.getUTCFullYear()) +
    pad(date.getUTCMonth() + 1) +
    pad(date.getUTCDate()) +
    "T" +
    pad(date.getUTCHours()) +
    pad(date.getUTCMinutes()) +
    "00Z"
  );
}

// An all-day event is written as a date with no time, and the end is the day
// *after* the last one — the spec treats it as exclusive, which is why a
// one-day event written without this shows up as finishing the day before.
function dateStamp(date, offsetDays = 0) {
  const pad = (n) => String(n).padStart(2, "0");
  const d = new Date(date);
  d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
}

// What the form holds, turned into the two stamps every output needs.
function span({ date, start, end, allDay }) {
  if (allDay) {
    const day = new Date(`${date}T00:00`);
    return { from: dateStamp(day), to: dateStamp(day, 1), allDay: true };
  }
  const from = new Date(`${date}T${start}`);
  const to = new Date(`${date}T${end}`);
  // An end before the start is an event running past midnight, not a mistake.
  if (to <= from) to.setDate(to.getDate() + 1);
  return { from: utcStamp(from), to: utcStamp(to), allDay: false };
}

export function isValidEvent(event) {
  return Boolean(
    event.title.trim() && event.date && (event.allDay || (event.start && event.end))
  );
}

// The link. Google reads this straight into its "create event" screen with
// everything filled in; the person saving it only has to confirm.
export function googleCalendarUrl(event) {
  const { from, to } = span(event);
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: event.title.trim(),
    dates: `${from}/${to}`,
  });
  if (event.details?.trim()) params.set("details", event.details.trim());
  if (event.location?.trim()) params.set("location", event.location.trim());
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

// A comma, a semicolon and a backslash all mean something in this format, and
// a description with a line break in it has to say so rather than contain one.
function escapeText(value) {
  return String(value ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

// The format wants lines of at most 75 octets, continued by starting the next
// one with a space. Counted in octets rather than characters, because an emoji
// in a title is four of them and a line split through the middle of one is not
// valid UTF-8.
function fold(line) {
  const encoder = new TextEncoder();
  if (encoder.encode(line).length <= 75) return line;

  const out = [];
  let current = "";
  let width = 0;
  for (const char of line) {
    const size = encoder.encode(char).length;
    // 74 on continuation lines: the leading space counts towards the 75.
    if (width + size > (out.length === 0 ? 75 : 74)) {
      out.push(current);
      current = "";
      width = 0;
    }
    current += char;
    width += size;
  }
  if (current) out.push(current);
  return out.join("\r\n ");
}

export function icsFile(event) {
  const { from, to, allDay } = span(event);
  const stamp = utcStamp(new Date());
  // Unique per event, so a calendar re-importing the file updates the event it
  // already has rather than adding a second copy of it.
  const uid = `${stamp}-${Math.random().toString(36).slice(2, 10)}@xzone.app`;

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//X Zone App//Events//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${stamp}`,
    allDay ? `DTSTART;VALUE=DATE:${from}` : `DTSTART:${from}`,
    allDay ? `DTEND;VALUE=DATE:${to}` : `DTEND:${to}`,
    `SUMMARY:${escapeText(event.title.trim())}`,
  ];
  if (event.details?.trim()) lines.push(`DESCRIPTION:${escapeText(event.details.trim())}`);
  if (event.location?.trim()) lines.push(`LOCATION:${escapeText(event.location.trim())}`);
  lines.push("END:VEVENT", "END:VCALENDAR");

  // CRLF throughout, and one at the end: a file finishing without it is
  // rejected by some readers.
  return lines.map(fold).join("\r\n") + "\r\n";
}

// A filename the person can find again in their downloads.
export function icsFilename(event) {
  const slug = event.title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return `${slug || "event"}.ics`;
}

// How the event reads to a person — the line that goes in the chat above the
// link, so people know what they are tapping before they tap it.
export function eventSummary(event) {
  if (!event.date) return "";
  const day = new Date(`${event.date}T${event.allDay ? "00:00" : event.start || "00:00"}`);
  if (Number.isNaN(day.getTime())) return "";

  const when = day.toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
  if (event.allDay) return `${when}, all day`;
  if (!event.start || !event.end) return when;

  // "4pm" rather than "4:00 pm": the minutes only earn their place when there
  // are some.
  const time = (value) => {
    const at = new Date(`${event.date}T${value}`);
    const hour = at.getHours();
    const minute = at.getMinutes();
    const suffix = hour < 12 ? "am" : "pm";
    const twelve = hour % 12 === 0 ? 12 : hour % 12;
    return minute === 0
      ? `${twelve}${suffix}`
      : `${twelve}.${String(minute).padStart(2, "0")}${suffix}`;
  };
  return `${when}, ${time(event.start)}–${time(event.end)}`;
}
