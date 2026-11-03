const express = require("express");

const { pool } = require("../db");
const {
  requireAuth,
  optionalAuth,
  loadAccess,
  requirePermission,
} = require("../middleware/auth");
const { PERMISSIONS } = require("../lib/groups");
const { rateLimit } = require("../lib/rateLimit");
const {
  MAX_NAME,
  MAX_TITLE,
  MAX_CAPTION,
  MAX_ROOMS,
  MAX_TASKS_PER_ROOM,
  MAX_PHOTOS_PER_ROOM,
  newCode,
  newPhotoId,
  newCheckinKey,
  cleanText,
  cleanNote,
  cleanLogistics,
  decodePhoto,
  shareOut,
} = require("../lib/narnia");

const router = express.Router();

const route = (handler) => (req, res, next) => handler(req, res, next).catch(next);

// Everyone in the room scans at about the same moment, usually on one Wi-Fi, so
// this is generous. It stops a script working through codes, not a congregation.
const checkInLimit = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 200,
  message: "Too many check-ins from this network. Wait a few minutes and try again.",
});

const canRun = [requireAuth, requirePermission(PERMISSIONS.RUN_NARNIA)];

// An id from the address, or null. Bounded because Postgres raises an error on a
// number too big for its integer column, which would read as a server fault.
function toId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 && id < 2 ** 31 ? id : null;
}

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

// ---------- The standard ----------

const photoUrl = (id) => `/api/narnia/photos/${id}`;

// Every room with its tasks and photos, in order. The image bytes are not read
// here; a phone asks for each photo by its address when it draws it.
async function readStandard() {
  const [rooms, tasks, photos] = await Promise.all([
    pool.query("SELECT id, name FROM narnia_rooms ORDER BY position, id"),
    pool.query(
      "SELECT id, room_id, title, note, logistics FROM narnia_tasks ORDER BY position, id"
    ),
    pool.query(
      "SELECT id, room_id, task_id, caption FROM narnia_photos ORDER BY created_at, id"
    ),
  ]);

  const byRoom = new Map(
    rooms.rows.map((room) => [room.id, { id: room.id, name: room.name, tasks: [], photos: [] }])
  );
  const byTask = new Map();

  for (const task of tasks.rows) {
    const shaped = {
      id: task.id,
      roomId: task.room_id,
      title: task.title,
      note: task.note,
      logistics: task.logistics,
      photos: [],
    };
    byTask.set(task.id, shaped);
    byRoom.get(task.room_id)?.tasks.push(shaped);
  }

  for (const photo of photos.rows) {
    const shaped = { id: photo.id, caption: photo.caption, url: photoUrl(photo.id) };
    if (photo.task_id !== null) byTask.get(photo.task_id)?.photos.push(shaped);
    else byRoom.get(photo.room_id)?.photos.push(shaped);
  }

  return [...byRoom.values()];
}

// ---------- A session ----------

async function sessionById(id) {
  const found = await pool.query("SELECT * FROM narnia_sessions WHERE id = $1", [id]);
  return found.rows[0] ?? null;
}

async function sessionByCode(code) {
  const found = await pool.query("SELECT * FROM narnia_sessions WHERE code = $1", [
    String(code ?? "").toUpperCase().slice(0, 32),
  ]);
  return found.rows[0] ?? null;
}

// Guards a change to a session: it has to exist, and still be running.
function openSession(handler) {
  return route(async (req, res, next) => {
    const id = toId(req.params.id);
    const session = id ? await sessionById(id) : null;
    if (!session) return res.status(404).json({ error: "That BM could not be found." });
    if (session.status !== "open") {
      return res.status(409).json({ error: "This BM has already finished." });
    }
    req.session = session;
    return handler(req, res, next);
  });
}

async function readCheckins(sessionId) {
  const found = await pool.query(
    `SELECT id, user_id, name, room_id, by_hand, checked_in_at
       FROM narnia_checkins
      WHERE session_id = $1
      ORDER BY checked_in_at, id`,
    [sessionId]
  );
  return found.rows;
}

