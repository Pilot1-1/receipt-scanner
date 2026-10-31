import { formatChange } from "../lib/prices";
import { formatMoney, shortDay } from "../lib/stats";

const TITLES = {
  month: "Spent this month",
  "30d": "Spent, last 30 days",
  "6m": "Spent, last 6 months",
  "12m": "Spent, last 12 months",
  all: "Spent, all time",
  custom: "Spent in this period",
};
const COMPARED_TO = {
  month: "the same days last month",
  "30d": "the 30 days before",
  "6m": "the 6 months before",
  "12m": "the 12 months before",
  custom: "the period before it",
};

function Comparison({ stats, period }) {
  if (stats.previousTotal === null) {
    // "All time", or a custom range without a start date: there is no earlier period to compare with.
    return <p className="card-sub">{stats.count} {stats.count === 1 ? "receipt" : "receipts"} {period.id === "all" ? "in total" : "in this period"}</p>;
  }
  if (stats.change === null) return <p className="card-sub">Nothing spent in {COMPARED_TO[period.id]}</p>;
  // Spending more than before is the "bad" direction, spending less the "good" one.
  const tone = stats.change > 0.01 ? "bad" : stats.change < -0.01 ? "good" : "flat";
  return (
    <p className="card-sub">
      <span className={`delta ${tone}`}>{formatChange(stats.change)}</span> compared with {COMPARED_TO[period.id]}
    </p>
  );
}

/** Four numbers that answer "how much, where, the biggest one, how fast". */
export default function StatCards({ stats, period, currency }) {
  const { topStore, biggest, perDay, days, count } = stats;
  const empty = count === 0;

  return (
    <div className="cards">
      <section className="card" aria-label={TITLES[period.id]}>
        <h3>{TITLES[period.id]}</h3>
        <p className="card-value">{formatMoney(stats.total, currency)}</p>
        <Comparison stats={stats} period={period} />
      </section>

      <section className="card" aria-label="Top store">
        <h3>Top store</h3>
        <p className="card-value card-text">{empty ? "–" : topStore.name}</p>
        <p className="card-sub">
          {empty ? "No receipts in this period" : `${formatMoney(topStore.amount, currency)} in ${topStore.count} ${topStore.count === 1 ? "visit" : "visits"}`}
        </p>
      </section>

      <section className="card" aria-label="Biggest receipt">
        <h3>Biggest receipt</h3>
        <p className="card-value">{empty ? "–" : formatMoney(biggest.total, currency)}</p>
        <p className="card-sub">
          {empty ? "No receipts in this period" : `${biggest.store || "Unknown store"}, ${shortDay(biggest.date || (biggest.createdAt || "").slice(0, 10))}`}
        </p>
      </section>

      <section className="card" aria-label="Average per day">
        <h3>Per day</h3>
        <p className="card-value">{empty ? "–" : formatMoney(perDay, currency)}</p>
        <p className="card-sub">{empty ? "No receipts in this period" : `average over ${days} ${days === 1 ? "day" : "days"}`}</p>
      </section>
    </div>
  );
}
