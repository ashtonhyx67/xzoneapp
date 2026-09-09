const express = require("express");

const { requireAuth, loadAccess } = require("../middleware/auth");
const { ZONES } = require("../lib/zones");

const router = express.Router();

// Which zones exist, and which of them this account may change. Read on its own
// rather than baked into the sign-in payload, so moving someone between zones
// takes effect on their next request instead of their next sign-in.
router.get("/", requireAuth, async (req, res, next) => {
  try {
    const access = await loadAccess(req.userId);
    if (!access) return res.status(401).json({ error: "Not signed in." });

    res.json({
      zones: ZONES,
      mine: access.zones,
      editable: access.editableZones,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
