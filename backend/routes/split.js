const express = require("express");

const { pool } = require("../db");
const { requireAuth, requirePermission } = require("../middleware/auth");
const { PERMISSIONS } = require("../lib/groups");
const split = require("../lib/split");

const router = express.Router();

const route = (handler) => (req, res, next) => handler(req, res, next).catch(next);

// Splitting expenses is something every signed-in account does for itself;
// which groups it can see is decided by membership below, not by role.
const canSplit = requirePermission(PERMISSIONS.USE_EXPENSES);

const MAX_NAME = 80;
const MAX_TEXT = 500;
const MAX_MEMBERS = 60;
const MAX_CATCHUP = 24; // How many missed occurrences one read will file.

const clean = (value, max = MAX_NAME) => String(value ?? "").slice(0, max).trim();
const today = () => asDate(new Date());

// Every date in here is the text 'YYYY-MM-DD' and is compared as text. db.js
// asks node-pg to hand DATE columns back that way, but nothing in this file
// should depend on that being configured somewhere else: a Date object
// compares false against a date string, and a recurring expense whose due date
// arrived as a Date would quietly stop recurring rather than fail loudly.
function asDate(value) {
  if (!value) return null;
  if (value instanceof Date) {
    // Local parts, not toISOString: node-pg builds a DATE at local midnight,
    // and reading it back in UTC would move it a day west of here.
    const pad = (n) => String(n).padStart(2, "0");
    return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
  }
  return String(value).slice(0, 10);
}

// A date the database will accept, or today. A blank date on an expense is
// almost always a form that was never touched, and filing it under today is
// what the person meant.
function cleanDate(value) {
  const text = clean(value, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : today();
}

// ---------------------------------------------------------------- reading --

async function loadMembers(groupId) {
  const result = await pool.query(
    "SELECT id, person_id, name FROM split_members WHERE group_id = $1 ORDER BY id",
    [groupId]
  );
  return result.rows;
}

// Everything the group page shows, in one read: the expenses, who paid and who
// owes on each, the running balances, and the payments that would clear them.
async function readGroup(groupId, personId) {
  const groupResult = await pool.query(
    `SELECT g.*, u.name AS created_by_name
       FROM split_groups g
       LEFT JOIN users u ON u.id = g.created_by
      WHERE g.id = $1`,
    [groupId]
  );
  const group = groupResult.rows[0];
  if (!group) return null;

  const members = await loadMembers(groupId);

  const expenseRows = await pool.query(
    `SELECT e.*, u.name AS created_by_name, coalesce(c.count, 0) AS comment_count
       FROM split_expenses e
       LEFT JOIN users u ON u.id = e.created_by
       LEFT JOIN (
              SELECT expense_id, count(*)::int AS count
                FROM split_comments GROUP BY expense_id
            ) c ON c.expense_id = e.id
      WHERE e.group_id = $1 AND e.deleted_at IS NULL
      ORDER BY e.spent_on DESC, e.id DESC`,
    [groupId]
  );

  const shareRows = await pool.query(
    `SELECT s.* FROM split_shares s
       JOIN split_expenses e ON e.id = s.expense_id
      WHERE e.group_id = $1 AND e.deleted_at IS NULL`,
    [groupId]
  );

  const sharesByExpense = new Map();
  for (const share of shareRows.rows) {
    if (!sharesByExpense.has(share.expense_id)) sharesByExpense.set(share.expense_id, []);
    sharesByExpense.get(share.expense_id).push(share);
  }

  const expenses = expenseRows.rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    description: row.description,
    amountCents: row.amount_cents,
    currency: row.currency,
    category: row.category,
    splitMethod: row.split_method,
    notes: row.notes,
    spentOn: asDate(row.spent_on),
    recurrence: row.recurrence,
    recurrenceNext: asDate(row.recurrence_next),
    createdBy: row.created_by,
    createdByName: row.created_by_name || "",
    createdAt: row.created_at,
    commentCount: Number(row.comment_count || 0),
    shares: (sharesByExpense.get(row.id) || []).map((share) => ({
      memberId: share.member_id,
      paidCents: share.paid_cents,
      owedCents: share.owed_cents,
      inputValue: share.input_value,
    })),
  }));

  // One pass over every share gives each member's position; the per-expense
  // grouping is what the pairwise view needs, so both are taken from the same
  // rows rather than re-read.
  const net = split.netBalances(shareRows.rows);
  const paid = new Map();
  const owed = new Map();
  for (const share of shareRows.rows) {
    paid.set(share.member_id, (paid.get(share.member_id) || 0) + share.paid_cents);
    owed.set(share.member_id, (owed.get(share.member_id) || 0) + share.owed_cents);
  }

  const me = members.find((member) => personId && member.person_id === personId) || null;

  // "Simplify debts" pools the group and asks for the fewest payments; off, it
  // keeps each debt with the person it is actually owed to.
  const debts = group.simplify_debts
    ? split.simplify(net)
    : split.pairwiseDebts([...sharesByExpense.values()]);

  const activity = await pool.query(
    `SELECT a.id, a.action, a.summary, a.created_at, a.expense_id, u.name AS actor
       FROM split_activity a
       LEFT JOIN users u ON u.id = a.user_id
      WHERE a.group_id = $1
      ORDER BY a.created_at DESC, a.id DESC
      LIMIT 60`,
    [groupId]
  );

  return {
    group: {
      id: group.id,
      name: group.name,
      emoji: group.emoji,
      currency: group.currency,
      simplifyDebts: group.simplify_debts,
      archived: group.archived,
      createdBy: group.created_by,
      createdByName: group.created_by_name || "",
    },
    members: members.map((member) => ({
      id: member.id,
      personId: member.person_id,
      name: member.name,
      paidCents: paid.get(member.id) || 0,
      owedCents: owed.get(member.id) || 0,
      netCents: net.get(member.id) || 0,
      isYou: me ? member.id === me.id : false,
    })),
    meMemberId: me ? me.id : null,
    expenses,
    debts,
    activity: activity.rows.map((row) => ({
      id: row.id,
      action: row.action,
      summary: row.summary,
      actor: row.actor || "Someone",
      expenseId: row.expense_id,
      createdAt: row.created_at,
    })),
  };
}

