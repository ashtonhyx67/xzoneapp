// The standard roles, and the colour each one wears.
//
// This list is the single place roles are defined. Add, rename, reorder, or
// recolour here and the whole app follows: the dropdown in the database grid,
// the coloured pill on a person's card, and the rows of the structure.
//
// Every role has its own colour. They are grouped by rank — zone greens, group
// leaders warm, prospective ambers, team leaders violets, prospective blues,
// and the member roles their own set — so a tier still reads at a glance while
// no two roles look alike.
//
// The colour travels as a CSS custom property rather than a class per role, so
// this file is genuinely the only place they are written down; there is no
// stylesheet to keep in step with it.

export const ROLES = [
  // Zone — greens
  { value: "ZL", label: "ZL", color: "#a8dfb4" },
  { value: "ZM", label: "ZM", color: "#c3e9c9" },
  { value: "SCGL", label: "SCGL", color: "#a9e0cf" },

  // Group leaders — warm
  { value: "CGL", label: "CGL", color: "#f9c2be" },
  { value: "OGL", label: "OGL", color: "#fbcfb5" },
  { value: "MGL", label: "MGL", color: "#f6c3ce" },

  // Prospective group leaders — ambers
  { value: "PCGL", label: "PCGL", color: "#fbdda6" },
  { value: "POGL", label: "POGL", color: "#f7e9a8" },
  { value: "PMGL", label: "PMGL", color: "#e5e4a9" },

  // Team leaders — violets
  { value: "TL", label: "TL", color: "#d5c8ee" },
  { value: "OTL", label: "OTL", color: "#e8c9ed" },
  { value: "ML", label: "ML", color: "#c7c4f0" },

  // Prospective team leaders — blues
  { value: "PTL", label: "PTL", color: "#bcd9f6" },
  { value: "POTL", label: "POTL", color: "#b1e4f2" },
  { value: "PMTL", label: "PMTL", color: "#c6d3f4" },

  // Everyone else. The same column — a leader keeps their own role, and is only
  // *counted* under R when a register is tallied.
  { value: "R", label: "R", color: "#dbe0e6" },
  { value: "GI", label: "GI", color: "#c3e3da" },
  { value: "I", label: "I", color: "#ecdcc3" },
  { value: "G", label: "G", color: "#e0d6cc" },
  { value: "NF", label: "NF", color: "#f2cfe0" },
];

// The roles that make someone a leader, as opposed to a member. A leader is
// tallied under R on a register whatever their rank.
export const LEADER_ROLES = ROLES.slice(0, 15).map((role) => role.value);

// Where a role sorts: leaders first in rank order, then R, GI, I, G, NF, then
// anything unrecognised.
const ROLE_ORDER = ROLES.map((role) => role.value);

export function roleRank(value) {
  const index = ROLE_ORDER.indexOf(String(value ?? "").trim().toUpperCase());
  return index === -1 ? ROLE_ORDER.length : index;
}

const BY_VALUE = new Map(ROLES.map((role) => [role.value.toLowerCase(), role]));

export function findRole(value) {
  return BY_VALUE.get(String(value ?? "").trim().toLowerCase()) || null;
}

// A role that isn't on the standard list still gets shown — it just wears no
// colour, which makes it easy to spot and tidy up. Roles retired from the list
// keep working this way rather than vanishing off records.
export function roleColor(value) {
  return findRole(value)?.color || "";
}

// Handed to `style`. Everything that shows a role reads `--role-tint`, so the
// colour comes from this file rather than from a class the stylesheet has to
// define for every role.
export function roleStyle(value) {
  const color = roleColor(value);
  return color ? { "--role-tint": color } : undefined;
}

export function roleClass(value) {
  return `role-pill${roleColor(value) ? "" : " tint-none"}`;
}

export function isStandardRole(value) {
  return Boolean(findRole(value));
}
