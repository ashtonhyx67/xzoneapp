const express = require("express");

const { pool } = require("../db");
const { requireAuth, requireAdmin } = require("../middleware/auth");
const { readPeopleCsv, importPeople } = require("../lib/peopleCsv");

const router = express.Router();

const route = (handler) => (req, res, next) => handler(req, res, next).catch(next);

// Every field on a person, in the order the source spreadsheet used.
const FIELDS = [
  "name",
  "photo_url",
  "role",
  "team",
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
];

const MAX_SHORT = 200;
const MAX_LONG = 4000;
const LONG_FIELDS = new Set(["general_information", "updates", "next_steps", "photo_url"]);

function normalize(body) {
  const values = {};
  for (const field of FIELDS) {
    if (field === "birthday") {
      // An empty date must become NULL, not the string "".
      const raw = String(body.birthday ?? "").trim();
      values.birthday = raw === "" ? null : raw;
      continue;
    }
    const limit = LONG_FIELDS.has(field) ? MAX_LONG : MAX_SHORT;
    values[field] = String(body[field] ?? "").slice(0, limit).trim();
  }
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

router.use(requireAuth, requireAdmin);

router.get(
  "/",
  route(async (req, res) => {
    const result = await pool.query(`${SELECT_PERSON} ORDER BY lower(p.name)`);
    res.json({ people: result.rows });
  })
);

router.post(
  "/",
  route(async (req, res) => {
    const values = normalize(req.body);
    if (!values.name) {
      return res.status(400).json({ error: "A name is required." });
    }

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
  route(async (req, res) => {
    const upserts = Array.isArray(req.body?.upserts) ? req.body.upserts : [];
    const deletes = Array.isArray(req.body?.deletes) ? req.body.deletes : [];

    if (upserts.length === 0 && deletes.length === 0) {
      return res.json({ created: 0, updated: 0, deleted: 0, people: [] });
    }

    const ids = deletes.map(Number).filter(Number.isInteger);
    const columns = FIELDS.join(", ");
    const placeholders = FIELDS.map((_, i) => `$${i + 1}`).join(", ");
    const assignments = FIELDS.map((f, i) => `${f} = $${i + 1}`).join(", ");

    const client = await pool.connect();
    let created = 0;
    let updated = 0;

    try {
      await client.query("BEGIN");

      if (ids.length > 0) {
        await client.query("DELETE FROM people WHERE id = ANY($1::int[])", [ids]);
      }

      for (const row of upserts) {
        const values = normalize(row);
        if (!values.name) {
          throw Object.assign(new Error("Every row needs a name."), { httpStatus: 400 });
        }
        const params = FIELDS.map((f) => values[f]);

        if (row.id === null || row.id === undefined || row.id === "") {
          await client.query(
            `INSERT INTO people (${columns}) VALUES (${placeholders})`,
            params
          );
          created += 1;
        } else {
          const id = Number(row.id);
          if (!Number.isInteger(id)) {
            throw Object.assign(new Error("A row had an unrecognized id."), { httpStatus: 400 });
          }
          const result = await client.query(
            `UPDATE people SET ${assignments}, updated_at = now()
              WHERE id = $${FIELDS.length + 1}`,
            [...params, id]
          );
          updated += result.rowCount;
        }
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
    const result = await pool.query(`${SELECT_PERSON} ORDER BY lower(p.name)`);
    res.json({ created, updated, deleted: ids.length, people: result.rows });
  })
);

router.put(
  "/:id",
  route(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: "Unknown person." });

    const values = normalize(req.body);
    if (!values.name) {
      return res.status(400).json({ error: "A name is required." });
    }

    const assignments = FIELDS.map((f, i) => `${f} = $${i + 1}`).join(", ");

    try {
      const updated = await pool.query(
        `UPDATE people SET ${assignments}, updated_at = now()
          WHERE id = $${FIELDS.length + 1} RETURNING id`,
        [...FIELDS.map((f) => values[f]), id]
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

// Bulk import straight from a spreadsheet export, so loading the roster does
// not require a terminal.
router.post(
  "/import",
  route(async (req, res) => {
    const csv = String(req.body?.csv ?? "");
    if (!csv.trim()) {
      return res.status(400).json({ error: "That file looked empty." });
    }

    const parsed = readPeopleCsv(csv);
    if (parsed.error) {
      return res.status(400).json({ error: parsed.error });
    }

    const { created, updated } = await importPeople(pool, parsed.people);
    res.json({
      created,
      updated,
      total: parsed.people.length,
      ignored: parsed.ignored,
      warnings: parsed.warnings,
    });
  })
);

router.delete(
  "/:id",
  route(async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ error: "Unknown person." });

    const deleted = await pool.query("DELETE FROM people WHERE id = $1 RETURNING id", [id]);
    if (!deleted.rows[0]) return res.status(404).json({ error: "Person not found." });
    res.json({ deleted: id });
  })
);

module.exports = { router, FIELDS };
