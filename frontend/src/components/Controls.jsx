import { PERIODS, isoDay, rangeOf } from "../lib/stats";

/** Amounts in different currencies are never added together, so the person picks one. Hidden if there is only one. */
export function CurrencySwitch({ currencies, currency, onChange }) {
  if (currencies.length < 2) return null;
  return (
    <div className="segmented" role="group" aria-label="Currency">
      {currencies.map((code) => (
        <button key={code} type="button" aria-pressed={code === currency} onClick={() => onChange(code)}>{code}</button>
      ))}
    </div>
  );
}

/**
 * One drop-down with ready-made periods. The two date fields exist only while "Custom range…" is chosen,
 * so the toolbar stays calm the rest of the time.
 */
export function PeriodSelect({ period, onChange }) {
  const today = isoDay(new Date());

  function choose(id) {
    if (id !== "custom") return onChange({ id });
    // Start from the dates on screen now, so the person only has to adjust them.
    const shown = rangeOf(period) || { from: "", to: today };
    onChange({ id, from: shown.from, to: shown.to });
  }

  return (
    <>
      <select value={period.id} onChange={(e) => choose(e.target.value)} aria-label="Period">
        {PERIODS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
      </select>
      {period.id === "custom" && (
        <div className="range" role="group" aria-label="Custom period">
          <input
            type="date" aria-label="From" value={period.from || ""} max={period.to || today}
            onChange={(e) => onChange({ ...period, from: e.target.value })}
          />
          <span aria-hidden="true">–</span>
          <input
            type="date" aria-label="To" value={period.to || ""} min={period.from || undefined} max={today}
            onChange={(e) => onChange({ ...period, to: e.target.value })}
          />
        </div>
      )}
    </>
  );
}
