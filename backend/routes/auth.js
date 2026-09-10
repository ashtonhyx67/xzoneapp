const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} = require("@simplewebauthn/server");

const { pool } = require("../db");
const { requireAuth } = require("../middleware/auth");
const { isOwnerEmail } = require("../lib/owner");
const { getGroup, permissionsFor, DEFAULT_GROUP } = require("../lib/groups");
const { normalizeEmail, isValidEmail, EMAIL_ERROR } = require("../lib/email");

const router = express.Router();

// RP_ID must be the bare domain (no protocol/port), e.g. "myapp.up.railway.app".
// ORIGIN must be the full origin, e.g. "https://myapp.up.railway.app".
// Both default to localhost for local development.
const RP_NAME = "X Zone App";
const RP_ID = process.env.RP_ID || "localhost";
const ORIGIN = process.env.ORIGIN || "http://localhost:5173";

// WebAuthn ties a credential to one domain. If RP_ID does not match the domain
// the page is actually on, the browser refuses in ways that read as the feature
// being broken rather than misconfigured — so say which it is.
function rpMismatch(req) {
  const host = String(req.headers.host || "").split(":")[0];
  if (!host || host === RP_ID) return null;
  // A subdomain of RP_ID is fine; anything else is not.
  if (host.endsWith(`.${RP_ID}`)) return null;

  return (
    `Face ID is set up for "${RP_ID}" but this page is on "${host}". ` +
    `Set RP_ID to "${host}" and ORIGIN to "https://${host}" in the server's variables.`
  );
}

// A challenge is single-use and short-lived; anything older is not accepted.
const CHALLENGE_TTL = "5 minutes";

// Express 4 does not catch rejected promises, so an async route that throws
// leaves the request hanging forever. Every async handler goes through this.
const route = (handler) => (req, res, next) => handler(req, res, next).catch(next);

function signToken(userId) {
  return jwt.sign({ userId }, process.env.JWT_SECRET, { expiresIn: "30d" });
}

function publicUser(row) {
  return { id: row.id, name: row.name, email: row.email };
}

async function saveChallenge(userId, challenge) {
  await pool.query(
    `INSERT INTO webauthn_challenges (user_id, challenge) VALUES ($1, $2)
     ON CONFLICT (user_id) DO UPDATE SET challenge = $2, created_at = now()`,
    [userId, challenge]
  );
}

// Reads and deletes in one statement, so a challenge can never be replayed.
async function takeChallenge(userId) {
  const result = await pool.query(
    `DELETE FROM webauthn_challenges
      WHERE user_id = $1 AND created_at > now() - interval '${CHALLENGE_TTL}'
      RETURNING challenge`,
    [userId]
  );
  return result.rows[0]?.challenge || null;
}

// ---------- PIN ----------

// Four digits is only 10,000 combinations, so guessing is rate limited: after
// this many wrong tries in a row the account stops accepting PINs for a while.
// The password (and Face ID) still work, so nobody is ever locked out for good.
const MAX_PIN_ATTEMPTS = 5;
const PIN_LOCKOUT = "15 minutes";

function isValidPin(pin) {
  return /^[0-9]{4}$/.test(String(pin ?? ""));
}

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
    faceIdEnabled: Boolean(row.face_id_enabled),
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
  route(async (req, res) => {
    const { name, password } = req.body;
    const email = normalizeEmail(req.body.email);

    if (!name || !email || !password) {
      return res.status(400).json({ error: "Name, email, and password are all required." });
    }
    // Checked here rather than trusting the browser: the input is type="email",
    // but nothing stops a request being made without one.
    if (!isValidEmail(email)) {
      return res.status(400).json({ error: EMAIL_ERROR });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: "Password must be at least 8 characters." });
    }

    const passwordHash = await bcrypt.hash(password, 10);

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
          String(name).trim(),
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
  route(async (req, res) => {
    const { password } = req.body;
    const email = normalizeEmail(req.body.email);

    if (!email || !password) {
      return res.status(400).json({ error: "Email and password are required." });
    }

    const result = await pool.query(
      `SELECT u.id, u.name, u.email, u.password_hash, u.group_key, u.is_admin, u.pin_hash,
              EXISTS (SELECT 1 FROM webauthn_credentials c WHERE c.user_id = u.id) AS face_id_enabled
         FROM users u
        WHERE u.email = $1`,
      [email]
    );
    const user = result.rows[0];

    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({ error: "Incorrect email or password." });
    }

    res.json(sessionPayload(user));
  })
);

