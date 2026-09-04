const { Pool } = require("pg");

// Railway automatically provides DATABASE_URL when you attach a Postgres
// service to this project. Locally, set it in a .env file (see .env.example).
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl:
    process.env.NODE_ENV === "production"
      ? { rejectUnauthorized: false }
      : false,
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

module.exports = { pool, initSchema };
