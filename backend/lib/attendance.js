// What a week's register is made of.
//
// A person can carry more than one status in a week — someone at Service 1 who
// also watched the replay wears both — so a status is a set, not a single
// choice. The total still counts people: two services is still one person.

// The statuses every register has. Everything here except Hangout is a service,
// so `counts` is simply whether the person was at one. Serving and Good Grounds
// are not marked, and someone overseas watches the replay, so they are marked
// Service Replay like anyone else who did. Anything else a week needs is added
// alongside these and applies everywhere, because one register is read next to
// another.
const BUILTIN_STATUSES = [
  { key: "S1", emoji: "1⃣", label: "Service 1", counts: true, builtin: true },
  { key: "S2", emoji: "2⃣", label: "Service 2", counts: true, builtin: true },
  { key: "S3", emoji: "3⃣", label: "Service 3", counts: true, builtin: true },
  { key: "REPLAY", emoji: "💻", label: "Service Replay", counts: true, builtin: true },
  { key: "HANGOUT", emoji: "🍁", label: "Hangout", counts: false, builtin: true },
];

const BUILTIN_KEYS = new Set(BUILTIN_STATUSES.map((status) => status.key));

const { MEMBER_ROLES, isLeaderRole, normalizeRole } = require("./roles");

// The groups a register is broken into, in the order the sheet lists them.
// They are roles like any other — the same column a leader's rank lives in.
const CATEGORIES = [
  { key: "R", label: "R", description: "Regulars, including every leader" },
  { key: "GI", label: "GI", description: "Growing in faith" },
  { key: "I", label: "I", description: "Integrating" },
  { key: "G", label: "G", description: "Guests" },
  { key: "NF", label: "NF", description: "New friends" },
];

const CATEGORY_KEYS = MEMBER_ROLES;

// Which group a person is listed under on a register. A leadership role is
// tallied as R — the leader keeps their own role on their record, and only the
// register treats them as a Regular.
function categoryOf(person) {
  const role = normalizeRole(person?.role);
  if (isLeaderRole(role)) return "R";
  return CATEGORY_KEYS.includes(role) ? role : "";
}

// A status added by hand needs a key that cannot collide with a built-in one or
// upset the comma-separated storage below.
function slugify(label) {
  return String(label ?? "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 32);
}

// Statuses live in one text column as a comma-separated list. A register is
// always written whole, so this keeps a person's marks on the person's row
// rather than in a join table torn down and rebuilt on every save.
function parseStatuses(value) {
  return String(value ?? "")
    .split(",")
    .map((key) => key.trim().toUpperCase())
    .filter(Boolean);
}

// Only keys the register actually offers survive, deduplicated and returned in
// the offered order, so storage can never hold a status nothing can display.
function cleanStatuses(value, allowed) {
  const asked = new Set(
    Array.isArray(value)
      ? value.map((key) => String(key).trim().toUpperCase())
      : parseStatuses(value)
  );
  return allowed.map((status) => status.key).filter((key) => asked.has(key));
}

const serializeStatuses = (keys) => keys.join(",");

// Present once, however many statuses that took.
function isPresent(statuses, allowed) {
  const counting = new Set(
    allowed.filter((status) => status.counts).map((status) => status.key)
  );
  const keys = Array.isArray(statuses) ? statuses : parseStatuses(statuses);
  return keys.some((key) => counting.has(key));
}

module.exports = {
  BUILTIN_STATUSES,
  BUILTIN_KEYS,
  CATEGORIES,
  CATEGORY_KEYS,
  categoryOf,
  slugify,
  parseStatuses,
  cleanStatuses,
  serializeStatuses,
  isPresent,
};
