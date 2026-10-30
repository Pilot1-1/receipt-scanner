import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Brand from "./Brand";
import Breakdown from "./Breakdown";
import Notices from "./Notices";
import ReceiptDetail from "./ReceiptDetail";
import ReceiptList from "./ReceiptList";
import Uploader from "./Uploader";
import { SessionExpiredError, listReceipts } from "../lib/api";
import { buildIndex, compareReceipt, hasLines, summarizeComparison } from "../lib/prices";
import { currenciesOf, isPending, summarize } from "../lib/stats";

const POLL_MS = 3000;
const MAX_NOTICES = 3;

/** A banner for a receipt that was just read, or null if none of its products has an earlier price to compare. */
function noticeFor(receipt, index) {
  const summary = summarizeComparison(compareReceipt(receipt, index));
  if (!summary.compared) return null;
  return { receiptId: receipt.receiptId, store: receipt.store || "Receipt", currency: receipt.currency || "?", summary };
}

export default function Dashboard({ email, onSignOut, onExpired }) {
  const [receipts, setReceipts] = useState(null); // null = first load
  const [loadError, setLoadError] = useState("");
  const [currency, setCurrency] = useState(null);
  const [period, setPeriod] = useState("all");
  const [openId, setOpenId] = useState(null);
  const [notices, setNotices] = useState([]);
  const reading = useRef(new Set());  // receipts that showed "Reading…" at the last refresh
  const announced = useRef(new Set()); // receipts that already got a banner

  const refresh = useCallback(async () => {
    try {
      const list = await listReceipts();

      // A receipt that was "Reading…" a moment ago and is done now: say how its prices compare.
      const finished = list.filter(
        (r) => reading.current.has(r.receiptId) && r.status === "done" && !announced.current.has(r.receiptId)
      );
      reading.current = new Set(list.filter(isPending).map((r) => r.receiptId));
      if (finished.length) {
        const index = buildIndex(list);
        finished.forEach((r) => announced.current.add(r.receiptId));
        const fresh = finished.map((r) => noticeFor(r, index)).filter(Boolean);
        if (fresh.length) setNotices((old) => [...fresh, ...old].slice(0, MAX_NOTICES));
      }

      setReceipts(list);
      setLoadError("");
    } catch (error) {
      if (error instanceof SessionExpiredError) onExpired();
      else setLoadError(error.message);
    }
  }, [onExpired]);

  useEffect(() => { refresh(); }, [refresh]);

  // While Gemini is still reading something, check again every few seconds.
  const waiting = receipts?.some(isPending);
  useEffect(() => {
    if (!waiting) return undefined;
    const timer = setInterval(refresh, POLL_MS);
    return () => clearInterval(timer);
  }, [waiting, refresh]);

  const currencies = useMemo(() => currenciesOf(receipts || []), [receipts]);
  const active = currencies.includes(currency) ? currency : currencies[0];
  const summary = useMemo(() => summarize(receipts || [], active, period), [receipts, active, period]);

  // Price history: built once per refresh, shared by the list icons and the receipt window.
  const index = useMemo(() => buildIndex(receipts || []), [receipts]);
  const trends = useMemo(() => {
    const result = new Map();
    for (const r of receipts || []) {
      if (!hasLines(r)) continue;
      const compared = summarizeComparison(compareReceipt(r, index));
      if (compared.compared) result.set(r.receiptId, compared);
    }
    return result;
  }, [receipts, index]);

  const open = openId && receipts ? receipts.find((r) => r.receiptId === openId) : null;
  const openLines = useMemo(() => (open ? compareReceipt(open, index) : []), [open, index]);
  const dismiss = (id) => setNotices((old) => old.filter((n) => n.receiptId !== id));

  return (
    <div className="app">
      <header className="bar">
        <Brand />
        <div className="bar-user">
          <span>{email}</span>
          <button className="ghost" onClick={onSignOut}>Sign out</button>
        </div>
      </header>

      <Notices notices={notices} onOpen={setOpenId} onDismiss={dismiss} />

      <main>
        <div className="grid">
          <Breakdown
            loading={receipts === null} summary={summary} hasAny={currencies.length > 0}
            currencies={currencies} currency={active} onCurrency={setCurrency}
            period={period} onPeriod={setPeriod}
          />
          <Uploader onUploaded={refresh} />
        </div>
        <ReceiptList receipts={receipts} error={loadError} trends={trends} onOpen={setOpenId} />
      </main>

      {open && <ReceiptDetail receipt={open} lines={openLines} onClose={() => setOpenId(null)} />}
    </div>
  );
}
