import React from "react";
import { TrendingUp, TrendingDown } from "lucide-react";
import { AnimatedNumber } from "./AnimatedNumber.jsx";

/**
 * Drop-in replacement for Chrome.jsx's StatTile:
 *  - the value counts up/down when it changes
 *  - an optional delta chip (fraction, e.g. 0.042 → +4.2%)
 *  - an optional sparkline. Motion has no price history yet, so leave `spark`
 *    undefined until live prices exist; the tile renders fine without it.
 *  - a thin accent bar on top that picks up the tone (gain/loss/neutral)
 */
export function StatTilePro({ label, value, format, tone, accent, delta, spark, t }) {
  const up = delta == null ? null : delta >= 0;
  return (
    <div
      className={`group relative overflow-hidden rounded-xl border p-4 transition-all duration-500 hover:-translate-y-0.5 hover:shadow-lg ${t.card}`}
    >
      <div
        className="absolute inset-x-0 top-0 h-0.5 opacity-70 transition-opacity group-hover:opacity-100"
        style={{ background: `linear-gradient(90deg, transparent, ${accent || "#6366f1"}, transparent)` }}
      />
      <div className="flex items-center justify-between">
        <div className={`text-xs uppercase tracking-wide ${t.faint}`}>{label}</div>
        {up != null && (
          <span
            className={`flex items-center gap-0.5 rounded-full px-1.5 py-0.5 font-mono text-[10px] font-medium ${
              up ? "bg-emerald-500/10 text-emerald-500" : "bg-rose-500/10 text-rose-500"
            }`}
          >
            {up ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
            {`${up ? "+" : ""}${(delta * 100).toFixed(1)}%`}
          </span>
        )}
      </div>
      <div className={`mt-1 font-mono text-lg font-semibold ${tone}`}>
        {typeof value === "number" ? <AnimatedNumber value={value} format={format} /> : value}
      </div>
      {spark && spark.length > 1 && <Sparkline points={spark} color={accent || "#6366f1"} />}
    </div>
  );
}

function Sparkline({ points, color, height = 28 }) {
  const w = 100;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const xy = points.map((p, i) => [
    (i / (points.length - 1)) * w,
    height - ((p - min) / span) * (height - 4) - 2,
  ]);
  const line = xy.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(2)},${y.toFixed(2)}`).join(" ");
  const area = `${line} L${w},${height} L0,${height} Z`;
  const id = `spark-${color.replace("#", "")}`;
  return (
    <svg viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" className="mt-2 h-7 w-full">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.35" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${id})`} />
      <path d={line} fill="none" stroke={color} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
