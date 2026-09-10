const express = require("express");
const bcrypt = require("bcryptjs");

const { pool } = require("../db");
const { requireAuth, requirePermission } = require("../middleware/auth");
const { PERMISSIONS, DEFAULT_GROUP, isAssignable, publicGroups } = require("../lib/groups");
const { isOwnerEmail } = require("../lib/owner");
const { normalizeEmail, isValidEmail, EMAIL_ERROR } = require("../lib/email");
const { CGS, TEAMS, TEAM_KEYS, normalizeTeam } = require("../lib/teams");

const router = express.Router();

const route = (handler) => (req, res, next) => handler(req, res, next).catch(next);

router.use(requireAuth, requirePermission(PERMISSIONS.MANAGE_ACCOUNTS));

// The owner's group comes from their email, so it is reported that way here
// too rather than from whatever the row happens to say.
function publicAccount(row) {
  const owner = isOwnerEmail(row.email);
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    group: owner ? "owner" : row.group_key || DEFAULT_GROUP,
    // The owner is always an admin, whatever the row says.
    isAdmin: owner || row.is_admin === true,
    isOwner: owner,
    teams: row.teams ?? [],
    pinSet: Boolean(row.pin_set),
    faceIdEnabled: Boolean(row.face_id_enabled),
    createdAt: row.created_at,
  };
}

const SELECT_ACCOUNTS = `
  SELECT u.id, u.name, u.email, u.group_key, u.is_admin, u.created_at,
         (u.pin_hash IS NOT NULL) AS pin_set,
         EXISTS (SELECT 1 FROM webauthn_credentials c WHERE c.user_id = u.id) AS face_id_enabled,
         COALESCE(
           (SELECT array_agg(t.team ORDER BY t.team) FROM user_teams t WHERE t.user_id = u.id),
           '{}'
         ) AS teams
    FROM users u
`;

router.get(
  "/accounts",
  route(async (req, res) => {
    const result = await pool.query(`${SELECT_ACCOUNTS} ORDER BY u.created_at, u.id`);
    res.json({
      groups: publicGroups(),
      cgs: CGS,
      teams: TEAMS,
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
    if (!isValidEmail(email)) {
      return res.status(400).json({ error: EMAIL_ERROR });
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
          // Admin is granted afterwards, deliberately: a new account should not
          // arrive holding it because of how its role was spelled.
          groupKey === "owner",
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

    // Role, admin and teams can be changed together or one at a time, so an
    // edit to one does not have to restate the others.
    const changingGroup = req.body?.group !== undefined;
    const changingAdmin = req.body?.isAdmin !== undefined;
    const changingTeams = req.body?.teams !== undefined;

    const groupKey = String(req.body?.group || "");
    if (changingGroup && !isAssignable(groupKey)) {
      return res.status(400).json({ error: "That is not a group you can assign." });
    }

    let teams = null;
    if (changingTeams) {
      if (!Array.isArray(req.body.teams)) {
        return res.status(400).json({ error: "Teams must be a list." });
      }
      // Anything unrecognised is dropped rather than stored, so the table can
      // never hold a team that no longer exists.
      teams = [...new Set(req.body.teams.map(normalizeTeam).filter(Boolean))];
      if (teams.length > TEAM_KEYS.length) {
        return res.status(400).json({ error: "Too many teams." });
      }
    }

    const found = await pool.query("SELECT id, email FROM users WHERE id = $1", [id]);
    const target = found.rows[0];
    if (!target) return res.status(404).json({ error: "Account not found." });

    if (isOwnerEmail(target.email)) {
      return res.status(403).json({ error: "The owner's access cannot be changed." });
    }

    // Nobody can drop their own access; it would take the last way back in with
    // it if they happen to be the only one who has it. Teams are not access, so
    // changing your own is allowed.
    if (changingGroup && id === req.userId) {
      return res.status(400).json({ error: "You cannot change your own role." });
    }
    if (changingAdmin && id === req.userId) {
      return res.status(400).json({ error: "You cannot remove your own admin access." });
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      if (changingGroup) {
        await client.query("UPDATE users SET group_key = $1 WHERE id = $2", [groupKey, id]);
      }

      // Deliberately separate from the role: an admin is a job, not a rank, so
      // a Member can hold it without being given a Leader's access.
      if (changingAdmin) {
        await client.query("UPDATE users SET is_admin = $1 WHERE id = $2", [
          req.body.isAdmin === true,
          id,
        ]);
      }

      if (teams) {
        await client.query("DELETE FROM user_teams WHERE user_id = $1", [id]);
        for (const team of teams) {
          await client.query("INSERT INTO user_teams (user_id, team) VALUES ($1, $2)", [
            id,
            team,
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
