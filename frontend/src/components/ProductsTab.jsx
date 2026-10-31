import { useMemo, useState } from "react";
import Sparkline from "./Sparkline";
import { MIN_CHANGE, formatChange, perUnit, trendOf } from "../lib/prices";
import { formatMoney, shortDay } from "../lib/stats";

// Products that were bought only once have no change; they always go to the end of a rise/drop sort.
const nullsLast = (get, direction) => (a, b) => {
  const x = get(a);
  const y = get(b);
  if (x === null && y === null) return 0;
  if (x === null) return 1;
  if (y === null) return -1;
  return direction * (x - y);
};

const SORTS = [
  { id: "count", label: "Most bought", compare: (a, b) => b.count - a.count || b.spent - a.spent },
  { id: "rise", label: "Biggest rise", compare: nullsLast((p) => p.change, -1) },
  { id: "drop", label: "Biggest drop", compare: nullsLast((p) => p.change, 1) },
  { id: "spent", label: "Most spent", compare: (a, b) => b.spent - a.spent },
  { id: "name", label: "A to Z", compare: (a, b) => a.name.localeCompare(b.name) },
];

function Highlight({ title, product, currency, tone }) {
  if (!product) {
    return (
      <section className="card" aria-label={title}>
        <h3>{title}</h3>
        <p className="card-value card-text">–</p>
        <p className="card-sub">Nothing yet. A product needs two purchases to be compared.</p>
      </section>
    );
  }
  return (
    <section className="card" aria-label={title}>
      <h3>{title}</h3>
      <p className="card-value card-text">{product.name}</p>
      <p className="card-sub">
        <span className={`delta ${tone}`}>{formatChange(product.change)}</span>{" "}
        {formatMoney(product.first.unitPrice, currency)} to {formatMoney(product.last.unitPrice, currency)}{perUnit(product.unit)}
      </p>
    </section>
  );
}

function History({ product, currency }) {
  const { lowest, highest } = product;
  return (
    <div className="p-history">
      <p className="note">
        Lowest {formatMoney(lowest.unitPrice, currency)}{perUnit(product.unit)} at {lowest.store}, {shortDay(lowest.day)}.
        {highest.unitPrice > lowest.unitPrice && <> Highest {formatMoney(highest.unitPrice, currency)} at {highest.store}, {shortDay(highest.day)}.</>}
      </p>
      <ul>
        {[...product.history].reverse().map((p) => (
          <li key={`${p.receiptId}-${p.day}`}>
            <span className="r-date">{shortDay(p.day)}</span>
            <span className="p-store">{p.store}</span>
            <span className="num">{p.quantity} {product.unit || "×"}</span>
            <span className="amount">
              {formatMoney(p.unitPrice, currency)}{perUnit(product.unit)}
              {p === lowest && product.count > 1 && <span className="chip down">lowest</span>}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Every product you have bought, with its price history. Built from the product lines of all receipts. */
export default function ProductsTab({ products, currencies, currency }) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("count");
  const [openId, setOpenId] = useState(null);

  const changed = useMemo(() => products.filter((p) => p.change !== null), [products]);
  const rise = useMemo(() => changed.filter((p) => p.change > MIN_CHANGE).sort(SORTS[1].compare)[0] || null, [changed]);
  const drop = useMemo(() => changed.filter((p) => p.change < -MIN_CHANGE).sort(SORTS[2].compare)[0] || null, [changed]);

  const shown = useMemo(() => {
    const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const compare = SORTS.find((s) => s.id === sort).compare;
    return products
      .filter((p) => terms.every((term) => p.name.toLowerCase().includes(term) || p.key.includes(term)))
      .sort(compare);
  }, [products, query, sort]);

  if (products.length === 0) {
    return (
      <p className="empty">
        No products yet. They appear after a receipt is read with its product lines.
        {currencies.length > 1 && " Try another currency."}
      </p>
    );
  }

  return (
    <div className="stack">
      <div className="toolbar">
        <h2>Products</h2>
      </div>

      <div className="cards cards-2">
        <Highlight title="Biggest price rise" product={rise} currency={currency} tone="bad" />
        <Highlight title="Biggest price drop" product={drop} currency={currency} tone="good" />
      </div>

      <section className="panel" aria-label="All products">
        <div className="filter-bar">
          <input
            type="search" className="search" placeholder="Search products" aria-label="Search products"
            value={query} onChange={(e) => setQuery(e.target.value)}
          />
          <select aria-label="Sort products" value={sort} onChange={(e) => setSort(e.target.value)}>
            {SORTS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
          </select>
        </div>
        <p className="note filter-count" role="status">
          {shown.length === products.length ? `${products.length} products` : `${shown.length} of ${products.length} products`}
        </p>

        {shown.length === 0 ? (
          <p className="empty">No product matches this search.</p>
        ) : (
          <ul className="products">
            {shown.map((p) => {
              const tone = trendOf(p.change);
              const open = openId === p.id;
              return (
                <li key={p.id}>
                  <button type="button" className="p-row" aria-expanded={open} onClick={() => setOpenId(open ? null : p.id)}>
                    <span className="p-name">
                      {p.name}
                      <small>
                        {p.count === 1 ? "bought once" : `bought ${p.count} times`}
                        {p.count > 1 && p.lowest.unitPrice < p.last.unitPrice * (1 - MIN_CHANGE) && <>, cheapest at {p.lowest.store}</>}
                      </small>
                    </span>
                    <span className="p-spark"><Sparkline values={p.history.slice(-12).map((h) => h.unitPrice)} tone={tone} /></span>
                    <span className="p-price amount">{formatMoney(p.last.unitPrice, currency)}{perUnit(p.unit)}</span>
                    <span className={`p-change change ${tone}`}>
                      {p.change === null ? "" : tone === "same" ? "≈ same" : `${tone === "up" ? "↑" : "↓"} ${formatChange(p.change)}`}
                    </span>
                  </button>
                  {open && <History product={p} currency={currency} />}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