async function readAssignments(sessionId) {
  const found = await pool.query(
    `SELECT a.checkin_id, a.task_id
       FROM narnia_assignments a
       JOIN narnia_checkins c ON c.id = a.checkin_id
      WHERE c.session_id = $1`,
    [sessionId]
  );
  return found.rows;
}

async function readDone(sessionId) {
  const found = await pool.query(
    "SELECT task_id, done_by FROM narnia_task_done WHERE session_id = $1",
    [sessionId]
  );
  return new Map(found.rows.map((row) => [row.task_id, row.done_by]));
}

// Everyone with an account who is not on this session's list. A clean-up is not a
// service, so this is only ever for the leaders' own information, and is counted
// nowhere else. Three things keep it honest:
//
//   - A name someone typed still counts for the account with that exact name.
//   - Whoever ran it was plainly there, whether or not they scanned their own code.
//   - An account created after it finished could not have come.
const NOT_HERE = `
  SELECT u.name
    FROM users u
   WHERE u.created_at <= COALESCE(s.ended_at, now())
     AND u.id IS DISTINCT FROM s.created_by
     AND NOT EXISTS (
       SELECT 1 FROM narnia_checkins c
        WHERE c.session_id = s.id
          AND (c.user_id = u.id OR lower(c.name) = lower(u.name))
     )
`;

async function readNotHere(sessionId) {
  const found = await pool.query(
    `SELECT missing.name
       FROM narnia_sessions s
       CROSS JOIN LATERAL (${NOT_HERE}) AS missing
      WHERE s.id = $1
      ORDER BY lower(missing.name)`,
    [sessionId]
  );
  return found.rows.map((row) => row.name);
}

// What the leader running it sees: everyone who came, and every task with who is
// on it. The photos and notes are left out, since this is read every few seconds
// and none of it is needed to delegate.
async function readBoard(session) {
  const [rooms, checkins, assignments, done, notHere] = await Promise.all([
    readStandard(),
    readCheckins(session.id),
    readAssignments(session.id),
    readDone(session.id),
    readNotHere(session.id),
  ]);

  const peopleOn = new Map();
  const tasksOf = new Map();
  for (const { checkin_id: checkinId, task_id: taskId } of assignments) {
    peopleOn.set(taskId, [...(peopleOn.get(taskId) ?? []), checkinId]);
    tasksOf.set(checkinId, [...(tasksOf.get(checkinId) ?? []), taskId]);
  }

  return {
    id: session.id,
    code: session.code,
    heldOn: session.held_on,
    status: session.status,
    allowNames: session.allow_names,
    notHere,
    people: checkins.map((row) => ({
      id: row.id,
      name: row.name,
      roomId: row.room_id,
      byHand: row.by_hand,
      taskIds: tasksOf.get(row.id) ?? [],
    })),
    rooms: rooms.map((room) => ({
      id: room.id,
      name: room.name,
      tasks: room.tasks.map((task) => ({
        id: task.id,
        title: task.title,
        logistics: task.logistics,
        people: peopleOn.get(task.id) ?? [],
        done: done.has(task.id),
        doneBy: done.get(task.id) ?? null,
      })),
    })),
  };
}

// The person on the phone: their room, their tasks, what to use for each, and
// what excellent looks like. This is the whole of what someone who only scanned
// a code can read.
async function readJob(session, checkin) {
  const base = {
    session: {
      heldOn: session.held_on,
      status: session.status,
      allowNames: session.allow_names,
    },
    me: null,
    job: null,
  };
  if (!checkin) return base;

  const [rooms, checkins, assignments, done] = await Promise.all([
    readStandard(),
    readCheckins(session.id),
    readAssignments(session.id),
    readDone(session.id),
  ]);

  const nameOf = new Map(checkins.map((row) => [row.id, row.name]));
  const namesOn = new Map();
  for (const { checkin_id: checkinId, task_id: taskId } of assignments) {
    namesOn.set(taskId, [...(namesOn.get(taskId) ?? []), checkinId]);
  }

  const mine = [];
  for (const room of rooms) {
    for (const task of room.tasks) {
      const onIt = namesOn.get(task.id) ?? [];
      if (!onIt.includes(checkin.id)) continue;
      mine.push({
        ...task,
        roomName: room.name,
        with: onIt.filter((id) => id !== checkin.id).map((id) => nameOf.get(id)),
        done: done.has(task.id),
        doneBy: done.get(task.id) ?? null,
      });
    }
  }

  const room = rooms.find((candidate) => candidate.id === checkin.room_id) ?? null;

  return {
    ...base,
    me: { name: checkin.name },
    job: {
      room: room && {
        id: room.id,
        name: room.name,
        photos: room.photos,
        // The rest of the room, so someone who finishes early can see what is
        // still going and go and help.
        tasks: room.tasks.map((task) => ({
          id: task.id,
          title: task.title,
          done: done.has(task.id),
          people: (namesOn.get(task.id) ?? []).map((id) => nameOf.get(id)),
        })),
      },
      tasks: mine,
    },
  };
}

