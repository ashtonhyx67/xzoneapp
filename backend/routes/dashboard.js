const express = require("express");

const { pool } = require("../db");
const { requireAuth, loadAccess } = require("../middleware/auth");
const { PERMISSIONS } = require("../lib/groups");
const { normalizeTeam, teamsInCg } = require("../lib/teams");

const router = express.Router();

const route = (handler) => (req, res, next) => handler(req, res, next).catch(next);

const BIRTHDAY_WINDOW_DAYS = 30;

// Anyone at these stages still needs working through; "Done" does not.
const isFollowUpOutstanding = (value) => {
  const status = String(value || "").trim().toLowerCase();
  return status !== "done";
};

// Next occurrence of a birthday. Computed here rather than in SQL because the
// dataset is small and make_date() would throw on a 29 Feb birthday in a
// non-leap year.
function daysUntilBirthday(birthday, today) {
  const [, month, day] = birthday.split("-").map(Number);
  const year = today.getUTCFullYear();

  const occurrence = (y) => {
    const date = new Date(Date.UTC(y, month - 1, day));
    // 29 Feb rolls into 1 Mar on a non-leap year, which is the sensible place
    // to mark it.
    if (date.getUTCMonth() !== month - 1) return new Date(Date.UTC(y, month, 0));
    return date;
  };

  let next = occurrence(year);
  const startOfToday = Date.UTC(year, today.getUTCMonth(), today.getUTCDate());
  if (next.getTime() < startOfToday) next = occurrence(year + 1);

  return Math.round((next.getTime() - startOfToday) / 86400000);
}

function turningAge(birthday, daysAway, today) {
  const birthYear = Number(birthday.split("-")[0]);
  const targetYear = today.getUTCFullYear() + (daysAway > 0 && isNextYear(birthday, today) ? 1 : 0);
  return targetYear - birthYear;
}

function isNextYear(birthday, today) {
  const [, month, day] = birthday.split("-").map(Number);
  const thisYear = Date.UTC(today.getUTCFullYear(), month - 1, day);
  const startOfToday = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  return thisYear < startOfToday;
}

router.get(
  "/summary",
  requireAuth,
  route(async (req, res) => {
    const access = await loadAccess(req.userId);

    // The reminders are built from personal records, so they follow the same
    // permission as the directory itself.
    if (!access?.permissions.includes(PERMISSIONS.VIEW_DIRECTORY)) {
      return res.json({ canView: false, stats: [], birthdays: [], followUps: [] });
    }

    // The reminders are the team's own: a leader is shown the birthdays and
    // follow-ups of the people they actually look after. Someone who has not
    // been put in a team yet — a new admin, say — sees everyone rather than an
    // empty page. An explicit ?team= or ?cg= overrides, for looking wider.
    const askedTeam = normalizeTeam(req.query.team);
    const askedCg = teamsInCg(req.query.cg);
    const scope = askedTeam ? [askedTeam] : askedCg.length ? askedCg : access.teams;

    const result = scope.length
      ? await pool.query(
          "SELECT id, name, birthday, follow_up, role, team_key FROM people WHERE team_key = ANY($1::text[])",
          [scope]
        )
      : await pool.query("SELECT id, name, birthday, follow_up, role, team_key FROM people");

    const people = result.rows;
    const today = new Date();

    const birthdays = people
      .filter((p) => p.birthday)
      .map((p) => {
        const daysAway = daysUntilBirthday(p.birthday, today);
        return {
          id: p.id,
          name: p.name,
          birthday: p.birthday,
          daysAway,
          turning: turningAge(p.birthday, daysAway, today),
          role: p.role,
          teamKey: p.team_key,
        };
      })
      .filter((p) => p.daysAway <= BIRTHDAY_WINDOW_DAYS)
      .sort((a, b) => a.daysAway - b.daysAway);

    const followUps = people
      .filter((p) => isFollowUpOutstanding(p.follow_up))
      .map((p) => ({
        id: p.id,
        name: p.name,
        status: p.follow_up || "Not set",
        role: p.role,
        teamKey: p.team_key,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    const missingBirthday = people.filter((p) => !p.birthday).length;

    res.json({
      canView: true,
      teams: access.teams,
      scope,
      stats: [
        { label: "People", value: people.length },
        { label: "Birthdays in 30 days", value: birthdays.length },
        { label: "Follow-ups open", value: followUps.length },
        { label: "Missing birthday", value: missingBirthday },
      ],
      birthdays,
      followUps,
    });
  })
);

module.exports = router;
