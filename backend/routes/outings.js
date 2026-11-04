const express = require("express");

const { pool } = require("../db");
const { requireAuth, loadAccess, requirePermission } = require("../middleware/auth");
const { PERMISSIONS } = require("../lib/groups");
const { cleanOuting, cleanEvaluation, friendNotes } = require("../lib/outings");
const { newPhotoId } = require("../lib/narnia");
const { normalizeTeam, canEditTeam } = require("../lib/teams");

const router = express.Router();

const route = (handler) => (req, res, next) => handler(req, res, next).catch(next);

// A picture of someone new. Open, because an <img> cannot send a sign-in, so holding
// the long random address is what lets a leader's screen show it, the same way the
// photos of the rooms work. Never listed anywhere.
router.get(
  "/photos/:id",
  route(async (req, res) => {
    const found = await pool.query("SELECT mime, data FROM person_photos WHERE id = $1", [
      String(req.params.id).slice(0, 64),
    ]);
    const photo = found.rows[0];
    if (!photo) return res.status(404).json({ error: "That picture could not be found." });

    res.setHeader("Content-Type", photo.mime);
    res.setHeader("Cache-Control", "private, max-age=31536000, immutable");
    res.send(photo.data);
  })
);

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
         (SELECT u.name FROM users u WHERE u.id = o.created_by) AS organiser_name,
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
function publicOuting(row, canManage, userId) {
  const isOrganiser = row.created_by === userId;
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
    organiser: row.organiser_name ?? "",
    isOrganiser,
    // The organiser runs their own outing; leaders can step in on any. Everyone
    // else on it sees it as it was planned.
    canEdit: canManage || isOrganiser,
    mine: row.my_row !== null,
    toEvaluate: row.status === "ended" && row.my_row !== null && row.i_submitted === false,
    people: row.people.map((person) =>
      canManage
        ? person
        : { id: person.id, personId: person.personId, name: person.name }
    ),
  };
}

function photoUrl(id) {
  return `/api/outings/photos/${id}`;
}

