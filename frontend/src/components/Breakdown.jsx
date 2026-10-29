import { CATEGORIES, PERIODS, formatMoney } from "../lib/stats";

const colorOf = (name) => CATEGORIES[name] || CATEGORIES.other;
const percent = (share) => `${Math.round(share * 100)}%`;

export default function Breakdown({ loading, summary, hasAny, currencies, currency, onCurrency, period, onPeriod }) {
  const { total, count, average, categories } = summary;

  return (
    <section className="panel breakdown" aria-labelledby="spending">
      <div className="panel-head">
        <h2 id="spending">Spending</h2>
        <div className="filters">
          {currencies.length > 1 && (
            <div className="segmented" role="group" aria-label="Currency">
              {currencies.map((code) => (
                <button key={code} aria-pressed={code === currency} onClick={() => onCurrency(code)}>{code}</button>
              ))}
            </div>
          )}
          <select value={period} onChange={(e) => onPeriod(e.target.value)} aria-label="Period">
            {PERIODS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
        </div>
      </div>

      {loading ? (
        <p className="muted">Loading your receipts…</p>
      ) : count === 0 ? (
        <p className="empty">
          {hasAny
            ? "No receipts in this period. Pick a longer one to see more."
            : "Nothing to total yet. Add a receipt photo and it appears here within a few seconds."}
        </p>
      ) : (
        <>
          <p className="total">{formatMoney(total, currency)}</p>
          <p className="muted">
            {count} {count === 1 ? "receipt" : "receipts"}, {formatMoney(average, currency)} on average
          </p>

          <div className="tape" role="img" aria-label={`Spending split across ${categories.length} categories`}>
            {categories.map((c) => (
              <span key={c.name} title={`${c.name} ${percent(c.share)}`} style={{ flexGrow: c.share, background: colorOf(c.name) }} />
            ))}
          </div>

          <ul className="ledger">
            {categories.map((c) => (
              <li key={c.name}>
                <i style={{ background: colorOf(c.name) }} />
                <span className="ledger-name">{c.name}</span>
                <span className="ledger-share">{percent(c.share)}</span>
                <span className="amount">{formatMoney(c.amount, currency)}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