// Membership is what grants access to a group — not role, and not team. The
// owner can reach any group, because somebody has to be able to sort out a
// group whose members have all left.
async function requireGroup(req, res, id = req.params.id) {
  const groupId = Number(id);
  if (!Number.isInteger(groupId)) {
    res.status(400).json({ error: "No such group." });
    return null;
  }

  const result = await pool.query("SELECT * FROM split_groups WHERE id = $1", [groupId]);
  const group = result.rows[0];
  if (!group) {
    res.status(404).json({ error: "No such group." });
    return null;
  }

  const members = await loadMembers(groupId);
  const personId = req.access.personId;
  const me = members.find((member) => personId && member.person_id === personId) || null;

  if (!me && !req.access.isOwner && group.created_by !== req.access.user.id) {
    res.status(403).json({ error: "This group isn't shared with you." });
    return null;
  }

  return { group, members, me };
}

// `db` is the pool for a lone write, or a client when the entry belongs to the
// same transaction as the change it describes.
async function logActivity(db, groupId, userId, action, summary, expenseId = null) {
  await db.query(
    `INSERT INTO split_activity (group_id, expense_id, user_id, action, summary)
     VALUES ($1, $2, $3, $4, $5)`,
    [groupId, expenseId, userId, action, summary.slice(0, MAX_TEXT)]
  );
}

// ---------------------------------------------------------------- writing --

