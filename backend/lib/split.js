// Splitting a bill, and working out who ends up owing whom.
//
// Every amount in here is an integer number of cents. Money in floating point
// is how a group of five splitting $10 ends up owing $9.999999999 between them,
// and the error compounds every time a balance is re-derived. Cents in, cents
// out, and the only division is done by the allocators below, which are written
// so the parts always add back up to the whole.

// What an expense can be filed under. The emoji is the whole icon — the app
// already leans on emoji for its navigation, so a category needs no artwork.
const CATEGORIES = [
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

const CATEGORY_KEYS = new Set(CATEGORIES.map((c) => c.key));
const normalizeCategory = (key) =>
  CATEGORY_KEYS.has(String(key || "").trim()) ? String(key).trim() : "general";

// How the amount owed is worked out from what each member was given.
const SPLIT_METHODS = ["equally", "exact", "percent", "shares", "adjustment"];

// Repeating expenses are materialised on read (see routes/split.js), so the
// period only ever has to answer "when is the next one due".
const RECURRENCES = ["", "weekly", "fortnightly", "monthly", "yearly"];

const MAX_CENTS = 1000000000; // $10,000,000 — past any real shared bill.

// Accepts what a person actually types: "12", "12.5", "$12.50", "1,234.56".
// Returns null rather than 0 for something that is not a number, so a typo is
// rejected instead of silently filed as a free lunch.
function toCents(value) {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    return Math.round(value * 100);
  }
  const text = String(value ?? "").replace(/[,$\s]/g, "");
  if (!text || !/^-?\d*(\.\d*)?$/.test(text)) return null;
  const negative = text.startsWith("-");
  const [whole, fraction = ""] = text.replace("-", "").split(".");
  const cents = Number(whole || 0) * 100 + Number((fraction + "00").slice(0, 2) || 0);
  if (!Number.isFinite(cents)) return null;
  return negative ? -cents : cents;
}

function formatCents(cents, currency = "SGD") {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(Math.round(cents));
  return `${sign}${currency ? `${currency} ` : ""}${(abs / 100).toFixed(2)}`;
}

// Hands out `total` in proportion to `weights` so the parts sum to exactly the
// total — the largest-remainder method. Everyone gets their floor, then the
// leftover cents go one each to whoever was rounded down hardest. This is the
// one place a cent can be created or destroyed, and it is written so it cannot:
// the loop below distributes precisely `total - sum(floors)` cents.
function allocate(total, weights) {
  const count = weights.length;
  if (count === 0) return [];

  const totalWeight = weights.reduce((sum, w) => sum + w, 0);
  // Nothing to go on — an even split is the only sensible reading.
  if (totalWeight <= 0) {
    return allocate(
      total,
      weights.map(() => 1)
    );
  }

  // Negative totals (a refund) round the same way once the sign is lifted out.
  const sign = total < 0 ? -1 : 1;
  const amount = Math.abs(total);

  const exact = weights.map((w) => (amount * w) / totalWeight);
  const parts = exact.map((value) => Math.floor(value));
  let remainder = amount - parts.reduce((sum, p) => sum + p, 0);

  // Biggest fractional part first; ties keep the order they came in, so the
  // same expense always splits the same way.
  const order = exact
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((a, b) => b.fraction - a.fraction || a.index - b.index);

  for (let i = 0; remainder > 0; i = (i + 1) % count, remainder -= 1) {
    parts[order[i].index] += 1;
  }

  return parts.map((part) => part * sign);
}

// What each member owes for one expense.
//
// `entries` is [{ memberId, value }] where the meaning of `value` follows the
// method: ignored for `equally`, cents for `exact` and `adjustment`, hundredths
// of a percent for `percent`, and a plain count for `shares`. Members left out
// of `entries` are not in the split at all.
function computeOwed(method, totalCents, entries) {
  const ids = entries.map((entry) => entry.memberId);

  switch (method) {
    case "exact": {
      return { ids, owed: entries.map((entry) => Math.round(entry.value || 0)) };
    }

    // Percentages are held in hundredths, so "33.33%" is exact as an integer;
    // shares are a plain count. Both are weights, and the allocator is what
    // guarantees the parts still come to the total.
    case "percent":
    case "shares": {
      return {
        ids,
        owed: allocate(
          totalCents,
          entries.map((entry) => Math.max(0, Math.round(entry.value || 0)))
        ),
      };
    }

    case "adjustment": {
      // Someone had the extra drink: they carry their adjustment in full, and
      // whatever is left over is split evenly across everyone.
      const adjustments = entries.map((entry) => Math.round(entry.value || 0));
      const adjusted = adjustments.reduce((sum, value) => sum + value, 0);
      const even = allocate(
        totalCents - adjusted,
        entries.map(() => 1)
      );
      return { ids, owed: even.map((part, i) => part + adjustments[i]) };
    }

    case "equally":
    default: {
      return {
        ids,
        owed: allocate(
          totalCents,
          entries.map(() => 1)
        ),
      };
    }
  }
}

// Sums an expense's exact/percent/share inputs the way the client shows them,
// so "these do not add up" can be said before anything is written.
function validateSplit(method, totalCents, entries) {
  if (!Array.isArray(entries) || entries.length === 0) {
    return "Choose at least one person to split between.";
  }

  const sum = entries.reduce((total, entry) => total + Math.round(entry.value || 0), 0);

  if (method === "exact" && sum !== totalCents) {
    const off = formatCents(Math.abs(totalCents - sum), "");
    return sum > totalCents
      ? `The amounts add up to ${off} more than the total.`
      : `The amounts are ${off} short of the total.`;
  }

  // 100%, held in hundredths.
  if (method === "percent" && sum !== 10000) {
    return `The percentages add up to ${(sum / 100).toFixed(2)}%, not 100%.`;
  }

  if (method === "shares" && sum <= 0) {
    return "Give at least one person a share.";
  }

  if (method === "adjustment" && Math.abs(sum) > Math.abs(totalCents)) {
    return "The adjustments come to more than the expense.";
  }

  return null;
}

