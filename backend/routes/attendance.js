const express = require("express");

const { pool } = require("../db");
const { requireAuth, requirePermission } = require("../middleware/auth");
const { PERMISSIONS } = require("../lib/groups");
const { normalizeTeam, canEditTeam, DEFAULT_TEAM, teamsInCg } = require("../lib/teams");
const { resolveWeek } = require("../lib/weeks");

const router = express.Router();

const route = (handler) => (req, res, next) => handler(req, res, next).catch(next);

// The four sessions every week has, always, in this order. They are fixed
// rather than seeded: a week is compared against other weeks, so a team that
// deleted or renamed a column would make its numbers meaningless next to
// everyone else's. Extra one-off events are added after these.
const FIXED_SESSIONS = ["Service 1", "Service 2", "Service 3", "Service Replay"];

const isFixed = (label) => FIXED_SESSIONS.includes(label);

// The session list a save is actually allowed to produce: the four fixed ones
// first, then whatever extras the client sent, deduplicated. Returned with a
// map from the positions the client used to the positions they land on, so the
// ticks follow their columns even if the client sent them in another order.
function reconcileSessions(incoming) {
  const labels = incoming.map((label) => clean(label));

  const extras = [];
  for (const label of labels) {
    if (!label || isFixed(label) || extras.includes(label)) continue;
    extras.push(label);
  }

  const final = [...FIXED_SESSIONS, ...extras];
  return { sessions: final, remap: labels.map((label) => final.indexOf(label)) };
}

const MAX_SESSIONS = 20;
const MAX_PEOPLE = 300;
const MAX_FIELD = 120;

const clean = (value) => String(value ?? "").slice(0, MAX_FIELD).trim();

function teamFor(req) {
  const asked = normalizeTeam(req.query.team ?? req.body?.team);
  if (asked) return asked;
  return req.access.editableTeams[0] || req.access.teams[0] || DEFAULT_TEAM;
}

async function readWeek(team, year, week) {
  const meta = await pool.query(
    "SELECT id FROM attendance_weeks WHERE team = $1 AND year = $2 AND week = $3",
    [team, year, week]
  );
  if (!meta.rows[0]) return null;
  const weekId = meta.rows[0].id;

  const sessions = await pool.query(
    "SELECT id, label FROM attendance_sessions WHERE week_id = $1 ORDER BY position, id",
    [weekId]
  );

  // People and their ticks in one query: the list is small, and this keeps it
  // to a single round trip rather than one per person.
  const rows = await pool.query(
    `SELECT p.id, p.name, p.person_id, m.session_id
       FROM attendance_people p
       LEFT JOIN attendance_marks m ON m.attendee_id = p.id
      WHERE p.week_id = $1
      ORDER BY p.position, p.id`,
    [weekId]
  );

  const people = [];
  const byId = new Map();
  for (const row of rows.rows) {
    let person = byId.get(row.id);
    if (!person) {
      person = { id: row.id, name: row.name, personId: row.person_id, present: [] };
      byId.set(row.id, person);
      people.push(person);
    }
    // LEFT JOIN yields a null session for someone with no ticks at all.
    if (row.session_id !== null) person.present.push(row.session_id);
  }

  return { team, year, week, sessions: sessions.rows, people };
}

