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

// A period is an object: { id: "month" }, or { id: "custom", from: "2026-10-01", to: "2026-10-15" }.
// A plain id string is accepted too (spec() below), so older callers keep working.
export const PERIODS = [
  { id: "month", label: "This month" },
  { id: "30d", label: "Last 30 days" },
  { id: "6m", label: "Last 6 months" },
  { id: "12m", label: "Last 12 months" },
  { id: "all", label: "All time" },
  { id: "custom", label: "Custom range…" },
];

export const DEFAULT_PERIOD = { id: "month" }; // what the person sees when they open the site

const spec = (period) => (typeof period === "string" ? { id: period } : period || { id: "all" });

export const titleCase = (text) => (text ? text[0].toUpperCase() + text.slice(1) : text);

// ---------- days and periods (all in the browser's local time) ----------

const pad = (n) => String(n).padStart(2, "0");
const startOfDay = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());
const shift = (date, days) => new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
export const isoDay = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const round2 = (value) => Math.round(value * 100) / 100;
const parseDay = (key) => new Date(`${key}T00:00:00`);
const validDay = (key) => typeof key === "string" && /^\d{4}-\d{2}-\d{2}$/.test(key) && !Number.isNaN(parseDay(key).getTime());
const daysBetween = (from, to) => Math.round((parseDay(to) - parseDay(from)) / 86_400_000);

/** The same day-of-month `n` months earlier; the 31st becomes the 30th (or 28th) in a shorter month. */
function monthsAgo(date, n) {
  const target = new Date(date.getFullYear(), date.getMonth() - n, 1);
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  return new Date(target.getFullYear(), target.getMonth(), Math.min(date.getDate(), lastDay));
}

// A receipt belongs to the day on the paper; if that was unreadable, to the day it was uploaded.
export const dayOf = (receipt) => receipt.date || (receipt.createdAt || "").slice(0, 10);

