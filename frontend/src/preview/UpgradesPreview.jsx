import React, { useMemo, useState } from "react";
import { Shuffle, ScanLine, Loader2 } from "lucide-react";
import { useAdaptiveTheme } from "../theme.js";
import { ThemeToggle } from "../components/Chrome.jsx";
import { usd0, pct, signedPct, signedUsd, computePortfolio } from "../lib/portfolioModel.js";
import {
  StatTilePro,
  InteractiveDonut,
  HoldingsTreemap,
  ConcentrationGauge,
  PnLContribution,
  DashboardSkeleton,
  XrayScan,
} from "../components/upgrades/index.js";

/**
 * Standalone gallery for the graphics upgrades — mock data, no backend.
 * Run `npm run dev` and open http://localhost:5173/preview.html
 */
const MOCK = [
  { id: 1, ticker: "AAPL", shares: 40, cost: 142, price: 228 },
  { id: 2, ticker: "MSFT", shares: 18, cost: 310, price: 436 },
  { id: 3, ticker: "NVDA", shares: 30, cost: 48, price: 131 },
  { id: 4, ticker: "VTI", shares: 25, cost: 220, price: 284 },
  { id: 5, ticker: "INTC", shares: 120, cost: 44, price: 23 },
  { id: 6, ticker: "JPM", shares: 15, cost: 168, price: 212 },
  { id: 7, ticker: "TLT", shares: 30, cost: 104, price: 92 },
  { id: 8, ticker: "XOM", shares: 20, cost: 112, price: 118 },
  { id: 9, ticker: "PYPL", shares: 35, cost: 92, price: 71 },
];

const PALETTE = ["#4f46e5", "#0ea5e9", "#14b8a6", "#f59e0b", "#f43f5e", "#8b5cf6", "#84cc16", "#ec4899"];

// Fake 30-point history so the sparklines have something to draw.
const fakeSeries = (end, vol, seed) => {
  let x = end * (1 - vol * 2);
  return Array.from({ length: 30 }, (_, i) => {
    x += (Math.sin(i * 1.7 + seed) + 0.35) * vol * end * 0.1;
    return i === 29 ? end : x;
  });
};

function Card({ title, note, t, children }) {
  return (
    <section className={`h-full rounded-xl border p-5 transition-colors duration-500 ${t.card}`}>
      <div className="mb-4">
        <h2 className={`text-sm font-medium ${t.heading}`}>{title}</h2>
        {note && <p className={`mt-0.5 text-xs ${t.faint}`}>{note}</p>}
      </div>
      {children}
    </section>
  );
}

export default function UpgradesPreview() {
  const theme = useAdaptiveTheme();
  const { t, resolved } = theme;
  const dark = resolved === "dark";

  const [rows, setRows] = useState(MOCK);
  const [scanning, setScanning] = useState(false);
  const [showSkeleton, setShowSkeleton] = useState(false);

  const model = useMemo(() => computePortfolio(rows, 4200), [rows]);

  const donut = useMemo(() => {
    const slices = model.positions.slice(0, 8).map((p) => ({ name: p.ticker, value: p.value }));
    const tail = model.positions.slice(8).reduce((s, p) => s + p.value, 0);
    if (tail > 0) slices.push({ name: "Other", value: tail });
    slices.push({ name: "Cash", value: model.cashVal });
    return slices;
  }, [model]);

  const colorFor = (name, i) =>
    name === "Cash" ? t.chart.cash : name === "Other" ? t.chart.other : PALETTE[i % PALETTE.length];

  const jiggle = () =>
    setRows((rs) =>
      rs.map((r) => ({ ...r, price: +(r.price * (0.85 + Math.random() * 0.3)).toFixed(2) }))
    );

  const scan = () => {
    setScanning(true);
    setTimeout(() => setScanning(false), 3600);
  };

  const btn = `flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs transition ${t.ghostBtn}`;

  return (
    <div className={`min-h-screen font-sans transition-colors duration-500 ${t.page}`}>
      <div className="mx-auto max-w-5xl px-5 py-8 sm:px-8 sm:py-12">
        <header className="mb-8 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Graphics upgrades</h1>
            <p className={`text-sm ${t.muted}`}>Mock portfolio · src/components/upgrades</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button className={btn} onClick={jiggle}><Shuffle className="h-3.5 w-3.5" /> Move prices</button>
            <button className={btn} onClick={scan} disabled={scanning}>
              {scanning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ScanLine className="h-3.5 w-3.5" />} X-ray scan
            </button>
            <button className={btn} onClick={() => setShowSkeleton((s) => !s)}>
              {showSkeleton ? "Hide" : "Show"} skeleton
            </button>
            <ThemeToggle {...theme} />
          </div>
        </header>

        {showSkeleton ? (
          <DashboardSkeleton t={t} dark={dark} />
        ) : (
          <div className="space-y-6">
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              <StatTilePro t={t} label="Total value" value={model.total} format={usd0.format}
                tone={t.heading} accent="#6366f1" spark={fakeSeries(model.total, 0.08, 1)} />
              <StatTilePro t={t} label="Total return" value={model.gainTotal} format={signedUsd}
                tone={model.gainTotal >= 0 ? t.up : t.down} delta={model.gainPctTotal}
                accent={model.gainTotal >= 0 ? "#10b981" : "#f43f5e"}
                spark={fakeSeries(Math.max(1, model.gainTotal), 0.2, 2)} />
              <StatTilePro t={t} label="Positions" value={model.positions.length}
                format={(v) => String(Math.round(v))} tone={t.heading} accent="#0ea5e9" />
              <StatTilePro t={t} label="Largest holding" value={`${model.topName} · ${pct(model.topWeight)}`}
                tone={t.heading} accent="#f59e0b" />
            </div>

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              <XrayScan active={scanning}>
                <Card t={t} title="Allocation — interactive donut" note="Hover a slice or a legend row">
                  <InteractiveDonut data={donut} total={model.total} colorFor={colorFor}
                    format={usd0.format} pct={pct} t={t} />
                </Card>
              </XrayScan>
              <XrayScan active={scanning}>
                <Card t={t} title="Concentration gauge" note="Herfindahl index over invested weights">
                  <ConcentrationGauge positions={model.positions} t={t} />
                </Card>
              </XrayScan>
            </div>

            <Card t={t} title="Holdings heatmap" note="Area = value · color = return on cost">
              <HoldingsTreemap positions={model.positions} dark={dark} format={usd0.format}
                signedPct={signedPct} t={t} />
            </Card>

            <Card t={t} title="P&L contribution" note="Dollar gain/loss per position">
              <PnLContribution positions={model.positions} signedUsd={signedUsd} t={t} />
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}
