// Search, filter and sort for the Receipts tab. Plain functions, so the same input always gives the same list.
import { CATEGORIES, dayOf, isDone, statusOf } from "./stats";

export const DEFAULT_FILTERS = { query: "", category: "all", status: "all", sort: "added" };

export const CATEGORY_OPTIONS = Object.keys(CATEGORIES);

export const STATUSES = [
  { id: "all", label: "Any status" },
  { id: "done", label: "Read" },
  { id: "pending", label: "Reading" },
  { id: "failed", label: "Not read" },
];

export const SORTS = [
  { id: "added", label: "Recently added" },
  { id: "date-desc", label: "Purchase date, newest" },
  { id: "date-asc", label: "Purchase date, oldest" },
  { id: "amount-desc", label: "Largest first" },
  { id: "amount-asc", label: "Smallest first" },
];

export const isModified = (filters) =>
  Object.keys(DEFAULT_FILTERS).some((name) => filters[name] !== DEFAULT_FILTERS[name]);

/** Every word typed must appear in the store name, the date or a product name. */
function matches(receipt, query) {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return true;
  const text = [receipt.store, receipt.date, ...(receipt.items || []).map((item) => item.name)]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return terms.every((term) => text.includes(term));
}

const dateOrder = (receipt) => `${dayOf(receipt)}|${receipt.createdAt || ""}`;
const amountOf = (receipt) => (isDone(receipt) ? receipt.total : null);

// Receipts without a readable total always go to the end, whichever way the list is sorted.
function compareAmounts(a, b, direction) {
  const x = amountOf(a);
  const y = amountOf(b);
  if (x === null && y === null) return 0;
  if (x === null) return 1;
  if (y === null) return -1;
  return direction * (x - y);
}

const COMPARE = {
  "date-desc": (a, b) => (dateOrder(a) < dateOrder(b) ? 1 : dateOrder(a) > dateOrder(b) ? -1 : 0),
  "date-asc": (a, b) => (dateOrder(a) < dateOrder(b) ? -1 : dateOrder(a) > dateOrder(b) ? 1 : 0),
  "amount-desc": (a, b) => compareAmounts(a, b, -1),
  "amount-asc": (a, b) => compareAmounts(a, b, 1),
};

export function filterReceipts(receipts, filters) {
  const rows = receipts.filter(
    (r) =>
      (filters.category === "all" || r.category === filters.category) &&
      (filters.status === "all" || statusOf(r) === filters.status) &&
      matches(r, filters.query)
  );
  return COMPARE[filters.sort] ? [...rows].sort(COMPARE[filters.sort]) : rows; // "added" keeps the API order
}
