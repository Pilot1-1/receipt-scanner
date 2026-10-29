import { useCallback, useEffect, useMemo, useState } from "react";
import Brand from "./Brand";
import Breakdown from "./Breakdown";
import ReceiptList from "./ReceiptList";
import Uploader from "./Uploader";
import { SessionExpiredError, listReceipts } from "../lib/api";
import { currenciesOf, isPending, summarize } from "../lib/stats";

const POLL_MS = 3000;

export default function Dashboard({ email, onSignOut, onExpired }) {
  const [receipts, setReceipts] = useState(null); // null = first load
  const [loadError, setLoadError] = useState("");
  const [currency, setCurrency] = useState(null);
  const [period, setPeriod] = useState("all");

  const refresh = useCallback(async () => {
    try {
      setReceipts(await listReceipts());
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

  return (
    <div className="app">
      <header className="bar">
        <Brand />
        <div className="bar-user">
          <span>{email}</span>
          <button className="ghost" onClick={onSignOut}>Sign out</button>
        </div>
      </header>

      <main>
        <div className="grid">
          <Breakdown
            loading={receipts === null} summary={summary} hasAny={currencies.length > 0}
            currencies={currencies} currency={active} onCurrency={setCurrency}
            period={period} onPeriod={setPeriod}
          />
          <Uploader onUploaded={refresh} />
        </div>
        <ReceiptList receipts={receipts} error={loadError} />
      </main>
    </div>
  );
}
