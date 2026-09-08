const { Pool, types } = require("pg");

// A DATE has no time and no timezone, but node-pg turns it into a local-midnight
// JS Date, which JSON.stringify then shifts to UTC — sending every birthday a
// day early from any timezone ahead of UTC. Hand back the raw 'YYYY-MM-DD'.
types.setTypeParser(types.builtins.DATE, (value) => value);

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.error(
    [
      "DATABASE_URL is not set.",
      "",
      "On Railway: add a PostgreSQL database to this project (New -> Database ->",
      "PostgreSQL) and make sure it is in the SAME project as this service, so",
      "Railway injects DATABASE_URL automatically.",
      "Locally: copy backend/.env.example to backend/.env and fill it in.",
    ].join("\n")
  );
  process.exit(1);
}

// Railway's *internal* Postgres hostname does not speak SSL, so forcing SSL on
// just because NODE_ENV=production makes the connection fail with
// "The server does not support SSL connections". Decide from the actual host
// instead, and let PGSSLMODE / ?sslmode= in the URL override.
function shouldUseSsl(url) {
  const sslmode =
    process.env.PGSSLMODE || (url.match(/[?&]sslmode=([^&]+)/) || [])[1];
  if (sslmode) return sslmode !== "disable";

  const host = (url.match(/@([^:/?]+)/) || [])[1] || "";
  if (!host) return false;
  const isLocal =
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "::1" ||
    host.endsWith(".railway.internal") ||
    host.endsWith(".internal");
  return !isLocal;
}

const pool = new Pool({
  connectionString,
  ssl: shouldUseSsl(connectionString) ? { rejectUnauthorized: false } : false,
});

// Don't let a dropped idle connection take the whole process down.
pool.on("error", (err) => {
  console.error("Unexpected Postgres client error:", err.message);
});

async function initSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS webauthn_credentials (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      credential_id TEXT UNIQUE NOT NULL,
      public_key TEXT NOT NULL,
      counter BIGINT NOT NULL DEFAULT 0,
      device_type TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  // Postgres does not index foreign keys automatically, and every WebAuthn
  // lookup filters on user_id.
  await pool.query(`
    CREATE INDEX IF NOT EXISTS webauthn_credentials_user_id_idx
      ON webauthn_credentials (user_id);
  `);

  // Remembering the transports the authenticator reported lets the browser go
  // straight to the right one instead of prompting for all of them.
  await pool.query(`
    ALTER TABLE webauthn_credentials
      ADD COLUMN IF NOT EXISTS transports JSONB;
  `);

  // Access to the people database is restricted; ordinary accounts can sign in
  // but see nothing until an admin promotes them.
  await pool.query(`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT false;
  `);

  // The first account to exist owns the instance, otherwise there would be no
  // way to grant the very first admin.
  await pool.query(`
    UPDATE users SET is_admin = true
     WHERE id = (SELECT MIN(id) FROM users)
       AND NOT EXISTS (SELECT 1 FROM users WHERE is_admin);
  `);

  // ---------- People ----------
  // One shared record per person. This is the source of truth; the roster is
  // an arrangement of these people, not a second copy of them.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS people (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      photo_url TEXT NOT NULL DEFAULT '',
      role TEXT NOT NULL DEFAULT '',
      contact TEXT NOT NULL DEFAULT '',
      telegram TEXT NOT NULL DEFAULT '',
      instagram TEXT NOT NULL DEFAULT '',
      ministry TEXT NOT NULL DEFAULT '',
      birthday DATE,
      follow_up TEXT NOT NULL DEFAULT '',
      school TEXT NOT NULL DEFAULT '',
      came_church TEXT NOT NULL DEFAULT '',
      invited_by TEXT NOT NULL DEFAULT '',
      religion TEXT NOT NULL DEFAULT '',
      general_information TEXT NOT NULL DEFAULT '',
      updates TEXT NOT NULL DEFAULT '',
      next_steps TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  // Age is derived from birthday rather than stored, so it can never go stale.
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS people_name_key ON people (lower(name));
  `);

  // ---------- Roster ----------
  // One roster per user. Groups are the visual blocks separated by blank rows
  // in the source spreadsheet; rows are the people inside them.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS rosters (
      user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL DEFAULT 'Roster',
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS roster_groups (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      position INTEGER NOT NULL
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS roster_rows (
      id SERIAL PRIMARY KEY,
      group_id INTEGER NOT NULL REFERENCES roster_groups(id) ON DELETE CASCADE,
      position INTEGER NOT NULL,
      role TEXT NOT NULL DEFAULT '',
      name TEXT NOT NULL DEFAULT '',
      year TEXT NOT NULL DEFAULT '',
      school TEXT NOT NULL DEFAULT '',
      color TEXT NOT NULL DEFAULT ''
    );
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS roster_groups_user_id_idx
      ON roster_groups (user_id, position);
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS roster_rows_group_id_idx
      ON roster_rows (group_id, position);
  `);

  // A roster row points at a person; the inline name/role/school columns stay
  // as a fallback for rows that have not been linked to one yet.
  await pool.query(`
    ALTER TABLE roster_rows
      ADD COLUMN IF NOT EXISTS person_id INTEGER REFERENCES people(id) ON DELETE SET NULL;
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS roster_rows_person_id_idx ON roster_rows (person_id);
  `);

  // Temporary store for in-flight WebAuthn challenges.
  // A real production app might use Redis for this; a table is fine at this scale.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS webauthn_challenges (
      user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      challenge TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  console.log("Database schema ready.");
}

// The database service often isn't accepting connections yet at the moment the
// app boots, so retry instead of exiting into a restart loop.
async function initSchemaWithRetry(attempts = 8) {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      await initSchema();
      return true;
    } catch (err) {
      const wait = Math.min(1000 * 2 ** (attempt - 1), 15000);
      console.error(
        `Database init failed (attempt ${attempt}/${attempts}): ${err.message}`
      );
      if (attempt === attempts) return false;
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  return false;
}

module.exports = { pool, initSchema, initSchemaWithRetry };
