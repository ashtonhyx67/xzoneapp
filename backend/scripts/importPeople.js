#!/usr/bin/env node
//
// Loads a spreadsheet export into the people table. The app itself has no
// import button — the database is edited in the grid on the Database page —
// so this is how a bulk or first-time load gets done.
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
const { readPeopleCsv, importPeople } = require("../lib/peopleCsv");

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

  const parsed = readPeopleCsv(fs.readFileSync(file, "utf8"));
  if (parsed.error) {
    console.error(parsed.error);
    process.exit(1);
  }

  console.log(`Found ${parsed.people.length} people in ${path.basename(file)}.`);
  if (parsed.ignored.length) {
    console.log(`Ignoring unrecognised columns: ${parsed.ignored.join(", ")}`);
  }
  parsed.warnings.forEach((w) => console.log(`  ! ${w}`));

  if (dryRun) {
    console.log("\n--dry-run: nothing written. People that would be imported:");
    parsed.people.forEach((p) => console.log(`  ${p.name}${p.role ? ` (${p.role})` : ""}`));
    await pool.end();
    return;
  }

  const { created, updated } = await importPeople(pool, parsed.people);
  console.log(`\nImported: ${created} created, ${updated} updated.`);
  await pool.end();
}

main().catch(async (err) => {
  console.error("Import failed:", err.message);
  await pool.end().catch(() => {});
  process.exit(1);
});
