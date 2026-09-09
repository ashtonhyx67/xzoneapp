const express = require("express");

const { pool } = require("../db");
const { requireAuth, requirePermission } = require("../middleware/auth");
const { PERMISSIONS } = require("../lib/groups");
const { normalizeTeam, canEditTeam, TEAM_KEYS } = require("../lib/teams");
const { roleRank } = require("../lib/roles");

const router = express.Router();

const route = (handler) => (req, res, next) => handler(req, res, next).catch(next);

// Every field on a person, in the order the source spreadsheet used. The single
// letter it kept alongside these ("A" in XIII A) is gone: the team key says it
// already, and X3A cannot disagree with itself the way two columns could. The
// column is left in the database rather than dropped.
const FIELDS = [
  "name",
  "photo_url",
  "role",
  "contact",
  "telegram",
  "instagram",
  "ministry",
  "birthday",
  "follow_up",
  "school",
  "came_church",
  "invited_by",
  "religion",
  "general_information",
  "updates",
  "next_steps",
  "team_key",
  "deployed_to",
];

const MAX_SHORT = 200;
const MAX_LONG = 4000;
const LONG_FIELDS = new Set(["general_information", "updates", "next_steps", "photo_url"]);

function clean(field, raw) {
  if (field === "team_key" || field === "deployed_to") {
    // Anything that is not a known team becomes unassigned rather than an
    // invented one.
    return normalizeTeam(raw);
  }
  if (field === "birthday") {
    // An empty date must become NULL, not the string "".
    const value = String(raw ?? "").trim();
    return value === "" ? null : value;
  }
  const limit = LONG_FIELDS.has(field) ? MAX_LONG : MAX_SHORT;
  return String(raw ?? "").slice(0, limit).trim();
}

// Being "deployed" to the team you already belong to says nothing, so it is
// dropped rather than stored as a second copy of the same fact.
function tidyDeployment(values) {
  if (values.deployed_to && values.deployed_to === values.team_key) values.deployed_to = "";
  return values;
}

// Creating a row: every column gets a value, missing ones default to empty.
function normalize(body) {
  const values = {};
  for (const field of FIELDS) values[field] = clean(field, body[field]);
  return tidyDeployment(values);
}

// Updating a row: only the columns the request actually carried. A field the
// caller never mentioned is left exactly as it is in the database rather than
// being overwritten with "", so a partial payload can never erase data someone
// entered.
function normalizeUpdate(body) {
  const values = {};
  for (const field of FIELDS) {
    if (Object.prototype.hasOwnProperty.call(body ?? {}, field)) {
      values[field] = clean(field, body[field]);
    }
  }
  // Only when the request carried both, since a partial update cannot compare
  // against a column it did not send.
  if ("deployed_to" in values && "team_key" in values) tidyDeployment(values);
  return values;
}

// Age is computed on read so it can never drift out of date, unlike the
// separate Age column the spreadsheet kept alongside Birthday.
const SELECT_PERSON = `
  SELECT p.*,
         CASE WHEN p.birthday IS NULL THEN NULL
              ELSE date_part('year', age(p.birthday))::int
         END AS age
    FROM people p
`;

// A leader may read every team but only change their own. Both ends of a move
// are checked: you cannot edit someone in a team you do not run, and you cannot
// push someone into one either.
function teamRefusal(access, currentTeam, nextTeam) {
  if (!canEditTeam(access, currentTeam)) {
    return `${currentTeam} is not one of your teams.`;
  }
  if (nextTeam !== undefined && !canEditTeam(access, nextTeam)) {
    return `You cannot move someone into ${nextTeam}.`;
  }
  return null;
}

// Current team of each id, so an update can be checked against where the person
// actually is rather than against whatever the request claims.
async function teamsById(ids, client = pool) {
  const found = await client.query(
    "SELECT id, team_key FROM people WHERE id = ANY($1::int[])",
    [ids]
  );
  return new Map(found.rows.map((row) => [row.id, row.team_key]));
}

router.use(requireAuth);

// Reading the directory and changing it are separate permissions, so a group
// can be given the member list without being handed the edit grid.
const canView = requirePermission(PERMISSIONS.VIEW_DIRECTORY);
const canEdit = requirePermission(PERMISSIONS.EDIT_DATABASE);

