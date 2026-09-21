import React, { useMemo, useState } from "react";
import { api } from "../api.js";
import { useAuth } from "../context/AuthContext.jsx";
import {
  CATEGORIES,
  CURRENCIES,
  METHODS,
  RECURRENCE_LABELS,
  centsToInput,
  formatMoney,
  previewOwed,
  splitProblem,
  toCents,
  todayText,
} from "../lib/split.js";

// Adding or changing an expense: what it was, who paid for it, and how it is
// carved up. The carving is the part worth getting right, so every way of
// doing it shows the same thing underneath each name — what that person ends
// up owing — and the total is checked while it is being typed rather than
// after saving.
export default function ExpenseEditor({ group, members, categories, expense, onSaved, onClose }) {
  const { token } = useAuth();
  const editing = Boolean(expense);

  const [description, setDescription] = useState(expense?.description ?? "");
  const [amount, setAmount] = useState(expense ? centsToInput(expense.amountCents) : "");
  const [currency, setCurrency] = useState(expense?.currency ?? group.currency);
  const [date, setDate] = useState(expense?.spentOn ?? todayText());
  const [category, setCategory] = useState(expense?.category ?? "general");
  const [notes, setNotes] = useState(expense?.notes ?? "");
  const [recurrence, setRecurrence] = useState(expense?.recurrence ?? "");
  const [method, setMethod] = useState(expense?.splitMethod ?? "equally");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const amountCents = toCents(amount) ?? 0;

  // Who paid. One payer covers almost every expense, so that is the shape the
  // form opens in; splitting the paying is a deliberate extra step.
  const payingShares = (expense?.shares ?? []).filter((share) => share.paidCents > 0);
  const [multiPayer, setMultiPayer] = useState(payingShares.length > 1);
  const [payerId, setPayerId] = useState(
    payingShares[0]?.memberId ?? members.find((member) => member.isYou)?.id ?? members[0]?.id
  );
  const [paidBy, setPaidBy] = useState(() => {
    const map = {};
    for (const share of payingShares) map[share.memberId] = centsToInput(share.paidCents);
    return map;
  });

  // Who it is split between, and what each was given in the current method's
  // units. Both are kept for every member so that switching method, or taking
  // someone out and putting them back, does not lose what was typed.
  const [included, setIncluded] = useState(() => {
    if (!expense) return new Set(members.map((member) => member.id));
    const chosen = expense.shares
      .filter((share) => share.owedCents !== 0 || share.inputValue !== 0)
      .map((share) => share.memberId);
    return new Set(chosen.length > 0 ? chosen : members.map((member) => member.id));
  });

  const [values, setValues] = useState(() => {
    const map = {};
    for (const share of expense?.shares ?? []) {
      if (expense.splitMethod === "exact" || expense.splitMethod === "adjustment") {
        map[share.memberId] = centsToInput(share.inputValue);
      } else if (expense.splitMethod === "percent") {
        map[share.memberId] = String(share.inputValue / 100);
      } else if (expense.splitMethod === "shares") {
        map[share.memberId] = String(share.inputValue);
      }
    }
    return map;
  });

  const chosen = useMemo(
    () => members.filter((member) => included.has(member.id)),
    [members, included]
  );

  // The entries in the units the method works in — cents for amounts,
  // hundredths for percentages, a plain count for shares.
  const entries = useMemo(
    () =>
      chosen.map((member) => {
        const raw = values[member.id];
        if (method === "exact" || method === "adjustment") {
          return { memberId: member.id, value: toCents(raw) ?? 0 };
        }
        if (method === "percent") return { memberId: member.id, value: Math.round(Number(raw || 0) * 100) };
        if (method === "shares") return { memberId: member.id, value: Math.round(Number(raw || 0)) || 0 };
        return { memberId: member.id, value: 0 };
      }),
    [chosen, values, method]
  );

  const owed = useMemo(
    () => previewOwed(method, amountCents, entries),
    [method, amountCents, entries]
  );
  const problem = splitProblem(method, amountCents, entries);

  const paidTotal = multiPayer
    ? members.reduce((sum, member) => sum + (toCents(paidBy[member.id]) ?? 0), 0)
    : amountCents;
  const payerProblem =
    multiPayer && paidTotal !== amountCents
      ? paidTotal > amountCents
        ? `${formatMoney(paidTotal - amountCents, "")} over the expense.`
        : `${formatMoney(amountCents - paidTotal, "")} left to account for.`
      : null;

  function toggle(memberId) {
    setIncluded((current) => {
      const next = new Set(current);
      if (next.has(memberId)) next.delete(memberId);
      else next.add(memberId);
      return next;
    });
  }

  // Fills the boxes with an even split, which is where most people start
  // before nudging one or two of them.
  function spreadEvenly() {
    if (chosen.length === 0) return;
    const next = { ...values };
    if (method === "exact") {
      const even = previewOwed("equally", amountCents, entries);
      for (const member of chosen) next[member.id] = centsToInput(even.get(member.id) ?? 0);
    } else if (method === "percent") {
      const even = previewOwed("equally", 10000, entries);
      for (const member of chosen) next[member.id] = String((even.get(member.id) ?? 0) / 100);
    } else if (method === "shares") {
      for (const member of chosen) next[member.id] = "1";
    } else if (method === "adjustment") {
      for (const member of chosen) next[member.id] = "0.00";
    }
    setValues(next);
  }

  async function save() {
    setError("");

    if (!description.trim()) return setError("Give the expense a description.");
    if (toCents(amount) === null || amountCents <= 0) return setError("Enter an amount.");
    if (payerProblem) return setError(payerProblem);
    if (problem) return setError(problem);

    const payers = multiPayer
      ? members
          .map((member) => ({ memberId: member.id, amount: paidBy[member.id] }))
          .filter((payer) => (toCents(payer.amount) ?? 0) > 0)
      : [{ memberId: payerId, amount }];

    if (payers.length === 0) return setError("Say who paid.");

    const splits = entries.map((entry) => ({
      memberId: entry.memberId,
      // Sent in the same units the server reads for this method: dollars for
      // the amount-based ones, plain numbers for the rest.
      value:
        method === "exact" || method === "adjustment"
          ? centsToInput(entry.value)
          : method === "percent"
            ? entry.value / 100
            : entry.value,
    }));

    const body = {
      description,
      amount,
      currency,
      date,
      category,
      notes,
      recurrence,
      payers,
      splitMethod: method,
      splits,
    };

    setSaving(true);
    try {
      const next = editing
        ? await api.updateExpense(token, expense.id, body)
        : await api.addExpense(token, group.id, body);
      onSaved(next);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    setSaving(true);
    try {
      onSaved(await api.deleteExpense(token, expense.id));
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  const unit = method === "percent" ? "%" : method === "shares" ? "shares" : currency;

  return (
    <div className="split-overlay" role="dialog" aria-modal="true">
      <div className="split-modal">
        <header className="split-modal-head">
          <h2 className="split-modal-title">{editing ? "Edit expense" : "New expense"}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>

        <div className="split-modal-body">
          {error && <div className="error-banner">{error}</div>}

          <div className="field">
            <label htmlFor="expense-description">Description</label>
            <input
              id="expense-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Dinner after service"
              autoFocus
            />
          </div>

          <div className="split-row">
            <div className="field">
              <label htmlFor="expense-amount">Amount</label>
              <input
                id="expense-amount"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                placeholder="0.00"
                inputMode="decimal"
              />
            </div>
            <div className="field split-field-narrow">
              <label htmlFor="expense-currency">Currency</label>
              <select
                id="expense-currency"
                value={currency}
                onChange={(event) => setCurrency(event.target.value)}
              >
                {[...new Set([currency, ...CURRENCIES])].map((code) => (
                  <option key={code} value={code}>
                    {code}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="split-row">
            <div className="field">
              <label htmlFor="expense-date">Date</label>
              <input
                id="expense-date"
                type="date"
                value={date}
                onChange={(event) => setDate(event.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="expense-category">Category</label>
              <select
                id="expense-category"
                value={category}
                onChange={(event) => setCategory(event.target.value)}
              >
                {(categories?.length ? categories : CATEGORIES).map((item) => (
                  <option key={item.key} value={item.key}>
                    {item.emoji} {item.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* ---- who paid ---- */}
          <section className="split-block">
            <div className="split-block-head">
              <h3 className="split-block-title">Paid by</h3>
              <button className="link-btn" onClick={() => setMultiPayer((on) => !on)}>
                {multiPayer ? "One person paid" : "More than one person paid"}
              </button>
            </div>

            {multiPayer ? (
              <>
                <div className="split-people">
                  {members.map((member) => (
                    <label key={member.id} className="split-person">
                      <span className="split-person-name">
                        {member.name}
                        {member.isYou && <span className="split-you">you</span>}
                      </span>
                      <input
                        className="split-person-input"
                        value={paidBy[member.id] ?? ""}
                        onChange={(event) =>
                          setPaidBy((current) => ({ ...current, [member.id]: event.target.value }))
                        }
                        placeholder="0.00"
                        inputMode="decimal"
                        aria-label={`${member.name} paid`}
                      />
                    </label>
                  ))}
                </div>
                <div className={`split-tally${payerProblem ? " split-tally-off" : ""}`}>
                  {payerProblem || `${formatMoney(paidTotal, currency)} of ${formatMoney(amountCents, currency)}`}
                </div>
              </>
            ) : (
              <select
                className="split-payer"
                value={payerId ?? ""}
                onChange={(event) => setPayerId(Number(event.target.value))}
                aria-label="Who paid"
              >
                {members.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.name}
                    {member.isYou ? " (you)" : ""}
                  </option>
                ))}
              </select>
            )}
          </section>

          {/* ---- how it splits ---- */}
          <section className="split-block">
            <div className="split-block-head">
              <h3 className="split-block-title">Split</h3>
              {method !== "equally" && (
                <button className="link-btn" onClick={spreadEvenly}>
                  Spread evenly
                </button>
              )}
            </div>

            <div className="split-methods">
              {METHODS.map((item) => (
                <button
                  key={item.key}
                  className={`split-method${method === item.key ? " split-method-on" : ""}`}
                  onClick={() => setMethod(item.key)}
                  title={item.hint}
                >
                  {item.label}
                </button>
              ))}
            </div>

            <div className="split-people">
              {members.map((member) => {
                const on = included.has(member.id);
                return (
                  <div key={member.id} className={`split-person${on ? "" : " split-person-off"}`}>
                    <label className="split-person-pick">
                      <input type="checkbox" checked={on} onChange={() => toggle(member.id)} />
                      <span className="split-person-name">
                        {member.name}
                        {member.isYou && <span className="split-you">you</span>}
                      </span>
                    </label>

                    {on && method !== "equally" && (
                      <input
                        className="split-person-input"
                        value={values[member.id] ?? ""}
                        onChange={(event) =>
                          setValues((current) => ({ ...current, [member.id]: event.target.value }))
                        }
                        placeholder={method === "shares" ? "1" : "0"}
                        inputMode="decimal"
                        aria-label={`${member.name} ${unit}`}
                      />
                    )}

                    {on && (
                      <span className="split-person-owes">
                        {formatMoney(owed.get(member.id) ?? 0, "")}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>

            <div className={`split-tally${problem ? " split-tally-off" : ""}`}>
              {problem ||
                `${formatMoney(amountCents, currency)} between ${chosen.length} ${
                  chosen.length === 1 ? "person" : "people"
                }`}
            </div>
          </section>

          <div className="split-row">
            <div className="field">
              <label htmlFor="expense-repeat">Repeat</label>
              <select
                id="expense-repeat"
                value={recurrence}
                onChange={(event) => setRecurrence(event.target.value)}
              >
                {Object.entries(RECURRENCE_LABELS).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="expense-notes">Notes</label>
              <input
                id="expense-notes"
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                placeholder="Optional"
              />
            </div>
          </div>
        </div>

        <footer className="split-modal-foot">
          {editing && (
            <button className="btn btn-danger btn-inline" onClick={remove} disabled={saving}>
              Delete
            </button>
          )}
          <div className="split-modal-foot-right">
            <button className="btn btn-secondary btn-inline" onClick={onClose} disabled={saving}>
              Cancel
            </button>
            <button className="btn btn-primary btn-inline" onClick={save} disabled={saving}>
              {saving ? "Saving…" : editing ? "Save changes" : "Add expense"}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
