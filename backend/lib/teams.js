// How the zone is divided up.
//
//   Zone            the whole thing — every CG, every team, everyone
//     CG            a cell group: X3, X2, X1
//       Team        X3A, X3B / X2A, X2B / X1
//
// A team is the finest grain and the one that owns data: a person belongs to a
// team, a structure belongs to a team, and a leader is assigned the teams they
// run. A CG is a roll-up of its teams — useful for looking at a whole cell
// group at once, never a place records are stored.
//
// This is a separate idea from the account groups in lib/groups.js, which say
// what someone is allowed to do, and from the blocks inside a structure, which
// are also called groups.

const CGS = [
  { key: "X3", label: "X3", teams: ["X3A", "X3B"] },
  { key: "X2", label: "X2", teams: ["X2A", "X2B"] },
  { key: "X1", label: "X1", teams: ["X1"] },
];

const TEAMS = CGS.flatMap((cg) =>
  cg.teams.map((key) => ({ key, label: key, cg: cg.key }))
);

const TEAM_KEYS = TEAMS.map((team) => team.key);

const BY_KEY = new Map(TEAMS.map((team) => [team.key.toLowerCase(), team]));
const CG_BY_KEY = new Map(CGS.map((cg) => [cg.key.toLowerCase(), cg]));

// Where records that predate teams land. The app began as this one.
const DEFAULT_TEAM = "X3A";

// Accepts any casing and hands back the canonical key, or "" for anything that
// is not a team. A person with "" is unassigned rather than invalid: they are
// visible to everyone and editable by anyone who can edit the database, which
// is what makes it possible to sort a new import out.
function normalizeTeam(value) {
  return BY_KEY.get(String(value ?? "").trim().toLowerCase())?.key ?? "";
}

function isTeam(value) {
  return normalizeTeam(value) !== "";
}

// The CG a team sits in, or "" if it is not a team.
function cgOf(team) {
  return BY_KEY.get(String(team ?? "").trim().toLowerCase())?.cg ?? "";
}

// Every team in a CG. Assigning someone a whole CG means assigning its teams,
// so there is only ever one kind of thing stored against an account.
function teamsInCg(cg) {
  return CG_BY_KEY.get(String(cg ?? "").trim().toLowerCase())?.teams ?? [];
}

// The teams an account may write to. Anyone who manages accounts manages the
// whole zone; everyone else is limited to the teams they have been put in.
// Reading is not restricted — a leader can look into another team, just not
// change it.
function editableTeams(access) {
  if (!access) return [];
  if (access.permissions.includes("manageAccounts")) return [...TEAM_KEYS];
  return access.teams ?? [];
}

function canEditTeam(access, team) {
  const key = normalizeTeam(team);
  // An unassigned record belongs to no team, so anyone who can edit the
  // database can file it into one.
  if (key === "") return true;
  return editableTeams(access).includes(key);
}

module.exports = {
  CGS,
  TEAMS,
  TEAM_KEYS,
  DEFAULT_TEAM,
  normalizeTeam,
  isTeam,
  cgOf,
  teamsInCg,
  editableTeams,
  canEditTeam,
};
