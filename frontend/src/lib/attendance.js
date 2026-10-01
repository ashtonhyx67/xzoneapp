import { LEADER_ROLES } from "./roles.js";

// What a week's register is made of. Mirrors backend/lib/attendance.js — the
// server is the authority and /api/attendance/legend hands back the live list,
// but having it here means the page renders before that request lands.
//
// A person gets one status for the week, not a tick per service: that is how
// the sheet has always been written, and it is why a total counts people.

// The statuses every register has. The server sends the live list — these
// built-ins plus anything added — with each register, so this is only what the
// page shows before that lands.
export const BUILTIN_STATUSES = [
  { key: "S1", emoji: "1️⃣", label: "Service 1", counts: true, builtin: true },
  { key: "S2", emoji: "2️⃣", label: "Service 2", counts: true, builtin: true },
  { key: "S3", emoji: "3️⃣", label: "Service 3", counts: true, builtin: true },
  { key: "REPLAY", emoji: "💻", label: "Service Replay", counts: true, builtin: true },
  { key: "HANGOUT", emoji: "🍁", label: "Hangout", counts: false, builtin: true },
];

// Present once, however many statuses that took: two services is still one
// person in the total.
export function isPresent(statuses, allowed) {
  const counting = new Set(allowed.filter((s) => s.counts).map((s) => s.key));
  return (statuses ?? []).some((key) => counting.has(key));
}

export const CATEGORIES = [
  { key: "R", label: "R", description: "Regulars, including every leader" },
  { key: "GI", label: "GI", description: "Growing in faith" },
  { key: "I", label: "I", description: "Integrating" },
  { key: "G", label: "G", description: "Guests" },
  { key: "NF", label: "NF", description: "New friends" },
];

export const CATEGORY_KEYS = CATEGORIES.map((category) => category.key);

// Which group a role is listed under. A leadership role is tallied as R; the
// member roles are their own group. Mirrors categoryOf in
// backend/lib/attendance.js, so linking a name here lands it where the server
// will put it too.
export function categoryOf(role) {
  const key = String(role ?? "").trim().toUpperCase();
  if (LEADER_ROLES.includes(key)) return "R";
  return CATEGORY_KEYS.includes(key) ? key : "";
}

// ── Exporting a register to Telegram ──────────────────────────────────────
//
// The register is read on a phone, in a chat, by people who never open this
// app. That post has had the same shape for years — a legend, a total, then
// each group with its count and its people — so this reproduces it rather
// than inventing a tidier one. Everything comes from what is on the screen:
// the statuses the register offers and the marks actually made.

// How a team is written in the chat: X3A is posted as XIIIA. The number is the
// CG, so only that part is in roman.
const ROMAN = { 1: "I", 2: "II", 3: "III" };

export function telegramTeam(team) {
  const match = /^X(\d)([A-Z]?)$/.exec(String(team ?? "").trim().toUpperCase());
  if (!match) return String(team ?? "");
  return `X${ROMAN[match[1]] ?? match[1]}${match[2]}`;
}

// The Saturday and Sunday the week covers — the weekend being reported, not
// the Monday the ISO week starts on. "26/27 Sept", or "30 Sept/1 Oct" when the
// weekend straddles a month.
export function weekendLabel({ year, week }) {
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const monday = new Date(jan4);
  monday.setUTCDate(jan4.getUTCDate() - ((jan4.getUTCDay() || 7) - 1) + (week - 1) * 7);

  const saturday = new Date(monday);
  saturday.setUTCDate(monday.getUTCDate() + 5);
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);

  const month = (date) =>
    date.toLocaleDateString("en-GB", { month: "short", timeZone: "UTC" });

  return saturday.getUTCMonth() === sunday.getUTCMonth()
    ? `${saturday.getUTCDate()}/${sunday.getUTCDate()} ${month(sunday)}`
    : `${saturday.getUTCDate()} ${month(saturday)}/${sunday.getUTCDate()} ${month(sunday)}`;
}

// What the heading says before anyone edits it. The term and its week — "BF
// Week 1" — is not something the app knows, so the ISO week stands in and the
// box it lands in can be typed over.
export function defaultTitle({ team, year, week }) {
  return `${telegramTeam(team)} ${weekendLabel({ year, week })} Week ${week}`;
}

// The post itself. `people` are the register's rows in the order they are
// shown; `statuses` is what the register offers, so a status added for one
// week appears in the legend of that week and nowhere else.
export function toTelegram({ title, people, statuses }) {
  const lines = [title, ""];

  // The legend, split the way the chat splits it: what puts someone in the
  // total, then a gap, then what is noted but not counted.
  const legend = (list) =>
    list.filter((s) => s.emoji).map((s) => `${s.emoji}: ${s.label}`);

  const counted = legend(statuses.filter((s) => s.counts));
  const uncounted = legend(statuses.filter((s) => !s.counts));
  if (counted.length > 0) lines.push(...counted);
  if (uncounted.length > 0) lines.push("", "", ...uncounted);

  const present = (person) => isPresent(person.statuses, statuses);
  lines.push("", `Total Attendance: ${people.filter(present).length}`);

  // Every group is posted even when nobody came: "GI: 0" is information, and a
  // group quietly missing from the post reads as an oversight.
  const blocks = CATEGORIES.map((category) => ({
    label: category.label,
    people: people.filter((person) => person.category === category.key),
  }));

  // Anyone whose group is not set yet still has to appear — leaving them out
  // would make the post disagree with the register it came from.
  const ungrouped = people.filter((person) => !CATEGORY_KEYS.includes(person.category));
  if (ungrouped.length > 0) blocks.push({ label: "?", people: ungrouped });

  const marks = (person) =>
    statuses
      .filter((status) => person.statuses.includes(status.key))
      .map((status) => status.emoji || status.label)
      .join("");

  for (const block of blocks) {
    lines.push("", `${block.label}: ${block.people.filter(present).length}`);
    // Absent too, with nothing after their name. The post is the team as well
    // as the turnout, which is how a gap gets noticed.
    for (const person of block.people) {
      const mark = marks(person);
      lines.push(mark ? `${person.name} ${mark}` : person.name);
    }
  }

  return lines.join("\n").trim() + "\n";
}
