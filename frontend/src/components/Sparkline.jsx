/** A tiny price line: no axes, just the shape (is it going up or down?). The text next to it says the numbers. */
export default function Sparkline({ values, tone = "same", width = 96, height = 28 }) {
  if (values.length < 2) return <span className="muted" title="Bought only once">–</span>;

  const min = Math.min(...values);
  const max = Math.max(...values);
  const pad = 3;
  const x = (i) => pad + (i * (width - 2 * pad)) / (values.length - 1);
  const y = (v) => (max === min ? height / 2 : height - pad - ((v - min) / (max - min)) * (height - 2 * pad));
  const points = values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");

  return (
    <svg className={`spark ${tone}`} width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      <polyline points={points} fill="none" strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(values.length - 1)} cy={y(values[values.length - 1])} r="2.6" />
    </svg>
  );
}
