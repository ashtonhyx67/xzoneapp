// Email addresses, in the one shape the app stores them.
//
// Lowercased and trimmed, because two people typing the same address in
// different cases are the same person, and the unique index has to agree.

// Deliberately not RFC 5322. That grammar accepts things no mail server here
// will ever see and is famously unreadable; this catches what people actually
// get wrong — no @ at all, nothing before or after it, a domain with no dot, or
// a stray space from a copy-paste.
const SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function isValidEmail(email) {
  const value = normalizeEmail(email);
  return value.length <= 254 && SHAPE.test(value);
}

// The one wording for a bad address, so every screen that can reject one says
// the same thing.
const EMAIL_ERROR = "That doesn't look like an email address. It needs an @ and a domain.";

module.exports = { normalizeEmail, isValidEmail, EMAIL_ERROR };
