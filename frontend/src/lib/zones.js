// The zones the app is split into. Kept in step with backend/lib/zones.js —
// the server is the authority, and /api/zones hands back the live list, but
// having it here too means the grid and the pickers can render before that
// request lands.
//
// A zone is a real-world grouping of leaders and the people they look after.
// It is a different idea from the account groups in lib/permissions.js, which
// decide what someone may do, and from the blocks inside a structure, which are
// also called groups.

export const ZONES = ["X3A", "X3B", "X2A", "X2B", "X1"];

// A person who has not been filed into a zone yet.
export const UNASSIGNED = "";

export const zoneLabel = (zone) => (zone ? zone : "Unassigned");
