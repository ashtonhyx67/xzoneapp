const BASE = "/api";

async function request(path, { method = "GET", body, token } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || "Something went wrong. Please try again.");
  }
  return data;
}

export const api = {
  signup: (payload) => request("/auth/signup", { method: "POST", body: payload }),
  login: (payload) => request("/auth/login", { method: "POST", body: payload }),
  me: (token) => request("/auth/me", { token }),
  dashboardSummary: (token) => request("/dashboard/summary", { token }),

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
