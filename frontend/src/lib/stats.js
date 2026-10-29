export const CATEGORIES = {
  food: "#d9480f",
  groceries: "#5c940d",
  transport: "#1971c2",
  shopping: "#9c36b5",
  health: "#c2255c",
  entertainment: "#e8a200",
  bills: "#0b7285",
  other: "#868e96",
};

export const PERIODS = [
  { id: "all", label: "All time" },
  { id: "month", label: "This month" },
  { id: "30d", label: "Last 30 days" },
];

// A receipt belongs to the day on the paper; if that was unreadable, to the day it was uploaded.
const dayOf = (receipt) => receipt.date || (receipt.createdAt || "").slice(0, 10);

const STALE_MS = 5 * 60_000; // still "processing" after this long: the upload probably never reached S3

export const isPending = (receipt) =>
  receipt.status === "processing" && Date.now() - Date.parse(receipt.createdAt) < STALE_MS;

export const isDone = (receipt) => receipt.status === "done" && typeof receipt.total === "number";

export function inPeriod(receipt, period) {
  if (period === "all") return true;
  const day = dayOf(receipt);
  const now = new Date();
  if (period === "month") return day.slice(0, 7) === now.toISOString().slice(0, 7);
  const since = new Date(now.getTime() - 30 * 86_400_000).toISOString().slice(0, 10);
  return day >= since;
}

/** Currencies seen in finished receipts, most used first. Amounts in different currencies are never added together. */
export function currenciesOf(receipts) {
  const counts = {};
  for (const r of receipts.filter(isDone)) {
    const code = r.currency || "?";
    counts[code] = (counts[code] || 0) + 1;
  }
  return Object.keys(counts).sort((a, b) => counts[b] - counts[a]);
}

export function summarize(receipts, currency, period) {
  const rows = receipts.filter((r) => isDone(r) && (r.currency || "?") === currency && inPeriod(r, period));
  const byCategory = {};
  let total = 0;
  for (const r of rows) {
    total += r.total;
    byCategory[r.category] = (byCategory[r.category] || 0) + r.total;
  }
  const categories = Object.entries(byCategory)
    .map(([name, amount]) => ({ name, amount, share: total ? amount / total : 0 }))
    .sort((a, b) => b.amount - a.amount);
  return { total, count: rows.length, average: rows.length ? total / rows.length : 0, categories };
}

export function formatMoney(amount, currency) {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: 2 }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency === "?" ? "" : currency}`.trim();
  }
}