// Turns what the form sends into the rows that go in the table: cents for
// every amount, one share per member, and a clear message back if the parts
// don't add up to the whole.
function parseExpense(body, group, members) {
  const ids = new Set(members.map((member) => member.id));

  const amountCents = split.toCents(body?.amount);
  if (amountCents === null) return { error: "Enter an amount." };
  if (amountCents <= 0) return { error: "An expense has to be more than zero." };
  if (amountCents > split.MAX_CENTS) return { error: "That amount is too large." };

  const description = clean(body?.description, MAX_NAME);
  if (!description) return { error: "Give the expense a description." };

  // Who put money in. One payer is the usual case and arrives as a list of one.
  const payerInput = Array.isArray(body?.payers) ? body.payers : [];
  if (payerInput.length === 0) return { error: "Say who paid." };

  const paid = new Map();
  for (const payer of payerInput) {
    const memberId = Number(payer?.memberId);
    if (!ids.has(memberId)) return { error: "Someone who paid isn't in this group." };
    const cents = split.toCents(payer?.amount);
    if (cents === null) return { error: "Check the amounts paid." };
    paid.set(memberId, (paid.get(memberId) || 0) + cents);
  }

  const paidTotal = [...paid.values()].reduce((sum, cents) => sum + cents, 0);
  if (paidTotal !== amountCents) {
    const off = split.formatCents(Math.abs(amountCents - paidTotal), "");
    return {
      error:
        paidTotal > amountCents
          ? `The payments add up to ${off} more than the expense.`
          : `The payments are ${off} short of the expense.`,
    };
  }

  const method = split.SPLIT_METHODS.includes(body?.splitMethod) ? body.splitMethod : "equally";

  // What each member was given, in the units that method works in.
  const entries = [];
  for (const item of Array.isArray(body?.splits) ? body.splits : []) {
    const memberId = Number(item?.memberId);
    if (!ids.has(memberId)) return { error: "Someone in the split isn't in this group." };
    if (entries.some((entry) => entry.memberId === memberId)) {
      return { error: "Someone is in the split twice." };
    }

    let value = 0;
    if (method === "exact" || method === "adjustment") {
      value = split.toCents(item?.value);
      if (value === null) return { error: "Check the amounts in the split." };
    } else if (method === "percent") {
      // Percentages are held in hundredths so 33.33% is an exact integer.
      const percent = Number(item?.value);
      if (!Number.isFinite(percent)) return { error: "Check the percentages." };
      value = Math.round(percent * 100);
    } else if (method === "shares") {
      const shares = Number(item?.value);
      if (!Number.isFinite(shares) || shares < 0) return { error: "Check the shares." };
      value = Math.round(shares);
    }

    entries.push({ memberId, value });
  }

  const invalid = split.validateSplit(method, amountCents, entries);
  if (invalid) return { error: invalid };

  const { ids: splitIds, owed } = split.computeOwed(method, amountCents, entries);

  // One row per member who is involved either way: they paid, or they owe, or
  // both. Everyone else in the group simply isn't on this expense.
  const shares = new Map();
  splitIds.forEach((memberId, index) => {
    shares.set(memberId, {
      memberId,
      paidCents: 0,
      owedCents: owed[index],
      inputValue: entries[index].value,
    });
  });
  for (const [memberId, cents] of paid) {
    const existing = shares.get(memberId) || {
      memberId,
      paidCents: 0,
      owedCents: 0,
      inputValue: 0,
    };
    existing.paidCents += cents;
    shares.set(memberId, existing);
  }

  const recurrence = split.RECURRENCES.includes(body?.recurrence) ? body.recurrence : "";
  const spentOn = cleanDate(body?.date);

  return {
    values: {
      description,
      amountCents,
      currency: clean(body?.currency, 8).toUpperCase() || group.currency,
      category: split.normalizeCategory(body?.category),
      splitMethod: method,
      notes: clean(body?.notes, MAX_TEXT),
      spentOn,
      recurrence,
      recurrenceNext: recurrence ? split.nextOccurrence(spentOn, recurrence) : null,
      shares: [...shares.values()],
    },
  };
}

async function writeShares(client, expenseId, shares) {
  await client.query("DELETE FROM split_shares WHERE expense_id = $1", [expenseId]);
  for (const share of shares) {
    await client.query(
      `INSERT INTO split_shares (expense_id, member_id, paid_cents, owed_cents, input_value)
       VALUES ($1, $2, $3, $4, $5)`,
      [expenseId, share.memberId, share.paidCents, share.owedCents, share.inputValue]
    );
  }
}

