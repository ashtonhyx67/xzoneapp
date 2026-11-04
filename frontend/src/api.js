const BASE = "/api";

// A leader previewing the app as a member. Kept for this launch only, and sent with
// every request so the server answers exactly as it would for a member.
const VIEW_AS_KEY = "viewAsMember";

export function isViewingAsMember() {
  try {
    return sessionStorage.getItem(VIEW_AS_KEY) === "1";
  } catch {
    return false;
  }
}

export function setViewingAsMember(on) {
  try {
    if (on) sessionStorage.setItem(VIEW_AS_KEY, "1");
    else sessionStorage.removeItem(VIEW_AS_KEY);
  } catch {
    /* storage unavailable; the preview simply does not start */
  }
}

async function request(path, { method = "GET", body, token, signal, headers } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(isViewingAsMember() ? { "X-View-As": "member" } : {}),
      ...headers,
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
  changePassword: (token, body) => request("/auth/password", { method: "POST", body, token }),
  pinLogin: (email, pin) => request("/auth/pin/login", { method: "POST", body: { email, pin } }),

  // The quiz is scored on the server, one step at a time: each submit answers
  // with what to ask next, or with the result once it has one.
  personalityQuiz: (token, signal) => request("/personality/quiz", { token, signal }),
  personalityResult: (token, signal) => request("/personality", { token, signal }),
  submitPersonality: (token, body) => request("/personality", { method: "POST", body, token }),

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

  // What the menu needs on every page.
  navStatus: (token, signal) => request("/dashboard/nav", { token, signal }),

  // ---- Outings ----
  outings: (token, signal) => request("/outings", { token, signal }),
  outing: (token, id, signal) => request(`/outings/${id}`, { token, signal }),
  outingPeople: (token, signal) => request("/outings/people", { token, signal }),
  createOuting: (token, body) => request("/outings", { method: "POST", body, token }),
  updateOuting: (token, id, body) => request(`/outings/${id}`, { method: "PUT", body, token }),
  deleteOuting: (token, id) => request(`/outings/${id}`, { method: "DELETE", token }),
  startOuting: (token, id) => request(`/outings/${id}/start`, { method: "POST", token }),
  endOuting: (token, id) => request(`/outings/${id}/end`, { method: "POST", token }),
  submitOutingEvaluation: (token, id, body) =>
    request(`/outings/${id}/evaluation`, { method: "POST", body, token }),
  addOutingFriend: (token, id, body) =>
    request(`/outings/friends/${id}/add`, { method: "POST", body, token }),

  // ---- Narnia BM ----
  // The standard answers every change with all the rooms, and a running session
  // with the whole board, so nothing on screen is half old and half new.
  narnia: (token, signal) => request("/narnia", { token, signal }),
  narniaAddRoom: (token, body) => request("/narnia/rooms", { method: "POST", body, token }),
  narniaUpdateRoom: (token, id, body) =>
    request(`/narnia/rooms/${id}`, { method: "PATCH", body, token }),
  narniaDeleteRoom: (token, id) => request(`/narnia/rooms/${id}`, { method: "DELETE", token }),
  narniaAddTask: (token, roomId, body) =>
    request(`/narnia/rooms/${roomId}/tasks`, { method: "POST", body, token }),
  narniaUpdateTask: (token, id, body) =>
    request(`/narnia/tasks/${id}`, { method: "PATCH", body, token }),
  narniaDeleteTask: (token, id) => request(`/narnia/tasks/${id}`, { method: "DELETE", token }),
  narniaAddPhoto: (token, roomId, body) =>
    request(`/narnia/rooms/${roomId}/photos`, { method: "POST", body, token }),
  narniaDeletePhoto: (token, id) => request(`/narnia/photos/${id}`, { method: "DELETE", token }),

  narniaCurrent: (token, signal) => request("/narnia/sessions/current", { token, signal }),
  narniaHistory: (token, signal) => request("/narnia/sessions", { token, signal }),
  narniaStart: (token, body) => request("/narnia/sessions", { method: "POST", body, token }),
  narniaEnd: (token, id) => request(`/narnia/sessions/${id}/end`, { method: "POST", token }),
  narniaAllowNames: (token, id, allowNames) =>
    request(`/narnia/sessions/${id}/allow-names`, {
      method: "POST",
      body: { allowNames },
      token,
    }),
  narniaAddCheckin: (token, id, body) =>
    request(`/narnia/sessions/${id}/checkins`, { method: "POST", body, token }),
  narniaRemoveCheckin: (token, id, checkinId) =>
    request(`/narnia/sessions/${id}/checkins/${checkinId}`, { method: "DELETE", token }),
  narniaAssign: (token, id, body) =>
    request(`/narnia/sessions/${id}/assign`, { method: "POST", body, token }),
  narniaUnassign: (token, id, body) =>
    request(`/narnia/sessions/${id}/unassign`, { method: "POST", body, token }),
  narniaSendToRoom: (token, id, body) =>
    request(`/narnia/sessions/${id}/room`, { method: "POST", body, token }),
  narniaShareOut: (token, id) =>
    request(`/narnia/sessions/${id}/share-out`, { method: "POST", token }),
  narniaSetDone: (token, id, body) =>
    request(`/narnia/sessions/${id}/done`, { method: "POST", body, token }),

  // Checking in, by whoever scanned the code. The key is how a phone finds its
  // own check-in again, with or without a sign-in.
  narniaJob: (code, { token, key }) =>
    request(`/narnia/join/${code}`, {
      token,
      headers: key ? { "X-Narnia-Key": key } : undefined,
    }),
  narniaJoin: (code, { token, key, name }) =>
    request(`/narnia/join/${code}`, {
      method: "POST",
      body: { name },
      token,
      headers: key ? { "X-Narnia-Key": key } : undefined,
    }),
  narniaTick: (code, taskId, { token, key, done }) =>
    request(`/narnia/join/${code}/tasks/${taskId}`, {
      method: "PUT",
      body: { done },
      token,
      headers: key ? { "X-Narnia-Key": key } : undefined,
    }),

  getAccounts: (token, signal) => request("/admin/accounts", { token, signal }),
  createAccount: (token, account) =>
    request("/admin/accounts", { method: "POST", body: account, token }),
  // Role, admin flag and teams all patch the same account; any subset is fine.
  updateAccount: (token, id, body) =>
    request(`/admin/accounts/${id}`, { method: "PATCH", body, token }),
  setAccountTeams: (token, id, teams) =>
    request(`/admin/accounts/${id}`, { method: "PATCH", body: { teams }, token }),
  deleteAccount: (token, id) => request(`/admin/accounts/${id}`, { method: "DELETE", token }),
  resetAccountPassword: (token, id, password) =>
    request(`/admin/accounts/${id}/password`, { method: "POST", body: { password }, token }),

};
