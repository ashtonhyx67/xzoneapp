// Who can do what.
//
// Two things decide it, and they are deliberately separate. An account has a
// *role* — Leader or Member — which says what kind of work they do. On top of
// that it may be marked *admin*, which is a job rather than a rank: running the
// accounts, and doing the seating arrangement.
//
// Keeping them apart is what makes "an admin who is only a member" possible,
// which is the point: someone can be trusted to sort the seating without being
// given the member database.
//
// This is the single place access is defined. Every protected route asks for a
// named permission, and the session payload carries the caller's list, so the
// API and the app both follow from here.

const PERMISSIONS = {
  // See the member directory and the scorecards, the registers, the structure,
  // and the dashboard reminders built from them.
  VIEW_DIRECTORY: "viewDirectory",
  // Edit the people database, the registers, and the structure.
  EDIT_DATABASE: "editDatabase",
  // See a seating arrangement. Everyone can, but a member only sees one that
  // has been finalised — see routes/seating.js.
  VIEW_SEATING: "viewSeating",
  // Build and rearrange a seating plan.
  EDIT_SEATING: "editSeating",
  // Add, remove and set access on the accounts that can sign in.
  MANAGE_ACCOUNTS: "manageAccounts",
};

const ALL = Object.values(PERMISSIONS);

// What being marked admin adds, whatever the role underneath is.
const ADMIN_PERMISSIONS = [
  PERMISSIONS.MANAGE_ACCOUNTS,
  PERMISSIONS.VIEW_SEATING,
  PERMISSIONS.EDIT_SEATING,
];

const GROUPS = [
  {
    key: "owner",
    label: "Owner",
    description: "Runs the app. Everything, and cannot be removed.",
    permissions: ALL,
  },
  {
    key: "leader",
    label: "Leader",
    description: "The database, the registers and the structure.",
    permissions: [
      PERMISSIONS.VIEW_DIRECTORY,
      PERMISSIONS.EDIT_DATABASE,
      PERMISSIONS.VIEW_SEATING,
    ],
  },
  {
    key: "member",
    label: "Member",
    description: "The dashboard, and the seating once it is finalised.",
    permissions: [PERMISSIONS.VIEW_SEATING],
  },
];

const BY_KEY = new Map(GROUPS.map((group) => [group.key, group]));

// A new account starts here. Someone who manages accounts moves it up.
const DEFAULT_GROUP = "member";

// The owner's role is decided by their email, so it is never handed out.
const ASSIGNABLE_GROUPS = GROUPS.filter((group) => group.key !== "owner");

function getGroup(key) {
  return BY_KEY.get(String(key || "").trim()) || BY_KEY.get(DEFAULT_GROUP);
}

// The role's permissions, plus the admin ones if the account carries the flag.
// Deduplicated, because a leader who is also an admin would otherwise hold
// VIEW_SEATING twice.
function permissionsFor(key, isAdmin = false) {
  const own = getGroup(key).permissions;
  return isAdmin ? [...new Set([...own, ...ADMIN_PERMISSIONS])] : own;
}

function can(key, permission, isAdmin = false) {
  return permissionsFor(key, isAdmin).includes(permission);
}

function isAssignable(key) {
  return ASSIGNABLE_GROUPS.some((group) => group.key === key);
}

// What the app needs to render its navigation and gates.
function publicGroups() {
  return GROUPS.map(({ key, label, description, permissions }) => ({
    key,
    label,
    description,
    permissions,
    assignable: key !== "owner",
  }));
}

module.exports = {
  PERMISSIONS,
  GROUPS,
  ADMIN_PERMISSIONS,
  DEFAULT_GROUP,
  getGroup,
  permissionsFor,
  can,
  isAssignable,
  publicGroups,
};
