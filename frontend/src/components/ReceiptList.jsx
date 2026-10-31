import { CATEGORIES, formatMoney, isPending } from "../lib/stats";
import { hasLines } from "../lib/prices";
import { matchingItems } from "../lib/filters";

function Amount({ receipt }) {
  if (receipt.status === "done" && typeof receipt.total === "number")
    return <span className="amount">{formatMoney(receipt.total, receipt.currency || "?")}</span>;
  if (receipt.status === "failed") return <span className="state bad">Not read</span>;
  if (isPending(receipt)) return <span className="state busy"><i /> Reading…</span>;
  return <span className="state bad" title="The photo may not have reached storage. Upload it again.">Stalled</span>;
}

/** "↑2 ↓1": how many products got dearer or cheaper since the last time they were bought. */
function Chips({ trend }) {
  if (!trend || (trend.up === 0 && trend.down === 0)) return null;
  return (
    <span className="chips" title={`${trend.up} dearer, ${trend.down} cheaper than last time`}>
      {trend.up > 0 && <span className="chip up">↑{trend.up}</span>}
      {trend.down > 0 && <span className="chip down">↓{trend.down}</span>}
    </span>
  );
}

/**
 * A list of receipts. `receipts` is what to show (already filtered or shortened); `totalCount` is how many
 * exist, so an empty list can say "nothing yet" or "nothing matches". With a search `query`, the products that
 * matched are shown under the store name, so it is clear why a receipt is in the list.
 */
export default function ReceiptList({ receipts, totalCount, error, trends, onOpen, query = "" }) {
  const canOpen = (r) => r.status === "done" && typeof r.total === "number";
  const anyLines = receipts?.some(hasLines);

  return (
    <div className="receipt-list">
      {anyLines && <p className="note">Click a receipt to see what you bought and how the prices changed.</p>}
      {error && <p className="error" role="alert">Could not refresh: {error}</p>}

      {receipts === null ? (
        <p className="muted">Loading…</p>
      ) : receipts.length === 0 ? (
        <p className="empty">{totalCount === 0 ? "No receipts yet. Add your first photo above." : "No receipts match this search."}</p>
      ) : (
        <ul>
          {receipts.map((r) => {
            const Row = canOpen(r) ? "button" : "div";
            return (
              <li key={r.receiptId}>
                <Row className="r-row" {...(canOpen(r) ? { type: "button", onClick: () => onOpen(r.receiptId) } : {})}>
                  <span className="r-date">{r.date || (r.createdAt || "").slice(0, 10)}</span>
                  <span className="r-store">
                    {r.store || "Unknown store"}
                    <Chips trend={trends?.get(r.receiptId)} />
                    {r.status === "failed" && r.error && <small>{r.error}</small>}
                    {matchingItems(r, query).map((item, i) => (
                      <span key={i} className="r-match">
                        {item.name} · {formatMoney(item.price, r.currency || "?")}
                      </span>
                    ))}
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
                </Row>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
