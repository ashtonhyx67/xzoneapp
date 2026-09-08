// The standard roles, and the colour each one wears.
//
// This list is the single place roles are defined. Add, rename, reorder, or
// recolour here and the whole app follows: the dropdown in the database grid,
// the coloured pill on a person's card, and anywhere else a role is shown.
//
// `tint` must be one of the names in TINTS below.

export const ROLES = [
  { value: "CGL", label: "CGL", tint: "rose" },
  { value: "PCGL", label: "PCGL", tint: "peach" },
  { value: "PTL", label: "PTL", tint: "cyan" },
  { value: "TL", label: "TL", tint: "yellow" },
  { value: "OTL", label: "OTL", tint: "lavender" },
  { value: "GI", label: "GI", tint: "mint" },
  { value: "G", label: "G", tint: "sky" },
  { value: "I", label: "I", tint: "sand" },
  { value: "R", label: "R", tint: "clay" },
];

// The colours a role can be given. Each one has a matching `.tint-<name>` rule
// in the stylesheet.
export const TINTS = [
  "rose",
  "peach",
  "cyan",
  "yellow",
  "lavender",
  "mint",
  "sky",
  "sand",
  "clay",
];

const BY_VALUE = new Map(ROLES.map((role) => [role.value.toLowerCase(), role]));

export function findRole(value) {
  return BY_VALUE.get(String(value ?? "").trim().toLowerCase()) || null;
}

// A role that isn't on the standard list still gets shown — it just wears the
// neutral colour, which makes it easy to spot and tidy up.
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
