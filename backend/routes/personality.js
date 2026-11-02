const express = require("express");

const { pool } = require("../db");
const { requireAuth } = require("../middleware/auth");
const {
  QUIZ_VERSION,
  CORE_QUESTIONS,
  evaluate,
  publicQuestion,
  publicResult,
} = require("../lib/personality");

const router = express.Router();

const route = (handler) => (req, res, next) => handler(req, res, next).catch(next);

// Only a sign-in, deliberately: a new account has no permissions yet, and this is
// the first thing it is asked to do.
router.use(requireAuth);

router.get("/quiz", (req, res) => {
  res.json({ version: QUIZ_VERSION, questions: CORE_QUESTIONS.map(publicQuestion) });
});

router.get(
  "/",
  route(async (req, res) => {
    const found = await pool.query(
      `SELECT type, scores, careless, created_at
         FROM personality_results
        WHERE user_id = $1
        ORDER BY created_at DESC, id DESC
        LIMIT 1`,
      [req.userId]
    );
    const row = found.rows[0];
    res.json({
      result: row
        ? publicResult({
            type: row.type,
            scores: row.scores,
            careless: row.careless,
            takenAt: row.created_at,
          })
        : null,
    });
  })
);

// Each step of the quiz comes through here with everything answered so far, and
// the answer says what to ask next. Only a finished quiz writes anything.
router.post(
  "/",
  route(async (req, res) => {
    if (req.body?.version !== QUIZ_VERSION) {
      return res.status(409).json({ error: "The quiz has been updated, so it needs starting again." });
    }

    const step = evaluate({ answers: req.body.answers, choices: req.body.choices });

    if (step.status === "incomplete") {
      return res.status(400).json({ error: "Some of the questions haven't been answered yet." });
    }
    if (step.status !== "done") return res.json(step);

    const client = await pool.connect();
    let takenAt;
    try {
      await client.query("BEGIN");

      const saved = await client.query(
        `INSERT INTO personality_results
           (user_id, quiz_version, type, measured_type, scores, answers, choices, careless)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING created_at`,
        [
          req.userId,
          QUIZ_VERSION,
          step.type,
          step.measuredType,
          JSON.stringify(step.scores),
          JSON.stringify(step.answers),
          JSON.stringify(step.choices),
          step.careless,
        ]
      );
      takenAt = saved.rows[0].created_at;

      await client.query(
        `UPDATE users
            SET personality_type = $1, personality_taken_at = $2
          WHERE id = $3`,
        [step.type, takenAt, req.userId]
      );

      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      client.release();
    }

    res.json({
      status: "done",
      result: publicResult({
        type: step.type,
        scores: step.scores,
        careless: step.careless,
        takenAt,
      }),
    });
  })
);

module.exports = router;
