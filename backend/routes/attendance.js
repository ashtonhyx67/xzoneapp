const express = require("express");

const { pool } = require("../db");
const { requireAuth, requirePermission } = require("../middleware/auth");
const { PERMISSIONS } = require("../lib/groups");
const { normalizeTeam, canEditTeam, DEFAULT_TEAM, teamsInCg } = require("../lib/teams");
const { resolveWeek } = require("../lib/weeks");
const {
  STATUSES,
  CATEGORIES,
  CATEGORY_KEYS,
  categoryOf,
  normalizeStatus,
  normalizeCategory,
  isPresent,
} = require("../lib/attendance");

const router = express.Router();

const route = (handler) => (req, res, next) => handler(req, res, next).catch(next);

const MAX_PEOPLE = 400;
const MAX_FIELD = 160;

const clean = (value) => String(value ?? "").slice(0, MAX_FIELD).trim();

function teamFor(req) {
  const asked = normalizeTeam(req.query.team ?? req.body?.team);
  if (asked) return asked;
  return req.access.editableTeams[0] || req.access.teams[0] || DEFAULT_TEAM;
}

// The counts the sheet ends with: one per category, then the total. Derived on
// read rather than stored, so they can never disagree with the register above
// them.
function tally(people) {
  const byCategory = Object.fromEntries(
    CATEGORY_KEYS.map((key) => [key, { listed: 0, present: 0 }])
  );

  let total = 0;
  for (const person of people) {
    const bucket = byCategory[person.category];
    if (bucket) bucket.listed += 1;

    if (isPresent(person.status)) {
      total += 1;
      if (bucket) bucket.present += 1;
    }
  }

  // How many wore each status, so nothing is hidden by the headline number —
  // whether Serving counts towards it or not, the breakdown still shows it.
  const byStatus = Object.fromEntries(
    STATUSES.map((status) => [
      status.key,
      people.filter((person) => person.status === status.key).length,
    ])
  );

  return { total, byCategory, byStatus };
}

async function readWeek(team, year, week) {
  const meta = await pool.query(
    "SELECT id, title FROM attendance_weeks WHERE team = $1 AND year = $2 AND week = $3",
    [team, year, week]
  );
  if (!meta.rows[0]) return null;

  // The category comes from the person's record where the row is linked to one,
  // so promoting someone or changing their category moves them on the register
  // without it having to be restated here.
  const rows = await pool.query(
    `SELECT a.id, a.name, a.person_id, a.status, a.category AS own_category,
            p.role AS person_role, p.category AS person_category
       FROM attendance_people a
       LEFT JOIN people p ON p.id = a.person_id
      WHERE a.week_id = $1
      ORDER BY a.position, a.id`,
    [meta.rows[0].id]
  );

  const people = rows.rows.map((row) => ({
    id: row.id,
    name: row.name,
    personId: row.person_id,
    status: normalizeStatus(row.status),
    // A linked row takes the person's category; a name typed in by hand keeps
    // the one chosen on the register itself.
    category: row.person_id
      ? categoryOf({ role: row.person_role, category: row.person_category })
      : normalizeCategory(row.own_category),
  }));

  return { team, year, week, title: meta.rows[0].title, people, counts: tally(people) };
}

