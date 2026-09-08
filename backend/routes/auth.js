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

const router = express.Router();

// RP_ID must be the bare domain (no protocol/port), e.g. "myapp.up.railway.app".
// ORIGIN must be the full origin, e.g. "https://myapp.up.railway.app".
// Both default to localhost for local development.
const RP_NAME = "Team App";
const RP_ID = process.env.RP_ID || "localhost";
const ORIGIN = process.env.ORIGIN || "http://localhost:5173";

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

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
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

// ---------- Email + password ----------

router.post(
  "/signup",
  route(async (req, res) => {
    const { name, password } = req.body;
    const email = normalizeEmail(req.body.email);

    if (!name || !email || !password) {
      return res.status(400).json({ error: "Name, email, and password are all required." });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: "Password must be at least 8 characters." });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    let user;
    try {
      // Let the UNIQUE constraint decide. A SELECT-then-INSERT would let two
      // simultaneous signups for the same email both pass the check.
      const result = await pool.query(
        "INSERT INTO users (name, email, password_hash) VALUES ($1, $2, $3) RETURNING id, name, email",
        [String(name).trim(), email, passwordHash]
      );
      user = result.rows[0];
    } catch (err) {
      if (err.code === "23505") {
        return res.status(409).json({ error: "An account with that email already exists." });
      }
      throw err;
    }

    res.json({ token: signToken(user.id), user: publicUser(user) });
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
      `SELECT u.id, u.name, u.email, u.password_hash,
              EXISTS (SELECT 1 FROM webauthn_credentials c WHERE c.user_id = u.id) AS face_id_enabled
         FROM users u
        WHERE u.email = $1`,
      [email]
    );
    const user = result.rows[0];

    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({ error: "Incorrect email or password." });
    }

    res.json({
      token: signToken(user.id),
      user: publicUser(user),
      faceIdEnabled: user.face_id_enabled,
    });
  })
);

router.get(
  "/me",
  requireAuth,
  route(async (req, res) => {
    // One round trip for the profile and whether Face ID is already enrolled,
    // so the dashboard never has to guess.
    const result = await pool.query(
      `SELECT u.id, u.name, u.email,
              EXISTS (SELECT 1 FROM webauthn_credentials c WHERE c.user_id = u.id) AS face_id_enabled
         FROM users u
        WHERE u.id = $1`,
      [req.userId]
    );
    const row = result.rows[0];
    if (!row) return res.status(404).json({ error: "User not found." });

    res.json({ user: publicUser(row), faceIdEnabled: row.face_id_enabled });
  })
);

// ---------- WebAuthn (Face ID / Touch ID / fingerprint) ----------

// Step 1: an already-signed-in user asks to enroll their device's biometrics.
router.get(
  "/webauthn/register-options",
  requireAuth,
  route(async (req, res) => {
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
      `SELECT c.id, c.credential_id, c.public_key, c.counter, u.id AS user_id, u.name, u.email
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

    res.json({
      token: signToken(saved.user_id),
      user: { id: saved.user_id, name: saved.name, email: saved.email },
    });
  })
);

module.exports = router;
