import React, { useMemo } from "react";

/**
 * Semicircle gauge of the Herfindahl-Hirschman Index over invested weights
 * (cash excluded). Bands follow the classic HHI cut-offs: < 0.15 unconcentrated,
 * 0.15–0.25 moderate, > 0.25 highly concentrated.
 *
 * "Effective positions" = 1 / HHI — how many equal-weight holdings would carry
 * the same concentration. It's descriptive only, in keeping with Motion's
 * no-advice rule.
 */
const SCALE_MAX = 0.5; // HHI at or above this pins the needle

export function computeConcentration(positions) {
  const invested = positions.reduce((s, p) => s + p.value, 0);
  if (!invested) return { hhi: 0, effectiveN: 0, n: 0 };
  const hhi = positions.reduce((s, p) => s + (p.value / invested) ** 2, 0);
  return { hhi, effectiveN: 1 / hhi, n: positions.length };
}

export function ConcentrationGauge({ positions, t }) {
  const { hhi, effectiveN, n } = useMemo(() => computeConcentration(positions), [positions]);
  const score = Math.min(1, hhi / SCALE_MAX);
  const band =
    hhi < 0.15
      ? { label: "Diversified", color: "#10b981" }
      : hhi < 0.25
        ? { label: "Moderately concentrated", color: "#f59e0b" }
        : { label: "Highly concentrated", color: "#f43f5e" };

  // Arc from (20,100) to (180,100), radius 80, center (100,100).
  const arc = "M20,100 A80,80 0 0 1 180,100";
  const tick = (h) => {
    const a = Math.PI * (1 - h / SCALE_MAX);
    return { x: 100 + 92 * Math.cos(a), y: 100 - 92 * Math.sin(a) };
  };

  return (
    <div className="flex flex-col items-center">
      <svg viewBox="0 0 200 118" className="w-full max-w-xs" role="img"
        aria-label={`Concentration index ${hhi.toFixed(2)}, ${band.label}`}>
        <defs>
          <linearGradient id="mo-gauge" x1="0" x2="1" y1="0" y2="0">
            <stop offset="0%" stopColor="#10b981" />
            <stop offset="45%" stopColor="#f59e0b" />
            <stop offset="100%" stopColor="#f43f5e" />
          </linearGradient>
        </defs>

        <path d={arc} fill="none" stroke="currentColor" strokeOpacity="0.1" strokeWidth="14" strokeLinecap="round" />
        <path
          d={arc}
          fill="none"
          stroke="url(#mo-gauge)"
          strokeWidth="14"
          strokeLinecap="round"
          pathLength="100"
          strokeDasharray="100"
          strokeDashoffset={100 - score * 100}
          style={{ transition: "stroke-dashoffset 900ms cubic-bezier(.2,.7,.2,1)" }}
        />

        {[0.15, 0.25].map((h) => {
          const p = tick(h);
          return <circle key={h} cx={p.x} cy={p.y} r="1.6" fill="currentColor" opacity="0.4" />;
        })}

        <g
          style={{
            transform: `rotate(${score * 180 - 90}deg)`,
            transformOrigin: "100px 100px",
            transition: "transform 900ms cubic-bezier(.2,.7,.2,1)",
          }}
        >
          <line x1="100" y1="100" x2="100" y2="34" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
        </g>
        <circle cx="100" cy="100" r="6" fill={band.color} />
        <circle cx="100" cy="100" r="2.5" fill="currentColor" />
      </svg>

      <div className="-mt-1 text-center">
        <div className="text-sm font-medium" style={{ color: band.color }}>{band.label}</div>
        <div className={`mt-1 font-mono text-xs ${t.muted}`}>
          HHI {hhi.toFixed(3)} · behaves like {effectiveN.toFixed(1)} equal positions (of {n})
        </div>
      </div>
    </div>
  );
}
