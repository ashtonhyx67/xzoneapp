const { Pool, types } = require("pg");

const { OWNER_EMAIL } = require("./lib/owner");
const { DEFAULT_GROUP } = require("./lib/groups");
const { DEFAULT_ZONE } = require("./lib/zones");

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

// Lifts the structure that used to belong to an account into the default zone,
// once, so nobody has to retype it. It runs only when no zone has a structure
// yet, which makes re-running the migration a no-op rather than a duplicate.
// The oldest account's structure wins: that is the owner's, the one that has
// actually been kept up to date.
async function migrateRosterToZone() {
  const already = await pool.query("SELECT 1 FROM zone_rosters LIMIT 1");
  if (already.rows[0]) return;

  const source = await pool.query(
    "SELECT user_id, title FROM rosters ORDER BY user_id LIMIT 1"
  );
  if (!source.rows[0]) return;

  const { user_id: userId, title } = source.rows[0];

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    await client.query("INSERT INTO zone_rosters (zone, title) VALUES ($1, $2)", [
      DEFAULT_ZONE,
      title,
    ]);

    const groups = await client.query(
      "SELECT id, position FROM roster_groups WHERE user_id = $1 ORDER BY position",
      [userId]
    );

    for (const group of groups.rows) {
      const created = await client.query(
        "INSERT INTO zone_roster_groups (zone, position) VALUES ($1, $2) RETURNING id",
        [DEFAULT_ZONE, group.position]
      );

      await client.query(
        `INSERT INTO zone_roster_rows (group_id, position, role, name, year, school)
         SELECT $1::int, position, role, name, year, school
           FROM roster_rows WHERE group_id = $2::int ORDER BY position`,
        [created.rows[0].id, group.id]
      );
    }

    await client.query("COMMIT");
    console.log(`Structure migrated to zone ${DEFAULT_ZONE}.`);
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

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

  // The owner is always an admin, whenever that account happens to be created.
  await pool.query(`UPDATE users SET is_admin = true WHERE lower(email) = $1 AND NOT is_admin;`, [
    OWNER_EMAIL,
  ]);

  // ---------- Groups ----------
  // Access is decided by which group an account is in; lib/groups.js says what
  // each group can do. is_admin stays in step with it so nothing that still
  // reads the old flag breaks.
  await pool.query(`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS group_key TEXT NOT NULL DEFAULT '${DEFAULT_GROUP}';
  `);

  // Existing accounts keep the access they already had: admins become the admin
  // group, everyone else lands in the default group.
  await pool.query(`
    UPDATE users SET group_key = 'admin'
     WHERE is_admin AND group_key = '${DEFAULT_GROUP}';
  `);

  await pool.query(`UPDATE users SET group_key = 'owner' WHERE lower(email) = $1;`, [OWNER_EMAIL]);

  // ---------- PIN ----------
  // A 4-digit PIN is the everyday way back in: the session ends when the app is
  // closed, and the PIN screen replaces the sign-up card on the next launch.
  // It is hashed like a password, and rate limited because 4 digits is only
  // 10,000 combinations.
  await pool.query(`
    ALTER TABLE users
      ADD COLUMN IF NOT EXISTS pin_hash TEXT,
      ADD COLUMN IF NOT EXISTS pin_set_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS pin_attempts INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS pin_locked_until TIMESTAMPTZ;
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

  // The scorecard tracks which team a person belongs to (e.g. "A" in XIII A).
  await pool.query(`
    ALTER TABLE people ADD COLUMN IF NOT EXISTS team TEXT NOT NULL DEFAULT '';
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

  // ---------- Zones ----------
  // Each zone keeps its own members and its own structure. A person belongs to
  // one zone; '' means unassigned, which is visible to everyone and filable by
  // anyone who can edit the database.
  await pool.query(`
    ALTER TABLE people ADD COLUMN IF NOT EXISTS zone TEXT NOT NULL DEFAULT '';
  `);

  await pool.query(`CREATE INDEX IF NOT EXISTS people_zone_idx ON people (zone);`);

  // Everything that predates zones came from the one zone the app used to be.
  // Asked as two statements rather than one with a NOT EXISTS guard: as a
  // single statement it reads as though it might stop partway once the first
  // row is filed, and being obviously right matters more here than being one
  // query. Once any person has a zone this never fires again, so someone
  // deliberately left unassigned stays that way.
  const zoned = await pool.query("SELECT 1 FROM people WHERE zone <> '' LIMIT 1");
  if (!zoned.rows[0]) {
    const filed = await pool.query("UPDATE people SET zone = $1 WHERE zone = ''", [DEFAULT_ZONE]);
    if (filed.rowCount > 0) {
      console.log(`Filed ${filed.rowCount} people into zone ${DEFAULT_ZONE}.`);
    }
  }

  // Which zones an account may edit. A leader can be in several.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_zones (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      zone TEXT NOT NULL,
      PRIMARY KEY (user_id, zone)
    );
  `);

  await pool.query(`CREATE INDEX IF NOT EXISTS user_zones_user_id_idx ON user_zones (user_id);`);

  // ---------- Structure, per zone ----------
  // The structure used to be private to each account. It belongs to the zone
  // now, so the leaders of a zone work on one shared picture. The old per-user
  // tables are left in place rather than dropped: they are the backup if this
  // migration ever needs looking at.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS zone_rosters (
      zone TEXT PRIMARY KEY,
      title TEXT NOT NULL DEFAULT 'Structure',
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS zone_roster_groups (
      id SERIAL PRIMARY KEY,
      zone TEXT NOT NULL REFERENCES zone_rosters(zone) ON DELETE CASCADE,
      position INTEGER NOT NULL
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS zone_roster_rows (
      id SERIAL PRIMARY KEY,
      group_id INTEGER NOT NULL REFERENCES zone_roster_groups(id) ON DELETE CASCADE,
      position INTEGER NOT NULL,
      role TEXT NOT NULL DEFAULT '',
      name TEXT NOT NULL DEFAULT '',
      year TEXT NOT NULL DEFAULT '',
      school TEXT NOT NULL DEFAULT ''
    );
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS zone_roster_groups_zone_idx
      ON zone_roster_groups (zone, position);
  `);

  await pool.query(`
    CREATE INDEX IF NOT EXISTS zone_roster_rows_group_id_idx
      ON zone_roster_rows (group_id, position);
  `);

  await migrateRosterToZone();

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