// The check-in this request belongs to: the phone's key first, since it survives
// the app being closed, and then the signed-in account.
async function findCheckin(req, sessionId) {
  const key = req.get("X-Narnia-Key");
  if (key) {
    const found = await pool.query(
      "SELECT * FROM narnia_checkins WHERE session_id = $1 AND access_key = $2",
      [sessionId, key.slice(0, 64)]
    );
    if (found.rows[0]) return found.rows[0];
  }
  if (req.userId) {
    const found = await pool.query(
      "SELECT * FROM narnia_checkins WHERE session_id = $1 AND user_id = $2",
      [sessionId, req.userId]
    );
    if (found.rows[0]) return found.rows[0];
  }
  return null;
}

async function nameTaken(sessionId, name) {
  const found = await pool.query(
    "SELECT 1 FROM narnia_checkins WHERE session_id = $1 AND lower(name) = lower($2) LIMIT 1",
    [sessionId, name]
  );
  return Boolean(found.rows[0]);
}

async function addCheckin(sessionId, { userId = null, name, byHand = false }) {
  const created = await pool.query(
    `INSERT INTO narnia_checkins (session_id, user_id, name, access_key, by_hand)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (session_id, user_id) WHERE user_id IS NOT NULL DO NOTHING
     RETURNING *`,
    [sessionId, userId, name, newCheckinKey(), byHand]
  );
  return created.rows[0] ?? null;
}

// Someone signed in. If they were already on the list under the same name, or
// this phone checked in before they signed in, that is the same person rather
// than a second one, so the row becomes theirs and keeps its room and tasks.
async function checkInAccount(req, session) {
  const account = await pool.query("SELECT id, name FROM users WHERE id = $1", [req.userId]);
  const user = account.rows[0];
  if (!user) return null;

  const mine = await findCheckin(req, session.id);
  if (mine?.user_id === user.id) return mine;

  const unclaimed = mine?.user_id === null
    ? mine
    : (
        await pool.query(
          `SELECT * FROM narnia_checkins
            WHERE session_id = $1 AND user_id IS NULL AND lower(name) = lower($2)
            ORDER BY id LIMIT 1`,
          [session.id, user.name]
        )
      ).rows[0];

  if (unclaimed) {
    const claimed = await pool.query(
      "UPDATE narnia_checkins SET user_id = $1, by_hand = false WHERE id = $2 RETURNING *",
      [user.id, unclaimed.id]
    );
    return claimed.rows[0];
  }

  // Two check-ins from one account at once: the second inserts nothing.
  const created = await addCheckin(session.id, { userId: user.id, name: user.name });
  if (created) return created;
  return findCheckin({ get: () => null, userId: user.id }, session.id);
}

// ---------- Open to anyone holding the code ----------
// These come first, and never ask for a sign-in. Someone scanning with the phone's
// own camera lands in a browser that is not signed in, even if they have the app.

// Fixed content under a random address, so it can be cached for good.
router.get(
  "/photos/:id",
  route(async (req, res) => {
    const found = await pool.query("SELECT mime, data FROM narnia_photos WHERE id = $1", [
      String(req.params.id).slice(0, 64),
    ]);
    const photo = found.rows[0];
    if (!photo) return res.status(404).json({ error: "That photo could not be found." });

    res.setHeader("Content-Type", photo.mime);
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    res.send(photo.data);
  })
);