// A repeating expense files its next copy the first time anyone opens the
// group on or after the due date. There is no scheduler in this app, and a
// monthly rent that only appears when somebody looks is still there before
// anyone needs to act on it — which is what the reminder is for.
//
// The original row keeps the schedule; each copy is a plain one-off. Catching
// up runs in a loop because a group nobody opened for a quarter owes three
// months of rent, not one.
async function materializeRecurring(groupId, userId) {
  const due = await pool.query(
    `SELECT id, description, amount_cents, currency, category, split_method, notes,
            recurrence, recurrence_next
       FROM split_expenses
      WHERE group_id = $1 AND deleted_at IS NULL
        AND recurrence <> '' AND recurrence_next IS NOT NULL
        AND recurrence_next <= CURRENT_DATE`,
    [groupId]
  );
  if (due.rows.length === 0) return 0;

  const client = await pool.connect();
  let filed = 0;
  try {
    await client.query("BEGIN");

    for (const source of due.rows) {
      const shares = await client.query(
        "SELECT member_id, paid_cents, owed_cents, input_value FROM split_shares WHERE expense_id = $1",
        [source.id]
      );

      let occurrence = asDate(source.recurrence_next);
      for (let guard = 0; occurrence && occurrence <= today() && guard < MAX_CATCHUP; guard += 1) {
        const created = await client.query(
          `INSERT INTO split_expenses
             (group_id, kind, description, amount_cents, currency, category, split_method,
              notes, spent_on, created_by)
           VALUES ($1, 'expense', $2, $3, $4, $5, $6, $7, $8, $9)
           RETURNING id`,
          [
            groupId,
            source.description,
            source.amount_cents,
            source.currency,
            source.category,
            source.split_method,
            source.notes,
            occurrence,
            userId,
          ]
        );

        await writeShares(
          client,
          created.rows[0].id,
          shares.rows.map((share) => ({
            memberId: share.member_id,
            paidCents: share.paid_cents,
            owedCents: share.owed_cents,
            inputValue: share.input_value,
          }))
        );

        await logActivity(
          client,
          groupId,
          null,
          "recurred",
          `"${source.description}" was added automatically (${split.formatCents(
            source.amount_cents,
            source.currency
          )})`,
          created.rows[0].id
        );

        occurrence = split.nextOccurrence(occurrence, source.recurrence);
        filed += 1;
      }

      await client.query("UPDATE split_expenses SET recurrence_next = $1 WHERE id = $2", [
        occurrence,
        source.id,
      ]);
    }

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }

  return filed;
}

// ----------------------------------------------------------------- routes --

// The names a group can be made from. Only names and ids: this is reachable by
// every account, including ones with no access to the directory itself, so it
// gives up nothing but who exists.
router.get(
  "/people",
  requireAuth,
  canSplit,
  route(async (req, res) => {
    const result = await pool.query("SELECT id, name FROM people ORDER BY name");
    res.json({ people: result.rows, youAre: req.access.personId });
  })
);

// Every group this account is in, with its own position in each, plus the
// lists the expense form needs so the app has them without a second call.
router.get(
  "/groups",
  requireAuth,
  canSplit,
  route(async (req, res) => {
    const personId = req.access.personId;

    const groups = personId
      ? await pool.query(
          `SELECT g.*, coalesce(m.count, 0) AS member_count
             FROM split_groups g
             LEFT JOIN (
                    SELECT group_id, count(*)::int AS count
                      FROM split_members GROUP BY group_id
                  ) m ON m.group_id = g.id
            WHERE g.id IN (SELECT group_id FROM split_members WHERE person_id = $1)
               OR g.created_by = $2
            ORDER BY g.archived, g.updated_at DESC`,
          [personId, req.access.user.id]
        )
      : await pool.query(
          `SELECT g.*, coalesce(m.count, 0) AS member_count
             FROM split_groups g
             LEFT JOIN (
                    SELECT group_id, count(*)::int AS count
                      FROM split_members GROUP BY group_id
                  ) m ON m.group_id = g.id
            WHERE g.created_by = $1
            ORDER BY g.archived, g.updated_at DESC`,
          [req.access.user.id]
        );

    // Your net position in each group, in one query rather than one per group.
    const netRows = personId
      ? await pool.query(
          `SELECT e.group_id,
                  sum(s.paid_cents - s.owed_cents)::int AS net
             FROM split_shares s
             JOIN split_expenses e ON e.id = s.expense_id AND e.deleted_at IS NULL
             JOIN split_members m ON m.id = s.member_id
            WHERE m.person_id = $1
            GROUP BY e.group_id`,
          [personId]
        )
      : { rows: [] };

    const netByGroup = new Map(netRows.rows.map((row) => [row.group_id, Number(row.net)]));

    const list = groups.rows.map((row) => ({
      id: row.id,
      name: row.name,
      emoji: row.emoji,
      currency: row.currency,
      archived: row.archived,
      memberCount: Number(row.member_count),
      yourNetCents: netByGroup.get(row.id) || 0,
    }));

    // Groups can be kept in different currencies, and this app does not invent
    // an exchange rate, so the headline is one total per currency rather than
    // one number that would be quietly wrong.
    const totals = new Map();
    for (const group of list) {
      if (group.archived) continue;
      totals.set(group.currency, (totals.get(group.currency) || 0) + group.yourNetCents);
    }

    res.json({
      groups: list,
      totals: [...totals.entries()]
        .map(([currency, netCents]) => ({ currency, netCents }))
        .filter((total) => total.netCents !== 0),
      // An account whose name is not in the directory has nothing to be a
      // member of yet; the app says so rather than showing an empty page.
      linked: Boolean(personId),
      categories: split.CATEGORIES,
      methods: split.SPLIT_METHODS,
      recurrences: split.RECURRENCES,
    });
  })
);

