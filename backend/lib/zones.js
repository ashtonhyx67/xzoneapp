// The zones the app is split into.
//
// A zone is a real-world grouping of leaders and the people they look after:
// each one has its own members, its own structure, and its own reminders. It is
// deliberately a separate idea from the account groups in lib/groups.js, which
// decide what someone is allowed to do, and from the visual blocks inside a
// structure, which are also called groups.
//
// Add or rename a zone here and both the API and the app follow.

const ZONES = [
  { key: "X3A", label: "X3A" },
  { key: "X3B", label: "X3B" },
  { key: "X2A", label: "X2A" },
  { key: "X2B", label: "X2B" },
  { key: "X1", label: "X1" },
];

const ZONE_KEYS = ZONES.map((zone) => zone.key);

const BY_KEY = new Map(ZONES.map((zone) => [zone.key.toLowerCase(), zone]));

// Where records that predate zones land, and the zone a first structure is
// created under. The app began as a single zone — this one.
const DEFAULT_ZONE = "X3A";

// Accepts any casing and hands back the canonical key, or "" for anything that
// is not a zone. A person with "" is unassigned rather than invalid: they are
// visible to everyone and editable by anyone who can edit the database, which
// is what makes it possible to sort a new import out.
function normalizeZone(value) {
  return BY_KEY.get(String(value ?? "").trim().toLowerCase())?.key ?? "";
}

function isZone(value) {
  return normalizeZone(value) !== "";
}

// The zones an account may write to. Anyone who manages accounts manages every
// zone; everyone else is limited to the zones they have been put in. Reading is
// not restricted — a leader can look into another zone, just not change it.
function editableZones(access) {
  if (!access) return [];
  if (access.permissions.includes("manageAccounts")) return [...ZONE_KEYS];
  return access.zones ?? [];
}

function canEditZone(access, zone) {
  const key = normalizeZone(zone);
  // An unassigned record belongs to no zone, so anyone who can edit the
  // database can file it into one.
  if (key === "") return true;
  return editableZones(access).includes(key);
}

module.exports = {
  ZONES,
  ZONE_KEYS,
  DEFAULT_ZONE,
  normalizeZone,
  isZone,
  editableZones,
  canEditZone,
};