router.get(
  "/join/:code",
  optionalAuth,
  route(async (req, res) => {
    const session = await sessionByCode(req.params.code);
    if (!session) return res.status(404).json({ error: "That check-in code isn't right." });

    const checkin = await findCheckin(req, session.id);
    res.json(await readJob(session, checkin));
  })
);

router.post(
  "/join/:code",
  checkInLimit,
  optionalAuth,
  route(async (req, res) => {
    const session = await sessionByCode(req.params.code);
    if (!session) return res.status(404).json({ error: "That check-in code isn't right." });

    // Someone already on the list can reopen the page after it has finished;
    // only a new check-in is turned away.
    let checkin = await findCheckin(req, session.id);
    if (session.status !== "open") {
      if (checkin) return res.json({ ...(await readJob(session, checkin)), key: checkin.access_key });
      return res.status(410).json({ error: "This BM has already finished." });
    }

    if (req.userId) {
      checkin = await checkInAccount(req, session);
    }

    if (!checkin) {
      if (!session.allow_names) {
        return res.status(403).json({ error: "Please sign in to your account to check in." });
      }
      const name = cleanText(req.body?.name, MAX_NAME);
      if (!name) return res.status(400).json({ error: "Please tell us your name." });
      if (await nameTaken(session.id, name)) {
        return res.status(409).json({
          error: `${name} has already checked in. If that's someone else, add your surname.`,
        });
      }
      checkin = await addCheckin(session.id, { name });
    }

    res.json({ ...(await readJob(session, checkin)), key: checkin.access_key });
  })
);

// Marks one of your own tasks done. Someone else's is theirs to mark, or a leader's.
router.put(
  "/join/:code/tasks/:taskId",
  optionalAuth,
  route(async (req, res) => {
    const session = await sessionByCode(req.params.code);
    if (!session) return res.status(404).json({ error: "That check-in code isn't right." });
    if (session.status !== "open") {
      return res.status(409).json({ error: "This BM has already finished." });
    }

    const checkin = await findCheckin(req, session.id);
    if (!checkin) return res.status(401).json({ error: "Please check in first." });

    const taskId = toId(req.params.taskId);
    const assigned = taskId
      ? await pool.query(
          "SELECT 1 FROM narnia_assignments WHERE checkin_id = $1 AND task_id = $2",
          [checkin.id, taskId]
        )
      : { rows: [] };
    if (!assigned.rows[0]) {
      return res.status(403).json({ error: "That task isn't one of yours." });
    }

    await setDone(session.id, taskId, req.body?.done === true, checkin.name);
    res.json(await readJob(session, checkin));
  })
);

async function setDone(sessionId, taskId, done, name) {
  if (done) {
    await pool.query(
      `INSERT INTO narnia_task_done (session_id, task_id, done_by)
       VALUES ($1, $2, $3)
       ON CONFLICT (session_id, task_id) DO NOTHING`,
      [sessionId, taskId, name]
    );
  } else {
    await pool.query("DELETE FROM narnia_task_done WHERE session_id = $1 AND task_id = $2", [
      sessionId,
      taskId,
    ]);
  }
}

// ---------- For any signed-in account ----------

router.get(
  "/",
  requireAuth,
  route(async (req, res) => {
    const access = await loadAccess(req.userId);
    if (!access) return res.status(401).json({ error: "Not signed in." });

    const [rooms, open] = await Promise.all([
      readStandard(),
      pool.query("SELECT id, code, held_on FROM narnia_sessions WHERE status = 'open' LIMIT 1"),
    ]);
    const session = open.rows[0];

    // A session's code is only handed to someone already checked in to it.
    // Everyone else has to be in the room to scan it, or the list of who came
    // would stop meaning that they came.
    let myCode = null;
    if (session) {
      const mine = await pool.query(
        "SELECT 1 FROM narnia_checkins WHERE session_id = $1 AND user_id = $2",
        [session.id, req.userId]
      );
      if (mine.rows[0]) myCode = session.code;
    }

    res.json({
      canRun: access.permissions.includes(PERMISSIONS.RUN_NARNIA),
      rooms,
      running: Boolean(session),
      myCode,
    });
  })
);