function publicFriend(row) {
  return {
    id: row.id,
    name: row.name,
    photoUrl: row.photo_id ? photoUrl(row.photo_id) : "",
    age: row.age,
    birthday: row.birthday,
    stage: row.stage,
    school: row.school,
    contact: row.contact,
    telegram: row.telegram,
    instagram: row.instagram,
    religion: row.religion,
    notes: row.notes,
    personId: row.person_id,
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
        WHERE $2::boolean OR my_row IS NOT NULL OR created_by = $1
        ORDER BY held_on DESC, id DESC
        LIMIT 200`,
      [req.userId, canManage]
    );

    res.json({
      canRun: canManage,
      outings: found.rows.map((row) => publicOuting(row, canManage, req.userId)),
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
      pool.query(
        `SELECT p.id, p.name, p.team_key,
                EXISTS (
                  SELECT 1 FROM users u
                   WHERE u.person_id = p.id OR lower(u.name) = lower(p.name)
                ) AS has_account
           FROM people p
          ORDER BY lower(p.name)`
      ),
      pool.query(
        `SELECT p.id FROM people p, users me
          WHERE me.id = $1 AND (p.id = me.person_id OR lower(p.name) = lower(me.name))
          LIMIT 1`,
        [req.userId]
      ),
    ]);
    res.json({
      people: people.rows.map((row) => ({
        id: row.id,
        name: row.name,
        team: row.team_key,
        hasAccount: row.has_account,
      })),
      me: me.rows[0]?.id ?? null,
      myName: req.access.user.name,
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
    if (!outing || (!canManage && outing.my_row === null && outing.created_by !== req.userId)) {
      return res.status(404).json({ error: "That outing could not be found." });
    }

    // A leader reads them all. Anyone else reads their own, to change it.
    const evaluations = await pool.query(
      `SELECT e.id, e.how, e.met_nf, e.nf_details, e.submitted_at, op.id AS row_id, op.name
         FROM outing_evaluations e
         JOIN outing_people op ON op.id = e.outing_person_id
        WHERE op.outing_id = $1 AND ($2::boolean OR op.id = $3)
        ORDER BY e.submitted_at`,
      [id, canManage, outing.my_row]
    );

    const friends = await pool.query(
      "SELECT * FROM outing_friends WHERE evaluation_id = ANY($1::int[]) ORDER BY id",
      [evaluations.rows.map((row) => row.id)]
    );

    res.json({
      canRun: canManage,
      outing: publicOuting(outing, canManage, req.userId),
      evaluations: evaluations.rows.map((row) => ({
        name: row.name,
        mine: row.row_id === outing.my_row,
        how: row.how,
        metNf: row.met_nf,
        nfDetails: row.nf_details,
        friends: friends.rows
          .filter((friend) => friend.evaluation_id === row.id)
          .map(publicFriend),
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

// Whoever plans an outing is on it. Through their person record when the account
// has one (linked, or the same name); otherwise by the account's name, which is
// enough for the outing to show up for them.
async function organiserOf(userId) {
  const found = await pool.query(
    `SELECT me.name, p.id AS person_id, p.name AS person_name
       FROM users me
       LEFT JOIN people p ON p.id = me.person_id OR lower(p.name) = lower(me.name)
      WHERE me.id = $1
      ORDER BY (p.id = me.person_id) DESC NULLS LAST
      LIMIT 1`,
    [userId]
  );
  const row = found.rows[0];
  if (!row) return null;
  return row.person_id
    ? { id: row.person_id, name: row.person_name }
    : { id: null, name: row.name };
}

async function addOrganiser(client, outingId, organiser) {
  if (!organiser) return;
  if (organiser.id) {
    await addPeople(client, outingId, [organiser]);
    return;
  }
  await client.query(
    `INSERT INTO outing_people (outing_id, person_id, name)
     SELECT $1, NULL, $2
      WHERE NOT EXISTS (
        SELECT 1 FROM outing_people WHERE outing_id = $1 AND lower(name) = lower($2)
      )`,
    [outingId, organiser.name]
  );
}

// Changing, starting, ending and deleting an outing: its organiser, or anyone who
// runs outings. Answers with the outing's status, or sends the refusal itself.
async function editableOuting(req, res) {
  const id = toId(req.params.id);
  const found = id
    ? await pool.query("SELECT id, status, created_by FROM outings WHERE id = $1", [id])
    : { rows: [] };
  const outing = found.rows[0];
  if (!outing) {
    res.status(404).json({ error: "That outing could not be found." });
    return null;
  }
  if (outing.created_by !== req.userId) {
    const access = await loadAccess(req.userId, req);
    if (!access?.permissions.includes(PERMISSIONS.RUN_OUTINGS)) {
      res.status(403).json({ error: "Only the person who planned this outing can change it." });
      return null;
    }
  }
  return outing;
}

router.post(
  "/",
  canRun,
  route(async (req, res) => {
    const { error, fields } = cleanOuting(req.body);
    if (error) return res.status(400).json({ error });

    const [people, organiser] = await Promise.all([
      peopleFor(fields.personIds),
      organiserOf(req.userId),
    ]);

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
      await addOrganiser(client, created.rows[0].id, organiser);
      return created.rows[0].id;
    });

    res.json({ id });
  })
);

// Anyone taken off loses their evaluation with them. Once it has ended the record
// stays as it was, because people are answering about what actually happened.
router.put(
  "/:id",
  route(async (req, res) => {
    const outing = await editableOuting(req, res);
    if (!outing) return;
    const { id } = outing;
    if (outing.status === "ended") {
      return res.status(409).json({ error: "This outing has already ended." });
    }

    const { error, fields } = cleanOuting(req.body);
    if (error) return res.status(400).json({ error });

    // The organiser stays on it, whoever is making the change.
    const [people, organiser] = await Promise.all([
      peopleFor(fields.personIds),
      outing.created_by ? organiserOf(outing.created_by) : null,
    ]);
    if (organiser?.id && !people.some((person) => person.id === organiser.id)) {
      people.push(organiser);
    }

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
          WHERE outing_id = $1 AND (person_id IS NULL OR NOT person_id = ANY($2::int[]))
            AND NOT (person_id IS NULL AND lower(name) = lower($3))`,
        [id, people.map((person) => person.id), organiser && !organiser.id ? organiser.name : ""]
      );
      await addPeople(client, id, people);
      await addOrganiser(client, id, organiser);
    });

    res.json({ id });
  })
);

