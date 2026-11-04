const express = require("express");

const { pool } = require("../db");
const { requireAuth, loadAccess, requirePermission } = require("../middleware/auth");
const { PERMISSIONS } = require("../lib/groups");
const { cleanOuting, cleanEvaluation } = require("../lib/outings");

const router = express.Router();

const route = (handler) => (req, res, next) => handler(req, res, next).catch(next);

router.use(requireAuth);

const canRun = requirePermission(PERMISSIONS.RUN_OUTINGS);

function toId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 && id < 2 ** 31 ? id : null;
}

// Someone is on an outing through their person record, or through having exactly
// the same name, since an account is only linked to its person at the next boot.
// $1 is always the account asking.
const IS_ME = `(op.person_id = me.person_id OR lower(op.name) = lower(me.name))`;

const SELECT_OUTINGS = `
  SELECT o.*,
         COALESCE(
           (SELECT json_agg(
                     json_build_object(
                       'id', op.id,
                       'personId', op.person_id,
                       'name', op.name,
                       'submitted', e.id IS NOT NULL,
                       'hasAccount', EXISTS (
                         SELECT 1 FROM users u
                          WHERE u.person_id = op.person_id OR lower(u.name) = lower(op.name)
                       )
                     )
                     ORDER BY lower(op.name)
                   )
              FROM outing_people op
              LEFT JOIN outing_evaluations e ON e.outing_person_id = op.id
             WHERE op.outing_id = o.id),
           '[]'
         ) AS people,
         (SELECT op.id
            FROM outing_people op, users me
           WHERE op.outing_id = o.id AND me.id = $1 AND ${IS_ME}
           LIMIT 1) AS my_row,
         (SELECT e.id IS NOT NULL
            FROM outing_people op
            JOIN users me ON me.id = $1 AND ${IS_ME}
            LEFT JOIN outing_evaluations e ON e.outing_person_id = op.id
           WHERE op.outing_id = o.id
           LIMIT 1) AS i_submitted
    FROM outings o
`;

// Who has and has not evaluated is for whoever runs outings. Everyone on one sees
// where it is and who is going.
function publicOuting(row, canManage) {
  return {
    id: row.id,
    type: row.hangout_type,
    heldOn: row.held_on,
    startTime: row.start_time,
    endTime: row.end_time,
    location: row.location,
    goals: row.goals,
    friendsCount: row.friends_count,
    friendsWho: row.friends_who,
    status: row.status,
    mine: row.my_row !== null,
    toEvaluate: row.status === "ended" && row.my_row !== null && row.i_submitted === false,
    people: row.people.map((person) =>
      canManage
        ? person
        : { id: person.id, personId: person.personId, name: person.name }
    ),
  };
}

async function findOuting(id, userId) {
  const found = await pool.query(`${SELECT_OUTINGS} WHERE o.id = $2`, [userId, id]);
  return found.rows[0] ?? null;
}

// The ended outings this account has yet to say how they went. Read on every page
// of the app, for the reminder on the home screen and the mark on the menu.
async function outingsToEvaluate(userId) {
  const found = await pool.query(
    `SELECT o.id, o.hangout_type, o.held_on, o.location
       FROM outings o
       JOIN outing_people op ON op.outing_id = o.id
       JOIN users me ON me.id = $1 AND ${IS_ME}
       LEFT JOIN outing_evaluations e ON e.outing_person_id = op.id
      WHERE o.status = 'ended' AND e.id IS NULL
      ORDER BY o.held_on DESC, o.id DESC`,
    [userId]
  );
  return found.rows.map((row) => ({
    id: row.id,
    type: row.hangout_type,
    heldOn: row.held_on,
    location: row.location,
  }));
}

