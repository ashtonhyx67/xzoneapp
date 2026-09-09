const express = require("express");

const { pool } = require("../db");
const { requireAuth, requirePermission } = require("../middleware/auth");
const { PERMISSIONS } = require("../lib/groups");
const { normalizeTeam, canEditTeam, DEFAULT_TEAM } = require("../lib/teams");

const router = express.Router();

const route = (handler) => (req, res, next) => handler(req, res, next).catch(next);

// Guard rails so a malformed or hostile payload can't blow up the table.
const MAX_GROUPS = 60;
const MAX_ROWS_PER_GROUP = 60;
const MAX_FIELD = 120;

const clean = (value) => String(value ?? "").slice(0, MAX_FIELD).trim();

// A structure belongs to a team, so which one is being asked for has to be
// settled before anything else. Falling back to the caller's first team means
// the app opens on their own structure without having to name it.
function teamFor(req) {
  const asked = normalizeTeam(req.query.team ?? req.body?.team);
  if (asked) return asked;
  // The account's own team comes first. Everyone can edit every team now that
  // access tiers are gone, so "the first team you may edit" is X3A for
  // everybody — which would open every leader on someone else's register.
  return req.access.teams[0] || req.access.editableTeams[0] || DEFAULT_TEAM;
}

async function readRoster(team) {
  const meta = await pool.query("SELECT title FROM team_rosters WHERE team = $1", [team]);
  if (!meta.rows[0]) return null;

  // One query for the whole structure; grouping happens in memory because a
  // structure is small and this avoids N+1 round trips per group.
  const rows = await pool.query(
    `SELECT g.id AS group_id, g.position AS group_position,
            r.id AS row_id, r.position AS row_position,
            r.role, r.name, r.year, r.school
       FROM team_roster_groups g
       LEFT JOIN team_roster_rows r ON r.group_id = g.id
      WHERE g.team = $1
      ORDER BY g.position, r.position`,
    [team]
  );

  const groups = [];
  const byId = new Map();
  for (const row of rows.rows) {
    let group = byId.get(row.group_id);
    if (!group) {
      group = { id: row.group_id, rows: [] };
      byId.set(row.group_id, group);
      groups.push(group);
    }
    // LEFT JOIN yields a null row id for an empty group.
    if (row.row_id !== null) {
      group.rows.push({
        id: row.row_id,
        role: row.role,
        name: row.name,
        year: row.year,
        school: row.school,
      });
    }
  }

  return { team, title: meta.rows[0].title, groups };
}

// Replaces the structure wholesale. The edit screen holds the entire thing in
// local state, so one atomic write is simpler and safer than a dozen granular
// endpoints that could half-apply.
async function writeRoster(team, title, groups) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    await client.query(
      `INSERT INTO team_rosters (team, title, updated_at) VALUES ($1, $2, now())
       ON CONFLICT (team) DO UPDATE SET title = $2, updated_at = now()`,
      [team, title]
    );

    // Rows cascade from groups, so clearing groups clears everything.
    await client.query("DELETE FROM team_roster_groups WHERE team = $1", [team]);

    for (const [groupIndex, group] of groups.entries()) {
      const inserted = await client.query(
        "INSERT INTO team_roster_groups (team, position) VALUES ($1, $2) RETURNING id",
        [team, groupIndex]
      );
      const groupId = inserted.rows[0].id;

      for (const [rowIndex, row] of group.rows.entries()) {
        await client.query(
          `INSERT INTO team_roster_rows (group_id, position, role, name, year, school)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            groupId,
            rowIndex,
            clean(row.role),
            clean(row.name),
            clean(row.year),
            clean(row.school),
          ]
        );
      }
    }

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

// Reading is open across teams; a leader can look at how another team is laid
// out even though they cannot change it.
const canView = requirePermission(PERMISSIONS.VIEW_DIRECTORY);
const canEdit = requirePermission(PERMISSIONS.EDIT_DATABASE);

router.get(
  "/",
  requireAuth,
  canView,
  route(async (req, res) => {
    const team = teamFor(req);

    let roster = await readRoster(team);
    if (!roster) {
      // A team nobody has laid out yet opens on one empty block rather than a
      // blank screen with nothing to click.
      await writeRoster(team, `${team} Structure`, [{ rows: [] }]);
      roster = await readRoster(team);
    }

    res.json({ ...roster, canEdit: canEditTeam(req.access, team) });
  })
);

router.put(
  "/",
  requireAuth,
  canEdit,
  route(async (req, res) => {
    const { title, groups } = req.body;
    const team = teamFor(req);

    if (!canEditTeam(req.access, team)) {
      return res.status(403).json({ error: `${team} is not one of your teams.` });
    }
    if (!Array.isArray(groups)) {
      return res.status(400).json({ error: "Structure must include a list of groups." });
    }
    if (groups.length > MAX_GROUPS) {
      return res
        .status(400)
        .json({ error: `A structure can hold at most ${MAX_GROUPS} groups.` });
    }
    for (const group of groups) {
      if (!group || !Array.isArray(group.rows)) {
        return res.status(400).json({ error: "Every group must include a list of rows." });
      }
      if (group.rows.length > MAX_ROWS_PER_GROUP) {
        return res
          .status(400)
          .json({ error: `A group can hold at most ${MAX_ROWS_PER_GROUP} people.` });
      }
    }

    await writeRoster(team, clean(title) || `${team} Structure`, groups);
    res.json({ ...(await readRoster(team)), canEdit: true });
  })
);

module.exports = router;
