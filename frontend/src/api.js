const BASE = "/api";

async function request(path, { method = "GET", body, token, signal } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal,
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    // Carry the status through so callers can tell "signed out" (401) apart
    // from "server hiccup" (5xx) and react differently.
    const error = new Error(data.error || "Something went wrong. Please try again.");
    error.status = res.status;
    throw error;
  }
  return data;
}

export const api = {
  signup: (payload) => request("/auth/signup", { method: "POST", body: payload }),
  login: (payload) => request("/auth/login", { method: "POST", body: payload }),
  me: (token, signal) => request("/auth/me", { token, signal }),
  dashboardSummary: (token, team, signal) =>
    request(`/dashboard/summary${team ? `?team=${encodeURIComponent(team)}` : ""}`, {
      token,
      signal,
    }),

  getPeople: (token, signal) => request("/people", { token, signal }),
  createPerson: (token, person) => request("/people", { method: "POST", body: person, token }),
  updatePerson: (token, id, person) =>
    request(`/people/${id}`, { method: "PUT", body: person, token }),
  deletePerson: (token, id) => request(`/people/${id}`, { method: "DELETE", token }),

  setPin: (token, pin, currentPin) =>
    request("/auth/pin", { method: "POST", body: { pin, currentPin }, token }),
  removePin: (token) => request("/auth/pin", { method: "DELETE", token }),
  pinLogin: (email, pin) => request("/auth/pin/login", { method: "POST", body: { email, pin } }),

  bulkSavePeople: (token, changes) =>
    request("/people/bulk", { method: "PUT", body: changes, token }),

  // A structure belongs to a team; omitting one opens the caller's own.
  getRoster: (token, team, signal) =>
    request(`/roster${team ? `?team=${encodeURIComponent(team)}` : ""}`, { token, signal }),
  saveRoster: (token, roster) => request("/roster", { method: "PUT", body: roster, token }),

  getTeams: (token, signal) => request("/teams", { token, signal }),

  // A question about the records, answered from them.
  ask: (token, question) => request("/ask", { method: "POST", body: { question }, token }),

  getAttendance: (token, { team, year, week }, signal) =>
    request(`/attendance?team=${encodeURIComponent(team)}&year=${year}&week=${week}`, {
      token,
      signal,
    }),
  saveAttendance: (token, body) => request("/attendance", { method: "PUT", body, token }),

  // What the whole CG did that week: each team, and the two added together.
  getCgAttendance: (token, { cg, year, week }, signal) =>
    request(`/attendance/cg?cg=${encodeURIComponent(cg)}&year=${year}&week=${week}`, {
      token,
      signal,
    }),

  // Statuses are zone-wide: a register is read next to other registers, so a
  // status added for one team would not compare.
  addAttendanceStatus: (token, body) =>
    request("/attendance/statuses", { method: "POST", body, token }),
  removeAttendanceStatus: (token, key) =>
    request(`/attendance/statuses/${encodeURIComponent(key)}`, { method: "DELETE", token }),

  // Everyone on the CG's attendance lists that week — the names a seating
  // arrangement draws on.
  getAttendanceRoll: (token, { cg, year, week }, signal) =>
    request(`/attendance/roll?cg=${encodeURIComponent(cg)}&year=${year}&week=${week}`, {
      token,
      signal,
    }),

  getSeating: (token, { cg, year, week }, signal) =>
    request(`/seating?cg=${encodeURIComponent(cg)}&year=${year}&week=${week}`, { token, signal }),
  saveSeating: (token, body) => request("/seating", { method: "PUT", body, token }),

  // ---- Shared expenses ----
  // Every write answers with the whole group — the expenses, the balances and
  // the debts are worked out together on the server, so sending them back in
  // one piece is what keeps the page from showing a new expense next to an old
  // balance.
  splitPeople: (token, signal) => request("/split/people", { token, signal }),
  splitGroups: (token, signal) => request("/split/groups", { token, signal }),
  splitGroup: (token, id, signal) => request(`/split/groups/${id}`, { token, signal }),
  createSplitGroup: (token, body) => request("/split/groups", { method: "POST", body, token }),
  updateSplitGroup: (token, id, body) =>
    request(`/split/groups/${id}`, { method: "PATCH", body, token }),
  deleteSplitGroup: (token, id) => request(`/split/groups/${id}`, { method: "DELETE", token }),

  addSplitMember: (token, id, body) =>
    request(`/split/groups/${id}/members`, { method: "POST", body, token }),
  removeSplitMember: (token, id, memberId) =>
    request(`/split/groups/${id}/members/${memberId}`, { method: "DELETE", token }),

  addExpense: (token, id, body) =>
    request(`/split/groups/${id}/expenses`, { method: "POST", body, token }),
  updateExpense: (token, expenseId, body) =>
    request(`/split/expenses/${expenseId}`, { method: "PUT", body, token }),
  deleteExpense: (token, expenseId) =>
    request(`/split/expenses/${expenseId}`, { method: "DELETE", token }),
  settleUp: (token, id, body) =>
    request(`/split/groups/${id}/settle`, { method: "POST", body, token }),

  expenseComments: (token, expenseId, signal) =>
    request(`/split/expenses/${expenseId}/comments`, { token, signal }),
  addExpenseComment: (token, expenseId, body) =>
    request(`/split/expenses/${expenseId}/comments`, { method: "POST", body: { body }, token }),

  splitActivity: (token, signal) => request("/split/activity", { token, signal }),

  // A file rather than JSON, so this goes around request() instead of through
  // it — the caller turns the text into a download.
  exportSplitCsv: async (token, id) => {
    const res = await fetch(`${BASE}/split/groups/${id}/export`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error("That group could not be exported.");
    return res.text();
  },

  getAccounts: (token, signal) => request("/admin/accounts", { token, signal }),
  createAccount: (token, account) =>
    request("/admin/accounts", { method: "POST", body: account, token }),
  // Role, admin flag and teams all patch the same account; any subset is fine.
  updateAccount: (token, id, body) =>
    request(`/admin/accounts/${id}`, { method: "PATCH", body, token }),
  setAccountTeams: (token, id, teams) =>
    request(`/admin/accounts/${id}`, { method: "PATCH", body: { teams }, token }),
  deleteAccount: (token, id) => request(`/admin/accounts/${id}`, { method: "DELETE", token }),

  webauthnRegisterOptions: (token) =>
    request("/auth/webauthn/register-options", { token }),
  webauthnRegisterVerify: (token, response) =>
    request("/auth/webauthn/register-verify", { method: "POST", body: response, token }),
  webauthnLoginOptions: (email) =>
    request("/auth/webauthn/login-options", { method: "POST", body: { email } }),
  webauthnLoginVerify: (userId, response) =>
    request("/auth/webauthn/login-verify", {
      method: "POST",
      body: { userId, response },
    }),
};
