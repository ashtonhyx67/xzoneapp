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
  { key: "S1", emoji: "1⃣", label: "Service 1", counts: true, builtin: true },
  { key: "S2", emoji: "2⃣", label: "Service 2", counts: true, builtin: true },
  { key: "S3", emoji: "3⃣", label: "Service 3", counts: true, builtin: true },
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