// A leader sees every outing. Anyone else sees the ones they are on.
router.get(
  "/",
  route(async (req, res) => {
    const access = await loadAccess(req.userId, req);
    if (!access) return res.status(401).json({ error: "Not signed in." });
    const canManage = access.permissions.includes(PERMISSIONS.RUN_OUTINGS);

    const found = await pool.query(
      `SELECT * FROM (${SELECT_OUTINGS}) AS listed
        WHERE $2::boolean OR my_row IS NOT NULL
        ORDER BY held_on DESC, id DESC
        LIMIT 200`,
      [req.userId, canManage]
    );

    res.json({
      canRun: canManage,
      outings: found.rows.map((row) => publicOuting(row, canManage)),
    });
  })
);

// The names to choose from, and which of them is the person asking, so that a
// leader planning an outing starts out on it.
router.get(
  "/people",
  canRun,
  route(async (req, res) => {
    const [people, me] = await Promise.all([
      pool.query("SELECT id, name, team_key FROM people ORDER BY lower(name)"),
      pool.query(
        `SELECT p.id FROM people p, users me
          WHERE me.id = $1 AND (p.id = me.person_id OR lower(p.name) = lower(me.name))
          LIMIT 1`,
        [req.userId]
      ),
    ]);
    res.json({
      people: people.rows.map((row) => ({ id: row.id, name: row.name, team: row.team_key })),
      me: me.rows[0]?.id ?? null,
    });
  })
);

router.get(
  "/:id",
  route(async (req, res) => {
    const access = await loadAccess(req.userId, req);
    if (!access) return res.status(401).json({ error: "Not signed in." });
    const canManage = access.permissions.includes(PERMISSIONS.RUN_OUTINGS);

    const id = toId(req.params.id);
    const outing = id ? await findOuting(id, req.userId) : null;
    // The same answer for one that exists and is not yours as for one that does not.
    if (!outing || (!canManage && outing.my_row === null)) {
      return res.status(404).json({ error: "That outing could not be found." });
    }

    // A leader reads them all. Anyone else reads their own, to change it.
    const evaluations = await pool.query(
      `SELECT e.how, e.met_nf, e.nf_details, e.submitted_at, op.id AS row_id, op.name
         FROM outing_evaluations e
         JOIN outing_people op ON op.id = e.outing_person_id
        WHERE op.outing_id = $1 AND ($2::boolean OR op.id = $3)
        ORDER BY e.submitted_at`,
      [id, canManage, outing.my_row]
    );

    res.json({
      canRun: canManage,
      outing: publicOuting(outing, canManage),
      evaluations: evaluations.rows.map((row) => ({
        name: row.name,
        mine: row.row_id === outing.my_row,
        how: row.how,
        metNf: row.met_nf,
        nfDetails: row.nf_details,
      })),
    });
  })
);

async function withTransaction(work) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// Only people who are really in the database, with their names copied in, so that
// removing someone later does not blank out who went.
async function peopleFor(personIds) {
  const found = await pool.query("SELECT id, name FROM people WHERE id = ANY($1::int[])", [
    personIds,
  ]);
  return found.rows;
}

async function addPeople(client, outingId, people) {
  for (const person of people) {
    await client.query(
      `INSERT INTO outing_people (outing_id, person_id, name) VALUES ($1, $2, $3)
       ON CONFLICT (outing_id, person_id) WHERE person_id IS NOT NULL DO NOTHING`,
      [outingId, person.id, person.name]
    );
  }
}

router.post(
  "/",
  canRun,
  route(async (req, res) => {
    const { error, fields } = cleanOuting(req.body);
    if (error) return res.status(400).json({ error });

    const people = await peopleFor(fields.personIds);
    if (people.length === 0) return res.status(400).json({ error: "Choose who's going." });

    const id = await withTransaction(async (client) => {
      const created = await client.query(
        `INSERT INTO outings
           (hangout_type, held_on, start_time, end_time, location, goals,
            friends_count, friends_who, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING id`,
        [
          fields.type,
          fields.heldOn,
          fields.startTime,
          fields.endTime,
          fields.location,
          fields.goals,
          fields.friendsCount,
          fields.friendsWho,
          req.userId,
        ]
      );
      await addPeople(client, created.rows[0].id, people);
      return created.rows[0].id;
    });

    res.json({ id });
  })
);

