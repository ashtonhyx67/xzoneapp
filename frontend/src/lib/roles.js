// The standard roles, and the colour each one wears.
//
// This list is the single place roles are defined. Add, rename, reorder, or
// recolour here and the whole app follows: the dropdown in the database grid,
// the coloured pill on a person's card, and the rows of the structure.
//
// Every role here is a leadership role, and the colour is the rank, not a
// per-row choice — the four leader tiers each wear one colour, so the structure
// can be read at a glance without anyone having to keep the colouring
// consistent by hand.
//
// `tint` must be one of the names in TINTS below.

export const ROLES = [
  // Zone
  { value: "ZL", label: "ZL", tint: "green" },
  { value: "ZM", label: "ZM", tint: "green" },
  { value: "SCGL", label: "SCGL", tint: "green" },

  // Group leaders
  { value: "CGL", label: "CGL", tint: "red" },
  { value: "OGL", label: "OGL", tint: "red" },
  { value: "MGL", label: "MGL", tint: "red" },

  // Prospective group leaders
  { value: "PCGL", label: "PCGL", tint: "yellow" },
  { value: "POGL", label: "POGL", tint: "yellow" },
  { value: "PMGL", label: "PMGL", tint: "yellow" },

  // Team leaders
  { value: "TL", label: "TL", tint: "purple" },
  { value: "OTL", label: "OTL", tint: "purple" },
  { value: "ML", label: "ML", tint: "purple" },

  // Prospective team leaders
  { value: "PTL", label: "PTL", tint: "blue" },
  { value: "POTL", label: "POTL", tint: "blue" },
  { value: "PMTL", label: "PMTL", tint: "blue" },
];

// The colours a role can wear. Each one has a matching `.tint-<name>` rule in
// the stylesheet, and a `.roster-tint-<name>` rule for a whole structure row.
export const TINTS = ["green", "red", "yellow", "purple", "blue"];

const BY_VALUE = new Map(ROLES.map((role) => [role.value.toLowerCase(), role]));

export function findRole(value) {
  return BY_VALUE.get(String(value ?? "").trim().toLowerCase()) || null;
}

// A role that isn't on the standard list still gets shown — it just wears the
// neutral colour, which makes it easy to spot and tidy up. Roles retired from
// the list keep working this way rather than vanishing off records.
export function roleTint(value) {
  return findRole(value)?.tint || "";
}

export function roleClass(value) {
  const tint = roleTint(value);
  return `role-pill${tint ? ` tint-${tint}` : " tint-none"}`;
}

export function isStandardRole(value) {
  return Boolean(findRole(value));
}
