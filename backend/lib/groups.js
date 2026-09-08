// Account groups, and what each one can do.
//
// This is the single place access is defined. Add a group or move a permission
// between groups here, and both the API and the app follow — the API because
// every protected route asks for a named permission, and the app because the
// session payload carries the caller's permission list.
//
// Everything not listed is universal: signing in, the dashboard, a PIN, and
// managing your own account are available to every group.

const PERMISSIONS = {
  // See the member directory and the scorecard, and the dashboard reminders
  // built from it.
  VIEW_DIRECTORY: "viewDirectory",
  // Edit the people database itself.
  EDIT_DATABASE: "editDatabase",
  // Add, remove, and regroup the accounts that can sign in.
  MANAGE_ACCOUNTS: "manageAccounts",
};

const ALL = Object.values(PERMISSIONS);

const GROUPS = [
  {
    key: "owner",
    label: "Owner",
    description: "Runs the app. Every permission, and cannot be removed.",
    permissions: ALL,
  },
  {
    key: "admin",
    label: "Admin",
    description: "Manages accounts and the whole database.",
    permissions: ALL,
  },
  {
    key: "leader",
    label: "Leader",
    description: "Reads and edits the member database.",
    permissions: [PERMISSIONS.VIEW_DIRECTORY, PERMISSIONS.EDIT_DATABASE],
  },
  {
    key: "member",
    label: "Member",
    description: "Reads the member directory.",
    permissions: [PERMISSIONS.VIEW_DIRECTORY],
  },
  {
    key: "pending",
    label: "No access",
    description: "Can sign in, but sees nothing until they are put in a group.",
    permissions: [],
  },
];

const BY_KEY = new Map(GROUPS.map((group) => [group.key, group]));

// A new account starts here; someone with manageAccounts moves it up.
const DEFAULT_GROUP = "pending";

// The owner's group is decided by their email, so it is never handed out.
const ASSIGNABLE_GROUPS = GROUPS.filter((group) => group.key !== "owner");

function getGroup(key) {
  return BY_KEY.get(String(key || "").trim()) || BY_KEY.get(DEFAULT_GROUP);
}

function permissionsFor(key) {
  return getGroup(key).permissions;
}

function can(key, permission) {
  return permissionsFor(key).includes(permission);
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
  DEFAULT_GROUP,
  getGroup,
  permissionsFor,
  can,
  isAssignable,
  publicGroups,
};
