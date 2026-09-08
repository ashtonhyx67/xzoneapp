const jwt = require("jsonwebtoken");

const { pool } = require("../db");

function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: "Not signed in." });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.userId = payload.userId;
    next();
  } catch (err) {
    return res.status(401).json({ error: "Session expired. Please sign in again." });
  }
}

// Admin status is read from the database, never from the token, so revoking
// someone's access takes effect immediately instead of when their token expires.
async function requireAdmin(req, res, next) {
  try {
    const result = await pool.query("SELECT is_admin FROM users WHERE id = $1", [req.userId]);
    if (!result.rows[0]?.is_admin) {
      return res.status(403).json({ error: "You do not have access to this." });
    }
    next();
  } catch (err) {
    next(err);
  }
}

module.exports = { requireAuth, requireAdmin };