/** "12 Oct 2026" from "2026-10-12" (or the text itself if it is not a date). */
export function shortDay(value) {
  if (!value) return "";
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

const STALE_MS = 5 * 60_000; // still "processing" after this long: the upload probably never reached S3

export const isPending = (receipt) =>
  receipt.status === "processing" && Date.now() - Date.parse(receipt.createdAt) < STALE_MS;

export const isDone = (receipt) => receipt.status === "done" && typeof receipt.total === "number";

/** "done" | "pending" (still being read) | "failed" (not read, or stalled). */
export const statusOf = (receipt) => (isDone(receipt) ? "done" : isPending(receipt) ? "pending" : "failed");

/** First and last day (inclusive, "YYYY-MM-DD") of a period, or null for "all time". An empty `from` means "no start". */
export function rangeOf(period, now = new Date()) {
  const { id, from, to } = spec(period);
  const today = startOfDay(now);
  if (id === "month") return { from: isoDay(new Date(today.getFullYear(), today.getMonth(), 1)), to: isoDay(today) };
  if (id === "30d") return { from: isoDay(shift(today, -29)), to: isoDay(today) };
  if (id === "6m" || id === "12m") {
    // Rolling: "last 6 months" ends today and starts the day after the same date 6 months ago.
    return { from: isoDay(shift(monthsAgo(today, id === "6m" ? 6 : 12), 1)), to: isoDay(today) };
  }
  if (id === "custom") {
    let start = validDay(from) ? from : "";
    let end = validDay(to) ? to : isoDay(today);
    if (start && start > end) [start, end] = [end, start]; // dates typed in the wrong order still work
    return { from: start, to: end };
  }
  return null;
}

/**
 * The period to compare with, always of the same length and right before the current one.
 * For "this month" that is the same number of days of the previous month (day 1 to day 12 against
 * day 1 to day 12), so the first days of a month are not unfairly "cheap".
 */
export function previousRangeOf(period, now = new Date()) {
  const { id } = spec(period);
  const today = startOfDay(now);
  if (id === "month") {
    const first = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    const length = new Date(today.getFullYear(), today.getMonth(), 0).getDate(); // days in the previous month
    const last = new Date(first.getFullYear(), first.getMonth(), Math.min(today.getDate(), length));
    return { from: isoDay(first), to: isoDay(last) };
  }
  if (id === "30d") return { from: isoDay(shift(today, -59)), to: isoDay(shift(today, -30)) };
  if (id === "6m" || id === "12m") {
    const n = id === "6m" ? 6 : 12;
    return { from: isoDay(shift(monthsAgo(today, 2 * n), 1)), to: isoDay(monthsAgo(today, n)) };
  }
  if (id === "custom") {
    const range = rangeOf(period, now);
    if (!range.from) return null;
    const length = daysBetween(range.from, range.to) + 1;
    const end = shift(parseDay(range.from), -1);
    return { from: isoDay(shift(end, -(length - 1))), to: isoDay(end) };
  }
  return null;
}

/** "This month", "Last 6 months", or the dates of a custom range: for headings and the chart. */
export function periodLabel(period, now = new Date()) {
  const { id } = spec(period);
  if (id !== "custom") return PERIODS.find((p) => p.id === id)?.label || "All time";
  const range = rangeOf(period, now);
  return range.from ? `${shortDay(range.from)} to ${shortDay(range.to)}` : `Until ${shortDay(range.to)}`;
}

export function inRange(receipt, range) {
  if (!range) return true;
  const day = dayOf(receipt);
  return day >= range.from && day <= range.to;
}

export const inPeriod = (receipt, period) => inRange(receipt, rangeOf(period));

// ---------- totals ----------

/** Currencies seen in finished receipts, most used first. Amounts in different currencies are never added together. */
export function currenciesOf(receipts) {
  const counts = {};
  for (const r of receipts.filter(isDone)) {
    const code = r.currency || "?";
    counts[code] = (counts[code] || 0) + 1;
  }
  return Object.keys(counts).sort((a, b) => counts[b] - counts[a]);
}

/** The currency with the most receipts in the period; if there are none, the most used overall. */
export function bestCurrency(receipts, period, now = new Date()) {
  const range = rangeOf(period, now);
  const overall = currenciesOf(receipts);
  const counts = {};
  for (const r of receipts.filter((x) => isDone(x) && inRange(x, range))) {
    const code = r.currency || "?";
    counts[code] = (counts[code] || 0) + 1;
  }
  const inPeriodFirst = Object.keys(counts).sort((a, b) => counts[b] - counts[a] || overall.indexOf(a) - overall.indexOf(b));
  return inPeriodFirst[0] ?? overall[0];
}

const rowsOf = (receipts, currency, range) =>
  receipts.filter((r) => isDone(r) && (r.currency || "?") === currency && inRange(r, range));

const sumOf = (rows) => rows.reduce((acc, r) => acc + r.total, 0);

export function summarize(receipts, currency, period) {
  const rows = rowsOf(receipts, currency, rangeOf(period));
  const byCategory = {};
  const total = sumOf(rows);
  for (const r of rows) byCategory[r.category] = (byCategory[r.category] || 0) + r.total;
  const categories = Object.entries(byCategory)
    .map(([name, amount]) => ({ name, amount, share: total ? amount / total : 0 }))
    .sort((a, b) => b.amount - a.amount);
  return { total, count: rows.length, average: rows.length ? total / rows.length : 0, categories };
}

/**
 * The numbers for the cards on the Overview tab.
 *   change: spending now / spending in the previous period - 1 (null if there is nothing to compare with)
 *   days:   how many days the period covers so far; perDay = total / days
 */
export function overview(receipts, currency, period, now = new Date()) {
  const rows = rowsOf(receipts, currency, rangeOf(period, now));
  const total = sumOf(rows);

  const previousRange = previousRangeOf(period, now);
  const previousTotal = previousRange ? sumOf(rowsOf(receipts, currency, previousRange)) : null;
  const change = previousTotal > 0 ? total / previousTotal - 1 : null;

  const stores = new Map();
  let biggest = null;
  for (const r of rows) {
    const name = (r.store || "Unknown store").trim();
    const entry = stores.get(name.toLowerCase()) || { name, amount: 0, count: 0 };
    entry.amount += r.total;
    entry.count += 1;
    stores.set(name.toLowerCase(), entry);
    if (!biggest || r.total > biggest.total) biggest = r;
  }
  const topStore = [...stores.values()].sort((a, b) => b.amount - a.amount)[0] || null;

  // How many days the period has covered so far (a future end date does not count).
  const todayKey = isoDay(startOfDay(now));
  const range = rangeOf(period, now);
  const first = range && range.from ? range.from : rows.map(dayOf).sort()[0] || null;
  const last = range && range.to < todayKey ? range.to : todayKey;
  const span = first ? daysBetween(first, last) + 1 : 0;
  const days = first ? (Number.isFinite(span) ? Math.max(1, span) : 1) : 0;

  return { total, count: rows.length, previousTotal, change, topStore, biggest, days, perDay: days ? total / days : 0 };
}

/**
 * The bars of the chart for a period. The bar size follows the length of the period:
 * up to ~2 months: one bar per day; up to 3 years: per month; longer: per year.
 * Returns { unit: "day" | "month" | "year", points: [{ key, amount }] }; keys look like "2026-10-12", "2026-10", "2026".
 * Periods without a start ("all time") begin at the first receipt.
 */
export function bucketSeries(receipts, currency, period, now = new Date()) {
  const rows = rowsOf(receipts, currency, null);
  const todayKey = isoDay(startOfDay(now));
  const range = rangeOf(period, now);

  let from = range && range.from ? range.from : rows.map(dayOf).filter(validDay).sort()[0];
  const to = range && range.to < todayKey ? range.to : todayKey;
  if (!from) return { unit: "day", points: [] };
  if (from > to) from = to;

  const monthsSpan = (Number(to.slice(0, 4)) - Number(from.slice(0, 4))) * 12 + Number(to.slice(5, 7)) - Number(from.slice(5, 7)) + 1;
  const unit = daysBetween(from, to) + 1 <= 62 ? "day" : monthsSpan <= 36 ? "month" : "year";
  const keyOf = (day) => day.slice(0, { day: 10, month: 7, year: 4 }[unit]);

  const totals = new Map();
  for (const r of rows) {
    const day = dayOf(r);
    if (day >= from && day <= to) totals.set(keyOf(day), (totals.get(keyOf(day)) || 0) + r.total);
  }

  const keys = [];
  if (unit === "day") {
    for (let d = parseDay(from); isoDay(d) <= to; d = shift(d, 1)) keys.push(isoDay(d));
  } else if (unit === "month") {
    for (let y = Number(from.slice(0, 4)), m = Number(from.slice(5, 7)); y * 12 + m <= Number(to.slice(0, 4)) * 12 + Number(to.slice(5, 7)); m++) {
      if (m > 12) { m = 1; y++; }
      keys.push(`${y}-${pad(m)}`);
    }
  } else {
    for (let y = Math.max(Number(from.slice(0, 4)), Number(to.slice(0, 4)) - 59); y <= Number(to.slice(0, 4)); y++) keys.push(String(y));
  }
  return { unit, points: keys.map((key) => ({ key, amount: round2(totals.get(key) || 0) })) };
}

export function formatMoney(amount, currency) {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency, maximumFractionDigits: 2 }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency === "?" ? "" : currency}`.trim();
  }
}