// Replaces the whole week in one transaction, the same way the structure is
// written: the screen holds all of it, so one atomic write cannot half-apply.
// Session and person ids are reissued on every save, and the client sends its
// ticks against the positions it was given rather than against stale ids.
async function writeWeek(team, year, week, sessions, people) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const meta = await client.query(
      `INSERT INTO attendance_weeks (team, year, week, updated_at) VALUES ($1, $2, $3, now())
       ON CONFLICT (team, year, week) DO UPDATE SET updated_at = now()
       RETURNING id`,
      [team, year, week]
    );
    const weekId = meta.rows[0].id;

    // Marks cascade from both sides, so clearing these clears the ticks too.
    await client.query("DELETE FROM attendance_sessions WHERE week_id = $1", [weekId]);
    await client.query("DELETE FROM attendance_people WHERE week_id = $1", [weekId]);

    const sessionIds = [];
    for (const [index, label] of sessions.entries()) {
      const created = await client.query(
        "INSERT INTO attendance_sessions (week_id, position, label) VALUES ($1, $2, $3) RETURNING id",
        [weekId, index, clean(label) || `Session ${index + 1}`]
      );
      sessionIds.push(created.rows[0].id);
    }

    for (const [index, person] of people.entries()) {
      const personId = Number.isInteger(Number(person.personId))
        ? Number(person.personId)
        : null;

      const created = await client.query(
        `INSERT INTO attendance_people (week_id, position, person_id, name)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [weekId, index, personId, clean(person.name)]
      );
      const attendeeId = created.rows[0].id;

      // `present` is a list of session positions, so it survives the ids being
      // reissued above.
      for (const position of person.present ?? []) {
        const sessionId = sessionIds[Number(position)];
        if (sessionId === undefined) continue;
        await client.query(
          "INSERT INTO attendance_marks (attendee_id, session_id) VALUES ($1, $2)",
          [attendeeId, sessionId]
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

// A week nobody has opened yet starts from the team's own members, so the
// common case is ticking boxes rather than typing a register from scratch.
async function seedWeek(team, year, week) {
  const members = await pool.query(
    "SELECT id, name FROM people WHERE team_key = $1 ORDER BY lower(name)",
    [team]
  );

  await writeWeek(
    team,
    year,
    week,
    FIXED_SESSIONS,
    members.rows.map((person) => ({ personId: person.id, name: person.name, present: [] }))
  );
}

const canView = requirePermission(PERMISSIONS.VIEW_DIRECTORY);
const canEdit = requirePermission(PERMISSIONS.EDIT_DATABASE);

router.get(
  "/",
  requireAuth,
  canView,
  route(async (req, res) => {
    const team = teamFor(req);
    const { year, week } = resolveWeek(req.query.year, req.query.week);

    let record = await readWeek(team, year, week);
    if (!record) {
      // Only fill a week in for someone who could have done it themselves;
      // a read-only visitor gets the empty shape rather than side effects.
      if (canEditTeam(req.access, team)) {
        await seedWeek(team, year, week);
        record = await readWeek(team, year, week);
      } else {
        record = { team, year, week, sessions: [], people: [] };
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

    const sessions = Array.isArray(req.body?.sessions) ? req.body.sessions : null;
    const people = Array.isArray(req.body?.people) ? req.body.people : null;

    if (!sessions || !people) {
      return res.status(400).json({ error: "Attendance needs a list of sessions and people." });
    }
    // The four fixed sessions are put back whatever the client sent, and the
    // ticks are moved to wherever their column ended up.
    const { sessions: finalSessions, remap } = reconcileSessions(sessions);

    if (finalSessions.length > MAX_SESSIONS) {
      return res.status(400).json({ error: `At most ${MAX_SESSIONS} sessions in a week.` });
    }
    if (people.length > MAX_PEOPLE) {
      return res.status(400).json({ error: `At most ${MAX_PEOPLE} people in a week.` });
    }
    if (people.some((person) => !clean(person?.name))) {
      return res.status(400).json({ error: "Every row needs a name." });
    }

    const moved = people.map((person) => ({
      ...person,
      present: (Array.isArray(person.present) ? person.present : [])
        .map((position) => remap[Number(position)])
        .filter((position) => position !== undefined && position >= 0),
    }));

    await writeWeek(team, year, week, finalSessions, moved);
    res.json({ ...(await readWeek(team, year, week)), canEdit: true });
  })
);

// The names a seating arrangement can draw on: everyone on the attendance lists
// of that CG's teams for the week, with how many sessions they made. Marked
// absent everywhere still counts as a name — the arrangement is planned before
// the week is over.
router.get(
  "/roll",
  requireAuth,
  canView,
  route(async (req, res) => {
    const teams = teamsInCg(req.query.cg);
    const { year, week } = resolveWeek(req.query.year, req.query.week);

    if (teams.length === 0) return res.json({ year, week, names: [] });

    const rows = await pool.query(
      `SELECT p.name, w.team, count(m.session_id)::int AS attended
         FROM attendance_weeks w
         JOIN attendance_people p ON p.week_id = w.id
         LEFT JOIN attendance_marks m ON m.attendee_id = p.id
        WHERE w.team = ANY($1::text[]) AND w.year = $2 AND w.week = $3
        GROUP BY p.id, p.name, w.team
        ORDER BY lower(p.name)`,
      [teams, year, week]
    );

    res.json({ year, week, names: rows.rows });
  })
);

module.exports = router;
