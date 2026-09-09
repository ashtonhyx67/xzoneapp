const express = require("express");
const bcrypt = require("bcryptjs");

const { pool } = require("../db");
const { requireAuth, requirePermission } = require("../middleware/auth");
const { PERMISSIONS, DEFAULT_GROUP, isAssignable, publicGroups } = require("../lib/groups");
const { isOwnerEmail } = require("../lib/owner");
const { ZONES, ZONE_KEYS, normalizeZone } = require("../lib/zones");

const router = express.Router();

const route = (handler) => (req, res, next) => handler(req, res, next).catch(next);

router.use(requireAuth, requirePermission(PERMISSIONS.MANAGE_ACCOUNTS));

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

// The owner's group comes from their email, so it is reported that way here
// too rather than from whatever the row happens to say.
function publicAccount(row) {
  const owner = isOwnerEmail(row.email);
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    group: owner ? "owner" : row.group_key || DEFAULT_GROUP,
    isOwner: owner,
    zones: row.zones ?? [],
    pinSet: Boolean(row.pin_set),
    faceIdEnabled: Boolean(row.face_id_enabled),
    createdAt: row.created_at,
  };
}

const SELECT_ACCOUNTS = `
  SELECT u.id, u.name, u.email, u.group_key, u.created_at,
         (u.pin_hash IS NOT NULL) AS pin_set,
         EXISTS (SELECT 1 FROM webauthn_credentials c WHERE c.user_id = u.id) AS face_id_enabled,
         COALESCE(
           (SELECT array_agg(z.zone ORDER BY z.zone) FROM user_zones z WHERE z.user_id = u.id),
           '{}'
         ) AS zones
    FROM users u
`;

router.get(
  "/accounts",
  route(async (req, res) => {
    const result = await pool.query(`${SELECT_ACCOUNTS} ORDER BY u.created_at, u.id`);
    res.json({
      groups: publicGroups(),
      zones: ZONES,
      accounts: result.rows.map(publicAccount),
      me: req.userId,
    });
  })
);

// Creating an account here is how someone joins without going through the
// sign-up page — they get a password to change and a group from the start.
router.post(
  "/accounts",
  route(async (req, res) => {
    const { name, password, group } = req.body || {};
    const email = normalizeEmail(req.body?.email);

    if (!name || !email || !password) {
      return res.status(400).json({ error: "Name, email, and password are all required." });
    }
    if (String(password).length < 8) {
      return res.status(400).json({ error: "Password must be at least 8 characters." });
    }

    const groupKey = isOwnerEmail(email) ? "owner" : group || DEFAULT_GROUP;
    if (groupKey !== "owner" && !isAssignable(groupKey)) {
      return res.status(400).json({ error: "That is not a group you can assign." });
    }

    const passwordHash = await bcrypt.hash(String(password), 10);

    try {
      const inserted = await pool.query(
        `INSERT INTO users (name, email, password_hash, group_key, is_admin)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id`,
        [
          String(name).trim(),
          email,
          passwordHash,
          groupKey,
          groupKey === "owner" || groupKey === "admin",
        ]
      );
      const result = await pool.query(`${SELECT_ACCOUNTS} WHERE u.id = $1`, [
        inserted.rows[0].id,
      ]);
      res.json({ account: publicAccount(result.rows[0]) });
    } catch (err) {
      if (err.code === "23505") {
        return res.status(409).json({ error: "An account with that email already exists." });
      }
      throw err;
    }
  })
);

router.patch(
  "/accounts/:id",
  route(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: "Unknown account." });

    // Group and zones can be changed together or one at a time, so an edit to
    // someone's zones does not have to restate their group.
    const changingGroup = req.body?.group !== undefined;
    const changingZones = req.body?.zones !== undefined;

    const groupKey = String(req.body?.group || "");
    if (changingGroup && !isAssignable(groupKey)) {
      return res.status(400).json({ error: "That is not a group you can assign." });
    }

    let zones = null;
    if (changingZones) {
      if (!Array.isArray(req.body.zones)) {
        return res.status(400).json({ error: "Zones must be a list." });
      }
      // Anything unrecognised is dropped rather than stored, so the table can
      // never hold a zone that no longer exists.
      zones = [...new Set(req.body.zones.map(normalizeZone).filter(Boolean))];
      if (zones.length > ZONE_KEYS.length) {
        return res.status(400).json({ error: "Too many zones." });
      }
    }

    const found = await pool.query("SELECT id, email FROM users WHERE id = $1", [id]);
    const target = found.rows[0];
    if (!target) return res.status(404).json({ error: "Account not found." });

    if (isOwnerEmail(target.email)) {
      return res.status(403).json({ error: "The owner's access cannot be changed." });
    }

    // Nobody can drop their own access; it would take the last way back in with
    // it if they happen to be the only one who has it. Zones are not access, so
    // changing your own is allowed.
    if (changingGroup && id === req.userId) {
      return res.status(400).json({ error: "You cannot change your own group." });
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      if (changingGroup) {
        await client.query("UPDATE users SET group_key = $1, is_admin = $2 WHERE id = $3", [
          groupKey,
          groupKey === "admin",
          id,
        ]);
      }

      if (zones) {
        await client.query("DELETE FROM user_zones WHERE user_id = $1", [id]);
        for (const zone of zones) {
          await client.query("INSERT INTO user_zones (user_id, zone) VALUES ($1, $2)", [
            id,
            zone,
          ]);
        }
      }

      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      client.release();
    }

    const result = await pool.query(`${SELECT_ACCOUNTS} WHERE u.id = $1`, [id]);
    res.json({ account: publicAccount(result.rows[0]) });
  })
);

router.delete(
  "/accounts/:id",
  route(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: "Unknown account." });

    const found = await pool.query("SELECT id, email FROM users WHERE id = $1", [id]);
    const target = found.rows[0];
    if (!target) return res.status(404).json({ error: "Account not found." });

    if (isOwnerEmail(target.email)) {
      return res.status(403).json({ error: "The owner's account cannot be removed." });
    }
    if (id === req.userId) {
      return res.status(400).json({ error: "You cannot remove your own account." });
    }

    // The roster and credentials hanging off this account go with it; the
    // people database does not, because it belongs to everyone.
    await pool.query("DELETE FROM users WHERE id = $1", [id]);
    res.json({ deleted: id });
  })
);

module.exports = router;