router.post(
  "/groups",
  requireAuth,
  canSplit,
  route(async (req, res) => {
    const name = clean(req.body?.name, MAX_NAME);
    if (!name) return res.status(400).json({ error: "Give the group a name." });

    const wanted = Array.isArray(req.body?.members) ? req.body.members : [];
    if (wanted.length > MAX_MEMBERS) {
      return res.status(400).json({ error: `A group holds at most ${MAX_MEMBERS} people.` });
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const created = await client.query(
        `INSERT INTO split_groups (name, emoji, currency, simplify_debts, created_by)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [
          name,
          clean(req.body?.emoji, 8) || "🧾",
          clean(req.body?.currency, 8).toUpperCase() || "SGD",
          req.body?.simplifyDebts === true,
          req.access.user.id,
        ]
      );
      const groupId = created.rows[0].id;

      // Whoever makes the group is in it, the way they are in Splitwise —
      // as long as their account is linked to a person.
      const seen = new Set();
      const members = [...wanted];
      if (req.access.personId) members.unshift({ personId: req.access.personId });

      for (const member of members) {
        const personId = Number(member?.personId) || null;
        if (personId && seen.has(personId)) continue;

        let memberName = clean(member?.name, MAX_NAME);
        if (personId) {
          const person = await client.query("SELECT name FROM people WHERE id = $1", [personId]);
          if (!person.rows[0]) continue;
          memberName = person.rows[0].name;
          seen.add(personId);
        }
        if (!memberName) continue;

        await client.query(
          "INSERT INTO split_members (group_id, person_id, name) VALUES ($1, $2, $3)",
          [groupId, personId, memberName]
        );
      }

      await logActivity(client, groupId, req.access.user.id, "group_created", `started "${name}"`);
      await client.query("COMMIT");

      res.status(201).json(await readGroup(groupId, req.access.personId));
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  })
);

router.get(
  "/groups/:id",
  requireAuth,
  canSplit,
  route(async (req, res) => {
    const found = await requireGroup(req, res);
    if (!found) return;

    // Anything the schedule owes gets filed before the page is built, so the
    // balances a person reads are the ones they are actually standing on.
    await materializeRecurring(found.group.id, null);

    res.json(await readGroup(found.group.id, req.access.personId));
  })
);

router.patch(
  "/groups/:id",
  requireAuth,
  canSplit,
  route(async (req, res) => {
    const found = await requireGroup(req, res);
    if (!found) return;

    const updates = [];
    const values = [];
    const set = (column, value) => {
      values.push(value);
      updates.push(`${column} = $${values.length}`);
    };

    if (req.body?.name !== undefined) {
      const name = clean(req.body.name, MAX_NAME);
      if (!name) return res.status(400).json({ error: "A group needs a name." });
      set("name", name);
    }
    if (req.body?.emoji !== undefined) set("emoji", clean(req.body.emoji, 8) || "🧾");
    if (req.body?.currency !== undefined) {
      set("currency", clean(req.body.currency, 8).toUpperCase() || "SGD");
    }
    if (req.body?.simplifyDebts !== undefined) {
      set("simplify_debts", req.body.simplifyDebts === true);
    }
    if (req.body?.archived !== undefined) set("archived", req.body.archived === true);

    if (updates.length > 0) {
      values.push(found.group.id);
      await pool.query(
        `UPDATE split_groups SET ${updates.join(", ")}, updated_at = now() WHERE id = $${values.length}`,
        values
      );
    }

    res.json(await readGroup(found.group.id, req.access.personId));
  })
);

// Deleting takes a year of somebody's records with it, so it is the one thing
// here only the person who started the group (or the owner) can do.
router.delete(
  "/groups/:id",
  requireAuth,
  canSplit,
  route(async (req, res) => {
    const found = await requireGroup(req, res);
    if (!found) return;

    if (found.group.created_by !== req.access.user.id && !req.access.isOwner) {
      return res.status(403).json({ error: "Only whoever started the group can delete it." });
    }

    await pool.query("DELETE FROM split_groups WHERE id = $1", [found.group.id]);
    res.json({ ok: true });
  })
);

router.post(
  "/groups/:id/members",
  requireAuth,
  canSplit,
  route(async (req, res) => {
    const found = await requireGroup(req, res);
    if (!found) return;

    if (found.members.length >= MAX_MEMBERS) {
      return res.status(400).json({ error: `A group holds at most ${MAX_MEMBERS} people.` });
    }

    const personId = Number(req.body?.personId) || null;
    let name = clean(req.body?.name, MAX_NAME);

    if (personId) {
      const person = await pool.query("SELECT name FROM people WHERE id = $1", [personId]);
      if (!person.rows[0]) return res.status(400).json({ error: "No such person." });
      name = person.rows[0].name;

      if (found.members.some((member) => member.person_id === personId)) {
        return res.status(400).json({ error: `${name} is already in this group.` });
      }
    }

    if (!name) return res.status(400).json({ error: "Choose someone to add." });

    await pool.query(
      "INSERT INTO split_members (group_id, person_id, name) VALUES ($1, $2, $3)",
      [found.group.id, personId, name]
    );
    await logActivity(pool, found.group.id, req.access.user.id, "member_added", `added ${name}`);

    res.status(201).json(await readGroup(found.group.id, req.access.personId));
  })
);

router.delete(
  "/groups/:id/members/:memberId",
  requireAuth,
  canSplit,
  route(async (req, res) => {
    const found = await requireGroup(req, res);
    if (!found) return;

    const memberId = Number(req.params.memberId);
    const member = found.members.find((row) => row.id === memberId);
    if (!member) return res.status(404).json({ error: "They aren't in this group." });

    // Their shares would cascade away with them, taking money off expenses
    // that other people are still settled against. So somebody who has been on
    // an expense stays in the group; they can only be taken out before they
    // have been on one.
    const involved = await pool.query(
      `SELECT count(*)::int AS count FROM split_shares s
         JOIN split_expenses e ON e.id = s.expense_id AND e.deleted_at IS NULL
        WHERE s.member_id = $1`,
      [memberId]
    );
    if (involved.rows[0].count > 0) {
      return res.status(400).json({
        error: `${member.name} is on ${involved.rows[0].count} expense${
          involved.rows[0].count === 1 ? "" : "s"
        } here, so they can't be removed. Settle up and delete those first.`,
      });
    }

    await pool.query("DELETE FROM split_members WHERE id = $1", [memberId]);
    res.json(await readGroup(found.group.id, req.access.personId));
  })
);

