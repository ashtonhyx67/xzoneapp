const express = require("express");
const jwt = require("jsonwebtoken");
const { pool } = require("../db");
const { requireAuth } = require("../middleware/auth");
const { isOwnerEmail } = require("../lib/owner");
const { getGroup, permissionsFor, DEFAULT_GROUP } = require("../lib/groups");
const { normalizeEmail, isValidEmail, EMAIL_ERROR } = require("../lib/email");
const {
  hash,
  verify,
  cleanName,
  NAME_ERROR,
  passwordProblem,
  isValidPin,
  isWeakPin,
  WEAK_PIN_ERROR,
} = require("../lib/credentials");
const { rateLimit } = require("../lib/rateLimit");

const router = express.Router();

// One address trying many accounts, or one account many times, is stopped here
// before the per-account counters below are ever reached. Generous enough for a
// room full of people signing up on the same Wi-Fi.
const signInLimit = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 40,
  message: "Too many sign-in attempts from this network. Wait a few minutes and try again.",
});
const signUpLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: "Too many new accounts from this network. Wait a few minutes and try again.",
});
// Changing a PIN checks the current one, so it is a guessing surface too.
const pinChangeLimit = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 10,
  message: "Too many PIN changes. Wait a few minutes and try again.",
});

// Express 4 does not catch rejected promises, so an async route that throws
// leaves the request hanging forever. Every async handler goes through this.
const route = (handler) => (req, res, next) => handler(req, res, next).catch(next);

// The app forgets the token when it is closed, so this only bounds how long a
// copied token stays useful. A week covers an app left open in the background;
// thirty days was a month-long window for a leaked one.
function signToken(userId) {
  return jwt.sign({ userId }, process.env.JWT_SECRET, {
    expiresIn: "7d",
    algorithm: "HS256",
  });
}

function publicUser(row) {
  return { id: row.id, name: row.name, email: row.email };
}

// ---------- PIN ----------

// Four digits is only 10,000 combinations, so guessing is rate limited: after
// this many wrong tries in a row the account stops accepting PINs for a while,
// and after a few of those the PIN is switched off until the password is used. At most 15 guesses ever reach the PIN, and the obvious PINs are
// refused when one is chosen, so those 15 are not the likely ones either.
const MAX_PIN_ATTEMPTS = 5;
const PIN_LOCKOUT = "15 minutes";
const MAX_PIN_LOCKOUTS = 3;

// Passwords get the same treatment, more loosely: they are far harder to guess,
// and a lockout here is also a way for a stranger to annoy a real user.
const MAX_LOGIN_ATTEMPTS = 10;
const LOGIN_LOCKOUT = "15 minutes";

const PIN_PAUSED_ERROR =
  "PIN sign-in is paused after too many wrong PINs. Sign in with your password to turn it back on.";

// Any sign-in that proves more than a PIN does clears the PIN's strikes too.
const CLEAR_STRIKES = `
  login_attempts = 0, login_locked_until = NULL,
  pin_attempts = 0, pin_locked_until = NULL, pin_lockouts = 0`;

function minutesUntil(when) {
  const ms = new Date(when).getTime() - Date.now();
  return Math.max(1, Math.ceil(ms / 60000));
}

// Everything the client needs to decide what to show after a successful
// sign-in, whichever way the user got here. Access travels as a list of named
// permissions, so the app never has to reason about group names.
function sessionPayload(row) {
  const owner = isOwnerEmail(row.email);
  const groupKey = owner ? "owner" : row.group_key || DEFAULT_GROUP;
  const group = getGroup(groupKey);
  const isAdmin = owner || row.is_admin === true;

  return {
    token: signToken(row.id),
    user: publicUser(row),
    isOwner: owner,
    pinSet: Boolean(row.pin_hash),
    group: { key: group.key, label: group.label },
    isAdmin,
    permissions: permissionsFor(groupKey, isAdmin),
  };
}

// ---------- Email + password ----------

