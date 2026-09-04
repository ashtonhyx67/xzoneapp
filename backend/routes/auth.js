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

function signToken(userId) {
  return jwt.sign({ userId }, process.env.JWT_SECRET, { expiresIn: "30d" });
}

function publicUser(row) {
  return { id: row.id, name: row.name, email: row.email };
}

// ---------- Email + password ----------

router.post("/signup", async (req, res) => {
  try {
    const { name, email, password } = req.body;
    if (!name || !email || !password) {
      return res.status(400).json({ error: "Name, email, and password are all required." });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: "Password must be at least 8 characters." });
    }

    const existing = await pool.query("SELECT id FROM users WHERE email = $1", [
      email.toLowerCase(),
    ]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: "An account with that email already exists." });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const result = await pool.query(
      "INSERT INTO users (name, email, password_hash) VALUES ($1, $2, $3) RETURNING id, name, email",
      [name, email.toLowerCase(), passwordHash]
    );

    const user = result.rows[0];
    const token = signToken(user.id);
    res.json({ token, user: publicUser(user) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Something went wrong creating your account." });
  }
});

router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: "Email and password are required." });
    }

    const result = await pool.query("SELECT * FROM users WHERE email = $1", [
      email.toLowerCase(),
    ]);
    const user = result.rows[0];
    if (!user) {
      return res.status(401).json({ error: "Incorrect email or password." });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: "Incorrect email or password." });
    }

    const token = signToken(user.id);
    res.json({ token, user: publicUser(user) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Something went wrong signing you in." });
  }
});

router.get("/me", requireAuth, async (req, res) => {
  const result = await pool.query("SELECT id, name, email FROM users WHERE id = $1", [
    req.userId,
  ]);
  if (!result.rows[0]) return res.status(404).json({ error: "User not found." });
  res.json({ user: result.rows[0] });
});

// ---------- WebAuthn (Face ID / Touch ID / fingerprint) ----------

// Step 1: an already-signed-in user asks to enroll their device's biometrics.
router.get("/webauthn/register-options", requireAuth, async (req, res) => {
  const userResult = await pool.query("SELECT * FROM users WHERE id = $1", [req.userId]);
  const user = userResult.rows[0];

  const existingCreds = await pool.query(
    "SELECT credential_id FROM webauthn_credentials WHERE user_id = $1",
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
    excludeCredentials: existingCreds.rows.map((c) => ({
      id: c.credential_id,
      type: "public-key",
    })),
  });

  await pool.query(
    `INSERT INTO webauthn_challenges (user_id, challenge) VALUES ($1, $2)
     ON CONFLICT (user_id) DO UPDATE SET challenge = $2, created_at = now()`,
    [req.userId, options.challenge]
  );

  res.json(options);
});

// Step 2: verify the device's response and store the credential.
router.post("/webauthn/register-verify", requireAuth, async (req, res) => {
  try {
    const challengeRow = await pool.query(
      "SELECT challenge FROM webauthn_challenges WHERE user_id = $1",
      [req.userId]
    );
    const expectedChallenge = challengeRow.rows[0]?.challenge;
    if (!expectedChallenge) {
      return res.status(400).json({ error: "No pending registration found. Please try again." });
    }

    const verification = await verifyRegistrationResponse({
      response: req.body,
      expectedChallenge,
      expectedOrigin: ORIGIN,
      expectedRPID: RP_ID,
    });

    if (!verification.verified || !verification.registrationInfo) {
      return res.status(400).json({ error: "Could not verify that device." });
    }

    const { credential } = verification.registrationInfo;

    await pool.query(
      `INSERT INTO webauthn_credentials (user_id, credential_id, public_key, counter, device_type)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        req.userId,
        credential.id,
        Buffer.from(credential.publicKey).toString("base64url"),
        credential.counter,
        "platform",
      ]
    );

    await pool.query("DELETE FROM webauthn_challenges WHERE user_id = $1", [req.userId]);

    res.json({ verified: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Something went wrong enabling Face ID." });
  }
});

// Step 3: at login time, before the user types a password, offer Face ID
// if their account has an enrolled device.
router.post("/webauthn/login-options", async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: "Email is required." });

    const userResult = await pool.query("SELECT * FROM users WHERE email = $1", [
      email.toLowerCase(),
    ]);
    const user = userResult.rows[0];
    if (!user) return res.status(404).json({ error: "No account with that email." });

    const creds = await pool.query(
      "SELECT credential_id FROM webauthn_credentials WHERE user_id = $1",
      [user.id]
    );
    if (creds.rows.length === 0) {
      return res.status(404).json({ error: "Face ID isn't enabled for this account yet." });
    }

    const options = await generateAuthenticationOptions({
      rpID: RP_ID,
      userVerification: "required",
      allowCredentials: creds.rows.map((c) => ({ id: c.credential_id, type: "public-key" })),
    });

    await pool.query(
      `INSERT INTO webauthn_challenges (user_id, challenge) VALUES ($1, $2)
       ON CONFLICT (user_id) DO UPDATE SET challenge = $2, created_at = now()`,
      [user.id, options.challenge]
    );

    res.json({ options, userId: user.id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Something went wrong starting Face ID sign-in." });
  }
});

// Step 4: verify the biometric response and sign the user in.
router.post("/webauthn/login-verify", async (req, res) => {
  try {
    const { userId, response } = req.body;

    const challengeRow = await pool.query(
      "SELECT challenge FROM webauthn_challenges WHERE user_id = $1",
      [userId]
    );
    const expectedChallenge = challengeRow.rows[0]?.challenge;
    if (!expectedChallenge) {
      return res.status(400).json({ error: "No pending sign-in found. Please try again." });
    }

    const credRow = await pool.query(
      "SELECT * FROM webauthn_credentials WHERE credential_id = $1 AND user_id = $2",
      [response.id, userId]
    );
    const savedCred = credRow.rows[0];
    if (!savedCred) return res.status(400).json({ error: "Unrecognized device." });

    const verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge,
      expectedOrigin: ORIGIN,
      expectedRPID: RP_ID,
      credential: {
        id: savedCred.credential_id,
        publicKey: Buffer.from(savedCred.public_key, "base64url"),
        counter: Number(savedCred.counter),
      },
    });

    if (!verification.verified) {
      return res.status(401).json({ error: "Face ID verification failed." });
    }

    await pool.query("UPDATE webauthn_credentials SET counter = $1 WHERE id = $2", [
      verification.authenticationInfo.newCounter,
      savedCred.id,
    ]);
    await pool.query("DELETE FROM webauthn_challenges WHERE user_id = $1", [userId]);

    const userResult = await pool.query("SELECT id, name, email FROM users WHERE id = $1", [
      userId,
    ]);
    const token = signToken(userId);
    res.json({ token, user: userResult.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Something went wrong verifying Face ID." });
  }
});

module.exports = router;