router.post(
  "/groups/:id/expenses",
  requireAuth,
  canSplit,
  route(async (req, res) => {
    const found = await requireGroup(req, res);
    if (!found) return;

    const parsed = parseExpense(req.body, found.group, found.members);
    if (parsed.error) return res.status(400).json({ error: parsed.error });
    const values = parsed.values;

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const created = await client.query(
        `INSERT INTO split_expenses
           (group_id, kind, description, amount_cents, currency, category, split_method,
            notes, spent_on, recurrence, recurrence_next, created_by)
         VALUES ($1, 'expense', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         RETURNING id`,
        [
          found.group.id,
          values.description,
          values.amountCents,
          values.currency,
          values.category,
          values.splitMethod,
          values.notes,
          values.spentOn,
          values.recurrence,
          values.recurrenceNext,
          req.access.user.id,
        ]
      );

      await writeShares(client, created.rows[0].id, values.shares);
      await logActivity(
        client,
        found.group.id,
        req.access.user.id,
        "expense_added",
        `added "${values.description}" (${split.formatCents(values.amountCents, values.currency)})`,
        created.rows[0].id
      );
      await client.query("UPDATE split_groups SET updated_at = now() WHERE id = $1", [
        found.group.id,
      ]);

      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      client.release();
    }

    res.status(201).json(await readGroup(found.group.id, req.access.personId));
  })
);

// An expense is reached by its own id rather than through its group, so the
// group has to be fetched and checked before anything is touched.
async function requireExpense(req, res) {
  const expenseId = Number(req.params.id);
  if (!Number.isInteger(expenseId)) {
    res.status(400).json({ error: "No such expense." });
    return null;
  }

  const result = await pool.query(
    "SELECT * FROM split_expenses WHERE id = $1 AND deleted_at IS NULL",
    [expenseId]
  );
  const expense = result.rows[0];
  if (!expense) {
    res.status(404).json({ error: "No such expense." });
    return null;
  }

  const found = await requireGroup(req, res, expense.group_id);
  if (!found) return null;

  return { ...found, expense };
}

