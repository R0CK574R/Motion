import React, { useMemo } from "react";

/**
 * Diverging bar chart of dollar P&L per position around a zero axis. Answers
 * "which holdings produced the total return figure" — the stat tile only shows
 * the sum.
 */
export function PnLContribution({ positions, signedUsd, t }) {
  const rows = useMemo(
    () => [...positions].sort((a, b) => b.gain - a.gain),
    [positions]
  );
  const maxAbs = Math.max(1, ...rows.map((p) => Math.abs(p.gain)));

  return (
    <div className="space-y-1.5">
      {rows.map((p, i) => {
        const w = (Math.abs(p.gain) / maxAbs) * 50;
        const up = p.gain >= 0;
        return (
          <div key={p.id} className="mo-rise flex items-center gap-3" style={{ animationDelay: `${i * 40}ms` }}>
            <div className="w-14 shrink-0 font-mono text-xs font-medium">{p.ticker}</div>
            <div className="relative h-5 flex-1">
              <div className={`absolute inset-y-0 left-1/2 w-px ${t.barTrack}`} style={{ opacity: 1 }} />
              <div
                className="mo-grow-x absolute inset-y-0.5 rounded"
                style={{
                  left: up ? "50%" : `${50 - w}%`,
                  width: `${Math.max(w, 0.5)}%`,
                  transformOrigin: up ? "left" : "right",
                  animationDelay: `${i * 40}ms`,
                  background: up
                    ? "linear-gradient(90deg, #10b98155, #10b981)"
                    : "linear-gradient(270deg, #f43f5e55, #f43f5e)",
                }}
              />
            </div>
            <div className={`w-24 shrink-0 text-right font-mono text-xs tabular-nums ${up ? t.up : t.down}`}>
              {signedUsd(p.gain)}
            </div>
          </div>
        );
      })}
    </div>
  );
}