// Grouped by team, and inside a team ordered by role — leaders down to NF —
// then by name. TEAM_KEYS is already in CG order, so sorting by it puts the
// teams of a CG next to each other for free. Sorted here rather than in SQL
// because both rankings live in lib/, so there is one place to change them.
function teamRank(team) {
  const index = TEAM_KEYS.indexOf(String(team ?? "").trim().toUpperCase());
  // Anyone not filed into a team yet sits at the end, where they are obvious.
  return index === -1 ? TEAM_KEYS.length : index;
}

function byTeamThenRole(a, b) {
  return (
    teamRank(a.team_key) - teamRank(b.team_key) ||
    roleRank(a.role) - roleRank(b.role) ||
    a.name.localeCompare(b.name)
  );
}

router.get(
  "/",
  canView,
  route(async (req, res) => {
    const result = await pool.query(SELECT_PERSON);
    res.json({ people: result.rows.sort(byTeamThenRole) });
  })
);

router.post(
  "/",
  canEdit,
  route(async (req, res) => {
    const values = normalize(req.body);
    if (!values.name) {
      return res.status(400).json({ error: "A name is required." });
    }

    const refusal = teamRefusal(req.access, values.team_key);
    if (refusal) return res.status(403).json({ error: refusal });

    const columns = FIELDS.join(", ");
    const placeholders = FIELDS.map((_, i) => `$${i + 1}`).join(", ");

    try {
      const inserted = await pool.query(
        `INSERT INTO people (${columns}) VALUES (${placeholders}) RETURNING id`,
        FIELDS.map((f) => values[f])
      );
      const result = await pool.query(`${SELECT_PERSON} WHERE p.id = $1`, [
        inserted.rows[0].id,
      ]);
      res.json({ person: result.rows[0] });
    } catch (err) {
      if (err.code === "23505") {
        return res.status(409).json({ error: `${values.name} is already in the database.` });
      }
      if (err.code === "22007" || err.code === "22008") {
        return res.status(400).json({ error: "Birthday must be a valid date (YYYY-MM-DD)." });
      }
      throw err;
    }
  })
);

// The spreadsheet view saves a whole screen of edits at once. Doing it in one
// transaction means a single bad cell can't leave half the grid saved.
router.put(
  "/bulk",
  canEdit,
  route(async (req, res) => {
    const upserts = Array.isArray(req.body?.upserts) ? req.body.upserts : [];
    const deletes = Array.isArray(req.body?.deletes) ? req.body.deletes : [];

    if (upserts.length === 0 && deletes.length === 0) {
      return res.json({ created: 0, updated: 0, deleted: 0, people: [] });
    }

    const ids = deletes.map(Number).filter(Number.isInteger);
    const columns = FIELDS.join(", ");
    const placeholders = FIELDS.map((_, i) => `$${i + 1}`).join(", ");

    // Everything the request touches is checked up front, so a refusal leaves
    // the whole write unapplied rather than half of it.
    // Number(null) is 0, which is a perfectly good integer — so "is this row
    // new?" has to be asked of the raw value, exactly as the write loop below
    // asks it. Getting that wrong would let a new row skip the team check.
    const isNewRow = (row) => row.id === null || row.id === undefined || row.id === "";

    const existingIds = upserts
      .filter((row) => !isNewRow(row))
      .map((row) => Number(row.id))
      .filter(Number.isInteger);

    const touched = [...ids, ...existingIds];
    const teams = touched.length > 0 ? await teamsById(touched) : new Map();

    for (const id of ids) {
      if (!teams.has(id)) continue;
      const refusal = teamRefusal(req.access, teams.get(id));
      if (refusal) return res.status(403).json({ error: refusal });
    }

    for (const row of upserts) {
      const hasTeam = Object.prototype.hasOwnProperty.call(row, "team_key");
      const nextTeam = hasTeam ? normalizeTeam(row.team_key) : undefined;

      if (isNewRow(row)) {
        // A new row only has to land somewhere allowed.
        const refusal = teamRefusal(req.access, nextTeam ?? "");
        if (refusal) return res.status(403).json({ error: refusal });
        continue;
      }

      // An existing one also has to be somewhere allowed already. A row that no
      // longer exists is left to the write loop to report.
      const id = Number(row.id);
      if (!teams.has(id)) continue;

      const refusal = teamRefusal(req.access, teams.get(id), nextTeam);
      if (refusal) return res.status(403).json({ error: refusal });
    }

    const client = await pool.connect();
    let created = 0;
    let updated = 0;
    let deleted = 0;

    try {
      await client.query("BEGIN");

      if (ids.length > 0) {
        // Count what actually went, not what was asked for: a row someone else
        // already removed should not be reported as removed twice.
        const removal = await client.query("DELETE FROM people WHERE id = ANY($1::int[])", [ids]);
        deleted = removal.rowCount;
      }

      for (const row of upserts) {
        const isNew = row.id === null || row.id === undefined || row.id === "";

        if (isNew) {
          const values = normalize(row);
          if (!values.name) {
            throw Object.assign(new Error("Every row needs a name."), { httpStatus: 400 });
          }
          await client.query(
            `INSERT INTO people (${columns}) VALUES (${placeholders})`,
            FIELDS.map((f) => values[f])
          );
          created += 1;
          continue;
        }

        const id = Number(row.id);
        if (!Number.isInteger(id)) {
          throw Object.assign(new Error("A row had an unrecognized id."), { httpStatus: 400 });
        }

        // Only the columns this row actually carried, so a grid that sends a
        // subset cannot wipe the columns it left out.
        const values = normalizeUpdate(row);
        const changed = Object.keys(values);
        if (changed.includes("name") && !values.name) {
          throw Object.assign(new Error("Every row needs a name."), { httpStatus: 400 });
        }
        if (changed.length === 0) continue;

        const rowAssignments = changed.map((f, i) => `${f} = $${i + 1}`).join(", ");
        const result = await client.query(
          `UPDATE people SET ${rowAssignments}, updated_at = now()
            WHERE id = $${changed.length + 1}`,
          [...changed.map((f) => values[f]), id]
        );
        updated += result.rowCount;
      }

      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});

      if (err.code === "23505") {
        return res
          .status(409)
          .json({ error: "Two rows have the same name. Names must be unique." });
      }
      if (err.code === "22007" || err.code === "22008") {
        return res
          .status(400)
          .json({ error: "A birthday isn't a valid date. Use YYYY-MM-DD." });
      }
      if (err.httpStatus) return res.status(err.httpStatus).json({ error: err.message });
      throw err;
    } finally {
      client.release();
    }

    // Hand back the saved table so the grid shows server truth (new ids,
    // recomputed ages) rather than what the browser hoped it wrote.
    const result = await pool.query(SELECT_PERSON);
    res.json({ created, updated, deleted, people: result.rows.sort(byTeamThenRole) });
  })
);

