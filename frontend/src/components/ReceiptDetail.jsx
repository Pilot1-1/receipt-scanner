import { useEffect, useMemo, useRef } from "react";
import { CATEGORIES, formatMoney } from "../lib/stats";
import { checkLines, formatChange, lineId, summarizeComparison } from "../lib/prices";

function shortDay(value) {
  if (!value) return "";
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

// "/ kg" after the unit price of goods sold by weight or volume; nothing for pieces.
const perUnit = (unit) => (unit && unit !== "pcs" ? ` / ${unit}` : "");

function Change({ line, currency }) {
  if (!line) return <span className="muted" title="Free or unreadable lines are not compared">–</span>;
  const { trend, previous, cheapest } = line;
  return (
    <span className={`change ${trend}`}>
      {trend === "up" && `↑ ${formatChange(line.change)}`}
      {trend === "down" && `↓ ${formatChange(line.change)}`}
      {trend === "same" && "≈ same"}
      {trend === "new" && "first time"}
      {previous && (
        <small>was {formatMoney(previous.unitPrice, currency)} · {previous.store} · {shortDay(previous.day)}</small>
      )}
      {cheapest && cheapest.receiptId !== previous?.receiptId && ( // not the same purchase as "was …"
        <small>
          cheaper at {cheapest.store}: {formatMoney(cheapest.unitPrice, currency)} · {shortDay(cheapest.day)}
        </small>
      )}
    </span>
  );
}

/** One receipt in a window: the products on it and how each price compares with earlier purchases. */
export default function ReceiptDetail({ receipt, lines, onClose }) {
  const dialog = useRef(null);

  // A native <dialog> gives focus handling and the Escape key for free.
  useEffect(() => {
    const element = dialog.current;
    if (element && !element.open) element.showModal();
    return () => { if (element && element.open) element.close(); };
  }, []);

  const currency = receipt.currency || "?";
  const items = Array.isArray(receipt.items) ? receipt.items : [];
  const byId = useMemo(() => new Map(lines.map((line) => [line.id, line])), [lines]);
  const summary = useMemo(() => summarizeComparison(lines), [lines]);
  const check = checkLines(receipt);
  const day = shortDay(receipt.date || (receipt.createdAt || "").slice(0, 10));

  return (
    <dialog
      ref={dialog}
      className="detail"
      aria-labelledby="detail-title"
      onCancel={(event) => { event.preventDefault(); onClose(); }}
      onClick={(event) => { if (event.target === dialog.current) onClose(); }} // a click on the dimmed backdrop
    >
      <div className="detail-body">
        <div className="detail-head">
          <div>
            <h2 id="detail-title">{receipt.store || "Unknown store"}</h2>
            <p className="muted detail-sub">
              {day}
              <span className="pill">
                <i style={{ background: CATEGORIES[receipt.category] || CATEGORIES.other }} />
                {receipt.category}
              </span>
            </p>
          </div>
          <p className="amount detail-total">{formatMoney(receipt.total, currency)}</p>
          <button className="ghost" onClick={onClose}>Close</button>
        </div>

        {items.length === 0 ? (
          <p className="empty">
            No products were saved for this receipt. Product lines are stored for receipts read after this
            feature was added, and only when they were readable on the photo.
          </p>
        ) : (
          <>
            <div className="table-wrap">
              <table className="lines">
                <thead>
                  <tr>
                    <th>Product</th>
                    <th className="num">Qty</th>
                    <th className="num">Unit price</th>
                    <th className="num">Total</th>
                    <th>Since last time</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item, index) => (
                    <tr key={`${index}-${item.name}`}>
                      <td className="name">{item.name}</td>
                      <td className="num">{item.quantity}{item.unit ? ` ${item.unit}` : ""}</td>
                      <td className="num">{formatMoney(item.unitPrice ?? item.price, currency)}{perUnit(item.unit)}</td>
                      <td className="num">{formatMoney(item.price, currency)}</td>
                      <td><Change line={byId.get(lineId(item))} currency={currency} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {summary.compared > 0 ? (
              <div className="detail-summary">
                <span>Compared with the last time you bought each product:</span>
                {summary.up > 0 && <span className="chip up">↑ {summary.up} dearer</span>}
                {summary.down > 0 && <span className="chip down">↓ {summary.down} cheaper</span>}
                {summary.up === 0 && summary.down === 0 && <span className="chip">no change</span>}
                {Math.abs(summary.saved) >= 0.01 && (
                  <span>
                    {formatMoney(Math.abs(summary.saved), currency)} {summary.saved > 0 ? "less" : "more"} than at your last prices
                  </span>
                )}
              </div>
            ) : (
              <p className="note detail-summary">
                You have not bought these products before, so there is nothing to compare yet. Add more receipts
                from the same shop.
              </p>
            )}

            {check && !check.ok && (
              <p className="note">
                The lines add up to {formatMoney(check.sum, currency)}, but the receipt total is{" "}
                {formatMoney(check.total, currency)}. Some lines may be missing from the photo reading.
              </p>
            )}
          </>
        )}
      </div>
    </dialog>
  );
}
