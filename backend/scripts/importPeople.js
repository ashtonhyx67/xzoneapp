#!/usr/bin/env node
//
// One-time import of the people database from the Google Sheet's Data tab.
//
//   1. In Google Sheets: File > Download > Comma-separated values (.csv)
//      with the Data tab selected.
//   2. From the backend folder:
//        DATABASE_URL=... node scripts/importPeople.js "path/to/XIII A - Data.csv"
//
// Re-running is safe: people are matched on name and updated in place, so you
// can re-import after fixing the sheet without creating duplicates.
//
// Pass --dry-run to see exactly what would change without writing anything.

const fs = require("fs");
const path = require("path");

require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const { pool } = require("../db");

// The sheet's headers, mapped onto our columns. Matching is case- and
// space-insensitive so "XIII A Name " still lines up with "name".
const HEADER_MAP = {
  name: "name",
  xiiianame: "name",
  photo: "photo_url",
  role: "role",
  status: "role",
  team: "team",
  contact: "contact",
  telegram: "telegram",
  instagram: "instagram",
  ministry: "ministry",
  birthday: "birthday",
  followup: "follow_up",
  school: "school",
  camechurch: "came_church",
  invitedby: "invited_by",
  religion: "religion",
  generalinformation: "general_information",
  updates: "updates",
  nextsteps: "next_steps",
};

// Age is deliberately ignored: it is derived from birthday on read.
const IGNORED = new Set(["age", ""]);

const key = (header) => String(header).toLowerCase().replace(/[^a-z]/g, "");

// A minimal RFC 4180 parser: handles quoted fields, escaped quotes and
// newlines inside cells, which the notes columns definitely contain.
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (char !== "\r") {
      field += char;
    }
  }

  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

// The sheet has a title banner above the real headers, so find the row that
// actually looks like a header rather than assuming row 1.
function findHeaderRow(rows) {
  for (let i = 0; i < Math.min(rows.length, 30); i++) {
    const keys = rows[i].map(key);
    if (keys.includes("role") && keys.some((k) => k.endsWith("name"))) return i;
  }
  return -1;
}

// "6 Nov 2005", "17 Mar 2006" and ISO dates all appear in the sheet.
const MONTHS = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

function parseBirthday(raw) {
  const value = String(raw || "").trim();
  if (!value) return null;

  const iso = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return value;

  const named = value.match(/^(\d{1,2})\s+([A-Za-z]{3,})\s+(\d{4})$/);
  if (named) {
    const month = MONTHS[named[2].slice(0, 3).toLowerCase()];
    if (month) {
      return `${named[3]}-${String(month).padStart(2, "0")}-${named[1].padStart(2, "0")}`;
    }
  }

  const slash = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slash) {
    return `${slash[3]}-${slash[2].padStart(2, "0")}-${slash[1].padStart(2, "0")}`;
  }

  return { unparsed: value };
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const file = args.find((a) => !a.startsWith("--"));

  if (!file) {
    console.error('Usage: node scripts/importPeople.js "path/to/export.csv" [--dry-run]');
    process.exit(1);
  }
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is not set.");
    process.exit(1);
  }

  const rows = parseCsv(fs.readFileSync(file, "utf8"));
  const headerIndex = findHeaderRow(rows);
  if (headerIndex === -1) {
    console.error("Could not find a header row containing 'Name' and 'Role'.");
    process.exit(1);
  }

  const headers = rows[headerIndex];
  const columns = headers.map((h) => HEADER_MAP[key(h)] || null);

  const unknown = headers.filter((h, i) => !columns[i] && !IGNORED.has(key(h)));
  if (unknown.length) {
    console.log(`Ignoring unrecognised columns: ${unknown.join(", ")}`);
  }

  const people = [];
  const warnings = [];

  for (const row of rows.slice(headerIndex + 1)) {
    const person = {};
    columns.forEach((column, i) => {
      if (column) person[column] = String(row[i] ?? "").trim();
    });

    if (!person.name) continue;

    if (person.birthday) {
      const parsed = parseBirthday(person.birthday);
      if (parsed && parsed.unparsed) {
        warnings.push(`${person.name}: could not read birthday "${parsed.unparsed}" — left blank`);
        person.birthday = null;
      } else {
        person.birthday = parsed;
      }
    } else {
      person.birthday = null;
    }

    people.push(person);
  }

  console.log(`Found ${people.length} people in ${path.basename(file)}.`);
  warnings.forEach((w) => console.log(`  ! ${w}`));

  if (dryRun) {
    console.log("\n--dry-run: nothing written. People that would be imported:");
    people.forEach((p) => console.log(`  ${p.name}${p.role ? ` (${p.role})` : ""}`));
    await pool.end();
    return;
  }

  const fields = [
    "name", "photo_url", "role", "team", "contact", "telegram", "instagram", "ministry",
    "birthday", "follow_up", "school", "came_church", "invited_by", "religion",
    "general_information", "updates", "next_steps",
  ];

  const client = await pool.connect();
  let created = 0;
  let updated = 0;

  try {
    await client.query("BEGIN");

    for (const person of people) {
      const values = fields.map((f) => (f === "birthday" ? person[f] ?? null : person[f] ?? ""));
      const placeholders = fields.map((_, i) => `$${i + 1}`).join(", ");
      const assignments = fields
        .filter((f) => f !== "name")
        .map((f) => `${f} = EXCLUDED.${f}`)
        .join(", ");

      const result = await client.query(
        `INSERT INTO people (${fields.join(", ")}) VALUES (${placeholders})
         ON CONFLICT (lower(name)) DO UPDATE SET ${assignments}, updated_at = now()
         RETURNING (xmax = 0) AS inserted`,
        values
      );

      if (result.rows[0].inserted) created++;
      else updated++;
    }

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  console.log(`\nImported: ${created} created, ${updated} updated.`);
  await pool.end();
}

main().catch(async (err) => {
  console.error("Import failed:", err.message);
  await pool.end().catch(() => {});
  process.exit(1);
});
