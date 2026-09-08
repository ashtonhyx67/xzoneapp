#!/usr/bin/env node
//
// Grants or revokes admin access.
//
//   node scripts/setAdmin.js --list                 who exists, and who is admin
//   node scripts/setAdmin.js someone@example.com    grant admin
//   node scripts/setAdmin.js someone@example.com --revoke
//
// Run against your Railway database:
//   DATABASE_URL="<public URL from Railway>" node scripts/setAdmin.js --list
//
// Accounts are normally managed in the app itself, on the Admin tab. This is
// the way in when nobody has access yet: it puts an account in the admin group,
// which can read and edit everything and manage other accounts.

const path = require("path");

require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const { pool } = require("../db");
const { isOwnerEmail, OWNER_EMAIL } = require("../lib/owner");

async function list() {
  const result = await pool.query(
    `SELECT id, name, email, is_admin, created_at
       FROM users ORDER BY id`
  );

  if (result.rows.length === 0) {
    console.log("No accounts yet. Sign up in the app first — the first account becomes admin.");
    return;
  }

  const width = Math.max(...result.rows.map((r) => r.email.length), 5);
  console.log(`${"EMAIL".padEnd(width)}  ADMIN  NAME`);
  for (const row of result.rows) {
    console.log(
      `${row.email.padEnd(width)}  ${row.is_admin ? " yes " : "  no "}  ${row.name}`
    );
  }

  const admins = result.rows.filter((r) => r.is_admin).length;
  console.log(`\n${result.rows.length} account(s), ${admins} admin(s).`);
  console.log(`Owner: ${OWNER_EMAIL}`);
}

async function setAdmin(email, makeAdmin) {
  const target = String(email).trim().toLowerCase();

  const found = await pool.query("SELECT id, name, email, is_admin FROM users WHERE email = $1", [
    target,
  ]);
  const user = found.rows[0];

  if (!user) {
    console.error(`No account with the email ${target}.`);
    console.error("Run with --list to see the accounts that exist.");
    process.exitCode = 1;
    return;
  }

  if (user.is_admin === makeAdmin) {
    console.log(`${user.email} is already ${makeAdmin ? "an admin" : "not an admin"}. Nothing to do.`);
    return;
  }

  // The owner's access is not revocable here; the app grants it back on the
  // next sign-in anyway, so removing it would only be confusing.
  if (!makeAdmin && isOwnerEmail(target)) {
    console.error(`${target} is the owner of this instance and is always an admin.`);
    console.error("Change the OWNER_EMAIL variable if the owner should be someone else.");
    process.exitCode = 1;
    return;
  }

  // Locking yourself out would leave no way back in except this script, so
  // refuse to remove the last admin.
  if (!makeAdmin) {
    const admins = await pool.query("SELECT count(*)::int AS count FROM users WHERE is_admin");
    if (admins.rows[0].count <= 1) {
      console.error(
        `${user.email} is the only admin. Grant admin to someone else first, ` +
          "otherwise nobody could reach the people database."
      );
      process.exitCode = 1;
      return;
    }
  }

  // Groups are the real access control now; the flag is kept in step for
  // anything still reading it.
  await pool.query("UPDATE users SET is_admin = $1, group_key = $2 WHERE id = $3", [
    makeAdmin,
    makeAdmin ? "admin" : "member",
    user.id,
  ]);
  console.log(
    `${user.email} (${user.name}) is ${makeAdmin ? "now an admin" : "no longer an admin"}.`
  );
  console.log("They will see the change the next time the app loads.");
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is not set.");
    console.error('Try: DATABASE_URL="<Railway public URL>" node scripts/setAdmin.js --list');
    process.exit(1);
  }

  const args = process.argv.slice(2);
  const revoke = args.includes("--revoke");
  const email = args.find((a) => !a.startsWith("--"));

  if (args.includes("--list") || (!email && args.length === 0)) {
    await list();
  } else if (!email) {
    console.error("Usage: node scripts/setAdmin.js <email> [--revoke]   |   --list");
    process.exitCode = 1;
  } else {
    await setAdmin(email, !revoke);
  }

  await pool.end();
}

main().catch(async (err) => {
  console.error("Failed:", err.message);
  await pool.end().catch(() => {});
  process.exit(1);
});
