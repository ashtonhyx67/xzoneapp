import React, { useEffect, useMemo, useState } from "react";
import { api } from "../api.js";
import { useAuth } from "../context/AuthContext.jsx";
import { initials } from "../lib/photo.js";

// Everyone who can sign in, and which group they are in. Groups are defined on
// the server (backend/lib/groups.js) and arrive with their permissions, so this
// panel never needs to know what a group is called or what it can do.
export default function AccountsPanel() {
  const { token, user } = useAuth();

  const [accounts, setAccounts] = useState([]);
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busyId, setBusyId] = useState(null);
  const [confirmId, setConfirmId] = useState(null);

  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", password: "", group: "member" });

  useEffect(() => {
    const controller = new AbortController();
    let active = true;

    api
      .getAccounts(token, controller.signal)
      .then((data) => {
        if (!active) return;
        setAccounts(data.accounts);
        setGroups(data.groups);
      })
      .catch((err) => {
        if (active && err.name !== "AbortError") setError(err.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [token]);

  const assignable = useMemo(() => groups.filter((g) => g.assignable), [groups]);
  const labelFor = (key) => groups.find((g) => g.key === key)?.label || key;

  async function changeGroup(account, group) {
    setBusyId(account.id);
    setError("");
    setNotice("");
    try {
      const { account: saved } = await api.setAccountGroup(token, account.id, group);
      setAccounts((list) => list.map((a) => (a.id === saved.id ? saved : a)));
      setNotice(`${saved.name} is now ${labelFor(saved.group)}.`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  }

  async function remove(account) {
    setBusyId(account.id);
    setError("");
    setNotice("");
    try {
      await api.deleteAccount(token, account.id);
      setAccounts((list) => list.filter((a) => a.id !== account.id));
      setNotice(`${account.name}'s account was removed.`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
      setConfirmId(null);
    }
  }

  async function create(event) {
    event.preventDefault();
    setError("");
    setNotice("");
    setBusyId("new");
    try {
      const { account } = await api.createAccount(token, form);
      setAccounts((list) => [...list, account]);
      setForm({ name: "", email: "", password: "", group: "member" });
      setAdding(false);
      setNotice(`${account.name} can now sign in as ${labelFor(account.group)}.`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  }

  function update(field) {
    return (e) => setForm((prev) => ({ ...prev, [field]: e.target.value }));
  }

  return (
    <section className="section">
      <div className="section-head">
        <h2 className="section-title">Accounts</h2>
        <span className="section-count">{accounts.length}</span>
        <button
          className="btn btn-secondary btn-inline section-action"
          onClick={() => {
            setAdding((open) => !open);
            setError("");
          }}
        >
          {adding ? "Cancel" : "Add account"}
        </button>
      </div>

      {error && <div className="error-banner panel-notice">{error}</div>}
      {notice && <div className="success-banner panel-notice">{notice}</div>}

      {adding && (
        <form className="panel account-form" onSubmit={create}>
          <div className="field">
            <label htmlFor="account-name">Full name</label>
            <input id="account-name" value={form.name} onChange={update("name")} required />
          </div>
          <div className="field">
            <label htmlFor="account-email">Email</label>
            <input
              id="account-email"
              type="email"
              value={form.email}
              onChange={update("email")}
              required
            />
          </div>
          <div className="field">
            <label htmlFor="account-password">Temporary password</label>
            <input
              id="account-password"
              type="text"
              value={form.password}
              onChange={update("password")}
              minLength={8}
              required
            />
          </div>
          <div className="field">
            <label htmlFor="account-group">Group</label>
            <select id="account-group" value={form.group} onChange={update("group")}>
              {assignable.map((group) => (
                <option key={group.key} value={group.key}>
                  {group.label}
                </option>
              ))}
            </select>
          </div>
          <button className="btn btn-primary" type="submit" disabled={busyId === "new"}>
            {busyId === "new" ? "Creating" : "Create account"}
          </button>
        </form>
      )}

      {loading ? (
        <div className="list-empty">Loading…</div>
      ) : (
        <div className="account-list">
          {accounts.map((account) => (
            <div className="account-row" key={account.id}>
              <span className="member-avatar">{initials(account.name)}</span>

              <span className="member-identity">
                <span className="member-name">
                  {account.name}
                  {account.id === user?.id && <span className="you-tag">You</span>}
                </span>
                <span className="member-detail">{account.email}</span>
              </span>

              <span className="account-signin">
                {account.pinSet && <span className="badge badge-off">PIN</span>}
                {account.faceIdEnabled && <span className="badge badge-off">Face ID</span>}
              </span>

              {account.isOwner ? (
                <span className="group-pill group-pill-owner">Owner</span>
              ) : (
                <select
                  className="account-group"
                  value={account.group}
                  onChange={(e) => changeGroup(account, e.target.value)}
                  disabled={busyId === account.id || account.id === user?.id}
                  aria-label={`Group for ${account.name}`}
                >
                  {assignable.map((group) => (
                    <option key={group.key} value={group.key}>
                      {group.label}
                    </option>
                  ))}
                </select>
              )}

              <span className="account-actions">
                {account.isOwner || account.id === user?.id ? null : confirmId === account.id ? (
                  <>
                    <button
                      className="btn btn-danger btn-inline"
                      onClick={() => remove(account)}
                      disabled={busyId === account.id}
                    >
                      Remove
                    </button>
                    <button
                      className="btn btn-secondary btn-inline"
                      onClick={() => setConfirmId(null)}
                    >
                      Keep
                    </button>
                  </>
                ) : (
                  <button
                    className="btn btn-secondary btn-inline"
                    onClick={() => setConfirmId(account.id)}
                  >
                    Remove
                  </button>
                )}
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="group-legend">
        {groups.map((group) => (
          <div className="group-legend-row" key={group.key}>
            <span className={`group-pill${group.key === "owner" ? " group-pill-owner" : ""}`}>
              {group.label}
            </span>
            <span className="group-legend-text">{group.description}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
