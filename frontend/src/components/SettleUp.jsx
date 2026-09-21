import React, { useState } from "react";
import { api } from "../api.js";
import { useAuth } from "../context/AuthContext.jsx";
import { centsToInput, formatMoney, todayText } from "../lib/split.js";

// Recording that money actually changed hands. The app does not move it — this
// is a note that it happened, which is all Splitwise does too — so the form
// opens on the debt that was tapped and only asks for what it cannot know:
// whether the whole thing was paid, and when.
export default function SettleUp({ group, members, preset, onSaved, onClose }) {
  const { token } = useAuth();

  const [fromMemberId, setFromMemberId] = useState(preset?.fromMemberId ?? members[0]?.id);
  const [toMemberId, setToMemberId] = useState(
    preset?.toMemberId ?? members.find((member) => member.id !== members[0]?.id)?.id
  );
  const [amount, setAmount] = useState(preset ? centsToInput(preset.amountCents) : "");
  const [date, setDate] = useState(todayText());
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const nameOf = (id) => members.find((member) => member.id === id)?.name ?? "";

  async function save() {
    setError("");
    setSaving(true);
    try {
      onSaved(
        await api.settleUp(token, group.id, {
          fromMemberId,
          toMemberId,
          amount,
          date,
          notes,
          currency: group.currency,
        })
      );
    } catch (err) {
      setError(err.message);
      setSaving(false);
    }
  }

  return (
    <div className="split-overlay" role="dialog" aria-modal="true">
      <div className="split-modal split-modal-narrow">
        <header className="split-modal-head">
          <h2 className="split-modal-title">Record a payment</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>

        <div className="split-modal-body">
          {error && <div className="error-banner">{error}</div>}

          <div className="split-settle-line">
            <select
              value={fromMemberId ?? ""}
              onChange={(event) => setFromMemberId(Number(event.target.value))}
              aria-label="Who paid"
            >
              {members.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.name}
                  {member.isYou ? " (you)" : ""}
                </option>
              ))}
            </select>
            <span className="split-settle-arrow" aria-hidden="true">
              →
            </span>
            <select
              value={toMemberId ?? ""}
              onChange={(event) => setToMemberId(Number(event.target.value))}
              aria-label="Who was paid"
            >
              {members.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.name}
                  {member.isYou ? " (you)" : ""}
                </option>
              ))}
            </select>
          </div>

          <p className="split-settle-note">
            {fromMemberId === toMemberId
              ? "Choose two different people."
              : `${nameOf(fromMemberId)} paid ${nameOf(toMemberId)}.`}
          </p>

          <div className="split-row">
            <div className="field">
              <label htmlFor="settle-amount">Amount ({group.currency})</label>
              <input
                id="settle-amount"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                placeholder="0.00"
                inputMode="decimal"
                autoFocus
              />
            </div>
            <div className="field">
              <label htmlFor="settle-date">Date</label>
              <input
                id="settle-date"
                type="date"
                value={date}
                onChange={(event) => setDate(event.target.value)}
              />
            </div>
          </div>

          {preset && (
            <p className="split-settle-note">
              The full amount owed is {formatMoney(preset.amountCents, group.currency)}. A smaller
              figure is fine — the rest stays outstanding.
            </p>
          )}

          <div className="field">
            <label htmlFor="settle-notes">Notes</label>
            <input
              id="settle-notes"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="PayNow, cash, …"
            />
          </div>
        </div>

        <footer className="split-modal-foot">
          <div className="split-modal-foot-right">
            <button className="btn btn-secondary btn-inline" onClick={onClose} disabled={saving}>
              Cancel
            </button>
            <button
              className="btn btn-primary btn-inline"
              onClick={save}
              disabled={saving || fromMemberId === toMemberId}
            >
              {saving ? "Saving…" : "Record it"}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
