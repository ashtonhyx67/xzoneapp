import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../api.js";
import { useAuth } from "../context/AuthContext.jsx";
import { PERMISSIONS } from "../lib/permissions.js";
import {
  RECURRENCE_LABELS,
  categoryFor,
  dayLabel,
  formatMoney,
  monthLabel,
} from "../lib/split.js";
import AppShell from "../components/AppShell.jsx";
import ExpenseEditor from "../components/ExpenseEditor.jsx";
import SettleUp from "../components/SettleUp.jsx";

// One group: what has been spent, who is out of pocket, and the payments that
// would put everyone straight. The page is built from a single response, so
// the balances can never be one save behind the expenses they come from.
export default function SplitGroup() {
  const { groupId } = useParams();
  const { token, can } = useAuth();
  const navigate = useNavigate();

  const [state, setState] = useState(null);
  const [categories, setCategories] = useState([]);
  const [people, setPeople] = useState([]);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState(null); // null | { expense } | "new"
  const [settling, setSettling] = useState(null); // null | {} | { preset }
  const [openExpense, setOpenExpense] = useState(null);
  const [comments, setComments] = useState([]);
  const [draft, setDraft] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(
    (signal) =>
      api
        .splitGroup(token, groupId, signal)
        .then(setState)
        .catch((err) => {
          if (err.name !== "AbortError") setError(err.message);
        }),
    [token, groupId]
  );

  useEffect(() => {
    if (!token) return;
    const controller = new AbortController();
    load(controller.signal);

    // The category list and the directory only matter once something is being
    // added, but they are small and fetching them now keeps the form instant.
    api
      .splitGroups(token, controller.signal)
      .then((data) => setCategories(data.categories || []))
      .catch(() => {});
    api
      .splitPeople(token, controller.signal)
      .then((data) => setPeople(data.people || []))
      .catch(() => {});

    return () => controller.abort();
  }, [token, load]);

  // Every write answers with the whole group, so applying a result is the
  // same thing as reloading — without the round trip.
  const applied = (next) => {
    setState(next);
    setEditing(null);
    setSettling(null);
    setBusy(false);
  };

  const members = state?.members ?? [];
  const me = members.find((member) => member.isYou) || null;
  const nameOf = useCallback(
    (id) => members.find((member) => member.id === id)?.name ?? "Someone",
    [members]
  );

  // Expenses under month headings, the way a statement reads.
  const months = useMemo(() => {
    const groups = [];
    let current = null;
    for (const expense of state?.expenses ?? []) {
      const label = monthLabel(expense.spentOn);
      if (!current || current.label !== label) {
        current = { label, expenses: [] };
        groups.push(current);
      }
      current.expenses.push(expense);
    }
    return groups;
  }, [state]);

  async function openComments(expense) {
    if (openExpense === expense.id) {
      setOpenExpense(null);
      return;
    }
    setOpenExpense(expense.id);
    setComments([]);
    setDraft("");
    try {
      const data = await api.expenseComments(token, expense.id);
      setComments(data.comments);
    } catch (err) {
      setError(err.message);
    }
  }

  async function postComment(expenseId) {
    if (!draft.trim()) return;
    try {
      const data = await api.addExpenseComment(token, expenseId, draft.trim());
      setComments(data.comments);
      setDraft("");
      // The row shows a count, and it has just changed.
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  async function exportCsv() {
    try {
      const csv = await api.exportSplitCsv(token, groupId);
      const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = `${(state?.group.name || "expenses").replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err.message);
    }
  }

  async function change(body) {
    setBusy(true);
    try {
      applied(await api.updateSplitGroup(token, groupId, body));
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  async function addMember(personId) {
    setBusy(true);
    try {
      applied(await api.addSplitMember(token, groupId, { personId: Number(personId) }));
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  async function removeMember(memberId) {
    setBusy(true);
    try {
      applied(await api.removeSplitMember(token, groupId, memberId));
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  async function deleteGroup() {
    setBusy(true);
    try {
      await api.deleteSplitGroup(token, groupId);
      navigate("/split");
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  if (!can(PERMISSIONS.USE_EXPENSES)) {
    return (
      <AppShell>
        <header className="page-head">
          <h1 className="page-title">Split</h1>
        </header>
        <p className="list-empty">You do not have access to shared expenses.</p>
      </AppShell>
    );
  }

  if (!state) {
    return (
      <AppShell>
        {error ? <div className="error-banner">{error}</div> : <p className="list-empty">Loading…</p>}
      </AppShell>
    );
  }

  const { group } = state;
  const currency = group.currency;
  const myNet = me?.netCents ?? 0;
  const alreadyIn = new Set(members.map((member) => member.personId).filter(Boolean));

  return (
    <AppShell>
      <header className="page-head">
        <div className="split-head-identity">
          <Link to="/split" className="link-btn">
            ← Groups
          </Link>
          <h1 className="page-title">
            <span aria-hidden="true">{group.emoji}</span> {group.name}
          </h1>
        </div>
        <button className="btn btn-secondary btn-inline" onClick={() => setShowSettings((on) => !on)}>
          {showSettings ? "Done" : "Settings"}
        </button>
      </header>

      {error && <div className="error-banner">{error}</div>}

      {/* Where you stand, before anything else on the page. */}
      <section className={`split-standing split-standing-${myNet > 0 ? "up" : myNet < 0 ? "down" : "level"}`}>
        {!me ? (
          <span>You are not one of the people in this group — you are looking at someone else's.</span>
        ) : myNet === 0 ? (
          <span>You are all settled up.</span>
        ) : myNet > 0 ? (
          <span>
            You are owed <strong>{formatMoney(myNet, currency)}</strong>
          </span>
        ) : (
          <span>
            You owe <strong>{formatMoney(-myNet, currency)}</strong>
          </span>
        )}
      </section>

      <div className="split-actions">
        <button className="btn btn-primary btn-inline" onClick={() => setEditing("new")}>
          Add expense
        </button>
        <button className="btn btn-secondary btn-inline" onClick={() => setSettling({})}>
          Settle up
        </button>
        <button className="btn btn-secondary btn-inline" onClick={exportCsv}>
          Export CSV
        </button>
      </div>

      {showSettings && (
        <section className="section">
          <div className="section-head">
            <h2 className="section-title">Settings</h2>
          </div>

          <div className="panel">
            <div className="panel-row">
              <div className="field">
                <label htmlFor="group-name">Name</label>
                <input
                  id="group-name"
                  defaultValue={group.name}
                  onBlur={(event) =>
                    event.target.value.trim() !== group.name && change({ name: event.target.value })
                  }
                />
              </div>
            </div>

            <label className="split-toggle">
              <input
                type="checkbox"
                checked={group.simplifyDebts}
                onChange={(event) => change({ simplifyDebts: event.target.checked })}
                disabled={busy}
              />
              <span>
                <strong>Simplify debts</strong>
                <span className="panel-note">
                  Combine the debts into the fewest payments. Off, everyone pays back the person who
                  actually paid for them.
                </span>
              </span>
            </label>

            <div className="panel-row">
              <span>People</span>
            </div>
            <ul className="split-member-list">
              {members.map((member) => (
                <li key={member.id} className="split-member-row">
                  <span>
                    {member.name}
                    {member.isYou && <span className="split-you">you</span>}
                  </span>
                  <button
                    className="link-btn link-btn-danger"
                    onClick={() => removeMember(member.id)}
                    disabled={busy}
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>

            <div className="panel-row">
              <select
                defaultValue=""
                onChange={(event) => event.target.value && addMember(event.target.value)}
                disabled={busy}
                aria-label="Add someone"
              >
                <option value="">Add someone…</option>
                {people
                  .filter((person) => !alreadyIn.has(person.id))
                  .map((person) => (
                    <option key={person.id} value={person.id}>
                      {person.name}
                    </option>
                  ))}
              </select>
            </div>

            <div className="panel-row panel-row-actions">
              <button
                className="btn btn-secondary btn-inline"
                onClick={() => change({ archived: !group.archived })}
                disabled={busy}
              >
                {group.archived ? "Unarchive" : "Archive"}
              </button>
              <button className="btn btn-danger btn-inline" onClick={deleteGroup} disabled={busy}>
                Delete group
              </button>
            </div>
            <p className="panel-note">
              Deleting takes every expense in this group with it, for everyone. Only whoever started
              the group can.
            </p>
          </div>
        </section>
      )}

      {/* ---- who owes whom ---- */}
      <section className="section">
        <div className="section-head">
          <h2 className="section-title">Balances</h2>
          <span className="section-count">
            {group.simplifyDebts ? "Simplified" : "As paid"}
          </span>
        </div>

        {state.debts.length === 0 ? (
          <p className="list-empty">Everyone is square.</p>
        ) : (
          <ul className="split-debts">
            {state.debts.map((debt) => (
              <li key={`${debt.fromMemberId}-${debt.toMemberId}`} className="split-debt">
                <span className="split-debt-text">
                  <strong>{nameOf(debt.fromMemberId)}</strong> owes{" "}
                  <strong>{nameOf(debt.toMemberId)}</strong>{" "}
                  {formatMoney(debt.amountCents, currency)}
                </span>
                <button
                  className="btn btn-secondary btn-inline"
                  onClick={() => setSettling({ preset: debt })}
                >
                  Settle
                </button>
              </li>
            ))}
          </ul>
        )}

        <ul className="split-member-list">
          {members.map((member) => (
            <li key={member.id} className="split-member-row">
              <span>
                {member.name}
                {member.isYou && <span className="split-you">you</span>}
              </span>
              <span
                className={`split-net split-net-${
                  member.netCents > 0 ? "up" : member.netCents < 0 ? "down" : "level"
                }`}
              >
                {member.netCents === 0
                  ? "settled"
                  : member.netCents > 0
                    ? `is owed ${formatMoney(member.netCents, "")}`
                    : `owes ${formatMoney(-member.netCents, "")}`}
              </span>
            </li>
          ))}
        </ul>
      </section>

      {/* ---- the expenses ---- */}
      <section className="section">
        <div className="section-head">
          <h2 className="section-title">Expenses</h2>
          <span className="section-count">{state.expenses.length}</span>
        </div>

        {state.expenses.length === 0 ? (
          <p className="list-empty">Nothing yet. Add the first expense.</p>
        ) : (
          months.map((month) => (
            <div key={month.label} className="split-month">
              <h3 className="split-month-label">{month.label}</h3>
              <ul className="split-expenses">
                {month.expenses.map((expense) => {
                  const mine = expense.shares.find((share) => share.memberId === me?.id);
                  const lent = mine ? mine.paidCents - mine.owedCents : 0;
                  const category = categoryFor(expense.category, categories);
                  const settlement = expense.kind === "settlement";

                  return (
                    <li key={expense.id} className="split-expense">
                      <button className="split-expense-row" onClick={() => openComments(expense)}>
                        <span className="split-expense-date">{dayLabel(expense.spentOn)}</span>
                        <span className="split-expense-icon" aria-hidden="true">
                          {settlement ? "💸" : category.emoji}
                        </span>
                        <span className="split-expense-main">
                          <span className="split-expense-name">
                            {expense.description}
                            {expense.recurrence && (
                              <span className="split-repeat" title={RECURRENCE_LABELS[expense.recurrence]}>
                                ↻
                              </span>
                            )}
                          </span>
                          <span className="split-expense-sub">
                            {settlement
                              ? "Payment"
                              : `${nameOf(
                                  expense.shares.find((share) => share.paidCents > 0)?.memberId
                                )} paid ${formatMoney(expense.amountCents, expense.currency)}`}
                            {expense.commentCount > 0 && ` · 💬 ${expense.commentCount}`}
                          </span>
                        </span>
                        <span
                          className={`split-expense-you split-net-${
                            lent > 0 ? "up" : lent < 0 ? "down" : "level"
                          }`}
                        >
                          {/* A payment is not a debt: the person on the
                              receiving end of one has been paid, and saying
                              "you owe" there reads as the opposite of what
                              just happened. */}
                          {!me || lent === 0
                            ? formatMoney(expense.amountCents, "")
                            : settlement
                              ? lent > 0
                                ? `you paid ${formatMoney(lent, "")}`
                                : `you received ${formatMoney(-lent, "")}`
                              : lent > 0
                                ? `you lent ${formatMoney(lent, "")}`
                                : `you owe ${formatMoney(-lent, "")}`}
                        </span>
                      </button>

                      {openExpense === expense.id && (
                        <div className="split-expense-detail">
                          <ul className="split-member-list">
                            {expense.shares.map((share) => (
                              <li key={share.memberId} className="split-member-row">
                                <span>{nameOf(share.memberId)}</span>
                                <span className="split-net">
                                  {share.paidCents > 0 &&
                                    `paid ${formatMoney(share.paidCents, "")}`}
                                  {share.paidCents > 0 && share.owedCents > 0 && " · "}
                                  {share.owedCents > 0 &&
                                    (settlement
                                      ? `received ${formatMoney(share.owedCents, "")}`
                                      : `owes ${formatMoney(share.owedCents, "")}`)}
                                </span>
                              </li>
                            ))}
                          </ul>

                          {expense.notes && <p className="panel-note">{expense.notes}</p>}
                          <p className="panel-note">
                            Added by {expense.createdByName || "someone"}
                            {expense.recurrence
                              ? ` · ${RECURRENCE_LABELS[expense.recurrence]}, next on ${expense.recurrenceNext}`
                              : ""}
                          </p>

                          <ul className="split-comments">
                            {comments.map((comment) => (
                              <li key={comment.id} className="split-comment">
                                <strong>{comment.author}</strong> {comment.body}
                              </li>
                            ))}
                          </ul>

                          <div className="split-comment-form">
                            <input
                              value={draft}
                              onChange={(event) => setDraft(event.target.value)}
                              onKeyDown={(event) =>
                                event.key === "Enter" && postComment(expense.id)
                              }
                              placeholder="Add a comment"
                              aria-label="Add a comment"
                            />
                            <button
                              className="btn btn-secondary btn-inline"
                              onClick={() => postComment(expense.id)}
                            >
                              Post
                            </button>
                          </div>

                          {!settlement && (
                            <button
                              className="link-btn"
                              onClick={() => setEditing({ expense })}
                            >
                              Edit this expense
                            </button>
                          )}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))
        )}
      </section>

      {/* ---- what has been happening ---- */}
      {state.activity.length > 0 && (
        <section className="section">
          <div className="section-head">
            <h2 className="section-title">Activity</h2>
          </div>
          <ul className="split-activity">
            {state.activity.map((entry) => (
              <li key={entry.id} className="split-activity-row">
                <span>
                  <strong>{entry.actor}</strong> {entry.summary}
                </span>
                <span className="split-activity-when">
                  {new Date(entry.createdAt).toLocaleDateString()}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {editing && members.length > 0 && (
        <ExpenseEditor
          group={group}
          members={members}
          categories={categories}
          expense={editing === "new" ? null : editing.expense}
          onSaved={applied}
          onClose={() => setEditing(null)}
        />
      )}

      {settling && members.length > 1 && (
        <SettleUp
          group={group}
          members={members}
          preset={settling.preset}
          onSaved={applied}
          onClose={() => setSettling(null)}
        />
      )}
    </AppShell>
  );
}