// Anyone taken off loses their evaluation with them. Once it has ended the record
// stays as it was, because people are answering about what actually happened.
router.put(
  "/:id",
  canRun,
  route(async (req, res) => {
    const id = toId(req.params.id);
    const found = id ? await pool.query("SELECT status FROM outings WHERE id = $1", [id]) : null;
    if (!found?.rows[0]) return res.status(404).json({ error: "That outing could not be found." });
    if (found.rows[0].status === "ended") {
      return res.status(409).json({ error: "This outing has already ended." });
    }

    const { error, fields } = cleanOuting(req.body);
    if (error) return res.status(400).json({ error });

    const people = await peopleFor(fields.personIds);
    if (people.length === 0) return res.status(400).json({ error: "Choose who's going." });

    await withTransaction(async (client) => {
      await client.query(
        `UPDATE outings
            SET hangout_type = $1, held_on = $2, start_time = $3, end_time = $4,
                location = $5, goals = $6, friends_count = $7, friends_who = $8
          WHERE id = $9`,
        [
          fields.type,
          fields.heldOn,
          fields.startTime,
          fields.endTime,
          fields.location,
          fields.goals,
          fields.friendsCount,
          fields.friendsWho,
          id,
        ]
      );
      await client.query(
        `DELETE FROM outing_people
          WHERE outing_id = $1 AND (person_id IS NULL OR NOT person_id = ANY($2::int[]))`,
        [id, people.map((person) => person.id)]
      );
      await addPeople(client, id, people);
    });

    res.json({ id });
  })
);

router.delete(
  "/:id",
  canRun,
  route(async (req, res) => {
    const id = toId(req.params.id);
    if (id) await pool.query("DELETE FROM outings WHERE id = $1", [id]);
    res.json({ deleted: id });
  })
);

// Each only moves an outing forward from the step before it, so two leaders
// pressing at once, or an old screen, cannot put one back.
function moveTo(status, from, stamp, wrongStep) {
  return route(async (req, res) => {
    const id = toId(req.params.id);
    const updated = id
      ? await pool.query(
          `UPDATE outings SET status = $1, ${stamp} = now()
            WHERE id = $2 AND status = $3
            RETURNING id`,
          [status, id, from]
        )
      : { rows: [] };
    if (updated.rows[0]) return res.json({ id, status });

    const exists = id ? await pool.query("SELECT 1 FROM outings WHERE id = $1", [id]) : { rows: [] };
    if (!exists.rows[0]) return res.status(404).json({ error: "That outing could not be found." });
    return res.status(409).json({ error: wrongStep });
  });
}

router.post(
  "/:id/start",
  canRun,
  moveTo("active", "planned", "started_at", "This outing has already started.")
);

router.post(
  "/:id/end",
  canRun,
  moveTo("ended", "active", "ended_at", "This outing isn't running.")
);

// Submitting again replaces the first answer, so someone can correct theirs.
router.post(
  "/:id/evaluation",
  route(async (req, res) => {
    const id = toId(req.params.id);
    const outing = id ? await findOuting(id, req.userId) : null;
    if (!outing || outing.my_row === null) {
      return res.status(404).json({ error: "That outing could not be found." });
    }
    if (outing.status !== "ended") {
      return res.status(409).json({ error: "This outing hasn't ended yet." });
    }

    const { error, fields } = cleanEvaluation(req.body);
    if (error) return res.status(400).json({ error });

    await pool.query(
      `INSERT INTO outing_evaluations (outing_person_id, user_id, how, met_nf, nf_details)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (outing_person_id)
       DO UPDATE SET user_id = $2, how = $3, met_nf = $4, nf_details = $5, submitted_at = now()`,
      [outing.my_row, req.userId, fields.how, fields.metNf, fields.nfDetails]
    );
    res.json({ submitted: true });
  })
);

module.exports = { router, outingsToEvaluate };
