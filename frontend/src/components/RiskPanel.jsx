import React, { useEffect, useState } from "react";
import { Activity, CloudOff, Loader2 } from "lucide-react";
import { api, ApiError } from "../api/client.js";
import { StatTile } from "./Chrome.jsx";
import { usd0, pct, signedUsd, signedPct } from "../lib/portfolioModel.js";

const CONFIDENCE_OPTIONS = [
  { value: 0.95, label: "95%" },
  { value: 0.99, label: "99%" },
];
const HORIZON_OPTIONS = [
  { value: 1, label: "1 day" },
  { value: 10, label: "10 days" },
];

function Segmented({ options, value, onChange, label, t }) {
  return (
    <div
      role="group"
      aria-label={label}
      className={`flex rounded-lg border p-0.5 transition-colors duration-500 ${t.toggleShell}`}
    >
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          aria-pressed={value === o.value}
          className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${
            value === o.value ? t.toggleActive : t.toggleIdle
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Simulated profit-and-loss distribution; the bars past the VaR line are the tail. */
function Histogram({ histogram, valueAtRisk, t }) {
  const { min, max, counts } = histogram;
  const peak = Math.max(...counts, 1);
  const width = (max - min) / counts.length;
  const W = 400;
  const H = 120;
  const barW = W / counts.length;
  const xFor = (pnl) => (max > min ? ((pnl - min) / (max - min)) * W : 0);
  return (
    <svg viewBox={`0 0 ${W} ${H + 18}`} className="w-full" role="img"
      aria-label="Distribution of simulated profit and loss">
      {counts.map((count, i) => {
        const isTail = min + (i + 1) * width <= -valueAtRisk;
        const h = (count / peak) * H;
        return (
          <rect
            key={i}
            x={i * barW + 0.5}
            y={H - h}
            width={Math.max(barW - 1, 1)}
            height={h}
            rx="1"
            className={`fill-current ${isTail ? t.down : t.faint}`}
          />
        );
      })}
      <line x1={xFor(0)} x2={xFor(0)} y1="0" y2={H} strokeDasharray="2 3"
        className={`stroke-current ${t.muted}`} strokeWidth="1" />
      <text x="0" y={H + 14} className={`fill-current ${t.faint}`} fontSize="10">
        {signedUsd(min)}
      </text>
      <text x={xFor(0)} y={H + 14} textAnchor="middle" className={`fill-current ${t.faint}`} fontSize="10">
        $0
      </text>
      <text x={W} y={H + 14} textAnchor="end" className={`fill-current ${t.faint}`} fontSize="10">
        {signedUsd(max)}
      </text>
    </svg>
  );
}

/**
 * Risk section of the dashboard. All numbers come from the C++ engine via
 * GET /api/risk; this component only formats them. `refreshKey` changes each
 * time the portfolio is saved, which triggers a refetch.
 */
export default function RiskPanel({ t, refreshKey }) {
  const [confidence, setConfidence] = useState(0.95);
  const [horizon, setHorizon] = useState(1);
  const [risk, setRisk] = useState(null);
  const [state, setState] = useState("loading"); // loading | ready | offline | error
  const [message, setMessage] = useState("");

  useEffect(() => {
    let cancelled = false;
    setState((s) => (s === "ready" ? "ready" : "loading"));
    (async () => {
      try {
        const data = await api(`/api/risk?confidence=${confidence}&horizon=${horizon}`);
        if (cancelled) return;
        setRisk(data);
        setState("ready");
      } catch (err) {
        if (cancelled) return;
        setRisk(null);
        setMessage(err.message || "Could not load risk.");
        setState(err instanceof ApiError && err.status === 503 ? "offline" : "error");
      }
    })();
    return () => { cancelled = true; };
  }, [confidence, horizon, refreshKey]);

  const card = `rounded-xl border p-5 transition-colors duration-500 ${t.card}`;
  const tailShare = pct(1 - confidence).replace(".0", "");
  // Bars are scaled to the largest value on show so they use the full track.
  const barScale = risk
    ? Math.max(...risk.positions.flatMap((p) => [p.weight, p.risk_contribution]), 0.0001)
    : 1;
  const period = horizon === 1 ? "one trading day" : `${horizon} trading days`;

  return (
    <div className="mt-6">
      <div className={`mb-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-3 ${t.plaque}`}>
        <div className={`flex items-center gap-2 ${t.heading}`}>
          <Activity className="h-4 w-4" />
          <h2 className="text-sm font-medium">Risk</h2>
          {state === "loading" && <Loader2 className={`h-3.5 w-3.5 animate-spin ${t.faint}`} />}
        </div>
        <div className="flex items-center gap-2">
          <Segmented options={CONFIDENCE_OPTIONS} value={confidence} onChange={setConfidence}
            label="Confidence level" t={t} />
          <Segmented options={HORIZON_OPTIONS} value={horizon} onChange={setHorizon}
            label="Time horizon" t={t} />
        </div>
      </div>

      {(state === "offline" || state === "error") && (
        <div className={`${card} flex items-center gap-3 text-sm ${t.muted}`}>
          <CloudOff className="h-4 w-4 shrink-0" />
          <span>
            {state === "offline"
              ? "The risk engine is offline, so risk figures can't be shown right now. The rest of your dashboard is unaffected."
              : message}
          </span>
        </div>
      )}

      {risk && state !== "offline" && state !== "error" && (
        <div className="mo-fade">
          <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatTile
              label={`Value at risk · ${Math.round(confidence * 100)}%`}
              value={`${usd0.format(risk.var.monte_carlo)} (${pct(risk.var.monte_carlo_pct)})`}
              tone={t.heading}
              t={t}
            />
            <StatTile
              label="Expected shortfall"
              value={`${usd0.format(risk.cvar.monte_carlo)} (${pct(risk.cvar.monte_carlo_pct)})`}
              tone={t.heading}
              t={t}
            />
            <StatTile label="Volatility · annual" value={pct(risk.volatility)} tone={t.heading} t={t} />
            <StatTile label="Beta to market" value={risk.beta.toFixed(2)} tone={t.heading} t={t} />
          </div>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <section className={card}>
              <h3 className={`mb-1 text-sm font-medium ${t.heading}`}>Simulated outcomes</h3>
              <p className={`mb-4 text-xs leading-relaxed ${t.muted}`}>
                {risk.config.simulations.toLocaleString()} simulated results over {period}. The
                shaded bars are the worst {tailShare}: losses beyond the value at risk of{" "}
                {usd0.format(risk.var.monte_carlo)}. Their average, {usd0.format(risk.cvar.monte_carlo)},
                is the expected shortfall.
              </p>
              <Histogram histogram={risk.simulated.histogram} valueAtRisk={risk.var.monte_carlo} t={t} />
              <p className={`mt-3 text-xs ${t.faint}`}>
                Closed-form check: {usd0.format(risk.var.parametric)} value at risk,{" "}
                {usd0.format(risk.cvar.parametric)} expected shortfall.
              </p>
            </section>

            <section className={card}>
              <h3 className={`mb-1 text-sm font-medium ${t.heading}`}>Where the risk comes from</h3>
              <p className={`mb-4 text-xs leading-relaxed ${t.muted}`}>
                Each position's share of the portfolio's risk (solid) against its share of the
                money (outline). A solid bar longer than its outline means the position adds more
                risk than its size suggests.
              </p>
              <div className="space-y-3">
                {[...risk.positions]
                  .sort((a, b) => b.risk_contribution - a.risk_contribution)
                  .map((p) => (
                    <div key={p.ticker} className="flex items-center gap-3">
                      <div className="w-14 shrink-0 font-mono text-sm font-medium">{p.ticker}</div>
                      <div className="relative h-3 flex-1">
                        <div
                          className={`absolute inset-y-0 left-0 rounded-full border ${t.toggleShell}`}
                          style={{ width: `${Math.max(2, (p.weight / barScale) * 100)}%` }}
                        />
                        <div
                          className={`absolute inset-y-[3px] left-0 rounded-full ${t.barFill}`}
                          style={{ width: `${Math.max(2, (p.risk_contribution / barScale) * 100)}%` }}
                        />
                      </div>
                      <div className={`w-28 shrink-0 text-right font-mono text-xs tabular-nums ${t.body}`}>
                        {pct(p.risk_contribution)}
                        <span className={t.faint}> / {pct(p.weight)}</span>
                      </div>
                    </div>
                  ))}
              </div>
            </section>
          </div>

          <section className={`${card} mt-6`}>
            <h3 className={`mb-1 text-sm font-medium ${t.heading}`}>Stress tests</h3>
            <p className={`mb-4 text-xs leading-relaxed ${t.muted}`}>
              What today's portfolio would lose if each episode repeated, from peak to trough.
            </p>
            <div className="space-y-3">
              {risk.scenarios.map((s) => (
                <div key={s.key} className="grid grid-cols-12 items-center gap-x-3 gap-y-1">
                  <div className="col-span-12 sm:col-span-5">
                    <div className={`text-sm ${t.body}`}>{s.name}</div>
                    <div className={`text-xs ${t.faint}`}>{s.description}</div>
                  </div>
                  <div className={`col-span-7 h-1.5 rounded-full sm:col-span-4 ${t.barTrack}`}>
                    <div
                      className={`h-1.5 rounded-full bg-current ${s.pnl < 0 ? t.down : t.up}`}
                      style={{ width: `${Math.min(100, Math.max(2, Math.abs(s.pnl_pct) * 100))}%` }}
                    />
                  </div>
                  <div className={`col-span-5 text-right font-mono text-sm tabular-nums sm:col-span-3 ${s.pnl < 0 ? t.down : t.up}`}>
                    {signedUsd(s.pnl)} <span className="text-xs">({signedPct(s.pnl_pct)})</span>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <p className={`mt-3 rounded-lg border px-4 py-3 text-xs leading-relaxed ${t.note}`}>
            Risk figures come from an illustrative one-factor model with rounded long-run
            assumptions for each ticker, not from live market data.
            {risk.positions.some((p) => p.uses_default_assumption) && (
              <>
                {" "}No specific assumptions exist yet for{" "}
                {risk.positions.filter((p) => p.uses_default_assumption).map((p) => p.ticker).join(", ")}
                , so an average single stock is assumed.
              </>
            )}
          </p>
        </div>
      )}
    </div>
  );
}
