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
  dashboardSummary: (token, signal) => request("/dashboard/summary", { token, signal }),

  getPeople: (token, signal) => request("/people", { token, signal }),
  createPerson: (token, person) => request("/people", { method: "POST", body: person, token }),
  updatePerson: (token, id, person) =>
    request(`/people/${id}`, { method: "PUT", body: person, token }),
  deletePerson: (token, id) => request(`/people/${id}`, { method: "DELETE", token }),
  importPeople: (token, csv) => request("/people/import", { method: "POST", body: { csv }, token }),

  setPin: (token, pin, currentPin) =>
    request("/auth/pin", { method: "POST", body: { pin, currentPin }, token }),
  removePin: (token) => request("/auth/pin", { method: "DELETE", token }),
  pinLogin: (email, pin) => request("/auth/pin/login", { method: "POST", body: { email, pin } }),

  bulkSavePeople: (token, changes) =>
    request("/people/bulk", { method: "PUT", body: changes, token }),

  getRoster: (token, signal) => request("/roster", { token, signal }),
  saveRoster: (token, roster) => request("/roster", { method: "PUT", body: roster, token }),

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
