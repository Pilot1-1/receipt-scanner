import { CATEGORIES, formatMoney, isPending } from "../lib/stats";

function Amount({ receipt }) {
  if (receipt.status === "done" && typeof receipt.total === "number")
    return <span className="amount">{formatMoney(receipt.total, receipt.currency || "?")}</span>;
  if (receipt.status === "failed") return <span className="state bad">Not read</span>;
  if (isPending(receipt)) return <span className="state busy"><i /> Reading…</span>;
  return <span className="state bad" title="The photo may not have reached storage. Upload it again.">Stalled</span>;
}

export default function ReceiptList({ receipts, error }) {
  return (
    <section className="receipts" aria-labelledby="receipts-title">
      <h2 id="receipts-title">Receipts</h2>
      {error && <p className="error" role="alert">Could not refresh: {error}</p>}

      {receipts === null ? (
        <p className="muted">Loading…</p>
      ) : receipts.length === 0 ? (
        <p className="empty">No receipts yet.</p>
      ) : (
        <ul>
          {receipts.map((r) => (
            <li key={r.receiptId}>
              <span className="r-date">{r.date || (r.createdAt || "").slice(0, 10)}</span>
              <span className="r-store">
                {r.store || "Unknown store"}
                {r.status === "failed" && r.error && <small>{r.error}</small>}
              </span>
              <span className="r-cat">
                {r.status === "done" && (
                  <span className="pill">
                    <i style={{ background: CATEGORIES[r.category] || CATEGORIES.other }} />
                    {r.category}
                  </span>
                )}
              </span>
              <span className="r-amount"><Amount receipt={r} /></span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
