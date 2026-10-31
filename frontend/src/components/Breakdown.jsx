import { CATEGORIES, formatMoney, titleCase } from "../lib/stats";

const colorOf = (name) => CATEGORIES[name] || CATEGORIES.other;
const percent = (share) => `${Math.round(share * 100)}%`;

/** Where the money went: one coloured bar and a list per category. The period and currency come from the Overview toolbar. */
export default function Breakdown({ summary, hasAny, currency }) {
  const { total, count, categories } = summary;

  return (
    <section className="panel breakdown" aria-labelledby="by-category">
      <div className="panel-head">
        <h2 id="by-category">By category</h2>
        {count > 0 && (
          <p className="muted">
            {count} {count === 1 ? "receipt" : "receipts"}, {formatMoney(total, currency)}
          </p>
        )}
      </div>

      {count === 0 ? (
        <p className="empty">
          {hasAny
            ? "No receipts in this period. Pick a longer one to see more."
            : "Nothing to total yet. Add a receipt photo and it appears here within a few seconds."}
        </p>
      ) : (
        <>
          <div className="tape" role="img" aria-label={`Spending split across ${categories.length} categories`}>
            {categories.map((c) => (
              <span key={c.name} title={`${titleCase(c.name)} ${percent(c.share)}`} style={{ flexGrow: c.share, background: colorOf(c.name) }} />
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