// Net position per member across a list of shares: positive means the group
// owes them, negative means they owe the group. A settlement is just another
// row here — the person paying has `paid`, the person being paid has `owed` —
// which is what makes "settle up" cancel a debt instead of needing its own
// arithmetic.
function netBalances(shares) {
  const net = new Map();
  for (const share of shares) {
    const current = net.get(share.member_id) || 0;
    net.set(
      share.member_id,
      current + Number(share.paid_cents || 0) - Number(share.owed_cents || 0)
    );
  }
  return net;
}

// The shortest list of payments that clears the board.
//
// Greedy: the person owed the most is paid by the person who owes the most,
// repeatedly. It does not always find the theoretical minimum number of
// transfers (that problem is NP-hard), but it never leaves a balance unsettled
// and in practice gives the same answer for a group of any realistic size.
function simplify(net) {
  const creditors = [];
  const debtors = [];

  for (const [memberId, amount] of net) {
    if (amount > 0) creditors.push({ memberId, amount });
    else if (amount < 0) debtors.push({ memberId, amount: -amount });
  }

  creditors.sort((a, b) => b.amount - a.amount || a.memberId - b.memberId);
  debtors.sort((a, b) => b.amount - a.amount || a.memberId - b.memberId);

  const transfers = [];
  let i = 0;
  let j = 0;

  while (i < debtors.length && j < creditors.length) {
    const amount = Math.min(debtors[i].amount, creditors[j].amount);
    if (amount > 0) {
      transfers.push({
        fromMemberId: debtors[i].memberId,
        toMemberId: creditors[j].memberId,
        amountCents: amount,
      });
    }
    debtors[i].amount -= amount;
    creditors[j].amount -= amount;
    if (debtors[i].amount === 0) i += 1;
    if (creditors[j].amount === 0) j += 1;
  }

  return transfers;
}

// Who owes whom, taken pair by pair rather than pooled.
//
// This is the un-simplified view, and it is the honest one: if Ann paid for
// Ben's ticket, Ben owes Ann, not "the group". Each expense is settled within
// itself — everyone who owes more than they paid on it owes a slice to each
// person who paid more than they owed — and the pairs are then netted across
// every expense, so A→B and B→A cancel out.
function pairwiseDebts(sharesByExpense) {
  const pairs = new Map(); // "from:to" -> cents

  const add = (from, to, amount) => {
    if (amount <= 0 || from === to) return;
    const forward = `${from}:${to}`;
    const backward = `${to}:${from}`;

    // A debt the other way round is cancelled against, never stacked beside —
    // otherwise two people who have each paid for the other would both be
    // shown as owing, when between them they are square.
    const owedBack = pairs.get(backward) || 0;
    if (owedBack > 0) {
      if (owedBack > amount) {
        pairs.set(backward, owedBack - amount);
        return;
      }
      pairs.delete(backward);
      const left = amount - owedBack;
      if (left > 0) pairs.set(forward, (pairs.get(forward) || 0) + left);
      return;
    }

    pairs.set(forward, (pairs.get(forward) || 0) + amount);
  };

  for (const shares of sharesByExpense) {
    const net = netBalances(shares);
    const lenders = [];
    const borrowers = [];
    for (const [memberId, amount] of net) {
      if (amount > 0) lenders.push({ memberId, amount });
      else if (amount < 0) borrowers.push({ memberId, amount: -amount });
    }

    if (lenders.length === 0) continue;

    // Each borrower's debt is split between the lenders in proportion to what
    // each lender put in — allocated, so no cent is invented here either.
    for (const borrower of borrowers) {
      const cut = allocate(
        borrower.amount,
        lenders.map((l) => l.amount)
      );
      lenders.forEach((lender, index) => add(borrower.memberId, lender.memberId, cut[index]));
    }
  }

  return [...pairs.entries()]
    .map(([key, amountCents]) => {
      const [from, to] = key.split(":").map(Number);
      return { fromMemberId: from, toMemberId: to, amountCents };
    })
    .filter((debt) => debt.amountCents > 0)
    .sort((a, b) => b.amountCents - a.amountCents);
}

// The next date a repeating expense is due, from the one just filed.
function nextOccurrence(dateText, recurrence) {
  if (!recurrence) return null;
  const date = new Date(`${dateText}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return null;

  if (recurrence === "weekly") date.setUTCDate(date.getUTCDate() + 7);
  else if (recurrence === "fortnightly") date.setUTCDate(date.getUTCDate() + 14);
  else if (recurrence === "yearly") date.setUTCFullYear(date.getUTCFullYear() + 1);
  else if (recurrence === "monthly") {
    // The 31st of a 30-day month lands on the 30th rather than spilling into
    // the next one, which is what someone filing rent on the 31st means.
    const day = date.getUTCDate();
    date.setUTCDate(1);
    date.setUTCMonth(date.getUTCMonth() + 1);
    const lastDay = new Date(
      Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)
    ).getUTCDate();
    date.setUTCDate(Math.min(day, lastDay));
  } else return null;

  return date.toISOString().slice(0, 10);
}

module.exports = {
  CATEGORIES,
  SPLIT_METHODS,
  RECURRENCES,
  MAX_CENTS,
  normalizeCategory,
  toCents,
  formatCents,
  allocate,
  computeOwed,
  validateSplit,
  netBalances,
  simplify,
  pairwiseDebts,
  nextOccurrence,
};
