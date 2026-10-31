import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Brand from "./Brand";
import Breakdown from "./Breakdown";
import Budgets from "./Budgets";
import { CurrencySwitch, PeriodSelect } from "./Controls";
import Notices from "./Notices";
import ProductsTab from "./ProductsTab";
import ReceiptDetail from "./ReceiptDetail";
import ReceiptFilters from "./ReceiptFilters";
import ReceiptList from "./ReceiptList";
import SpendChart from "./SpendChart";
import StatCards from "./StatCards";
import Tabs from "./Tabs";
import Uploader from "./Uploader";
import { SessionExpiredError, getBudgets, listReceipts, saveBudgets } from "../lib/api";
import { downloadCsv, receiptsToCsv } from "../lib/csv";
import { DEFAULT_FILTERS, filterReceipts } from "../lib/filters";
import { buildIndex, buildProducts, compareReceipt, hasLines, summarizeComparison } from "../lib/prices";
import { DEFAULT_PERIOD, bestCurrency, currenciesOf, isPending, overview, summarize } from "../lib/stats";

const POLL_MS = 3000;
const MAX_NOTICES = 3;
const RECENT = 5; // receipts shown on the Overview tab

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
  const [period, setPeriod] = useState(DEFAULT_PERIOD); // the site opens on "this month"
  const [tab, setTab] = useState("overview");
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [openId, setOpenId] = useState(null);
  const [notices, setNotices] = useState([]);
  const [budgets, setBudgets] = useState(null); // null = loading
  const [budgetsError, setBudgetsError] = useState("");
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

  // The monthly limits are loaded once; they only change when the person saves them.
  useEffect(() => {
    let cancelled = false;
    getBudgets()
      .then((loaded) => { if (!cancelled) setBudgets(loaded); })
      .catch((error) => {
        if (error instanceof SessionExpiredError) onExpired();
        else if (!cancelled) setBudgetsError(error.message);
      });
    return () => { cancelled = true; };
  }, [onExpired]);

  const saveBudget = useCallback(async (code, limits) => {
    try {
      setBudgets(await saveBudgets(code, limits));
    } catch (error) {
      if (error instanceof SessionExpiredError) onExpired();
      throw error;
    }
  }, [onExpired]);

  // While Gemini is still reading something, check again every few seconds.
  const waiting = receipts?.some(isPending);
  useEffect(() => {
    if (!waiting) return undefined;
    const timer = setInterval(refresh, POLL_MS);
    return () => clearInterval(timer);
  }, [waiting, refresh]);

  const currencies = useMemo(() => currenciesOf(receipts || []), [receipts]);
  // Until the person picks a currency, show the one with the most receipts in the chosen period.
  const suggested = useMemo(() => bestCurrency(receipts || [], period), [receipts, period]);
  const active = currencies.includes(currency) ? currency : suggested;
  const summary = useMemo(() => summarize(receipts || [], active, period), [receipts, active, period]);
  const stats = useMemo(() => overview(receipts || [], active, period), [receipts, active, period]);
  const monthSpent = useMemo(
    () => Object.fromEntries(summarize(receipts || [], active, "month").categories.map((c) => [c.name, c.amount])),
    [receipts, active]
  );

  // Price history: built once per refresh, shared by the list icons, the receipt window and the Products tab.
  const index = useMemo(() => buildIndex(receipts || []), [receipts]);
  const products = useMemo(() => buildProducts(receipts || [], active), [receipts, active]);
  const trends = useMemo(() => {
    const result = new Map();
    for (const r of receipts || []) {
      if (!hasLines(r)) continue;
      const compared = summarizeComparison(compareReceipt(r, index));
      if (compared.compared) result.set(r.receiptId, compared);
    }
    return result;
  }, [receipts, index]);

  const visible = useMemo(() => filterReceipts(receipts || [], filters), [receipts, filters]);

  const open = openId && receipts ? receipts.find((r) => r.receiptId === openId) : null;
  const openLines = useMemo(() => (open ? compareReceipt(open, index) : []), [open, index]);
  const dismiss = (id) => setNotices((old) => old.filter((n) => n.receiptId !== id));

  // A deleted receipt disappears from the screen at once; the next refresh confirms it.
  const removed = useCallback((id) => {
    setOpenId(null);
    setReceipts((old) => (old ? old.filter((r) => r.receiptId !== id) : old));
    setNotices((old) => old.filter((n) => n.receiptId !== id));
    refresh();
  }, [refresh]);

  const tabs = [
    { id: "overview", label: "Overview" },
    { id: "receipts", label: "Receipts", count: receipts?.length },
    { id: "products", label: "Products", count: receipts ? products.length : undefined },
  ];

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
      <Uploader onUploaded={refresh} />
      <Tabs tabs={tabs} active={tab} onChange={setTab} />

      <main>
        <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} className="stack">
          {tab === "overview" && (
            <>
              <div className="toolbar">
                <h2>Overview</h2>
                <div className="filters">
                  <CurrencySwitch currencies={currencies} currency={active} onChange={setCurrency} />
                  <PeriodSelect period={period} onChange={setPeriod} />
                </div>
              </div>

              {receipts !== null && active && (
                <>
                  <StatCards stats={stats} period={period} currency={active} />
                  <SpendChart receipts={receipts} currency={active} period={period} />
                </>
              )}
              <div className="grid">
                {receipts === null ? (
                  <p className="muted">Loading your receipts…</p>
                ) : (
                  <Breakdown summary={summary} hasAny={currencies.length > 0} currency={active} />
                )}
                <Budgets budgets={budgets} error={budgetsError} currency={active} spent={monthSpent} onSave={saveBudget} />
              </div>

              <section className="panel" aria-labelledby="recent-title">
                <div className="panel-head">
                  <h2 id="recent-title">Recent receipts</h2>
                  {receipts && receipts.length > RECENT && (
                    <button className="link" onClick={() => setTab("receipts")}>All {receipts.length} receipts</button>
                  )}
                </div>
                <ReceiptList
                  receipts={receipts && receipts.slice(0, RECENT)} totalCount={receipts?.length}
                  error={loadError} trends={trends} onOpen={setOpenId}
                />
              </section>
            </>
          )}

          {tab === "receipts" && (
            <section className="panel" aria-labelledby="receipts-title">
              <h2 id="receipts-title">Receipts</h2>
              {receipts !== null && receipts.length > 0 && (
                <ReceiptFilters
                  filters={filters} onChange={setFilters} shown={visible.length} total={receipts.length}
                  onExport={() => downloadCsv(receiptsToCsv(visible))}
                />
              )}
              <ReceiptList receipts={receipts && visible} totalCount={receipts?.length} error={loadError} trends={trends} onOpen={setOpenId} />
            </section>
          )}

          {tab === "products" && (
            receipts === null ? (
              <p className="muted">Loading your receipts…</p>
            ) : (
              <ProductsTab products={products} currencies={currencies} currency={active} onCurrency={setCurrency} />
            )
          )}
        </div>
      </main>

      {open && (
        <ReceiptDetail
          receipt={open} lines={openLines} onClose={() => setOpenId(null)}
          onSaved={refresh} onDeleted={removed} onExpired={onExpired}
        />
      )}
    </div>
  );
}
