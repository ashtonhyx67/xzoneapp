const express = require("express");

const { pool } = require("../db");
const { requireAuth, requirePermission } = require("../middleware/auth");
const { PERMISSIONS } = require("../lib/groups");
const { normalizeTeam, canEditTeam, DEFAULT_TEAM, teamsInCg } = require("../lib/teams");
const { roleRank } = require("../lib/roles");
const { resolveWeek, isoWeek } = require("../lib/weeks");
const {
  BUILTIN_STATUSES,
  BUILTIN_KEYS,
  CATEGORIES,
  CATEGORY_KEYS,
  categoryOf,
  slugify,
  parseStatuses,
  cleanStatuses,
  serializeStatuses,
  isPresent,
} = require("../lib/attendance");

const router = express.Router();

const route = (handler) => (req, res, next) => handler(req, res, next).catch(next);

const MAX_PEOPLE = 400;
const MAX_FIELD = 160;

const clean = (value) => String(value ?? "").slice(0, MAX_FIELD).trim();

// The built-in statuses plus whatever has been added. Read per request rather
// than cached, so a status added on one device shows up on the next without a
// restart.
async function allowedStatuses() {
  const extra = await pool.query(
    "SELECT key, label, emoji, counts FROM attendance_extra_statuses ORDER BY position, key"
  );
  return [...BUILTIN_STATUSES, ...extra.rows.map((row) => ({ ...row, builtin: false }))];
}

function teamFor(req) {
  const asked = normalizeTeam(req.query.team ?? req.body?.team);
  if (asked) return asked;
  return req.access.editableTeams[0] || req.access.teams[0] || DEFAULT_TEAM;
}

// The counts the sheet ends with: one per group, then the total. Derived on
// read rather than stored, so they can never disagree with the register above
// them.
function tally(people, allowed) {
  const byCategory = Object.fromEntries(
    CATEGORY_KEYS.map((key) => [key, { listed: 0, present: 0 }])
  );

  let total = 0;
  for (const person of people) {
    const bucket = byCategory[person.category];
    if (bucket) bucket.listed += 1;

    // Present once, however many statuses that took.
    if (isPresent(person.statuses, allowed)) {
      total += 1;
      if (bucket) bucket.present += 1;
    }
  }

  // How many wore each status. Someone at two services appears under both,
  // which is why this can add up to more than the total.
  const byStatus = Object.fromEntries(
    allowed.map((status) => [
      status.key,
      people.filter((person) => person.statuses.includes(status.key)).length,
    ])
  );

  return { total, byCategory, byStatus };
}

// A register that has already been written is not re-seeded, but it should
// still pick up someone added to the team since. Only for this week and later:
// a past register is the record of who was actually there, and quietly adding
// people to it afterwards would rewrite history.
function isCurrentOrLater(year, week) {
  const now = isoWeek();
  return year > now.year || (year === now.year && week >= now.week);
}

