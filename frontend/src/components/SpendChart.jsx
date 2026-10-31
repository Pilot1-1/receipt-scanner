import { useEffect, useId, useMemo, useRef, useState } from "react";
import BucketDetails from "./BucketDetails";
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
 * three years, one per year beyond that. Click a bar to see the receipts behind it (and search them).
 * Drawn by hand, no chart library.
 */
export default function SpendChart({ receipts, currency, period, trends, onOpen }) {
  const [hover, setHover] = useState(null);
  const [selectedKey, setSelectedKey] = useState(null);
  const [wrap, width] = useWidth();
  const detailsRef = useRef(null);
  const id = useId();

  const { unit, from, to, points } = useMemo(() => bucketSeries(receipts, currency, period), [receipts, currency, period]);
  const empty = points.every((p) => p.amount === 0); // also true when there are no bars at all
  const max = niceMax(Math.max(0, ...points.map((p) => p.amount)));
  const label = periodLabel(period);

  // A bar that no longer exists, or has no receipts any more (after the period or the currency changed), is not "open".
  const found = points.findIndex((p) => p.key === selectedKey && p.count > 0);
  const selectedIndex = found;
  const selected = found >= 0 ? points[found] : null;
  const picked = hover !== null ? points[hover] : undefined; // undefined if the bars changed under the pointer
  const tabStop = selectedIndex >= 0 ? selectedIndex : Math.max(0, points.length - 1); // one tab stop for the whole chart

  // Bring the opened list into view, unless the person asked their system for less motion.
  useEffect(() => {
    if (!selectedKey || !detailsRef.current) return;
    const calm = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    detailsRef.current.scrollIntoView?.({ block: "nearest", behavior: calm ? "auto" : "smooth" });
  }, [selectedKey]);

  const innerW = width - MARGIN.left - MARGIN.right;
  const innerH = HEIGHT - MARGIN.top - MARGIN.bottom;
  const slot = innerW / Math.max(1, points.length);
  const barW = Math.max(2, Math.min(36, slot * 0.68));
  const y = (value) => MARGIN.top + innerH - (value / max) * innerH;
  const labelEvery = Math.max(1, Math.ceil(points.length / Math.max(2, Math.floor(innerW / (unit === "day" ? 64 : 56)))));

  // Only bars with receipts can be opened; clicking the open bar again closes it.
  const choose = (p) => { if (p.count) setSelectedKey((current) => (current === p.key ? null : p.key)); };

  function onKeyDown(event, i, p) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      choose(p);
    } else if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
      event.preventDefault();
      document.getElementById(`${id}-bar-${i + (event.key === "ArrowRight" ? 1 : -1)}`)?.focus();
    }
  }

  return (
    <section className="panel chart" aria-labelledby="over-time">
      <div className="panel-head">
        <h2 id="over-time">Spending over time</h2>
      </div>

      <p className="chart-readout" aria-live="polite">
        {picked
          ? `${labelOf(picked, unit, points.length, true)}: ${formatMoney(picked.amount, currency)}${picked.count ? `, ${picked.count} ${picked.count === 1 ? "receipt" : "receipts"}` : ""}`
          : `${label}, by ${unit}`}
      </p>

      <div ref={wrap} className="chart-box">
        {empty ? (
          <p className="empty">No spending in this period.</p>
        ) : (
          <svg
            width={width} height={HEIGHT} viewBox={`0 0 ${width} ${HEIGHT}`} role="group"
            aria-label={`${label}: spending by ${unit}. Select a bar to list its receipts.`}
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
              const isSelected = selected?.key === p.key;
              return (
                <g key={p.key} className={`chart-slot${picked && hover === i ? " is-hot" : ""}${isSelected ? " is-selected" : ""}`}>
                  {isSelected && <rect className="chart-select" x={left} y={MARGIN.top} width={slot} height={innerH} rx="3" />}
                  {height > 0 && (
                    <rect className="chart-bar" x={left + (slot - barW) / 2} y={y(0) - height} width={barW} height={height} rx="2" />
                  )}
                  <rect
                    id={`${id}-bar-${i}`} className={`chart-hit${p.count ? " clickable" : ""}`}
                    x={left} y={MARGIN.top} width={slot} height={innerH} fill="transparent"
                    role="button" tabIndex={i === tabStop ? 0 : -1} aria-pressed={isSelected}
                    aria-label={`${labelOf(p, unit, points.length, true)}: ${formatMoney(p.amount, currency)}, ${p.count} ${p.count === 1 ? "receipt" : "receipts"}`}
                    onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} onBlur={() => setHover(null)}
                    onClick={() => choose(p)} onKeyDown={(e) => onKeyDown(e, i, p)}
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

      {!empty && !selected && <p className="note chart-hint">Click a bar to see its receipts.</p>}

      {selected && (
        <div ref={detailsRef}>
          <BucketDetails
            key={selected.key} receipts={receipts} currency={currency} trends={trends} onOpen={onOpen}
            bucket={{ key: selected.key, label: labelOf(selected, unit, points.length, true), from, to }}
            onClose={() => setSelectedKey(null)}
          />
        </div>
      )}
    </section>
  );
}