router.delete(
  "/:id",
  route(async (req, res) => {
    const outing = await editableOuting(req, res);
    if (!outing) return;
    const { id } = outing;
    await withTransaction(async (client) => {
      // Pictures of anyone not added to the database have nothing left to belong
      // to. Those of people who were added stay, because their record still uses them.
      await client.query(
        `DELETE FROM person_photos
          WHERE id IN (
            SELECT f.photo_id
              FROM outing_friends f
              JOIN outing_evaluations e ON e.id = f.evaluation_id
              JOIN outing_people op ON op.id = e.outing_person_id
             WHERE op.outing_id = $1 AND f.person_id IS NULL AND f.photo_id IS NOT NULL
          )`,
        [id]
      );
      await client.query("DELETE FROM outings WHERE id = $1", [id]);
    });
    res.json({ deleted: id });
  })
);

// Each only moves an outing forward from the step before it, so two leaders
// pressing at once, or an old screen, cannot put one back.
function moveTo(status, from, stamp, wrongStep) {
  return route(async (req, res) => {
    const outing = await editableOuting(req, res);
    if (!outing) return;
    const { id } = outing;
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
  moveTo("active", "planned", "started_at", "This outing has already started.")
);

router.post(
  "/:id/end",
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

    await withTransaction(async (client) => {
      const saved = await client.query(
        `INSERT INTO outing_evaluations (outing_person_id, user_id, how, met_nf, nf_details)
         VALUES ($1, $2, $3, $4, '')
         ON CONFLICT (outing_person_id)
         DO UPDATE SET user_id = $2, how = $3, met_nf = $4, nf_details = '', submitted_at = now()
         RETURNING id`,
        [outing.my_row, req.userId, fields.how, fields.metNf]
      );
      await saveFriends(client, saved.rows[0].id, fields.friends);
    });
    res.json({ submitted: true });
  })
);

async function storePhoto(client, photo) {
  const id = newPhotoId();
  await client.query("INSERT INTO person_photos (id, mime, data) VALUES ($1, $2, $3)", [
    id,
    photo.mime,
    photo.data,
  ]);
  return id;
}

