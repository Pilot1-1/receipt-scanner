// Price comparison between receipts. Plain arithmetic on the product lines the API returns
// (receipt.items), no AI: the same receipts always give the same answer.
//
// A product line looks like { name, quantity, unit, price, unitPrice, key }. Lines with the same
// `key` (made by the processor Lambda) are the same product, so each line is compared with the
// last earlier purchase of that product.

export const MIN_CHANGE = 0.02; // changes under 2% are rounding noise, not "cheaper" or "dearer"

const dayOf = (receipt) => receipt.date || (receipt.createdAt || "").slice(0, 10);

// When it was bought: the day on the paper first, then the upload time to order receipts of the same day.
const orderOf = (receipt) => `${dayOf(receipt)}|${receipt.createdAt || ""}`;
const byOrder = (a, b) => (a.order < b.order ? -1 : a.order > b.order ? 1 : 0);

// "No unit" is treated as unknown and matches anything; two known units must be equal (kg is not pcs).
const sameUnit = (a, b) => !a || !b || a === b;

export const lineId = (item) => `${item.key}|${item.unit || ""}`;

export const hasLines = (receipt) => receipt.status === "done" && Array.isArray(receipt.items) && receipt.items.length > 0;

// "/ kg" after the unit price of goods sold by weight or volume; nothing for pieces.
export const perUnit = (unit) => (unit && unit !== "pcs" ? ` / ${unit}` : "");

/**
 * One entry per product in a receipt, with duplicate lines added up (three identical lines of
 * herring become one entry). Lines that cannot be compared are left out: no key, or a price
 * that is zero or negative (free gifts, discount lines).
 */
function purchasesOf(receipt) {
  const merged = new Map();
  for (const item of receipt.items || []) {
    if (!item.key || !(item.price > 0) || !(item.quantity > 0)) continue;
    const id = lineId(item);
    const entry = merged.get(id) || { id, key: item.key, name: item.name, unit: item.unit || null, price: 0, quantity: 0 };
    entry.price += item.price;
    entry.quantity += item.quantity;
    merged.set(id, entry);
  }
  return [...merged.values()].map((entry) => ({ ...entry, unitPrice: entry.price / entry.quantity }));
}

/**
 * Every purchase of every product, oldest first. Amounts in different currencies are never
 * compared, so the currency is part of the index key.
 */
export function buildIndex(receipts) {
  const index = new Map();
  for (const receipt of receipts) {
    if (receipt.status !== "done") continue;
    const currency = receipt.currency || "?";
    for (const purchase of purchasesOf(receipt)) {
      const id = `${currency}|${purchase.key}`;
      if (!index.has(id)) index.set(id, []);
      index.get(id).push({
        receiptId: receipt.receiptId,
        store: receipt.store || "Unknown store",
        day: dayOf(receipt),
        order: orderOf(receipt),
        unit: purchase.unit,
        unitPrice: purchase.unitPrice,
      });
    }
  }
  for (const list of index.values()) list.sort(byOrder);
  return index;
}

/**
 * Compare each product of one receipt with the same product in the other receipts.
 *   previous: the last purchase before this receipt (or null: first time)
 *   change:   unit price now / unit price then - 1  (0.1 = 10% dearer)
 *   trend:    "up" | "down" | "same" | "new"
 *   cheapest: the lowest price you paid elsewhere, only if it is clearly lower than this one
 *   saved:    (price then - price now) x quantity; positive = cheaper than last time
 */
