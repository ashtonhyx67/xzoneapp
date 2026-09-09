const express = require("express");

const { pool } = require("../db");
const { requireAuth, requirePermission } = require("../middleware/auth");
const { PERMISSIONS } = require("../lib/groups");
const { CGS, teamsInCg, editableTeams } = require("../lib/teams");
const { resolveWeek } = require("../lib/weeks");

const router = express.Router();

const route = (handler) => (req, res, next) => handler(req, res, next).catch(next);

const MAX_ROWS = 40;
const MAX_SEATS_PER_ROW = 40;
const MAX_FIELD = 120;

const clean = (value) => String(value ?? "").slice(0, MAX_FIELD).trim();

// Seating is done per CG, so the CG has to be settled first. Falling back to
// the CG of a team the caller runs means the page opens on their own.
function cgFor(req) {
  const asked = String(req.query.cg ?? req.body?.cg ?? "").trim().toUpperCase();
  if (CGS.some((cg) => cg.key === asked)) return asked;

  const mine = editableTeams(req.access)[0];
  return CGS.find((cg) => cg.teams.includes(mine))?.key ?? CGS[0].key;
}

// One leader per CG does the arrangement, and they are a leader of that CG —
// so holding any team inside it is what grants the write.
function canEditCg(access, cg) {
  if (access.permissions.includes(PERMISSIONS.MANAGE_ACCOUNTS)) return true;
  const teams = teamsInCg(cg);
  return teams.some((team) => (access.teams ?? []).includes(team));
}

async function readWeek(cg, year, week) {
  const meta = await pool.query(
    "SELECT id FROM seating_weeks WHERE cg = $1 AND year = $2 AND week = $3",
    [cg, year, week]
  );
  if (!meta.rows[0]) return { cg, year, week, rows: [] };

  const result = await pool.query(
    `SELECT r.id AS row_id, r.label, s.id AS seat_id, s.name
       FROM seating_rows r
       LEFT JOIN seating_seats s ON s.row_id = r.id
      WHERE r.week_id = $1
      ORDER BY r.position, s.position`,
    [meta.rows[0].id]
  );

  const rows = [];
  const byId = new Map();
  for (const record of result.rows) {
    let row = byId.get(record.row_id);
    if (!row) {
      row = { id: record.row_id, label: record.label, seats: [] };
      byId.set(record.row_id, row);
      rows.push(row);
    }
    // LEFT JOIN yields a null seat for an empty row.
    if (record.seat_id !== null) row.seats.push({ id: record.seat_id, name: record.name });
  }

  return { cg, year, week, rows };
}

async function writeWeek(cg, year, week, rows) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const meta = await client.query(
      `INSERT INTO seating_weeks (cg, year, week, updated_at) VALUES ($1, $2, $3, now())
       ON CONFLICT (cg, year, week) DO UPDATE SET updated_at = now()
       RETURNING id`,
      [cg, year, week]
    );
    const weekId = meta.rows[0].id;

    // Seats cascade from rows, so clearing rows clears everything.
    await client.query("DELETE FROM seating_rows WHERE week_id = $1", [weekId]);

    for (const [rowIndex, row] of rows.entries()) {
      const created = await client.query(
        "INSERT INTO seating_rows (week_id, position, label) VALUES ($1, $2, $3) RETURNING id",
        [weekId, rowIndex, clean(row.label)]
      );

      for (const [seatIndex, seat] of (row.seats ?? []).entries()) {
        await client.query(
          "INSERT INTO seating_seats (row_id, position, name) VALUES ($1, $2, $3)",
          [created.rows[0].id, seatIndex, clean(seat?.name)]
        );
      }
    }

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

const canView = requirePermission(PERMISSIONS.VIEW_DIRECTORY);
const canEdit = requirePermission(PERMISSIONS.EDIT_DATABASE);

router.get(
  "/",
  requireAuth,
  canView,
  route(async (req, res) => {
    const cg = cgFor(req);
    const { year, week } = resolveWeek(req.query.year, req.query.week);

    const record = await readWeek(cg, year, week);
    res.json({ ...record, canEdit: canEditCg(req.access, cg) });
  })
);

router.put(
  "/",
  requireAuth,
  canEdit,
  route(async (req, res) => {
    const cg = cgFor(req);
    const { year, week } = resolveWeek(req.body?.year, req.body?.week);

    if (!canEditCg(req.access, cg)) {
      return res.status(403).json({ error: `${cg} is not one of your CGs.` });
    }

    const rows = Array.isArray(req.body?.rows) ? req.body.rows : null;
    if (!rows) {
      return res.status(400).json({ error: "Seating needs a list of rows." });
    }
    if (rows.length > MAX_ROWS) {
      return res.status(400).json({ error: `At most ${MAX_ROWS} rows.` });
    }
    if (rows.some((row) => (row?.seats?.length ?? 0) > MAX_SEATS_PER_ROW)) {
      return res.status(400).json({ error: `At most ${MAX_SEATS_PER_ROW} seats in a row.` });
    }

    await writeWeek(cg, year, week, rows);
    res.json({ ...(await readWeek(cg, year, week)), canEdit: true });
  })
);

module.exports = router;
