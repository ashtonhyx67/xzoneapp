import React, { useEffect, useState } from "react";
import { api } from "../api.js";
import { CGS } from "../lib/teams.js";
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
        setGroups(data.groups.filter((group) => group.assignable));
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

  // Teams are not access — they say whose members someone works on — so unlike
  // a group, an admin may change their own.
  async function setTeams(account, next) {
    setBusyId(account.id);
    setError("");
    setNotice("");
    try {
      const { account: saved } = await api.setAccountTeams(token, account.id, next);
      setAccounts((list) => list.map((a) => (a.id === saved.id ? saved : a)));
      setNotice(
        saved.teams.length
          ? `${saved.name} works on ${saved.teams.join(", ")}.`
          : `${saved.name} is not on any team yet.`
      );
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  }

  async function patch(account, body, describe) {
    setBusyId(account.id);
    setError("");
    setNotice("");
    try {
      const { account: saved } = await api.updateAccount(token, account.id, body);
      setAccounts((list) => list.map((a) => (a.id === saved.id ? saved : a)));
      setNotice(describe(saved));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusyId(null);
    }
  }

  function toggleTeam(account, team) {
    const has = account.teams.includes(team);
    setTeams(account, has ? account.teams.filter((t) => t !== team) : [...account.teams, team]);
  }

  // A whole CG is just its teams, so giving someone a CG adds all of them and
  // taking it away removes all of them. Nothing is stored at CG level.
  function toggleCg(account, cg) {
    const hasAll = cg.teams.every((t) => account.teams.includes(t));
    setTeams(
      account,
      hasAll
        ? account.teams.filter((t) => !cg.teams.includes(t))
        : [...new Set([...account.teams, ...cg.teams])]
    );
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
      setNotice(`${account.name} can now sign in.`);
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
            {/* A browser accepts "a@b" as a valid email; the server wants a
                domain with a dot in it. Matching the two means the browser
                catches it first, in its own words, rather than the form being
                submitted only to come back rejected. */}
            <input
              id="account-email"
              type="email"
              pattern="[^\s@]+@[^\s@]+\.[^\s@]+"
              title="Include an @ and a domain, like name@gmail.com"
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
                <span className="account-access">
                  <select
                    className="account-role"
                    value={account.group}
                    disabled={busyId === account.id || account.id === user?.id}
                    aria-label={`Role for ${account.name}`}
                    onChange={(e) =>
                      patch(account, { group: e.target.value }, (saved) =>
                        `${saved.name} is now a ${
                          groups.find((g) => g.key === saved.group)?.label ?? saved.group
                        }.`
                      )
                    }
                  >
                    {groups.map((group) => (
                      <option key={group.key} value={group.key} title={group.description}>
                        {group.label}
                      </option>
                    ))}
                  </select>

                  {/* Separate from the role on purpose: an admin is a job, not
                      a rank, so a Member can hold it without being handed a
                      Leader's access to the database. */}
                  <label className="account-admin" title="Runs the accounts and the seating">
                    <input
                      type="checkbox"
                      checked={Boolean(account.isAdmin)}
                      disabled={busyId === account.id || account.id === user?.id}
                      onChange={(e) =>
                        patch(account, { isAdmin: e.target.checked }, (saved) =>
                          saved.isAdmin
                            ? `${saved.name} can now run the accounts and the seating.`
                            : `${saved.name} is no longer an admin.`
                        )
                      }
                    />
                    Admin
                  </label>
                </span>
              )}

              {/* Which teams this account works on, laid out by CG. An admin
                  already reaches the whole zone, so there is nothing to
                  choose for them. */}
              <span className="account-teams">
                {account.group === "admin" || account.isOwner ? (
                  <span className="account-teams-all">Whole zone</span>
                ) : (
                  CGS.map((cg) => {
                    const held = cg.teams.filter((t) => account.teams?.includes(t));
                    return (
                      <span className="cg-group" key={cg.key}>
                        <button
                          type="button"
                          className={`cg-chip${
                            held.length === cg.teams.length ? " cg-chip-on" : ""
                          }`}
                          onClick={() => toggleCg(account, cg)}
                          disabled={busyId === account.id}
                          title={`Whole ${cg.key} CG`}
                        >
                          {cg.key}
                        </button>
                        {cg.teams.map((team) => (
                          <button
                            type="button"
                            key={team}
                            className={`team-chip${
                              account.teams?.includes(team) ? " team-chip-on" : ""
                            }`}
                            onClick={() => toggleTeam(account, team)}
                            disabled={busyId === account.id}
                            aria-pressed={Boolean(account.teams?.includes(team))}
                            aria-label={`${team} for ${account.name}`}
                          >
                            {team}
                          </button>
                        ))}
                      </span>
                    );
                  })
                )}
              </span>

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

      <div className="panel-note">
        <p>
          <strong>Leader</strong> — the database, the registers and the structure.
          <br />
          <strong>Member</strong> — the dashboard, and the seating once it is finalised.
          <br />
          <strong>Admin</strong> — this page, and arranging the seating. A job rather
          than a rank, so a Member can hold it too.
        </p>
        <p>Teams decide whose members someone works on, not what they may do.</p>
      </div>

    </section>
  );
}