export function compareReceipt(receipt, index) {
  const currency = receipt.currency || "?";
  const order = orderOf(receipt);
  return purchasesOf(receipt).map((now) => {
    const others = (index.get(`${currency}|${now.key}`) || []).filter(
      (p) => p.receiptId !== receipt.receiptId && sameUnit(p.unit, now.unit)
    );
    const earlier = others.filter((p) => p.order < order);
    const previous = earlier.length ? earlier[earlier.length - 1] : null;
    const change = previous ? now.unitPrice / previous.unitPrice - 1 : null;

    let lowest = null;
    for (const p of others) if (!lowest || p.unitPrice < lowest.unitPrice) lowest = p;
    const cheapest = lowest && lowest.unitPrice < now.unitPrice * (1 - MIN_CHANGE) ? lowest : null;

    const trend = change === null ? "new" : change > MIN_CHANGE ? "up" : change < -MIN_CHANGE ? "down" : "same";
    return {
      id: now.id,
      key: now.key,
      name: now.name,
      unit: now.unit,
      quantity: now.quantity,
      price: now.price,
      unitPrice: now.unitPrice,
      previous,
      change,
      trend,
      cheapest,
      saved: previous ? (previous.unitPrice - now.unitPrice) * now.quantity : 0,
    };
  });
}

/**
 * Every product bought in one currency, with its whole price history (for the Products tab).
 * A product is one key + unit, as in the receipt window, so "milk per l" and "milk per pcs" stay apart.
 *   history: purchases, oldest first: { receiptId, store, day, quantity, price, unitPrice, name }
 *   change:  last unit price / first unit price - 1 (null if bought only once)
 *   lowest / highest: the cheapest and the dearest purchase
 */
export function buildProducts(receipts, currency) {
  const products = new Map();
  for (const receipt of receipts) {
    if (receipt.status !== "done" || (receipt.currency || "?") !== currency) continue;
    for (const purchase of purchasesOf(receipt)) {
      const product = products.get(purchase.id) || { id: purchase.id, key: purchase.key, unit: purchase.unit, history: [] };
      product.history.push({
        receiptId: receipt.receiptId,
        store: receipt.store || "Unknown store",
        day: dayOf(receipt),
        order: orderOf(receipt),
        name: purchase.name,
        quantity: purchase.quantity,
        price: purchase.price,
        unitPrice: purchase.unitPrice,
      });
      products.set(purchase.id, product);
    }
  }

  return [...products.values()].map((product) => {
    const history = [...product.history].sort(byOrder);
    const first = history[0];
    const last = history[history.length - 1];
    const lowest = history.reduce((best, p) => (p.unitPrice < best.unitPrice ? p : best), first);
    const highest = history.reduce((best, p) => (p.unitPrice > best.unitPrice ? p : best), first);
    return {
      ...product,
      name: last.name, // the spelling on the latest receipt
      history,
      count: history.length,
      first,
      last,
      lowest,
      highest,
      spent: history.reduce((sum, p) => sum + p.price, 0),
      change: history.length > 1 ? last.unitPrice / first.unitPrice - 1 : null,
    };
  });
}

/** Counts per trend, how many products could be compared, and the money difference at last prices. */
export function summarizeComparison(lines) {
  const summary = { up: 0, down: 0, same: 0, new: 0, compared: 0, saved: 0 };
  for (const line of lines) {
    summary[line.trend] += 1;
    if (line.previous) {
      summary.compared += 1;
      summary.saved += line.saved;
    }
  }
  summary.saved = Math.round(summary.saved * 100) / 100;
  return summary;
}

/** "+9.8%" / "−5%" (one decimal at most). */
export function formatChange(change) {
  const percent = Math.round(Math.abs(change) * 1000) / 10;
  return `${change > 0 ? "+" : "−"}${percent}%`;
}

/** "up" | "down" | "same" for a change in price, using the same 2% threshold as everywhere else. */
export const trendOf = (change) => (change === null ? "same" : change > MIN_CHANGE ? "up" : change < -MIN_CHANGE ? "down" : "same");

/**
 * Do the product lines add up to the receipt total? A small gap is normal (rounding, discounts, a
 * bag); a big one means the model missed some lines. Returns null when it cannot be checked.
 */
export function checkLines(receipt) {
  if (typeof receipt.total !== "number" || !Array.isArray(receipt.items) || receipt.items.length === 0) return null;
  const sum = Math.round(receipt.items.reduce((acc, item) => acc + (item.price || 0), 0) * 100) / 100;
  const difference = Math.round((sum - receipt.total) * 100) / 100;
  return { sum, total: receipt.total, difference, ok: Math.abs(difference) <= Math.max(1, Math.abs(receipt.total) * 0.02) };
}
