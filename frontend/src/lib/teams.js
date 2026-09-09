// How the zone is divided up. Kept in step with backend/lib/teams.js — the
// server is the authority, and /api/teams hands back the live list, but having
// it here too means the grid and the pickers can render before that lands.
//
//   Zone            the whole thing — every CG, every team, everyone
//     CG            a cell group: X3, X2, X1
//       Team        X3A, X3B / X2A, X2B / X1
//
// A team is the finest grain and the one that owns data. A CG is a roll-up of
// its teams, never a place records are stored.
//
// Separate idea from the account groups in lib/permissions.js, which say what
// someone may do, and from the blocks inside a structure, also called groups.

export const CGS = [
  { key: "X3", label: "X3", teams: ["X3A", "X3B"] },
  { key: "X2", label: "X2", teams: ["X2A", "X2B"] },
  { key: "X1", label: "X1", teams: ["X1"] },
];

// The CGs that do a seating arrangement. X1 does not, so it is not offered.
export const SEATING_CGS = CGS.filter((cg) => cg.key !== "X1");

export const TEAMS = CGS.flatMap((cg) => cg.teams.map((key) => ({ key, cg: cg.key })));

export const TEAM_KEYS = TEAMS.map((team) => team.key);

const CG_BY_TEAM = new Map(TEAMS.map((team) => [team.key, team.cg]));

// A person who has not been filed into a team yet.
export const cgOf = (team) => CG_BY_TEAM.get(team) ?? "";

export const teamLabel = (team) => team || "Unassigned";
