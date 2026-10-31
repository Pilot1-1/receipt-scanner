import { useEffect, useMemo, useRef, useState } from "react";
import { bucketSeries, formatMoney, periodLabel } from "../lib/stats";

const HEIGHT = 220;
const MARGIN = { top: 12, right: 8, bottom: 26, left: 44 };

const compact = new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 });

/** Round the top of the scale up to 1, 2, 5 or 10 times a power of ten, so the grid lines have tidy values. */
function niceMax(value) {
  if (value <= 0) return 1;
  const unit = 10 ** Math.floor(Math.log10(value));
  const f = value / unit;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * unit;
}

// Day keys look like "2026-10-12", month keys like "2026-10", year keys like "2026".
function labelOf(point, unit, count, long = false) {
  if (unit === "year") return point.key;
  if (unit === "day") {
    const date = new Date(`${point.key}T00:00:00`);
    return date.toLocaleDateString(undefined, { day: "numeric", month: "short", ...(long ? { year: "numeric" } : {}) });
  }
  const date = new Date(`${point.key}-01T00:00:00`);
  if (long) return date.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  return date.toLocaleDateString(undefined, count > 12 ? { month: "short", year: "2-digit" } : { month: "short" });
}

function useWidth() {
  const ref = useRef(null);
  const [width, setWidth] = useState(640);
  useEffect(() => {
    const element = ref.current;
    if (!element) return undefined;
    const update = () => setWidth(Math.max(280, Math.round(element.getBoundingClientRect().width)));
    update();
    if (typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, width];
}

/**
 * Spending over the selected period as bars: one per day for a month or so, one per month for up to
 * three years, one per year beyond that. Drawn by hand, no chart library.
 */
export default function SpendChart({ receipts, currency, period }) {
  const [hover, setHover] = useState(null);
  const [wrap, width] = useWidth();

  const { unit, points } = useMemo(() => bucketSeries(receipts, currency, period), [receipts, currency, period]);
  const empty = points.every((p) => p.amount === 0); // also true when there are no bars at all
  const max = niceMax(Math.max(0, ...points.map((p) => p.amount)));
  const label = periodLabel(period);

  const innerW = width - MARGIN.left - MARGIN.right;
  const innerH = HEIGHT - MARGIN.top - MARGIN.bottom;
  const slot = innerW / Math.max(1, points.length);
  const barW = Math.max(2, Math.min(36, slot * 0.68));
  const y = (value) => MARGIN.top + innerH - (value / max) * innerH;
  const labelEvery = Math.max(1, Math.ceil(points.length / Math.max(2, Math.floor(innerW / (unit === "day" ? 64 : 56)))));

  const picked = hover !== null ? points[hover] : undefined; // undefined if the bars changed under the pointer

  return (
    <section className="panel chart" aria-labelledby="over-time">
      <div className="panel-head">
        <h2 id="over-time">Spending over time</h2>
      </div>

      <p className="chart-readout" aria-live="polite">
        {picked ? `${labelOf(picked, unit, points.length, true)}: ${formatMoney(picked.amount, currency)}` : `${label}, by ${unit}`}
      </p>

      <div ref={wrap} className="chart-box">
        {empty ? (
          <p className="empty">No spending in this period.</p>
        ) : (
          <svg
            width={width} height={HEIGHT} viewBox={`0 0 ${width} ${HEIGHT}`} role="img"
            aria-label={`${label}: spending by ${unit}`}
            onMouseLeave={() => setHover(null)}
          >
            <g className="chart-grid">
              {[0, 0.5, 1].map((t) => (
                <g key={t}>
                  <line x1={MARGIN.left} x2={width - MARGIN.right} y1={y(max * t)} y2={y(max * t)} />
                  <text x={MARGIN.left - 8} y={y(max * t) + 4} textAnchor="end">{compact.format(max * t)}</text>
                </g>
              ))}
            </g>

            {points.map((p, i) => {
              const left = MARGIN.left + i * slot;
              const height = p.amount > 0 ? Math.max(2, (p.amount / max) * innerH) : 0;
              return (
                <g key={p.key} className={`chart-slot${picked && hover === i ? " is-hot" : ""}`}>
                  {height > 0 && (
                    <rect className="chart-bar" x={left + (slot - barW) / 2} y={y(0) - height} width={barW} height={height} rx="2" />
                  )}
                  <rect
                    x={left} y={MARGIN.top} width={slot} height={innerH} fill="transparent"
                    onMouseEnter={() => setHover(i)} onClick={() => setHover(i)}
                  >
                    <title>{`${labelOf(p, unit, points.length, true)}: ${formatMoney(p.amount, currency)}`}</title>
                  </rect>
                  {i % labelEvery === 0 && (
                    <text className="chart-tick" x={left + slot / 2} y={HEIGHT - 8} textAnchor="middle">{labelOf(p, unit, points.length)}</text>
                  )}
                </g>
              );
            })}
          </svg>
        )}
      </div>
    </section>
  );
}
