import { useMemo, useState } from "react";
import ReceiptList from "./ReceiptList";
import { matchesQuery } from "../lib/filters";
import { dayOf, formatMoney, isDone } from "../lib/stats";

const newestFirst = (a, b) => {
  const x = `${dayOf(a)}|${a.createdAt || ""}`;
  const y = `${dayOf(b)}|${b.createdAt || ""}`;
  return x < y ? 1 : x > y ? -1 : 0;
};
const sum = (rows) => rows.reduce((total, r) => total + r.total, 0);

/**
 * The receipts behind one bar of the chart (a day, a month or a year), with a search over their stores
 * and products. `bucket` is { key, label, from, to }: the key "2026-10" matches every day that starts with it.
 */
export default function BucketDetails({ receipts, currency, bucket, trends, onOpen, onClose }) {
  const [query, setQuery] = useState("");

  const rows = useMemo(
    () =>
      receipts
        .filter((r) => {
          const day = dayOf(r);
          return isDone(r) && (r.currency || "?") === currency && day.startsWith(bucket.key) && day >= bucket.from && day <= bucket.to;
        })
        .sort(newestFirst),
    [receipts, currency, bucket]
  );
  const shown = useMemo(() => rows.filter((r) => matchesQuery(r, query)), [rows, query]);
  const searching = query.trim() !== "";

  return (
    <div className="bucket" role="region" aria-label={`Receipts, ${bucket.label}`}>
      <div className="bucket-head">
        <div>
          <h3>{bucket.label}</h3>
          <p className="muted">
            {formatMoney(sum(rows), currency)} in {rows.length} {rows.length === 1 ? "receipt" : "receipts"}
          </p>
        </div>
        <button type="button" className="ghost" onClick={onClose}>Close</button>
      </div>

      <input
        type="search" className="search" placeholder="Search these receipts by store or product"
        aria-label={`Search receipts, ${bucket.label}`} value={query} onChange={(e) => setQuery(e.target.value)}
      />
      {searching && (
        <p className="note" role="status">
          {shown.length} of {rows.length} receipts match, {formatMoney(sum(shown), currency)}
        </p>
      )}

      {rows.length === 0 ? (
        <p className="empty">No receipts in {bucket.label}.</p>
      ) : (
        <ReceiptList receipts={shown} totalCount={rows.length} trends={trends} onOpen={onOpen} query={query} />
      )}
    </div>
  );
}