// Brings an evaluation's friends in line with what was just submitted. Anyone a leader
// has already added to the database stays exactly as they are: that record is the
// leader's now, and takes no edits from here.
async function saveFriends(client, evaluationId, friends) {
  const existing = await client.query("SELECT * FROM outing_friends WHERE evaluation_id = $1", [
    evaluationId,
  ]);
  const byId = new Map(existing.rows.map((row) => [row.id, row]));
  const kept = new Set();

  for (const friend of friends) {
    const row = friend.id ? byId.get(friend.id) : null;
    if (row) kept.add(row.id);
    if (row?.person_id) continue;

    let photoId = row?.photo_id ?? null;
    const oldPhoto = photoId;
    if (friend.photo) photoId = await storePhoto(client, friend.photo);
    else if (friend.removePhoto) photoId = null;

    const values = [
      friend.name,
      photoId,
      friend.age,
      friend.birthday,
      friend.stage,
      friend.school,
      friend.contact,
      friend.telegram,
      friend.instagram,
      friend.religion,
      friend.notes,
    ];

    if (row) {
      await client.query(
        `UPDATE outing_friends
            SET name = $1, photo_id = $2, age = $3, birthday = $4, stage = $5, school = $6,
                contact = $7, telegram = $8, instagram = $9, religion = $10, notes = $11
          WHERE id = $12`,
        [...values, row.id]
      );
    } else {
      await client.query(
        `INSERT INTO outing_friends
           (name, photo_id, age, birthday, stage, school, contact, telegram, instagram,
            religion, notes, evaluation_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
        [...values, evaluationId]
      );
    }

    if (oldPhoto && oldPhoto !== photoId) {
      await client.query("DELETE FROM person_photos WHERE id = $1", [oldPhoto]);
    }
  }

  for (const row of existing.rows) {
    if (kept.has(row.id) || row.person_id) continue;
    await client.query("DELETE FROM outing_friends WHERE id = $1", [row.id]);
    if (row.photo_id) {
      await client.query("DELETE FROM person_photos WHERE id = $1", [row.photo_id]);
    }
  }
}

// A leader moving someone into the people database as an NF. With `link`, a person of
// that name is already there, and this says it is them rather than adding them twice.
router.post(
  "/friends/:id/add",
  canRun,
  route(async (req, res) => {
    const id = toId(req.params.id);
    const found = id
      ? await pool.query(
          `SELECT f.*, op.name AS met_by, o.hangout_type, o.location, o.held_on
             FROM outing_friends f
             JOIN outing_evaluations e ON e.id = f.evaluation_id
             JOIN outing_people op ON op.id = e.outing_person_id
             JOIN outings o ON o.id = op.outing_id
            WHERE f.id = $1`,
          [id]
        )
      : { rows: [] };
    const friend = found.rows[0];
    if (!friend) return res.status(404).json({ error: "That friend could not be found." });
    if (friend.person_id) {
      return res.status(409).json({ error: `${friend.name} is already in the database.` });
    }

    const name = String(req.body?.name ?? friend.name).replace(/\s+/g, " ").trim().slice(0, 80);
    if (!name) return res.status(400).json({ error: "A name is required." });

    if (req.body?.link === true) {
      const person = await pool.query("SELECT id FROM people WHERE lower(name) = lower($1)", [name]);
      if (!person.rows[0]) {
        return res.status(404).json({ error: `${name} isn't in the database.` });
      }
      await pool.query("UPDATE outing_friends SET person_id = $1 WHERE id = $2", [
        person.rows[0].id,
        id,
      ]);
      return res.json({ personId: person.rows[0].id });
    }

    const team = normalizeTeam(req.body?.team);
    if (!canEditTeam(req.access, team)) {
      return res.status(403).json({ error: `${team} is not one of your teams.` });
    }

    try {
      const personId = await withTransaction(async (client) => {
        const created = await client.query(
          `INSERT INTO people
             (name, photo_url, role, contact, telegram, instagram, birthday, school,
              stage_of_life, religion, invited_by, general_information, team_key)
           VALUES ($1, $2, 'NF', $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
           RETURNING id`,
          [
            name,
            friend.photo_id ? photoUrl(friend.photo_id) : "",
            friend.contact,
            friend.telegram,
            friend.instagram,
            friend.birthday,
            friend.school,
            friend.stage,
            friend.religion,
            friend.met_by,
            friendNotes(friend, friend),
            team,
          ]
        );
        await client.query("UPDATE outing_friends SET person_id = $1 WHERE id = $2", [
          created.rows[0].id,
          id,
        ]);
        return created.rows[0].id;
      });
      res.json({ personId });
    } catch (err) {
      if (err.code === "23505") {
        return res.status(409).json({
          error: `${name} is already in the database. Same person, or change the name.`,
        });
      }
      throw err;
    }
  })
);

module.exports = { router, outingsToEvaluate };
