// What counts as an acceptable name, password and PIN — in one place, so the
// sign-up page and an admin creating an account can never disagree about it.

const bcrypt = require("bcryptjs");

// 12 rounds is roughly a quarter of a second per hash: unnoticeable once at
// sign-in, ruinous for anyone trying a list of guesses against a leaked table.
// Existing hashes made at 10 keep working — bcrypt stores its own cost.
const HASH_ROUNDS = 12;

const PIN_LENGTH = 4;
const MIN_PASSWORD_LENGTH = 8;
// bcrypt only looks at the first 72 bytes. Anything past that is silently
// ignored, so a longer password would be weaker than it looks.
const MAX_PASSWORD_BYTES = 72;
const MAX_NAME_LENGTH = 80;

function hash(secret) {
  return bcrypt.hash(String(secret), HASH_ROUNDS);
}

// Comparing against an unknown account must take as long as comparing against
// a real one, or the response time says which emails have accounts.
const DUMMY_HASH = bcrypt.hashSync("not-a-real-secret", HASH_ROUNDS);

async function verify(secret, storedHash) {
  const ok = await bcrypt.compare(String(secret), storedHash || DUMMY_HASH);
  return Boolean(storedHash) && ok;
}

// ---------- Names ----------

// Trimmed, inner runs of whitespace collapsed, control characters dropped.
// Returns null when nothing usable is left.
function cleanName(name) {
  if (typeof name !== "string") return null;
  const cleaned = name
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned || cleaned.length > MAX_NAME_LENGTH) return null;
  return cleaned;
}

const NAME_ERROR = `Enter your name (up to ${MAX_NAME_LENGTH} characters).`;

// ---------- Passwords ----------

// The handful that every guessing list starts with. Not a dictionary — just
// enough that the most obvious choices are turned away.
const COMMON_PASSWORDS = new Set([
  "password",
  "password1",
  "password123",
  "passw0rd",
  "12345678",
  "123456789",
  "1234567890",
  "87654321",
  "11111111",
  "00000000",
  "qwertyui",
  "qwerty123",
  "qwertyuiop",
  "asdfghjk",
  "iloveyou",
  "letmein1",
  "welcome1",
  "abc12345",
  "abcd1234",
  "1q2w3e4r",
  "sunshine",
  "princess",
  "football",
  "baseball",
  "superman",
  "trustno1",
  "changeme",
]);

// Returns a sentence saying what is wrong, or null if the password is fine.
function passwordProblem(password, { email = "", name = "" } = {}) {
  if (typeof password !== "string" || password.length === 0) {
    return "Choose a password.";
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  if (Buffer.byteLength(password, "utf8") > MAX_PASSWORD_BYTES) {
    return "That password is too long — keep it under 72 characters.";
  }

  const lower = password.toLowerCase();
  if (/^(.)\1+$/.test(password) || COMMON_PASSWORDS.has(lower)) {
    return "That password is too easy to guess. Try a few words together.";
  }

  const localPart = String(email).split("@")[0].toLowerCase();
  if (localPart.length >= 4 && lower.includes(localPart)) {
    return "Your password shouldn't contain your email address.";
  }
  const compactName = String(name).toLowerCase().replace(/\s+/g, "");
  if (compactName.length >= 4 && lower.replace(/\s+/g, "") === compactName) {
    return "Your password shouldn't be your name.";
  }

  return null;
}

// ---------- PINs ----------

function isValidPin(pin) {
  return typeof pin === "string" || typeof pin === "number"
    ? new RegExp(`^[0-9]{${PIN_LENGTH}}$`).test(String(pin))
    : false;
}

// Four digits is only 10,000 options, and people do not pick them evenly: a
// handful of patterns cover a large share of every PIN ever chosen. Those are
// turned away, so a guesser's first few tries are not also their best ones.
const COMMON_PINS = new Set(["2580", "0852", "1004", "2000", "2001", "1998", "1999", "6969"]);

function isWeakPin(pin) {
  const digits = String(pin).split("").map(Number);
  const [a, b, c, d] = digits;

  if (digits.every((n) => n === a)) return true; // 1111
  const steps = [b - a, c - b, d - c];
  if (steps.every((s) => s === 1) || steps.every((s) => s === -1)) return true; // 1234, 4321
  if (a === c && b === d) return true; // 1212
  if (a === b && c === d) return true; // 1122
  return COMMON_PINS.has(String(pin));
}

const WEAK_PIN_ERROR =
  "That PIN is too easy to guess. Avoid repeats and runs like 1111, 1234 or 1212.";

module.exports = {
  HASH_ROUNDS,
  PIN_LENGTH,
  MIN_PASSWORD_LENGTH,
  hash,
  verify,
  cleanName,
  NAME_ERROR,
  passwordProblem,
  isValidPin,
  isWeakPin,
  WEAK_PIN_ERROR,
};