// ---------- Editing the standard ----------
// Each answers with every room, so the page redraws from one source.

const sendStandard = async (res) => res.json({ rooms: await readStandard() });

router.post(
  "/rooms",
  ...canRun,
  route(async (req, res) => {
    const name = cleanText(req.body?.name, MAX_TITLE);
    if (!name) return res.status(400).json({ error: "A room needs a name." });

    const count = await pool.query("SELECT count(*)::int AS n FROM narnia_rooms");
    if (count.rows[0].n >= MAX_ROOMS) {
      return res.status(400).json({ error: `At most ${MAX_ROOMS} rooms.` });
    }

    await pool.query(
      `INSERT INTO narnia_rooms (name, position)
       VALUES ($1, (SELECT COALESCE(MAX(position), -1) + 1 FROM narnia_rooms))`,
      [name]
    );
    await sendStandard(res);
  })
);

router.patch(
  "/rooms/:id",
  ...canRun,
  route(async (req, res) => {
    const id = toId(req.params.id);
    const name = cleanText(req.body?.name, MAX_TITLE);
    if (!name) return res.status(400).json({ error: "A room needs a name." });

    const updated = id
      ? await pool.query("UPDATE narnia_rooms SET name = $1 WHERE id = $2", [name, id])
      : { rowCount: 0 };
    if (updated.rowCount === 0) return res.status(404).json({ error: "That room is gone." });
    await sendStandard(res);
  })
);

router.delete(
  "/rooms/:id",
  ...canRun,
  route(async (req, res) => {
    const id = toId(req.params.id);
    if (!id) return res.status(404).json({ error: "That room is gone." });

    const count = await pool.query("SELECT count(*)::int AS n FROM narnia_rooms");
    if (count.rows[0].n <= 1) {
      return res.status(409).json({ error: "Narnia needs at least one room." });
    }

    await pool.query("DELETE FROM narnia_rooms WHERE id = $1", [id]);
    await sendStandard(res);
  })
);

function taskFields(body) {
  return {
    title: cleanText(body?.title, MAX_TITLE),
    note: cleanNote(body?.note),
    logistics: cleanLogistics(body?.logistics),
  };
}

router.post(
  "/rooms/:id/tasks",
  ...canRun,
  route(async (req, res) => {
    const roomId = toId(req.params.id);
    const { title, note, logistics } = taskFields(req.body);
    if (!title) return res.status(400).json({ error: "A task needs a name." });

    const room = roomId
      ? await pool.query(
          `SELECT r.id, (SELECT count(*)::int FROM narnia_tasks t WHERE t.room_id = r.id) AS tasks
             FROM narnia_rooms r WHERE r.id = $1`,
          [roomId]
        )
      : { rows: [] };
    if (!room.rows[0]) return res.status(404).json({ error: "That room is gone." });
    if (room.rows[0].tasks >= MAX_TASKS_PER_ROOM) {
      return res.status(400).json({ error: `At most ${MAX_TASKS_PER_ROOM} tasks in a room.` });
    }

    await pool.query(
      `INSERT INTO narnia_tasks (room_id, title, note, logistics, position)
       VALUES ($1, $2, $3, $4,
         (SELECT COALESCE(MAX(position), -1) + 1 FROM narnia_tasks WHERE room_id = $1))`,
      [roomId, title, note, JSON.stringify(logistics)]
    );
    await sendStandard(res);
  })
);

router.patch(
  "/tasks/:id",
  ...canRun,
  route(async (req, res) => {
    const id = toId(req.params.id);
    const { title, note, logistics } = taskFields(req.body);
    if (!title) return res.status(400).json({ error: "A task needs a name." });

    const updated = id
      ? await pool.query(
          "UPDATE narnia_tasks SET title = $1, note = $2, logistics = $3 WHERE id = $4",
          [title, note, JSON.stringify(logistics), id]
        )
      : { rowCount: 0 };
    if (updated.rowCount === 0) return res.status(404).json({ error: "That task is gone." });
    await sendStandard(res);
  })
);