router.put(
  "/:id",
  canEdit,
  route(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: "Unknown person." });

    const values = normalizeUpdate(req.body);
    const changed = Object.keys(values);
    if (changed.includes("name") && !values.name) {
      return res.status(400).json({ error: "A name is required." });
    }

    const teams = await teamsById([id]);
    if (!teams.has(id)) return res.status(404).json({ error: "Person not found." });

    const refusal = teamRefusal(
      req.access,
      teams.get(id),
      changed.includes("team_key") ? values.team_key : undefined
    );
    if (refusal) return res.status(403).json({ error: refusal });
    if (changed.length === 0) {
      const current = await pool.query(`${SELECT_PERSON} WHERE p.id = $1`, [id]);
      if (!current.rows[0]) return res.status(404).json({ error: "Person not found." });
      return res.json({ person: current.rows[0] });
    }

    const assignments = changed.map((f, i) => `${f} = $${i + 1}`).join(", ");

    try {
      const updated = await pool.query(
        `UPDATE people SET ${assignments}, updated_at = now()
          WHERE id = $${changed.length + 1} RETURNING id`,
        [...changed.map((f) => values[f]), id]
      );
      if (!updated.rows[0]) return res.status(404).json({ error: "Person not found." });

      const result = await pool.query(`${SELECT_PERSON} WHERE p.id = $1`, [id]);
      res.json({ person: result.rows[0] });
    } catch (err) {
      if (err.code === "23505") {
        return res.status(409).json({ error: `Another person is already named ${values.name}.` });
      }
      if (err.code === "22007" || err.code === "22008") {
        return res.status(400).json({ error: "Birthday must be a valid date (YYYY-MM-DD)." });
      }
      throw err;
    }
  })
);

router.delete(
  "/:id",
  canEdit,
  route(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: "Unknown person." });

    const teams = await teamsById([id]);
    if (!teams.has(id)) return res.status(404).json({ error: "Person not found." });

    const refusal = teamRefusal(req.access, teams.get(id));
    if (refusal) return res.status(403).json({ error: refusal });

    const deleted = await pool.query("DELETE FROM people WHERE id = $1 RETURNING id", [id]);
    if (!deleted.rows[0]) return res.status(404).json({ error: "Person not found." });
    res.json({ deleted: id });
  })
);

module.exports = { router, FIELDS };