router.post(
  "/signup",
  signUpLimit,
  route(async (req, res) => {
    const body = req.body || {};
    const name = cleanName(body.name);
    const email = normalizeEmail(typeof body.email === "string" ? body.email : "");
    const { password } = body;

    if (!name) {
      return res.status(400).json({ error: NAME_ERROR });
    }
    // Checked here rather than trusting the browser: the input is type="email",
    // but nothing stops a request being made without one.
    if (!isValidEmail(email)) {
      return res.status(400).json({ error: EMAIL_ERROR });
    }
    const problem = passwordProblem(password, { email, name });
    if (problem) {
      return res.status(400).json({ error: problem });
    }

    const passwordHash = await hash(password);

    let user;
    try {
      // Let the UNIQUE constraint decide. A SELECT-then-INSERT would let two
      // simultaneous signups for the same email both pass the check.
      // The very first account owns the instance, otherwise there would be no
      // way to grant the first admin.
      const result = await pool.query(
        `INSERT INTO users (name, email, password_hash, is_admin, group_key)
         VALUES ($1, $2, $3, $4 OR NOT EXISTS (SELECT 1 FROM users),
                 CASE WHEN $4 OR NOT EXISTS (SELECT 1 FROM users) THEN $5 ELSE $6 END)
         RETURNING id, name, email, group_key, is_admin, pin_hash`,
        [
          name,
          email,
          passwordHash,
          isOwnerEmail(email),
          // The owner, and the very first account on a fresh install, need full
          // access or there would be nobody to grant it.
          isOwnerEmail(email) ? "owner" : "admin",
          DEFAULT_GROUP,
        ]
      );
      user = result.rows[0];
    } catch (err) {
      if (err.code === "23505") {
        return res.status(409).json({ error: "An account with that email already exists." });
      }
      throw err;
    }

    res.json(sessionPayload(user));
  })
);

router.post(
  "/login",
  signInLimit,
  route(async (req, res) => {
    const body = req.body || {};
    const email = normalizeEmail(typeof body.email === "string" ? body.email : "");
    const password = typeof body.password === "string" ? body.password : "";

    if (!email || !password) {
      return res.status(400).json({ error: "Email and password are required." });
    }

    const found = await pool.query(
      "SELECT id, password_hash, login_locked_until FROM users WHERE email = $1",
      [email]
    );
    const account = found.rows[0];

    if (!account) {
      // Same work, same answer, as a wrong password — so this can't be used
      // to find out who has an account.
      await verify(password, null);
      return res.status(401).json({ error: "Incorrect email or password." });
    }

    if (account.login_locked_until && new Date(account.login_locked_until) > new Date()) {
      return res.status(429).json({
        error: `Too many wrong passwords. Try again in ${minutesUntil(
          account.login_locked_until
        )} minutes.`,
      });
    }

    // Claim the attempt before checking it. Counting afterwards would let a
    // burst of simultaneous guesses all read the same count and all get through.
    const claimed = await pool.query(
      `UPDATE users SET login_attempts = login_attempts + 1
        WHERE id = $1 AND login_attempts < $2
          AND (login_locked_until IS NULL OR login_locked_until <= now())
        RETURNING login_attempts`,
      [account.id, MAX_LOGIN_ATTEMPTS]
    );
    if (claimed.rows.length === 0) {
      return res.status(429).json({ error: "Too many wrong passwords. Try again in 15 minutes." });
    }

    if (!(await verify(password, account.password_hash))) {
      if (claimed.rows[0].login_attempts >= MAX_LOGIN_ATTEMPTS) {
        await pool.query(
          `UPDATE users
              SET login_attempts = 0, login_locked_until = now() + interval '${LOGIN_LOCKOUT}'
            WHERE id = $1`,
          [account.id]
        );
        return res.status(429).json({
          error: `Too many wrong passwords. Try again in 15 minutes.`,
        });
      }
      return res.status(401).json({ error: "Incorrect email or password." });
    }

    const result = await pool.query(
      `UPDATE users u SET ${CLEAR_STRIKES}
        WHERE u.id = $1
        RETURNING u.id, u.name, u.email, u.group_key, u.is_admin, u.pin_hash`,
      [account.id]
    );

    res.json(sessionPayload(result.rows[0]));
  })
);

router.get(
  "/me",
  requireAuth,
  route(async (req, res) => {
    const result = await pool.query(
      `SELECT u.id, u.name, u.email, u.group_key, u.is_admin, u.pin_hash
         FROM users u
        WHERE u.id = $1`,
      [req.userId]
    );
    const row = result.rows[0];
    if (!row) return res.status(404).json({ error: "User not found." });

    // The caller already holds a valid token; re-issuing one here would be
    // noise, so send everything except that.
    const { token, ...session } = sessionPayload(row);
    res.json(session);
  })
);

// ---------- PIN sign-in ----------

// Set a PIN, or change an existing one. The user is already signed in here;
// changing a PIN that exists also needs the current one, so a borrowed unlocked
// session cannot quietly lock the real owner out.
router.post(
  "/pin",
  requireAuth,
  pinChangeLimit,
  route(async (req, res) => {
    const { pin, currentPin } = req.body || {};

    if (!isValidPin(pin)) {
      return res.status(400).json({ error: "Your PIN must be exactly 4 digits." });
    }
    if (isWeakPin(pin)) {
      return res.status(400).json({ error: WEAK_PIN_ERROR, weakPin: true });
    }

    const existing = await pool.query("SELECT pin_hash FROM users WHERE id = $1", [req.userId]);
    if (!existing.rows[0]) return res.status(404).json({ error: "User not found." });

    const currentHash = existing.rows[0].pin_hash;
    if (currentHash) {
      if (!isValidPin(currentPin)) {
        return res.status(400).json({ error: "Enter your current PIN to change it." });
      }
      if (!(await verify(currentPin, currentHash))) {
        return res.status(401).json({ error: "That current PIN is incorrect." });
      }
    }

    const pinHash = await hash(pin);
    await pool.query(
      `UPDATE users
          SET pin_hash = $1, pin_set_at = now(),
              pin_attempts = 0, pin_locked_until = NULL, pin_lockouts = 0
        WHERE id = $2`,
      [pinHash, req.userId]
    );

    res.json({ pinSet: true });
  })
);