router.delete(
  "/tasks/:id",
  ...canRun,
  route(async (req, res) => {
    const id = toId(req.params.id);
    if (id) await pool.query("DELETE FROM narnia_tasks WHERE id = $1", [id]);
    await sendStandard(res);
  })
);

// A photo of the standard, for a whole room or for one task in it.
router.post(
  "/rooms/:id/photos",
  ...canRun,
  route(async (req, res) => {
    const roomId = toId(req.params.id);
    const photo = decodePhoto(req.body?.image);
    if (!photo) {
      return res.status(400).json({ error: "That photo couldn't be read. Try a different one." });
    }

    const room = roomId
      ? await pool.query(
          `SELECT r.id, (SELECT count(*)::int FROM narnia_photos p WHERE p.room_id = r.id) AS photos
             FROM narnia_rooms r WHERE r.id = $1`,
          [roomId]
        )
      : { rows: [] };
    if (!room.rows[0]) return res.status(404).json({ error: "That room is gone." });
    if (room.rows[0].photos >= MAX_PHOTOS_PER_ROOM) {
      return res.status(400).json({ error: `At most ${MAX_PHOTOS_PER_ROOM} photos in a room.` });
    }

    let taskId = null;
    if (req.body?.taskId != null) {
      taskId = toId(req.body.taskId);
      const task = taskId
        ? await pool.query("SELECT 1 FROM narnia_tasks WHERE id = $1 AND room_id = $2", [
            taskId,
            roomId,
          ])
        : { rows: [] };
      if (!task.rows[0]) return res.status(404).json({ error: "That task is gone." });
    }

    await pool.query(
      `INSERT INTO narnia_photos (id, room_id, task_id, caption, mime, data)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        newPhotoId(),
        roomId,
        taskId,
        cleanText(req.body?.caption, MAX_CAPTION),
        photo.mime,
        photo.data,
      ]
    );
    await sendStandard(res);
  })
);

router.delete(
  "/photos/:id",
  ...canRun,
  route(async (req, res) => {
    await pool.query("DELETE FROM narnia_photos WHERE id = $1", [
      String(req.params.id).slice(0, 64),
    ]);
    await sendStandard(res);
  })
);

// ---------- Running a session ----------
// Each change answers with the whole board, so a leader's screen cannot show a
// new placement next to an old list.

const sendBoard = async (res, session) => res.json({ session: await readBoard(session) });

function validDate(value) {
  const text = String(value ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const parsed = new Date(`${text}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === text
    ? text
    : null;
}

router.get(
  "/sessions/current",
  ...canRun,
  route(async (req, res) => {
    const found = await pool.query("SELECT * FROM narnia_sessions WHERE status = 'open' LIMIT 1");
    res.json({ session: found.rows[0] ? await readBoard(found.rows[0]) : null });
  })
);

// Past clean-ups, newest first, with who came and who did not. The people who came
// without an account are named as well, because the list of who did not come can
// only match them to an account if they typed its exact name.
router.get(
  "/sessions",
  ...canRun,
  route(async (req, res) => {
    const found = await pool.query(
      `SELECT s.id, s.held_on,
              COALESCE(
                (SELECT json_agg(c.name ORDER BY c.checked_in_at, c.id)
                   FROM narnia_checkins c WHERE c.session_id = s.id),
                '[]'
              ) AS came,
              COALESCE(
                (SELECT json_agg(c.name ORDER BY c.checked_in_at, c.id)
                   FROM narnia_checkins c WHERE c.session_id = s.id AND c.user_id IS NULL),
                '[]'
              ) AS without_account,
              COALESCE(
                (SELECT json_agg(missing.name ORDER BY lower(missing.name))
                   FROM (${NOT_HERE}) AS missing),
                '[]'
              ) AS missed,
              (SELECT count(*)::int FROM narnia_task_done d WHERE d.session_id = s.id) AS tasks_done
         FROM narnia_sessions s
        WHERE s.status = 'ended'
        ORDER BY s.held_on DESC, s.id DESC
        LIMIT 60`
    );
    res.json({
      sessions: found.rows.map((row) => ({
        id: row.id,
        heldOn: row.held_on,
        came: row.came,
        withoutAccount: row.without_account,
        missed: row.missed,
        tasksDone: row.tasks_done,
      })),
    });
  })
);

router.post(
  "/sessions",
  ...canRun,
  route(async (req, res) => {
    // The day as the leader's phone has it, since the server may be in another
    // timezone and this is what gets read back in the history.
    const heldOn = validDate(req.body?.heldOn);

    try {
      // Whether names are allowed carries over from the last one, so turning them
      // off once everyone has an account stays off without being asked each time.
      const created = await pool.query(
        `INSERT INTO narnia_sessions (code, held_on, created_by, allow_names)
         VALUES ($1, COALESCE($2::date, CURRENT_DATE), $3,
           COALESCE((SELECT allow_names FROM narnia_sessions ORDER BY id DESC LIMIT 1), true))
         RETURNING *`,
        [newCode(), heldOn, req.userId]
      );
      await sendBoard(res, created.rows[0]);
    } catch (err) {
      // Only one can run at a time; see the index in db.js.
      if (err.code === "23505") {
        return res.status(409).json({ error: "A BM is already running." });
      }
      throw err;
    }
  })
);

// A session nobody checked in to is a mis-tap, not a record worth keeping.
router.post(
  "/sessions/:id/end",
  ...canRun,
  openSession(async (req, res) => {
    const { id } = req.session;
    const people = await pool.query(
      "SELECT 1 FROM narnia_checkins WHERE session_id = $1 LIMIT 1",
      [id]
    );
    if (people.rows[0]) {
      await pool.query(
        "UPDATE narnia_sessions SET status = 'ended', ended_at = now() WHERE id = $1",
        [id]
      );
    } else {
      await pool.query("DELETE FROM narnia_sessions WHERE id = $1", [id]);
    }
    res.json({ session: null });
  })
);

router.post(
  "/sessions/:id/allow-names",
  ...canRun,
  openSession(async (req, res) => {
    const updated = await pool.query(
      "UPDATE narnia_sessions SET allow_names = $1 WHERE id = $2 RETURNING *",
      [req.body?.allowNames === true, req.session.id]
    );
    await sendBoard(res, updated.rows[0]);
  })
);

// For someone without a phone on them.
router.post(
  "/sessions/:id/checkins",
  ...canRun,
  openSession(async (req, res) => {
    const name = cleanText(req.body?.name, MAX_NAME);
    if (!name) return res.status(400).json({ error: "Please type a name." });
    if (await nameTaken(req.session.id, name)) {
      return res.status(409).json({ error: `${name} is already on the list.` });
    }
    await addCheckin(req.session.id, { name, byHand: true });
    await sendBoard(res, req.session);
  })
);

router.delete(
  "/sessions/:id/checkins/:checkinId",
  ...canRun,
  openSession(async (req, res) => {
    const checkinId = toId(req.params.checkinId);
    if (checkinId) {
      await pool.query("DELETE FROM narnia_checkins WHERE id = $1 AND session_id = $2", [
        checkinId,
        req.session.id,
      ]);
    }
    await sendBoard(res, req.session);
  })
);

async function checkinInSession(sessionId, value) {
  const id = toId(value);
  if (!id) return null;
  const found = await pool.query(
    "SELECT * FROM narnia_checkins WHERE id = $1 AND session_id = $2",
    [id, sessionId]
  );
  return found.rows[0] ?? null;
}

// Puts someone on a task, which also puts them in that task's room. With
// fromTaskId it is a move from that task rather than an extra one.
router.post(
  "/sessions/:id/assign",
  ...canRun,
  openSession(async (req, res) => {
    const checkin = await checkinInSession(req.session.id, req.body?.checkinId);
    if (!checkin) return res.status(404).json({ error: "That person isn't checked in." });

    const taskId = toId(req.body?.taskId);
    const task = taskId
      ? await pool.query("SELECT room_id FROM narnia_tasks WHERE id = $1", [taskId])
      : { rows: [] };
    if (!task.rows[0]) return res.status(404).json({ error: "That task is gone." });

    const fromTaskId = toId(req.body?.fromTaskId);

    await withTransaction(async (client) => {
      if (fromTaskId) {
        await client.query("DELETE FROM narnia_assignments WHERE checkin_id = $1 AND task_id = $2", [
          checkin.id,
          fromTaskId,
        ]);
      }
      await client.query(
        `INSERT INTO narnia_assignments (checkin_id, task_id) VALUES ($1, $2)
         ON CONFLICT DO NOTHING`,
        [checkin.id, taskId]
      );
      await client.query("UPDATE narnia_checkins SET room_id = $1 WHERE id = $2", [
        task.rows[0].room_id,
        checkin.id,
      ]);
    });

    await sendBoard(res, req.session);
  })
);

// Off a task, but still in the room: they are waiting for another one.
router.post(
  "/sessions/:id/unassign",
  ...canRun,
  openSession(async (req, res) => {
    const checkin = await checkinInSession(req.session.id, req.body?.checkinId);
    const taskId = toId(req.body?.taskId);
    if (checkin && taskId) {
      await pool.query("DELETE FROM narnia_assignments WHERE checkin_id = $1 AND task_id = $2", [
        checkin.id,
        taskId,
      ]);
    }
    await sendBoard(res, req.session);
  })
);

// Sends someone to a room with no task yet, or back to the list with roomId null.
// Tasks elsewhere go, because being moved means they are no longer doing those.
router.post(
  "/sessions/:id/room",
  ...canRun,
  openSession(async (req, res) => {
    const checkin = await checkinInSession(req.session.id, req.body?.checkinId);
    if (!checkin) return res.status(404).json({ error: "That person isn't checked in." });

    const roomId = req.body?.roomId == null ? null : toId(req.body.roomId);
    if (req.body?.roomId != null) {
      const room = roomId
        ? await pool.query("SELECT 1 FROM narnia_rooms WHERE id = $1", [roomId])
        : { rows: [] };
      if (!room.rows[0]) return res.status(404).json({ error: "That room is gone." });
    }

    await withTransaction(async (client) => {
      await client.query(
        `DELETE FROM narnia_assignments a
          USING narnia_tasks t
          WHERE a.task_id = t.id
            AND a.checkin_id = $1
            AND t.room_id IS DISTINCT FROM $2`,
        [checkin.id, roomId]
      );
      await client.query("UPDATE narnia_checkins SET room_id = $1 WHERE id = $2", [
        roomId,
        checkin.id,
      ]);
    });

    await sendBoard(res, req.session);
  })
);

router.post(
  "/sessions/:id/share-out",
  ...canRun,
  openSession(async (req, res) => {
    const board = await readBoard(req.session);
    const roomOfTask = new Map();
    const tasks = board.rooms.flatMap((room) =>
      room.tasks.map((task) => {
        roomOfTask.set(task.id, room.id);
        return { id: task.id, roomId: room.id, done: task.done };
      })
    );

    const added = shareOut({ people: board.people, tasks });

    await withTransaction(async (client) => {
      for (const { checkinId, taskId } of added) {
        await client.query(
          `INSERT INTO narnia_assignments (checkin_id, task_id) VALUES ($1, $2)
           ON CONFLICT DO NOTHING`,
          [checkinId, taskId]
        );
        await client.query(
          "UPDATE narnia_checkins SET room_id = COALESCE(room_id, $1) WHERE id = $2",
          [roomOfTask.get(taskId), checkinId]
        );
      }
    });

    await sendBoard(res, req.session);
  })
);

router.post(
  "/sessions/:id/done",
  ...canRun,
  openSession(async (req, res) => {
    const taskId = toId(req.body?.taskId);
    const task = taskId
      ? await pool.query("SELECT 1 FROM narnia_tasks WHERE id = $1", [taskId])
      : { rows: [] };
    if (!task.rows[0]) return res.status(404).json({ error: "That task is gone." });

    await setDone(req.session.id, taskId, req.body?.done === true, req.access.user.name);
    await sendBoard(res, req.session);
  })
);

module.exports = router;
