// The money side of shared expenses, on the app's side of the wire.
//
// Kept in step with backend/lib/split.js, which is the one that counts: the
// server recomputes every split it is sent and the balances always come from
// there. This exists so the form can show what each person will owe while it
// is still being typed, which is the difference between a split you can trust
// and one you find out about after saving.

export const CURRENCIES = ["SGD", "MYR", "USD", "EUR", "GBP", "AUD", "JPY", "IDR", "THB", "PHP"];

// Used until the server's list arrives, and as the fallback for a category
// that has since been removed.
export const CATEGORIES = [
  { key: "general", label: "General", emoji: "🧾" },
  { key: "food", label: "Food & drink", emoji: "🍜" },
  { key: "groceries", label: "Groceries", emoji: "🛒" },
  { key: "transport", label: "Transport", emoji: "🚕" },
  { key: "accommodation", label: "Accommodation", emoji: "🏨" },
  { key: "tickets", label: "Tickets & entry", emoji: "🎟️" },
  { key: "supplies", label: "Supplies", emoji: "📦" },
  { key: "gifts", label: "Gifts", emoji: "🎁" },
  { key: "utilities", label: "Utilities", emoji: "💡" },
  { key: "rent", label: "Rent", emoji: "🏠" },
  { key: "entertainment", label: "Entertainment", emoji: "🎬" },
  { key: "other", label: "Other", emoji: "✳️" },
];

export const METHODS = [
  { key: "equally", label: "Equally", hint: "Split the same between everyone chosen." },
  { key: "exact", label: "Exact amounts", hint: "Say what each person owes." },
  { key: "percent", label: "Percentages", hint: "Give each person a share of the total." },
  { key: "shares", label: "Shares", hint: "Two shares for a room of two, one for a room of one." },
  { key: "adjustment", label: "Plus / minus", hint: "Split evenly, then adjust for the extras." },
];

export const RECURRENCE_LABELS = {
  "": "Doesn't repeat",
  weekly: "Every week",
  fortnightly: "Every fortnight",
  monthly: "Every month",
  yearly: "Every year",
};

export function categoryFor(key, categories = CATEGORIES) {
  return (
    categories.find((category) => category.key === key) ||
    CATEGORIES.find((category) => category.key === key) ||
    CATEGORIES[0]
  );
}

// "12", "12.5", "$12.50", "1,234.56" — and null for anything that is not a
// number, so a typo can be caught rather than filed as zero.
export function toCents(value) {
  if (typeof value === "number") {
    return Number.isFinite(value) ? Math.round(value * 100) : null;
  }
  const text = String(value ?? "").replace(/[,$\s]/g, "");
  if (!text || !/^-?\d*(\.\d*)?$/.test(text)) return null;
  const negative = text.startsWith("-");
  const [whole, fraction = ""] = text.replace("-", "").split(".");
  const cents = Number(whole || 0) * 100 + Number((fraction + "00").slice(0, 2) || 0);
  if (!Number.isFinite(cents)) return null;
  return negative ? -cents : cents;
}

// The plain number, for putting back in an input.
export const centsToInput = (cents) => (cents / 100).toFixed(2);

export function formatMoney(cents, currency = "SGD") {
  const sign = cents < 0 ? "-" : "";
  const amount = (Math.abs(Math.round(cents)) / 100).toFixed(2);
  return `${sign}${currency ? `${currency} ` : ""}${amount}`;
}

// Same largest-remainder allocation the server uses, so the preview and the
// saved split agree to the cent.
export function allocate(total, weights) {
  const count = weights.length;
  if (count === 0) return [];

  const totalWeight = weights.reduce((sum, w) => sum + w, 0);
  if (totalWeight <= 0) return allocate(total, weights.map(() => 1));

  const sign = total < 0 ? -1 : 1;
  const amount = Math.abs(total);

  const exact = weights.map((w) => (amount * w) / totalWeight);
  const parts = exact.map((value) => Math.floor(value));
  let remainder = amount - parts.reduce((sum, p) => sum + p, 0);

  const order = exact
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((a, b) => b.fraction - a.fraction || a.index - b.index);

  for (let i = 0; remainder > 0; i = (i + 1) % count, remainder -= 1) {
    parts[order[i].index] += 1;
  }

  return parts.map((part) => part * sign);
}

// What each chosen person owes, in cents, for the amounts currently in the
// form. `entries` is [{ memberId, value }] in the method's own units.
export function previewOwed(method, totalCents, entries) {
  if (entries.length === 0) return new Map();

  let owed;
  switch (method) {
    case "exact":
      owed = entries.map((entry) => Math.round(entry.value || 0));
      break;
    case "percent":
    case "shares":
      owed = allocate(
        totalCents,
        entries.map((entry) => Math.max(0, Math.round(entry.value || 0)))
      );
      break;
    case "adjustment": {
      const adjustments = entries.map((entry) => Math.round(entry.value || 0));
      const adjusted = adjustments.reduce((sum, value) => sum + value, 0);
      const even = allocate(totalCents - adjusted, entries.map(() => 1));
      owed = even.map((part, index) => part + adjustments[index]);
      break;
    }
    default:
      owed = allocate(totalCents, entries.map(() => 1));
  }

  return new Map(entries.map((entry, index) => [entry.memberId, owed[index]]));
}

// The same objection the server would raise, raised while there is still a
// form open to fix it in. Null means the split is good.
export function splitProblem(method, totalCents, entries) {
  if (entries.length === 0) return "Choose at least one person.";

  const sum = entries.reduce((total, entry) => total + Math.round(entry.value || 0), 0);

  if (method === "exact" && sum !== totalCents) {
    const off = formatMoney(Math.abs(totalCents - sum), "");
    return sum > totalCents ? `${off} over.` : `${off} left to assign.`;
  }
  if (method === "percent" && sum !== 10000) {
    return `${(sum / 100).toFixed(2)}% of 100%.`;
  }
  if (method === "shares" && sum <= 0) return "Give someone a share.";
  if (method === "adjustment" && Math.abs(sum) > Math.abs(totalCents)) {
    return "The adjustments come to more than the expense.";
  }
  return null;
}

// "Sep 2026" — the heading expenses are grouped under.
export function monthLabel(dateText) {
  const date = new Date(`${dateText}T00:00:00`);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(undefined, { month: "long", year: "numeric" });
}

// "3 Sep" — enough on a row where the month is already the heading above it.
export function dayLabel(dateText) {
  const date = new Date(`${dateText}T00:00:00`);
  if (Number.isNaN(date.getTime())) return dateText || "";
  return date.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

export const todayText = () => {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
};
