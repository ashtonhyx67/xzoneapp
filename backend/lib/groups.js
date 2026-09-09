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

// Being in the app is the whole of the permission model. There is no tier to
// promote someone into: an account exists because someone was given it, and
// that is the decision — so everyone who can sign in can do everything.
//
// The permissions above are kept rather than deleted. Every protected route
// asks for one by name, so leaving them in place means the gate is still there
// to close if this ever needs tiers again; today every group holds all of them.
const GROUPS = [
  {
    key: "owner",
    label: "Owner",
    description: "Runs the app. Cannot be removed.",
    permissions: ALL,
  },
  {
    key: "member",
    label: "Member",
    description: "Everyone else with an account.",
    permissions: ALL,
  },
];

const BY_KEY = new Map(GROUPS.map((group) => [group.key, group]));

// Where a new account lands, which is also where it stays.
const DEFAULT_GROUP = "member";

// The owner's group is decided by their email, so it is never handed out.
const ASSIGNABLE_GROUPS = GROUPS.filter((group) => group.key !== "owner");

function getGroup(key) {
  return BY_KEY.get(String(key || "").trim()) || BY_KEY.get(DEFAULT_GROUP);
}

// Everyone gets everything, whatever their row happens to say — an account
// left on a group key from before this changed is not locked out by it.
function permissionsFor() {
  return ALL;
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
