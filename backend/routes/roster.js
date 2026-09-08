const express = require("express");

const { pool } = require("../db");
const { requireAuth } = require("../middleware/auth");
const { TEMPLATE } = require("../rosterTemplate");

const router = express.Router();

const route = (handler) => (req, res, next) => handler(req, res, next).catch(next);

// Guard rails so a malformed or hostile payload can't blow up the table.
const MAX_GROUPS = 60;
const MAX_ROWS_PER_GROUP = 60;
const MAX_FIELD = 120;

const clean = (value) => String(value ?? "").slice(0, MAX_FIELD).trim();

async function readRoster(userId) {
  const meta = await pool.query("SELECT title FROM rosters WHERE user_id = $1", [userId]);
  if (!meta.rows[0]) return null;

  // One query for the whole roster; grouping happens in memory because a
  // roster is small and this avoids N+1 round trips per group.
  const rows = await pool.query(
    `SELECT g.id AS group_id, g.position AS group_position,
            r.id AS row_id, r.position AS row_position,
            r.role, r.name, r.year, r.school, r.color
       FROM roster_groups g
       LEFT JOIN roster_rows r ON r.group_id = g.id
      WHERE g.user_id = $1
      ORDER BY g.position, r.position`,
    [userId]
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
        color: row.color,
      });
    }
  }

  return { title: meta.rows[0].title, groups };
}

// Replaces the roster wholesale. The edit screen holds the entire thing in
// local state, so one atomic write is simpler and safer than a dozen granular
// endpoints that could half-apply.
async function writeRoster(userId, title, groups) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    await client.query(
      `INSERT INTO rosters (user_id, title, updated_at) VALUES ($1, $2, now())
       ON CONFLICT (user_id) DO UPDATE SET title = $2, updated_at = now()`,
      [userId, title]
    );

    // Rows cascade from groups, so clearing groups clears everything.
    await client.query("DELETE FROM roster_groups WHERE user_id = $1", [userId]);

    for (const [groupIndex, group] of groups.entries()) {
      const inserted = await client.query(
        "INSERT INTO roster_groups (user_id, position) VALUES ($1, $2) RETURNING id",
        [userId, groupIndex]
      );
      const groupId = inserted.rows[0].id;

      for (const [rowIndex, row] of group.rows.entries()) {
        await client.query(
          `INSERT INTO roster_rows (group_id, position, role, name, year, school, color)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            groupId,
            rowIndex,
            clean(row.role),
            clean(row.name),
            clean(row.year),
            clean(row.school),
            clean(row.color),
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

// First visit gets the spreadsheet template rather than an empty screen.
router.get(
  "/",
  requireAuth,
  route(async (req, res) => {
    let roster = await readRoster(req.userId);
    if (!roster) {
      await writeRoster(req.userId, TEMPLATE.title, TEMPLATE.groups);
      roster = await readRoster(req.userId);
    }
    res.json(roster);
  })
);

router.put(
  "/",
  requireAuth,
  route(async (req, res) => {
    const { title, groups } = req.body;

    if (!Array.isArray(groups)) {
      return res.status(400).json({ error: "Roster must include a list of groups." });
    }
    if (groups.length > MAX_GROUPS) {
      return res.status(400).json({ error: `A roster can hold at most ${MAX_GROUPS} groups.` });
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

    await writeRoster(req.userId, clean(title) || "Roster", groups);
    res.json(await readRoster(req.userId));
  })
);

module.exports = router;
