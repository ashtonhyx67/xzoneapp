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

// ── Reading a register back in from Telegram ─────────────────────────────
//
// The reverse of toTelegram: a post in the same shape — legend, totals, then
// each group with its people and their marks — turned back into marks on the
// register on screen. Used when the week was taken in the chat first.

// Emoji arrive with and without the variation selector (🏘 / 🏘️), so both sides
// are compared without it.
const plain = (text) => String(text ?? "").replace(/[︎️]/g, "");

// Anything still looking like an emoji once the known marks are taken out:
// a keycap digit (1️⃣) or a pictograph (❌, 🙏).
const LEFTOVER_MARK = /\d⃣|\p{Extended_Pictographic}/gu;

const GROUP_HEADER = /^(R|GI|I|G|NF|\?)\s*:\s*\d*\s*$/i;

const nameKey = (name) => String(name ?? "").trim().replace(/\s+/g, " ").toLowerCase();

// Which register (team and week) a post's first line names: "XIIIA 14/15 Nov
// Week 46". Either part can be missing; nothing is assumed about the rest.
export function telegramHeading(text) {
  const first = String(text ?? "").split("\n").find((line) => line.trim()) ?? "";
  const team = /^\s*(X[IVX]+[A-Z]?)\b/i.exec(first)?.[1]?.toUpperCase() ?? null;
  const week = /\bweek\s*(\d{1,2})\b/i.exec(first)?.[1];
  return { team, week: week ? Number(week) : null };
}

// `people` are the register's rows (key, personId, name, statuses, category);
// `statuses` what it offers. Returns the rows to put on screen and what could
// not be used, so the page can say so instead of quietly dropping it.
export function fromTelegram({ text, people, statuses, newKey }) {
  const lines = String(text ?? "").split(/\r?\n/);

  // The legend names marks this register may not have yet ("🏘: Cave"), which
  // is what lets the page say which status to add.
  const legend = new Map();
  for (const line of lines) {
    const match = /^\s*(\S+)\s*:\s*(.+?)\s*$/.exec(line);
    if (match && LEFTOVER_MARK.test(plain(match[1]))) legend.set(plain(match[1]), match[2]);
    LEFTOVER_MARK.lastIndex = 0;
  }

  const known = statuses
    .filter((status) => status.emoji)
    .map((status) => ({ key: status.key, emoji: plain(status.emoji) }))
    // Longest first, so a two-character mark is not half-matched by a shorter one.
    .sort((a, b) => b.emoji.length - a.emoji.length);

  const entries = [];
  const unknownMarks = new Map();
  const notes = [];
  let group = null;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    const header = GROUP_HEADER.exec(line);
    if (header) {
      group = header[1].toUpperCase() === "?" ? "" : header[1].toUpperCase();
      continue;
    }
    // Everything above the first group is the heading, legend and totals.
    if (group === null) continue;

    let rest = plain(line);
    const note = /\(([^)]*)\)/.exec(rest);
    if (note) {
      notes.push(`${note[1].trim()}`);
      rest = rest.replace(/\([^)]*\)/g, " ");
    }

    const marks = [];
    for (const status of known) {
      if (rest.includes(status.emoji)) {
        marks.push(status.key);
        rest = rest.split(status.emoji).join(" ");
      }
    }

    const leftovers = rest.match(LEFTOVER_MARK) ?? [];
    rest = rest.replace(LEFTOVER_MARK, " ");
    const name = rest.replace(/\s+/g, " ").trim();
    if (!name) continue;

    for (const mark of leftovers) {
      if (!unknownMarks.has(mark)) unknownMarks.set(mark, []);
      unknownMarks.get(mark).push(name);
    }
    entries.push({ name, marks, group });
  }

  // Match each name to a row: exactly, or by the first name alone when only one
  // row has it ("Glynnis" for "Glynnis Tan"). A row is matched once.
  const rows = people.map((row) => ({ ...row, statuses: [] }));
  const taken = new Set();
  const added = [];

  const findRow = (name) => {
    const key = nameKey(name);
    const exact = rows.find((row) => !taken.has(row.key) && nameKey(row.name) === key);
    if (exact) return exact;
    const byStart = rows.filter(
      (row) => !taken.has(row.key) && nameKey(row.name).startsWith(`${key} `)
    );
    return byStart.length === 1 ? byStart[0] : null;
  };

  for (const entry of entries) {
    const row = findRow(entry.name);
    if (row) {
      taken.add(row.key);
      row.statuses = entry.marks;
      continue;
    }
    const fresh = {
      key: newKey(),
      personId: null,
      name: entry.name,
      statuses: entry.marks,
      category: entry.group,
    };
    rows.push(fresh);
    taken.add(fresh.key);
    added.push(entry.name);
  }

  // Order marks the way the register offers them, as ticking them would.
  const order = statuses.map((status) => status.key);
  for (const row of rows) {
    row.statuses = [...new Set(row.statuses)].sort(
      (a, b) => order.indexOf(a) - order.indexOf(b)
    );
  }

  const cleared = people.filter(
    (row) => !taken.has(row.key) && (row.statuses ?? []).length > 0
  ).length;

  return {
    people: rows,
    report: {
      read: entries.length,
      added,
      cleared,
      notes,
      unknownMarks: [...unknownMarks].map(([mark, names]) => ({
        mark,
        label: legend.get(mark) ?? "",
        names,
      })),
    },
  };
}
