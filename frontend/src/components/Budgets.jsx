import { useState } from "react";
import { CATEGORIES, formatMoney, titleCase } from "../lib/stats";

const NAMES = Object.keys(CATEGORIES);
const WARN_AT = 0.8; // the bar turns amber at 80% of the limit and red at 100%

const toneOf = (ratio) => (ratio >= 1 ? "bad" : ratio >= WARN_AT ? "warn" : "ok");

/**
 * Monthly limits per category (saved in the cloud) against what has been spent this month.
 *   budgets: { EUR: { food: 200 } } for every currency, or null while loading
 *   spent:   { food: 130.5 } this month, in the selected currency
 */
export default function Budgets({ budgets, error, currency, spent, onSave }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({});
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");

  const limits = (budgets && currency && budgets[currency]) || {};
  const rows = NAMES.filter((name) => limits[name] > 0)
    .map((name) => {
      const used = spent[name] || 0;
      return { name, limit: limits[name], used, ratio: used / limits[name] };
    })
    .sort((a, b) => b.ratio - a.ratio);
  const alerts = rows.filter((row) => row.ratio >= WARN_AT).length;

  function startEditing() {
    setDraft(Object.fromEntries(NAMES.map((name) => [name, limits[name] ? String(limits[name]) : ""])));
    setProblem("");
    setEditing(true);
  }

  async function save(event) {
    event.preventDefault();
    const payload = {};
    for (const name of NAMES) {
      const text = (draft[name] || "").trim().replace(",", ".");
      if (text === "") { payload[name] = null; continue; }
      const value = Number(text);
      if (!Number.isFinite(value) || value < 0) {
        setProblem(`${titleCase(name)}: enter an amount like 150 or 99.50, or leave it empty.`);
        return;
      }
      payload[name] = value;
    }
    setBusy(true);
    setProblem("");
    try {
      await onSave(currency, payload);
      setEditing(false);
    } catch (failure) {
      setProblem(failure.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel budgets" aria-labelledby="budgets-title">
      <div className="panel-head">
        <h2 id="budgets-title">Monthly budgets</h2>
        {currency && budgets && !editing && (
          <button type="button" className="ghost" onClick={startEditing}>{rows.length ? "Edit limits" : "Set limits"}</button>
        )}
      </div>

      {!currency ? (
        <p className="empty">Add a receipt first. Limits are set per currency.</p>
      ) : error ? (
        <p className="error" role="alert">Could not load budgets: {error}</p>
      ) : budgets === null ? (
        <p className="muted">Loading…</p>
      ) : editing ? (
        <form className="budget-form" onSubmit={save}>
          <p className="note">Monthly limit in {currency} for each category. Leave a field empty for no limit.</p>
          <div className="budget-fields">
            {NAMES.map((name) => (
              <label key={name}>
                {titleCase(name)}
                <input
                  inputMode="decimal" placeholder="No limit" value={draft[name] ?? ""}
                  onChange={(e) => setDraft({ ...draft, [name]: e.target.value })}
                />
              </label>
            ))}
          </div>
          {problem && <p className="error" role="alert">{problem}</p>}
          <div className="form-actions">
            <button className="primary" disabled={busy}>{busy ? "Saving…" : "Save limits"}</button>
            <button type="button" className="ghost" disabled={busy} onClick={() => setEditing(false)}>Cancel</button>
          </div>
        </form>
      ) : rows.length === 0 ? (
        <p className="empty">No limits yet. Set a monthly limit for a category and the bar fills as you spend.</p>
      ) : (
        <>
          <p className="note">
            {alerts > 0
              ? `${alerts} ${alerts === 1 ? "category is" : "categories are"} close to or over the limit this month.`
              : "Everything is within the limits this month."}
          </p>
          <ul className="budget-list">
            {rows.map((row) => {
              const tone = toneOf(row.ratio);
              return (
                <li key={row.name}>
                  <div className="budget-line">
                    <span className="budget-name">{row.name}</span>
                    <span className="budget-figures">
                      {formatMoney(row.used, currency)} of {formatMoney(row.limit, currency)}
                    </span>
                  </div>
                  <div
                    className={`meter ${tone}`} role="progressbar" aria-label={`${titleCase(row.name)} budget used`}
                    aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(100, Math.round(row.ratio * 100))}
                  >
                    <span style={{ width: `${Math.min(100, row.ratio * 100)}%` }} />
                  </div>
                  <p className={`budget-note ${tone}`}>
                    {row.ratio >= 1
                      ? `Over by ${formatMoney(row.used - row.limit, currency)}`
                      : `${Math.round(row.ratio * 100)}% used, ${formatMoney(row.limit - row.used, currency)} left`}
                  </p>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}
