const jwt = require("jsonwebtoken");

const { pool } = require("../db");
const { isOwnerEmail } = require("../lib/owner");
const { getGroup, permissionsFor, DEFAULT_GROUP } = require("../lib/groups");
const { normalizeZone, editableZones } = require("../lib/zones");

function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: "Not signed in." });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.userId = payload.userId;
    next();
  } catch (err) {
    return res.status(401).json({ error: "Session expired. Please sign in again." });
  }
}

// Access is read from the database on every request, never from the token, so
// moving someone between groups takes effect immediately rather than whenever
// their token happens to expire.
async function loadAccess(userId) {
  const result = await pool.query(
    "SELECT id, name, email, group_key FROM users WHERE id = $1",
    [userId]
  );
  const row = result.rows[0];
  if (!row) return null;

  // The owner's group comes from their email, so it survives any edit.
  const groupKey = isOwnerEmail(row.email) ? "owner" : row.group_key || DEFAULT_GROUP;

  const assigned = await pool.query(
    "SELECT zone FROM user_zones WHERE user_id = $1 ORDER BY zone",
    [userId]
  );

  const access = {
    user: row,
    groupKey,
    group: getGroup(groupKey),
    permissions: permissionsFor(groupKey),
    isOwner: isOwnerEmail(row.email),
    // Zones this account has been put in. A zone that has since been removed
    // from lib/zones.js drops out here rather than lingering as a dead key.
    zones: assigned.rows.map((r) => normalizeZone(r.zone)).filter(Boolean),
  };

  // Reading is not zoned — a leader can look into any zone. Writing is.
  access.editableZones = editableZones(access);

  return access;
}

// Guards a route with a named permission from lib/groups.js.
function requirePermission(permission) {
  return async function check(req, res, next) {
    try {
      const access = await loadAccess(req.userId);
      if (!access) return res.status(401).json({ error: "Not signed in." });
      if (!access.permissions.includes(permission)) {
        return res.status(403).json({ error: "You do not have access to this." });
      }
      req.access = access;
      next();
    } catch (err) {
      next(err);
    }
  };
}

module.exports = { requireAuth, loadAccess, requirePermission };
