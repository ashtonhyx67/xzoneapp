// What a week's register is made of.
//
// A person gets one status for the week, not a tick per service — that is how
// the sheet has always been written, and it is why the totals are a count of
// people rather than a count of attendances.

// The statuses, in the order they appear in the legend. `counts` decides
// whether someone wearing it is in the Total Attendance line: being at a
// service counts, and so does serving or being at Good Grounds, because the
// person was there. Hangout and Overseas are records of where someone was
// instead, so they do not.
const STATUSES = [
  { key: "S1", emoji: "1⃣", label: "Service 1", counts: true },
  { key: "S2", emoji: "2⃣", label: "Service 2", counts: true },
  { key: "S3", emoji: "3⃣", label: "Service 3", counts: true },
  { key: "REPLAY", emoji: "💻", label: "Service Replay", counts: true },
  { key: "SERVING", emoji: "🌸", label: "Serving", counts: true },
  { key: "GROUNDS", emoji: "🌺", label: "Good Grounds", counts: true },
  { key: "HANGOUT", emoji: "🍁", label: "Hangout", counts: false },
  { key: "OVERSEAS", emoji: "✈️", label: "Overseas", counts: false },
];

const STATUS_BY_KEY = new Map(STATUSES.map((status) => [status.key, status]));

// The groups a register is broken into, in the order the sheet lists them.
// These are not the leadership roles — a leader has one of those *and* sits
// under R here.
const CATEGORIES = [
  { key: "R", label: "R", description: "Regulars, including every leader" },
  { key: "GI", label: "GI", description: "Growing in faith" },
  { key: "I", label: "I", description: "Integrating" },
  { key: "G", label: "G", description: "Guests" },
  { key: "NF", label: "NF", description: "New friends" },
];

const CATEGORY_KEYS = CATEGORIES.map((category) => category.key);

// Every leadership role. A leader is a Regular for the purposes of a register,
// whatever their rank, so their category never has to be set by hand. Kept in
// step with frontend/src/lib/roles.js.
const LEADER_ROLES = new Set([
  "ZL", "ZM", "SCGL",
  "CGL", "OGL", "MGL",
  "PCGL", "POGL", "PMGL",
  "TL", "OTL", "ML",
  "PTL", "POTL", "PMTL",
]);

const isLeaderRole = (role) => LEADER_ROLES.has(String(role ?? "").trim().toUpperCase());

// Which group a person is listed under. A leadership role wins: it means R
// regardless of what the category column happens to say, so promoting someone
// moves them up the sheet without a second edit.
function categoryOf(person) {
  if (isLeaderRole(person?.role)) return "R";
  return normalizeCategory(person?.category);
}

function normalizeStatus(value) {
  const key = String(value ?? "").trim().toUpperCase();
  return STATUS_BY_KEY.has(key) ? key : "";
}

function normalizeCategory(value) {
  const key = String(value ?? "").trim().toUpperCase();
  return CATEGORY_KEYS.includes(key) ? key : "";
}

// Someone wearing a status that counts was there. No status means absent.
function isPresent(status) {
  return STATUS_BY_KEY.get(normalizeStatus(status))?.counts ?? false;
}

module.exports = {
  STATUSES,
  CATEGORIES,
  CATEGORY_KEYS,
  LEADER_ROLES,
  isLeaderRole,
  categoryOf,
  normalizeStatus,
  normalizeCategory,
  isPresent,
};
