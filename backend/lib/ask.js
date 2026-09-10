// Answering questions about what is in the app.
//
// Nothing here is trained. A trained model would be a snapshot of the database
// on the day it was trained, would cost money and time to retrain, and would
// still answer last month's question. Instead the question is answered from the
// records as they are right now: the relevant ones are gathered and handed to
// Claude with the question. Add someone this morning and they can be asked
// about this afternoon.
//
// Which records are "relevant" is the whole job. Sending the entire database
// every time would be slow, expensive, and worse at answering — so a question
// naming someone gets that person in full, and a question that names nobody
// gets a summary of the caller's teams.

const { CATEGORY_KEYS, isPresent, categoryOf } = require("./attendance");
const { roleRank } = require("./roles");
const { isoWeek, stepWeek } = require("./weeks");

// How far back a person's attendance is worth reading. Far enough to see a
// pattern, short enough to stay small.
const WEEKS_OF_HISTORY = 8;

// A name is "mentioned" if it appears in the question. Checked longest-first so
// "Ashton Heng" wins over "Ashton" when both are on the books.
function mentionedPeople(question, people) {
  const asked = ` ${String(question).toLowerCase().replace(/[^a-z0-9\s]/g, " ")} `;

  const hit = people.filter((person) => {
    const name = String(person.name || "").toLowerCase().trim();
    if (name.length < 3) return false;
    // Word boundaries, so "Ian" does not match "Brian".
    return new RegExp(`(^|\\s)${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(\\s|$)`).test(asked);
  });

  // A question naming several people should not pull the whole database in.
  return hit.sort((a, b) => b.name.length - a.name.length).slice(0, 6);
}

// The weeks to look back over, newest first.
function recentWeeks(count = WEEKS_OF_HISTORY) {
  const weeks = [];
  let cursor = isoWeek();
  for (let i = 0; i < count; i += 1) {
    weeks.push(cursor);
    cursor = stepWeek(cursor, -1);
  }
  return weeks;
}

// Everything worth knowing about one person, in the shape a reader would want
// it: who they are, then what has actually happened.
async function personDossier(pool, person, allowed) {
  const weeks = recentWeeks();
  const oldest = weeks[weeks.length - 1];

  const [attendance, structure, seats] = await Promise.all([
    pool.query(
      `SELECT w.year, w.week, w.team, a.statuses
         FROM attendance_people a
         JOIN attendance_weeks w ON w.id = a.week_id
        WHERE a.person_id = $1
          AND (w.year > $2 OR (w.year = $2 AND w.week >= $3))
        ORDER BY w.year DESC, w.week DESC`,
      [person.id, oldest.year, oldest.week]
    ),
    pool.query(
      `SELECT r.team, g.position AS block, x.position AS place, x.year
         FROM team_roster_rows x
         JOIN team_roster_groups g ON g.id = x.group_id
         JOIN team_rosters r ON r.team = g.team
        WHERE lower(x.name) = lower($1)`,
      [person.name]
    ),
    pool.query(
      `SELECT w.cg, w.year, w.week, r.label
         FROM seating_seats s
         JOIN seating_rows r ON r.id = s.row_id
         JOIN seating_weeks w ON w.id = r.week_id
        WHERE lower(s.name) = lower($1)
        ORDER BY w.year DESC, w.week DESC
        LIMIT 4`,
      [person.name]
    ),
  ]);

  const marked = attendance.rows.map((row) => ({
    week: `${row.year}-W${row.week}`,
    team: row.team,
    statuses: row.statuses || "(absent)",
    present: isPresent(row.statuses, allowed),
  }));

  return {
    name: person.name,
    role: person.role || "(not set)",
    countedUnder: categoryOf(person) || "(no group)",
    team: person.team_key || "(no team)",
    deployedTo: person.deployed_to || null,
    age: person.age ?? null,
    birthday: person.birthday || null,
    school: person.school || null,
    ministry: person.ministry || null,
    followUp: person.follow_up || null,
    cameToChurch: person.came_church || null,
    invitedBy: person.invited_by || null,
    religion: person.religion || null,
    contact: person.contact || null,
    telegram: person.telegram || null,
    generalInformation: person.general_information || null,
    updates: person.updates || null,
    nextSteps: person.next_steps || null,
    attendance: {
      lastWeeks: WEEKS_OF_HISTORY,
      cameToCount: marked.filter((m) => m.present).length,
      listedWeeks: marked.length,
      weekByWeek: marked,
    },
    inStructureOf: structure.rows.map((r) => r.team),
    recentSeats: seats.rows.map((r) => `${r.cg} ${r.year}-W${r.week}: ${r.label || "unnamed row"}`),
  };
}

// When nobody is named, the question is about the group rather than a person.
async function teamOverview(pool, teams, allowed) {
  if (teams.length === 0) return null;

  const [people, attendance] = await Promise.all([
    pool.query(
      "SELECT name, role, team_key, follow_up, school FROM people WHERE team_key = ANY($1::text[])",
      [teams]
    ),
    pool.query(
      `SELECT w.team, w.year, w.week, a.statuses
         FROM attendance_weeks w
         JOIN attendance_people a ON a.week_id = w.id
        WHERE w.team = ANY($1::text[])`,
      [teams]
    ),
  ]);

  const weeks = new Map();
  for (const row of attendance.rows) {
    const key = `${row.year}-W${row.week}`;
    const entry = weeks.get(key) ?? { week: key, present: 0, listed: 0 };
    entry.listed += 1;
    if (isPresent(row.statuses, allowed)) entry.present += 1;
    weeks.set(key, entry);
  }

  const byRole = {};
  for (const person of people.rows) {
    const key = person.role || "(not set)";
    byRole[key] = (byRole[key] ?? 0) + 1;
  }

  return {
    teams,
    peopleCount: people.rows.length,
    byRole,
    followUpsOutstanding: people.rows
      .filter((p) => String(p.follow_up || "").trim().toLowerCase() !== "done")
      .map((p) => ({ name: p.name, status: p.follow_up || "(not set)" })),
    attendanceByWeek: [...weeks.values()]
      .sort((a, b) => b.week.localeCompare(a.week))
      .slice(0, WEEKS_OF_HISTORY),
    roster: people.rows
      .sort((a, b) => roleRank(a.role) - roleRank(b.role) || a.name.localeCompare(b.name))
      .map((p) => `${p.name} — ${p.role || "(no role)"}, ${p.team_key || "(no team)"}`),
  };
}

// Gathers what the question needs. `teams` is what the asker may see, so an
// answer can never be built from records they could not open themselves.
async function buildContext(pool, question, teams, allowed) {
  const everyone = await pool.query(
    "SELECT *, CASE WHEN birthday IS NULL THEN NULL ELSE date_part('year', age(birthday))::int END AS age FROM people"
  );

  const named = mentionedPeople(question, everyone.rows);

  return {
    today: new Date().toISOString().slice(0, 10),
    thisWeek: (() => {
      const { year, week } = isoWeek();
      return `${year}-W${week}`;
    })(),
    askedAbout: await Promise.all(
      named.map((person) => personDossier(pool, person, allowed))
    ),
    // Always included, so a question about nobody in particular still has
    // something to answer from, and a question about someone has the shape of
    // the team around them.
    overview: await teamOverview(pool, teams, allowed),
    everyNameOnFile: everyone.rows.map((p) => p.name),
  };
}

module.exports = { buildContext, mentionedPeople, WEEKS_OF_HISTORY };