// Replaces the whole week in one transaction. The screen holds all of it, so
// one atomic write is simpler and safer than granular endpoints that could
// half-apply.
async function writeWeek(team, year, week, title, people) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const meta = await client.query(
      `INSERT INTO attendance_weeks (team, year, week, title, updated_at)
       VALUES ($1, $2, $3, $4, now())
       ON CONFLICT (team, year, week)
       DO UPDATE SET title = $4, updated_at = now()
       RETURNING id`,
      [team, year, week, clean(title)]
    );
    const weekId = meta.rows[0].id;

    await client.query("DELETE FROM attendance_people WHERE week_id = $1", [weekId]);

    for (const [index, person] of people.entries()) {
      const personId = Number.isInteger(Number(person.personId))
        ? Number(person.personId)
        : null;

      await client.query(
        `INSERT INTO attendance_people (week_id, position, person_id, name, status, category)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          weekId,
          index,
          personId,
          clean(person.name),
          normalizeStatus(person.status),
          // Only kept for an unlinked row; a linked one reads the person's.
          personId ? "" : normalizeCategory(person.category),
        ]
      );
    }

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// A week nobody has opened yet starts from the team's own members, in the order
// the sheet lists them — by category, then by name — so the usual week is
// marking people rather than typing a register from scratch.
async function seedWeek(team, year, week) {
  const members = await pool.query(
    "SELECT id, name, role, category FROM people WHERE team_key = $1 ORDER BY lower(name)",
    [team]
  );

  const ordered = members.rows
    .map((person) => ({ ...person, category: categoryOf(person) }))
    .sort((a, b) => {
      const rank = (c) => {
        const index = CATEGORY_KEYS.indexOf(c);
        // Anyone with no category yet sits after the named groups.
        return index === -1 ? CATEGORY_KEYS.length : index;
      };
      return rank(a.category) - rank(b.category) || a.name.localeCompare(b.name);
    });

  await writeWeek(
    team,
    year,
    week,
    "",
    ordered.map((person) => ({ personId: person.id, name: person.name, status: "" }))
  );
}

const canView = requirePermission(PERMISSIONS.VIEW_DIRECTORY);
const canEdit = requirePermission(PERMISSIONS.EDIT_DATABASE);

// The legend, so the app and the sheet always name things the same way.
router.get(
  "/legend",
  requireAuth,
  canView,
  route(async (req, res) => {
    res.json({ statuses: STATUSES, categories: CATEGORIES });
  })
);

router.get(
  "/",
  requireAuth,
  canView,
  route(async (req, res) => {
    const team = teamFor(req);
    const { year, week } = resolveWeek(req.query.year, req.query.week);

    let record = await readWeek(team, year, week);
    if (!record) {
      // Only fill a week in for someone who could have done it themselves; a
      // read-only visitor gets the empty shape rather than side effects.
      if (canEditTeam(req.access, team)) {
        await seedWeek(team, year, week);
        record = await readWeek(team, year, week);
      } else {
        record = {
          team,
          year,
          week,
          title: "",
          people: [],
          counts: tally([]),
        };
      }
    }

    res.json({ ...record, canEdit: canEditTeam(req.access, team) });
  })
);

router.put(
  "/",
  requireAuth,
  canEdit,
  route(async (req, res) => {
    const team = teamFor(req);
    const { year, week } = resolveWeek(req.body?.year, req.body?.week);

    if (!canEditTeam(req.access, team)) {
      return res.status(403).json({ error: `${team} is not one of your teams.` });
    }

    const people = Array.isArray(req.body?.people) ? req.body.people : null;
    if (!people) {
      return res.status(400).json({ error: "A register needs a list of people." });
    }
    if (people.length > MAX_PEOPLE) {
      return res.status(400).json({ error: `At most ${MAX_PEOPLE} people in a week.` });
    }
    if (people.some((person) => !clean(person?.name))) {
      return res.status(400).json({ error: "Every row needs a name." });
    }

    await writeWeek(team, year, week, req.body?.title, people);
    res.json({ ...(await readWeek(team, year, week)), canEdit: true });
  })
);

// The names a seating arrangement can draw on: everyone on the registers of
// that CG's teams for the week, and whether they were actually there.
router.get(
  "/roll",
  requireAuth,
  canView,
  route(async (req, res) => {
    const teams = teamsInCg(req.query.cg);
    const { year, week } = resolveWeek(req.query.year, req.query.week);

    if (teams.length === 0) return res.json({ year, week, names: [] });

    const rows = await pool.query(
      `SELECT a.name, a.status, w.team
         FROM attendance_weeks w
         JOIN attendance_people a ON a.week_id = w.id
        WHERE w.team = ANY($1::text[]) AND w.year = $2 AND w.week = $3
        ORDER BY lower(a.name)`,
      [teams, year, week]
    );

    res.json({
      year,
      week,
      names: rows.rows.map((row) => ({
        name: row.name,
        team: row.team,
        status: normalizeStatus(row.status),
        present: isPresent(row.status),
      })),
    });
  })
);

module.exports = router;