router.put(
  "/expenses/:id",
  requireAuth,
  canSplit,
  route(async (req, res) => {
    const found = await requireExpense(req, res);
    if (!found) return;

    if (found.expense.kind === "settlement") {
      return res.status(400).json({
        error: "A payment can't be edited. Delete it and record it again.",
      });
    }

    const parsed = parseExpense(req.body, found.group, found.members);
    if (parsed.error) return res.status(400).json({ error: parsed.error });
    const values = parsed.values;

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      await client.query(
        `UPDATE split_expenses
            SET description = $1, amount_cents = $2, currency = $3, category = $4,
                split_method = $5, notes = $6, spent_on = $7, recurrence = $8,
                recurrence_next = $9, updated_at = now()
          WHERE id = $10`,
        [
          values.description,
          values.amountCents,
          values.currency,
          values.category,
          values.splitMethod,
          values.notes,
          values.spentOn,
          values.recurrence,
          values.recurrenceNext,
          found.expense.id,
        ]
      );

      await writeShares(client, found.expense.id, values.shares);
      await logActivity(
        client,
        found.group.id,
        req.access.user.id,
        "expense_edited",
        `updated "${values.description}" (${split.formatCents(values.amountCents, values.currency)})`,
        found.expense.id
      );

      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      client.release();
    }

    res.json(await readGroup(found.group.id, req.access.personId));
  })
);

router.delete(
  "/expenses/:id",
  requireAuth,
  canSplit,
  route(async (req, res) => {
    const found = await requireExpense(req, res);
    if (!found) return;

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      // Marked rather than removed: the shares stay on the row, so a deletion
      // made by mistake is recoverable from the database rather than gone.
      await client.query(
        "UPDATE split_expenses SET deleted_at = now(), recurrence = '', recurrence_next = NULL WHERE id = $1",
        [found.expense.id]
      );
      await logActivity(
        client,
        found.group.id,
        req.access.user.id,
        "expense_deleted",
        `deleted "${found.expense.description}"`,
        found.expense.id
      );
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      client.release();
    }

    res.json(await readGroup(found.group.id, req.access.personId));
  })
);

// Settling up is one person handing money to another. It is stored as an
// expense with two shares — the payer's `paid`, the receiver's `owed` — which
// is exactly the shape that makes the balance between them fall to zero.
router.post(
  "/groups/:id/settle",
  requireAuth,
  canSplit,
  route(async (req, res) => {
    const found = await requireGroup(req, res);
    if (!found) return;

    const ids = new Set(found.members.map((member) => member.id));
    const fromId = Number(req.body?.fromMemberId);
    const toId = Number(req.body?.toMemberId);

    if (!ids.has(fromId) || !ids.has(toId)) {
      return res.status(400).json({ error: "Both people have to be in this group." });
    }
    if (fromId === toId) {
      return res.status(400).json({ error: "Someone can't pay themselves." });
    }

    const amountCents = split.toCents(req.body?.amount);
    if (amountCents === null || amountCents <= 0) {
      return res.status(400).json({ error: "Enter how much was paid." });
    }
    if (amountCents > split.MAX_CENTS) {
      return res.status(400).json({ error: "That amount is too large." });
    }

    const from = found.members.find((member) => member.id === fromId);
    const to = found.members.find((member) => member.id === toId);
    const currency = clean(req.body?.currency, 8).toUpperCase() || found.group.currency;

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const created = await client.query(
        `INSERT INTO split_expenses
           (group_id, kind, description, amount_cents, currency, category, split_method,
            notes, spent_on, created_by)
         VALUES ($1, 'settlement', $2, $3, $4, 'general', 'exact', $5, $6, $7)
         RETURNING id`,
        [
          found.group.id,
          `${from.name} paid ${to.name}`,
          amountCents,
          currency,
          clean(req.body?.notes, MAX_TEXT),
          cleanDate(req.body?.date),
          req.access.user.id,
        ]
      );

      await writeShares(client, created.rows[0].id, [
        { memberId: fromId, paidCents: amountCents, owedCents: 0, inputValue: 0 },
        { memberId: toId, paidCents: 0, owedCents: amountCents, inputValue: amountCents },
      ]);

      await logActivity(
        client,
        found.group.id,
        req.access.user.id,
        "settled",
        `recorded ${from.name} paying ${to.name} ${split.formatCents(amountCents, currency)}`,
        created.rows[0].id
      );
      await client.query("UPDATE split_groups SET updated_at = now() WHERE id = $1", [
        found.group.id,
      ]);

      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      client.release();
    }

    res.status(201).json(await readGroup(found.group.id, req.access.personId));
  })
);

