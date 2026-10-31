import { CATEGORIES, formatMoney, titleCase } from "../lib/stats";

const WARN_AT = 0.8; // amber from 80% of the limit, red from 100% (the same rule as the category bars)
const toneOf = (ratio) => (ratio >= 1 ? "bad" : ratio >= WARN_AT ? "warn" : "ok");

/**
 * The big budget bar under the cards: everything spent this month in the categories that have a limit, against the
 * sum of those limits. The thin tick shows where an even spend would be today, so "ahead of the month" is visible at a glance.
 *   limits: { food: 200, groceries: 400 } for the selected currency;  spent: { food: 130.5 } this month
 */
export default function BudgetBanner({ limits, spent, currency, now = new Date() }) {
  const names = Object.keys(limits || {}).filter((name) => limits[name] > 0);
  if (!names.length) return null;

  const limit = names.reduce((sum, name) => sum + limits[name], 0);
  const used = names.reduce((sum, name) => sum + (spent[name] || 0), 0);
  const ratio = used / limit;
  const tone = toneOf(ratio);

  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const daysLeft = daysInMonth - now.getDate() + 1; // today still counts
  const pace = now.getDate() / daysInMonth;
  const left = limit - used;

  const close = names
    .map((name) => ({ name, ratio: (spent[name] || 0) / limits[name] }))
    .filter((row) => row.ratio >= WARN_AT)
    .sort((a, b) => b.ratio - a.ratio);

  return (
    <section className={`budget-banner ${tone}`} aria-labelledby="budget-banner-title">
      <div className="bb-head">
        <h2 id="budget-banner-title">Budget this month</h2>
        <span className="bb-badge">{Math.round(ratio * 100)}%</span>
      </div>

      <p className="bb-figures">
        <strong>{formatMoney(used, currency)}</strong> of {formatMoney(limit, currency)}
      </p>

      <div
        className="bb-meter" role="progressbar" aria-label="Budget used this month"
        aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(100, Math.round(ratio * 100))}
      >
        <span className="bb-fill" style={{ width: `${Math.min(100, ratio * 100)}%` }} />
        <i className="bb-pace" style={{ left: `${pace * 100}%` }} title={`Day ${now.getDate()} of ${daysInMonth}: an even spend would be here`} />
      </div>

      <p className="bb-note">
        {left < 0
          ? `Over the budget by ${formatMoney(-left, currency)}.`
          : `${formatMoney(left, currency)} left, about ${formatMoney(left / daysLeft, currency)} a day for the remaining ${daysLeft} ${daysLeft === 1 ? "day" : "days"}.`}
        {left >= 0 && ratio > pace + 0.1 && " You are spending faster than the month goes."}
      </p>

      {close.length > 0 && (
        <ul className="bb-chips" aria-label="Categories close to their limit">
          {close.map((row) => (
            <li key={row.name} className={toneOf(row.ratio)}>
              <i style={{ background: CATEGORIES[row.name] || CATEGORIES.other }} />
              {titleCase(row.name)} {Math.round(row.ratio * 100)}%
            </li>
          ))}
        </ul>
      )}
      <p className="bb-hint">Counts the categories that have a limit. The tick shows where an even spend would be today.</p>
    </section>
  );
}
