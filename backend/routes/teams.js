const express = require("express");

const { requireAuth, loadAccess } = require("../middleware/auth");
const { TEAMS, CGS } = require("../lib/teams");

const router = express.Router();

// How the zone is divided, and which teams this account may change. Read on its
// own rather than baked into the sign-in payload, so moving someone between
// teams takes effect on their next request instead of their next sign-in.
router.get("/", requireAuth, async (req, res, next) => {
  try {
    const access = await loadAccess(req.userId);
    if (!access) return res.status(401).json({ error: "Not signed in." });

    res.json({
      cgs: CGS,
      teams: TEAMS,
      mine: access.teams,
      editable: access.editableTeams,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
