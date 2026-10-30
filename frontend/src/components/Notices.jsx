import { formatMoney } from "../lib/stats";

function sentence({ summary, currency }) {
  const { up, down, saved } = summary;
  const parts = [];
  if (up) parts.push(`${up} ${up === 1 ? "product" : "products"} dearer`);
  if (down) parts.push(`${down} cheaper`);
  let text = parts.length ? `${parts.join(", ")} than last time.` : "Prices are the same as last time.";
  if (Math.abs(saved) >= 0.01) {
    text += saved > 0
      ? ` You paid ${formatMoney(saved, currency)} less than at your last prices.`
      : ` You paid ${formatMoney(-saved, currency)} more than at your last prices.`;
  }
  return text;
}

const toneOf = ({ summary }) => (summary.saved >= 0.01 ? "good" : summary.saved <= -0.01 ? "bad" : "neutral");

/** Banners for receipts that were just read: "milk is dearer, bread is cheaper". */
export default function Notices({ notices, onOpen, onDismiss }) {
  return (
    <div className="notices" role="status" aria-live="polite">
      {notices.map((notice) => (
        <div key={notice.receiptId} className="notice" data-tone={toneOf(notice)}>
          <p><strong>{notice.store}</strong> is ready. {sentence(notice)}</p>
          <button className="link" onClick={() => onOpen(notice.receiptId)}>See details</button>
          <button className="x" onClick={() => onDismiss(notice.receiptId)} aria-label="Dismiss">×</button>
        </div>
      ))}
    </div>
  );
}