router.get(
  "/expenses/:id/comments",
  requireAuth,
  canSplit,
  route(async (req, res) => {
    const found = await requireExpense(req, res);
    if (!found) return;

    const result = await pool.query(
      `SELECT c.id, c.body, c.created_at, coalesce(u.name, c.author) AS author
         FROM split_comments c
         LEFT JOIN users u ON u.id = c.user_id
        WHERE c.expense_id = $1
        ORDER BY c.created_at, c.id`,
      [found.expense.id]
    );

    res.json({ comments: result.rows });
  })
);

router.post(
  "/expenses/:id/comments",
  requireAuth,
  canSplit,
  route(async (req, res) => {
    const found = await requireExpense(req, res);
    if (!found) return;

    const body = clean(req.body?.body, MAX_TEXT);
    if (!body) return res.status(400).json({ error: "Write something first." });

    await pool.query(
      "INSERT INTO split_comments (expense_id, user_id, author, body) VALUES ($1, $2, $3, $4)",
      [found.expense.id, req.access.user.id, req.access.user.name, body]
    );

    const result = await pool.query(
      `SELECT c.id, c.body, c.created_at, coalesce(u.name, c.author) AS author
         FROM split_comments c
         LEFT JOIN users u ON u.id = c.user_id
        WHERE c.expense_id = $1
        ORDER BY c.created_at, c.id`,
      [found.expense.id]
    );

    res.status(201).json({ comments: result.rows });
  })
);

// Everything that has happened lately across every group this account is in —
// the same entries the group page shows, pooled.
router.get(
  "/activity",
  requireAuth,
  canSplit,
  route(async (req, res) => {
    const personId = req.access.personId;
    if (!personId) return res.json({ activity: [] });

    const result = await pool.query(
      `SELECT a.id, a.action, a.summary, a.created_at, a.expense_id,
              g.id AS group_id, g.name AS group_name, g.emoji,
              u.name AS actor
         FROM split_activity a
         JOIN split_groups g ON g.id = a.group_id
         LEFT JOIN users u ON u.id = a.user_id
        WHERE a.group_id IN (SELECT group_id FROM split_members WHERE person_id = $1)
        ORDER BY a.created_at DESC, a.id DESC
        LIMIT 100`,
      [personId]
    );

    res.json({
      activity: result.rows.map((row) => ({
        id: row.id,
        action: row.action,
        summary: row.summary,
        actor: row.actor || "Someone",
        groupId: row.group_id,
        groupName: row.group_name,
        emoji: row.emoji,
        expenseId: row.expense_id,
        createdAt: row.created_at,
      })),
    });
  })
);

// The group's expenses as a spreadsheet: one row per expense, one column per
// member, so it can be checked against a bank statement outside the app.
router.get(
  "/groups/:id/export",
  requireAuth,
  canSplit,
  route(async (req, res) => {
    const found = await requireGroup(req, res);
    if (!found) return;

    const record = await readGroup(found.group.id, req.access.personId);
    const members = record.members;

    const cell = (value) => {
      const text = String(value ?? "");
      return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    };
    const money = (cents) => (cents / 100).toFixed(2);

    const lines = [
      [
        "Date",
        "Description",
        "Category",
        "Currency",
        "Amount",
        ...members.map((member) => `${member.name} paid`),
        ...members.map((member) => `${member.name} owes`),
      ]
        .map(cell)
        .join(","),
    ];

    for (const expense of record.expenses) {
      const byMember = new Map(expense.shares.map((share) => [share.memberId, share]));
      lines.push(
        [
          expense.spentOn,
          expense.description,
          expense.kind === "settlement" ? "Payment" : expense.category,
          expense.currency,
          money(expense.amountCents),
          ...members.map((member) => money(byMember.get(member.id)?.paidCents || 0)),
          ...members.map((member) => money(byMember.get(member.id)?.owedCents || 0)),
        ]
          .map(cell)
          .join(",")
      );
    }

    // The closing balances are what people actually open this for, and they do
    // not line up with the expense columns, so they get their own block.
    lines.push("");
    lines.push(["Balance", "Currency", "Net"].map(cell).join(","));
    for (const member of members) {
      lines.push([member.name, found.group.currency, money(member.netCents)].map(cell).join(","));
    }

    const filename = found.group.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase() || "expenses";
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}.csv"`);
    res.send(lines.join("\n"));
  })
);

module.exports = router;