// Brings a register in step with the team as it stands now. Adds anyone missing
// and drops anyone who has left the team *and* has no marks — a row with marks
// on it is a record of something that happened, so it stays put whatever the
// database says today.
async function syncMembers(team, year, week) {
  const meta = await pool.query(
    "SELECT id FROM attendance_weeks WHERE team = $1 AND year = $2 AND week = $3",
    [team, year, week]
  );
  if (!meta.rows[0]) return;
  const weekId = meta.rows[0].id;

  const [listed, members] = await Promise.all([
    pool.query(
      "SELECT id, person_id, statuses FROM attendance_people WHERE week_id = $1",
      [weekId]
    ),
    pool.query("SELECT id, name, role FROM people WHERE team_key = $1", [team]),
  ]);

  const already = new Set(listed.rows.map((row) => row.person_id).filter(Boolean));
  const stillOnTeam = new Set(members.rows.map((person) => person.id));

  const missing = members.rows
    .filter((person) => !already.has(person.id))
    .sort((a, b) => roleRank(a.role) - roleRank(b.role) || a.name.localeCompare(b.name));

  const departed = listed.rows.filter(
    (row) => row.person_id && !stillOnTeam.has(row.person_id) && !row.statuses
  );

  if (missing.length === 0 && departed.length === 0) return;

  const next = await pool.query(
    "SELECT COALESCE(max(position), -1) + 1 AS position FROM attendance_people WHERE week_id = $1",
    [weekId]
  );
  let position = next.rows[0].position;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    for (const person of missing) {
      await client.query(
        `INSERT INTO attendance_people (week_id, position, person_id, name, statuses)
         VALUES ($1, $2, $3, $4, '')`,
        [weekId, position++, person.id, person.name]
      );
    }

    if (departed.length > 0) {
      await client.query("DELETE FROM attendance_people WHERE id = ANY($1::int[])", [
        departed.map((row) => row.id),
      ]);
    }

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

async function readWeek(team, year, week, allowed) {
  const meta = await pool.query(
    "SELECT id FROM attendance_weeks WHERE team = $1 AND year = $2 AND week = $3",
    [team, year, week]
  );
  if (!meta.rows[0]) return null;

  // The group comes from the person's own role where the row is linked to a
  // record, so promoting someone moves them on the register without it having
  // to be restated here.
  const rows = await pool.query(
    `SELECT a.id, a.name, a.person_id, a.statuses, a.category AS own_category,
            p.role AS person_role, p.team_key AS person_team
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
    statuses: cleanStatuses(row.statuses, allowed),
    // A linked row is grouped by the person's own role; a name typed in by hand
    // keeps the group chosen on the register itself.
    category: row.person_id
      ? categoryOf({ role: row.person_role })
      : categoryOf({ role: row.own_category }),
    // One of the team's own, as the database has it right now. Those are kept
    // in step automatically, so they are not removed by hand — someone who did
    // not come is left unmarked, which is what absent means.
    fromTeam: row.person_team === team,
  }));

  return { team, year, week, people, counts: tally(people, allowed) };
}

// Replaces the whole week in one transaction. The screen holds all of it, so
// one atomic write is simpler and safer than granular endpoints that could
// half-apply.
async function writeWeek(team, year, week, people, allowed) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const meta = await client.query(
      `INSERT INTO attendance_weeks (team, year, week, updated_at)
       VALUES ($1, $2, $3, now())
       ON CONFLICT (team, year, week) DO UPDATE SET updated_at = now()
       RETURNING id`,
      [team, year, week]
    );
    const weekId = meta.rows[0].id;

    await client.query("DELETE FROM attendance_people WHERE week_id = $1", [weekId]);

    for (const [index, person] of people.entries()) {
      const personId = Number.isInteger(Number(person.personId))
        ? Number(person.personId)
        : null;

      await client.query(
        `INSERT INTO attendance_people (week_id, position, person_id, name, statuses, category)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          weekId,
          index,
          personId,
          clean(person.name),
          serializeStatuses(cleanStatuses(person.statuses, allowed)),
          // Only kept for an unlinked row; a linked one follows the person.
          personId ? "" : categoryOf({ role: person.category }),
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
// the sheet lists them — by role, then by name — so the usual week is marking
// people rather than typing a register from scratch.
async function seedWeek(team, year, week, allowed) {
  const members = await pool.query(
    "SELECT id, name, role FROM people WHERE team_key = $1",
    [team]
  );

  const ordered = members.rows.sort(
    (a, b) => roleRank(a.role) - roleRank(b.role) || a.name.localeCompare(b.name)
  );

  await writeWeek(
    team,
    year,
    week,
    ordered.map((person) => ({ personId: person.id, name: person.name, statuses: [] })),
    allowed
  );
}

const canView = requirePermission(PERMISSIONS.VIEW_DIRECTORY);
const canEdit = requirePermission(PERMISSIONS.EDIT_DATABASE);

router.get(
  "/statuses",
  requireAuth,
  canView,
  route(async (req, res) => {
    res.json({ statuses: await allowedStatuses(), categories: CATEGORIES });
  })
);

// Adding a status changes every register — one week is read next to another, so
// a column that existed for a single team would not compare. It is therefore
// offered to whoever can edit the database rather than to one team's leader.
router.post(
  "/statuses",
  requireAuth,
  canEdit,
  route(async (req, res) => {
    const label = clean(req.body?.label);
    if (!label) return res.status(400).json({ error: "A status needs a name." });

    const key = slugify(label);
    if (!key) {
      return res.status(400).json({ error: "That name has no letters or digits in it." });
    }
    if (BUILTIN_KEYS.has(key)) {
      return res.status(409).json({ error: `${label} is already a status.` });
    }

    const emoji = String(req.body?.emoji ?? "").slice(0, 8).trim();
    // Anything added is assumed to be something people turned up to, unless it
    // is explicitly marked as not counting.
    const counts = req.body?.counts !== false;

    const next = await pool.query(
      "SELECT COALESCE(max(position), 0) + 1 AS position FROM attendance_extra_statuses"
    );

    await pool.query(
      `INSERT INTO attendance_extra_statuses (key, label, emoji, counts, position)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (key) DO UPDATE SET label = $2, emoji = $3, counts = $4`,
      [key, label, emoji, counts, next.rows[0].position]
    );

    res.json({ statuses: await allowedStatuses() });
  })
);

router.delete(
  "/statuses/:key",
  requireAuth,
  canEdit,
  route(async (req, res) => {
    const key = slugify(req.params.key);
    if (BUILTIN_KEYS.has(key)) {
      return res.status(400).json({ error: "The standard statuses cannot be removed." });
    }

    // Marks referring to it are left where they are: cleanStatuses drops
    // anything the register no longer offers, so they simply stop showing.
    await pool.query("DELETE FROM attendance_extra_statuses WHERE key = $1", [key]);
    res.json({ statuses: await allowedStatuses() });
  })
);

router.get(
  "/",
  requireAuth,
  canView,
  route(async (req, res) => {
    const team = teamFor(req);
    const { year, week } = resolveWeek(req.query.year, req.query.week);
    const allowed = await allowedStatuses();

    let record = await readWeek(team, year, week, allowed);
    if (!record) {
      // Only fill a week in for someone who could have done it themselves; a
      // read-only visitor gets the empty shape rather than side effects.
      if (canEditTeam(req.access, team)) {
        await seedWeek(team, year, week, allowed);
        record = await readWeek(team, year, week, allowed);
      } else {
        record = { team, year, week, people: [], counts: tally([], allowed) };
      }
    } else if (canEditTeam(req.access, team) && isCurrentOrLater(year, week)) {
      // Already written, so pick up anyone added to the team since it was.
      await syncMembers(team, year, week);
      record = await readWeek(team, year, week, allowed);
    }

    // The statuses travel with the register, so the page always offers exactly
    // what the server will accept.
    res.json({ ...record, statuses: allowed, canEdit: canEditTeam(req.access, team) });
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

    const allowed = await allowedStatuses();
    await writeWeek(team, year, week, people, allowed);

    res.json({
      ...(await readWeek(team, year, week, allowed)),
      statuses: allowed,
      canEdit: true,
    });
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

    const allowed = await allowedStatuses();
    const rows = await pool.query(
      `SELECT a.name, a.statuses, w.team
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
        statuses: parseStatuses(row.statuses),
        present: isPresent(row.statuses, allowed),
      })),
    });
  })
);

module.exports = router;