router.get(
  "/me",
  requireAuth,
  route(async (req, res) => {
    // One round trip for the profile and whether Face ID is already enrolled,
    // so the dashboard never has to guess.
    const result = await pool.query(
      `SELECT u.id, u.name, u.email, u.group_key, u.is_admin, u.pin_hash,
              EXISTS (SELECT 1 FROM webauthn_credentials c WHERE c.user_id = u.id) AS face_id_enabled
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

// ---------- WebAuthn (Face ID / Touch ID / fingerprint) ----------

// Step 1: an already-signed-in user asks to enroll their device's biometrics.
router.get(
  "/webauthn/register-options",
  requireAuth,
  route(async (req, res) => {
    const mismatch = rpMismatch(req);
    if (mismatch) return res.status(500).json({ error: mismatch });

    const userResult = await pool.query("SELECT id, name, email FROM users WHERE id = $1", [
      req.userId,
    ]);
    const user = userResult.rows[0];
    if (!user) return res.status(404).json({ error: "User not found." });

    const existing = await pool.query(
      "SELECT credential_id, transports FROM webauthn_credentials WHERE user_id = $1",
      [req.userId]
    );

    const options = await generateRegistrationOptions({
      rpName: RP_NAME,
      rpID: RP_ID,
      userID: Buffer.from(String(user.id)),
      userName: user.email,
      userDisplayName: user.name,
      attestationType: "none",
      authenticatorSelection: {
        authenticatorAttachment: "platform", // Face ID / Touch ID / Windows Hello
        userVerification: "required",
        residentKey: "preferred",
      },
      // Asks the browser for the authenticator built into this device. Without
      // it Chrome is free to lead with "use a phone" and offer a QR code or a
      // third-party passkey provider, which is not what Face ID here means.
      hints: ["client-device"],
      // Stops the same device being enrolled twice.
      excludeCredentials: existing.rows.map((c) => ({
        id: c.credential_id,
        transports: c.transports || undefined,
      })),
    });

    await saveChallenge(req.userId, options.challenge);
    res.json(options);
  })
);

// Step 2: verify the device's response and store the credential.
router.post(
  "/webauthn/register-verify",
  requireAuth,
  route(async (req, res) => {
    const expectedChallenge = await takeChallenge(req.userId);
    if (!expectedChallenge) {
      return res.status(400).json({ error: "That registration expired. Please try again." });
    }

    let verification;
    try {
      verification = await verifyRegistrationResponse({
        response: req.body,
        expectedChallenge,
        expectedOrigin: ORIGIN,
        expectedRPID: RP_ID,
      });
    } catch (err) {
      // A rejected device is the caller's problem, not a server fault.
      return res.status(400).json({ error: err.message || "Could not verify that device." });
    }

    if (!verification.verified || !verification.registrationInfo) {
      return res.status(400).json({ error: "Could not verify that device." });
    }

    const { credential } = verification.registrationInfo;

    await pool.query(
      `INSERT INTO webauthn_credentials (user_id, credential_id, public_key, counter, device_type, transports)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (credential_id) DO NOTHING`,
      [
        req.userId,
        credential.id,
        Buffer.from(credential.publicKey).toString("base64url"),
        credential.counter,
        "platform",
        JSON.stringify(credential.transports || []),
      ]
    );

    res.json({ verified: true });
  })
);

// Step 3: at login time, before the user types a password, offer Face ID
// if their account has an enrolled device.
router.post(
  "/webauthn/login-options",
  route(async (req, res) => {
    const email = normalizeEmail(req.body.email);
    if (!email) return res.status(400).json({ error: "Email is required." });

    const result = await pool.query(
      `SELECT u.id, c.credential_id, c.transports
         FROM users u
         JOIN webauthn_credentials c ON c.user_id = u.id
        WHERE u.email = $1`,
      [email]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Face ID isn't set up for this account." });
    }

    const userId = result.rows[0].id;
    const options = await generateAuthenticationOptions({
      rpID: RP_ID,
      userVerification: "required",
      allowCredentials: result.rows.map((c) => ({
        id: c.credential_id,
        transports: c.transports || undefined,
      })),
    });

    await saveChallenge(userId, options.challenge);
    res.json({ options, userId });
  })
);

// Step 4: verify the biometric response and sign the user in.
router.post(
  "/webauthn/login-verify",
  route(async (req, res) => {
    const { userId, response } = req.body;
    if (!userId || !response?.id) {
      return res.status(400).json({ error: "Incomplete Face ID response." });
    }

    const expectedChallenge = await takeChallenge(userId);
    if (!expectedChallenge) {
      return res.status(400).json({ error: "That sign-in expired. Please try again." });
    }

    const credResult = await pool.query(
      `SELECT c.id, c.credential_id, c.public_key, c.counter,
              u.id AS user_id, u.name, u.email, u.group_key, u.is_admin, u.pin_hash
         FROM webauthn_credentials c
         JOIN users u ON u.id = c.user_id
        WHERE c.credential_id = $1 AND c.user_id = $2`,
      [response.id, userId]
    );
    const saved = credResult.rows[0];
    if (!saved) return res.status(400).json({ error: "Unrecognized device." });

    let verification;
    try {
      verification = await verifyAuthenticationResponse({
        response,
        expectedChallenge,
        expectedOrigin: ORIGIN,
        expectedRPID: RP_ID,
        credential: {
          id: saved.credential_id,
          publicKey: Buffer.from(saved.public_key, "base64url"),
          counter: Number(saved.counter),
        },
      });
    } catch (err) {
      return res.status(401).json({ error: err.message || "Face ID verification failed." });
    }

    if (!verification.verified) {
      return res.status(401).json({ error: "Face ID verification failed." });
    }

    await pool.query("UPDATE webauthn_credentials SET counter = $1 WHERE id = $2", [
      verification.authenticationInfo.newCounter,
      saved.id,
    ]);

    res.json(
      sessionPayload({
        id: saved.user_id,
        name: saved.name,
        email: saved.email,
        group_key: saved.group_key,
        is_admin: saved.is_admin,
        pin_hash: saved.pin_hash,
        face_id_enabled: true,
      })
    );
  })
);

// ---------- PIN sign-in ----------

// Set a PIN, or change an existing one. The user is already signed in here;
// changing a PIN that exists also needs the current one, so a borrowed unlocked
// session cannot quietly lock the real owner out.
router.post(
  "/pin",
  requireAuth,
  route(async (req, res) => {
    const { pin, currentPin } = req.body || {};

    if (!isValidPin(pin)) {
      return res.status(400).json({ error: "Your PIN must be exactly 4 digits." });
    }

    const existing = await pool.query("SELECT pin_hash FROM users WHERE id = $1", [req.userId]);
    if (!existing.rows[0]) return res.status(404).json({ error: "User not found." });

    const currentHash = existing.rows[0].pin_hash;
    if (currentHash) {
      if (!isValidPin(currentPin)) {
        return res.status(400).json({ error: "Enter your current PIN to change it." });
      }
      if (!(await bcrypt.compare(String(currentPin), currentHash))) {
        return res.status(401).json({ error: "That current PIN is incorrect." });
      }
    }

    const pinHash = await bcrypt.hash(String(pin), 10);
    await pool.query(
      `UPDATE users
          SET pin_hash = $1, pin_set_at = now(), pin_attempts = 0, pin_locked_until = NULL
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
          SET pin_hash = NULL, pin_set_at = NULL, pin_attempts = 0, pin_locked_until = NULL
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
  route(async (req, res) => {
    const email = normalizeEmail(req.body.email);
    const pin = String(req.body.pin ?? "");

    if (!email || !isValidPin(pin)) {
      return res.status(400).json({ error: "Enter your 4-digit PIN." });
    }

    const result = await pool.query(
      `SELECT u.id, u.name, u.email, u.group_key, u.is_admin, u.pin_hash, u.pin_attempts, u.pin_locked_until,
              EXISTS (SELECT 1 FROM webauthn_credentials c WHERE c.user_id = u.id) AS face_id_enabled
         FROM users u
        WHERE u.email = $1`,
      [email]
    );
    const user = result.rows[0];

    // An unknown account and a wrong PIN read the same, so this page can't be
    // used to find out who has an account.
    if (!user || !user.pin_hash) {
      return res.status(401).json({ error: "That PIN didn't work. Sign in with your password." });
    }

    if (user.pin_locked_until && new Date(user.pin_locked_until) > new Date()) {
      return res.status(429).json({
        error: `Too many wrong PINs. Try again in ${minutesUntil(
          user.pin_locked_until
        )} minutes, or sign in with your password.`,
        lockedOut: true,
      });
    }

    if (!(await bcrypt.compare(pin, user.pin_hash))) {
      const attempts = Number(user.pin_attempts || 0) + 1;
      const lock = attempts >= MAX_PIN_ATTEMPTS;

      await pool.query(
        `UPDATE users
            SET pin_attempts = $1,
                pin_locked_until = CASE WHEN $2 THEN now() + interval '${PIN_LOCKOUT}' ELSE NULL END
          WHERE id = $3`,
        [lock ? 0 : attempts, lock, user.id]
      );

      if (lock) {
        return res.status(429).json({
          error: "Too many wrong PINs. Try again in 15 minutes, or sign in with your password.",
          lockedOut: true,
        });
      }

      const left = MAX_PIN_ATTEMPTS - attempts;
      return res.status(401).json({
        error: `Incorrect PIN. ${left} ${left === 1 ? "try" : "tries"} left before it locks.`,
        attemptsLeft: left,
      });
    }

    await pool.query(
      "UPDATE users SET pin_attempts = 0, pin_locked_until = NULL WHERE id = $1",
      [user.id]
    );

    res.json(sessionPayload(user));
  })
);

module.exports = router;