// Turning the PIN off falls back to email and password on the next launch.
router.delete(
  "/pin",
  requireAuth,
  route(async (req, res) => {
    await pool.query(
      `UPDATE users
          SET pin_hash = NULL, pin_set_at = NULL,
              pin_attempts = 0, pin_locked_until = NULL, pin_lockouts = 0
        WHERE id = $1`,
      [req.userId]
    );
    res.json({ pinSet: false });
  })
);

// Sign in with the PIN. This is the screen a returning user sees after the app
// has been closed, so it takes the email the device already remembers.
router.post(
  "/pin/login",
  signInLimit,
  route(async (req, res) => {
    const body = req.body || {};
    const email = normalizeEmail(typeof body.email === "string" ? body.email : "");
    const pin = body.pin;

    if (!email || !isValidPin(pin)) {
      return res.status(400).json({ error: "Enter your 4-digit PIN." });
    }

    const found = await pool.query(
      `SELECT id, pin_hash, pin_locked_until, pin_lockouts FROM users WHERE email = $1`,
      [email]
    );
    const account = found.rows[0];

    // An unknown account and a wrong PIN read the same, and take as long, so
    // this page can't be used to find out who has an account.
    if (!account || !account.pin_hash) {
      await verify(pin, null);
      return res.status(401).json({ error: "That PIN didn't work. Sign in with your password." });
    }

    if (account.pin_lockouts >= MAX_PIN_LOCKOUTS) {
      return res.status(423).json({ error: PIN_PAUSED_ERROR, pinPaused: true, lockedOut: true });
    }

    if (account.pin_locked_until && new Date(account.pin_locked_until) > new Date()) {
      return res.status(429).json({
        error: `Too many wrong PINs. Try again in ${minutesUntil(
          account.pin_locked_until
        )} minutes, or sign in with your password.`,
        lockedOut: true,
      });
    }

    // Claim this attempt before checking it. Reading the count, comparing, and
    // then writing count + 1 lets fifty simultaneous guesses all read "0 tries
    // so far" — the row lock on this UPDATE makes them queue instead.
    const claimed = await pool.query(
      `UPDATE users SET pin_attempts = pin_attempts + 1
        WHERE id = $1 AND pin_hash IS NOT NULL
          AND pin_attempts < $2 AND pin_lockouts < $3
          AND (pin_locked_until IS NULL OR pin_locked_until <= now())
        RETURNING pin_attempts`,
      [account.id, MAX_PIN_ATTEMPTS, MAX_PIN_LOCKOUTS]
    );
    if (claimed.rows.length === 0) {
      return res.status(429).json({
        error: "Too many wrong PINs. Try again in 15 minutes, or sign in with your password.",
        lockedOut: true,
      });
    }
    const attempts = claimed.rows[0].pin_attempts;

    if (!(await verify(pin, account.pin_hash))) {
      if (attempts < MAX_PIN_ATTEMPTS) {
        const left = MAX_PIN_ATTEMPTS - attempts;
        return res.status(401).json({
          error: `Incorrect PIN. ${left} ${left === 1 ? "try" : "tries"} left before it locks.`,
          attemptsLeft: left,
        });
      }

      const locked = await pool.query(
        `UPDATE users
            SET pin_attempts = 0,
                pin_lockouts = pin_lockouts + 1,
                pin_locked_until = now() + interval '${PIN_LOCKOUT}'
          WHERE id = $1
          RETURNING pin_lockouts`,
        [account.id]
      );

      if (locked.rows[0].pin_lockouts >= MAX_PIN_LOCKOUTS) {
        return res.status(423).json({ error: PIN_PAUSED_ERROR, pinPaused: true, lockedOut: true });
      }
      return res.status(429).json({
        error: "Too many wrong PINs. Try again in 15 minutes, or sign in with your password.",
        lockedOut: true,
      });
    }

    const result = await pool.query(
      `UPDATE users u
          SET pin_attempts = 0, pin_locked_until = NULL, pin_lockouts = 0
        WHERE u.id = $1
        RETURNING u.id, u.name, u.email, u.group_key, u.is_admin, u.pin_hash`,
      [account.id]
    );

    res.json(sessionPayload(result.rows[0]));
  })
);

module.exports = router;
