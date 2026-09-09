// What a week's register is made of. Mirrors backend/lib/attendance.js — the
// server is the authority and /api/attendance/legend hands back the live list,
// but having it here means the page renders before that request lands.
//
// A person gets one status for the week, not a tick per service: that is how
// the sheet has always been written, and it is why a total counts people.

// Everything here except Hangout is a service, so `counts` is simply whether
// the person was at one. Serving and Good Grounds are not marked at all, and
// someone overseas watches the replay, so they are marked Service Replay like
// anyone else who did.
export const STATUSES = [
  { key: "S1", emoji: "1⃣", label: "Service 1", counts: true },
  { key: "S2", emoji: "2⃣", label: "Service 2", counts: true },
  { key: "S3", emoji: "3⃣", label: "Service 3", counts: true },
  { key: "REPLAY", emoji: "💻", label: "Service Replay", counts: true },
  { key: "HANGOUT", emoji: "🍁", label: "Hangout", counts: false },
];

export const STATUS_BY_KEY = new Map(STATUSES.map((status) => [status.key, status]));

// The groups a register is broken into, in the order the sheet lists them.
// Not the leadership roles — a leader has one of those *and* sits under R.
export const CATEGORIES = [
  { key: "R", label: "R", description: "Regulars, including every leader" },
  { key: "GI", label: "GI", description: "Growing in faith" },
  { key: "I", label: "I", description: "Integrating" },
  { key: "G", label: "G", description: "Guests" },
  { key: "NF", label: "NF", description: "New friends" },
];

export const CATEGORY_KEYS = CATEGORIES.map((category) => category.key);

export const isPresent = (status) => STATUS_BY_KEY.get(status)?.counts ?? false;

export const statusEmoji = (status) => STATUS_BY_KEY.get(status)?.emoji ?? "";
