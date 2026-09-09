// Every role a person can hold, in the order a list of people reads best.
//
// There is one role column, not two. The leadership roles come first, ranked,
// then the member roles — R, GI, I, G, NF. A leader keeps their own role here;
// they are only *counted* under R when a register is tallied, which is a fact
// about the register rather than about them.
//
// Kept in step with frontend/src/lib/roles.js.

const LEADER_ROLES = [
  "ZL", "ZM", "SCGL",
  "CGL", "OGL", "MGL",
  "PCGL", "POGL", "PMGL",
  "TL", "OTL", "ML",
  "PTL", "POTL", "PMTL",
];

// The groups a register is broken into. A leader is tallied under R.
const MEMBER_ROLES = ["R", "GI", "I", "G", "NF"];

const ROLE_ORDER = [...LEADER_ROLES, ...MEMBER_ROLES];

const LEADER_SET = new Set(LEADER_ROLES);
const MEMBER_SET = new Set(MEMBER_ROLES);

const normalizeRole = (role) => String(role ?? "").trim().toUpperCase();

const isLeaderRole = (role) => LEADER_SET.has(normalizeRole(role));
const isMemberRole = (role) => MEMBER_SET.has(normalizeRole(role));

// Where a role sorts. Anything unrecognised — an old code, or nothing at all —
// goes last rather than being scattered through the list.
function roleRank(role) {
  const index = ROLE_ORDER.indexOf(normalizeRole(role));
  return index === -1 ? ROLE_ORDER.length : index;
}

module.exports = {
  LEADER_ROLES,
  MEMBER_ROLES,
  ROLE_ORDER,
  normalizeRole,
  isLeaderRole,
  isMemberRole,
  roleRank,
};
