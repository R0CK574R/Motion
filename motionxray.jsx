import React, { useState, useMemo } from "react";
import {
  Aperture,
  Plus,
  X,
  Loader2,
  ScanLine,
  AlertTriangle,
  Eye,
  Info,
} from "lucide-react";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";

// --- Formatters ---
const usd0 = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});
const usd2 = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});
const pct = (n) => `${(n * 100).toFixed(1)}%`;
const signedPct = (n) => `${n >= 0 ? "+" : ""}${(n * 100).toFixed(1)}%`;
const signedUsd = (n) => `${n >= 0 ? "+" : "-"}${usd0.format(Math.abs(n))}`;

// --- Chart palette (SVG fills, not Tailwind classes) ---
const PALETTE = [
  "#4f46e5", "#0ea5e9", "#14b8a6", "#f59e0b",
  "#f43f5e", "#8b5cf6", "#84cc16", "#ec4899",
];
const colorFor = (name, i) =>
  name === "Cash" ? "#94a3b8" : name === "Other" ? "#cbd5e1" : PALETTE[i % PALETTE.length];

// --- Synthetic demo portfolio. Not real holdings, not real prices. ---
// Motion is a portfolio/demo project: all data is fake and entered by hand.
const DEMO_HOLDINGS = [
  { ticker: "AAPL", shares: 30, cost: 150, price: 230 },
  { ticker: "MSFT", shares: 15, cost: 300, price: 440 },
  { ticker: "VOO", shares: 10, cost: 400, price: 540 },
  { ticker: "NVDA", shares: 20, cost: 45, price: 135 },
  { ticker: "TSLA", shares: 12, cost: 340, price: 250 },
];

export default function Motion() {
  const [rows, setRows] = useState(DEMO_HOLDINGS);
  const [cash, setCash] = useState(3000);
  const [running, setRunning] = useState(false);
  const [aiError, setAiError] = useState("");
  const [analysis, setAnalysis] = useState(null);
  const [view, setView] = useState("holdings");

  // --- Derived quantitative model (live) ---
  const model = useMemo(() => {
    const positions = rows
      .filter((r) => r.ticker && Number(r.shares) > 0 && Number(r.price) >= 0)
      .map((r) => {
        const shares = Number(r.shares);
        const price = Number(r.price) || 0;
        const cost = Number(r.cost) || 0;
        const value = shares * price;
        const basis = shares * cost;
        const gain = value - basis;
        return {
          ticker: r.ticker.toUpperCase(),
          shares,
          price,
          cost,
          value,
          basis,
          gain,
          gainPct: basis > 0 ? gain / basis : 0,
        };
      });
    const cashVal = Number(cash) || 0;
    const invested = positions.reduce((s, p) => s + p.value, 0);
    const total = invested + cashVal;
    const basisTotal = positions.reduce((s, p) => s + p.basis, 0);
    const gainTotal = positions.reduce((s, p) => s + p.gain, 0);
    const withWeights = positions
      .map((p) => ({ ...p, weight: total > 0 ? p.value / total : 0 }))
      .sort((a, b) => b.value - a.value);
    const top = withWeights[0];
    const top3 = withWeights.slice(0, 3).reduce((s, p) => s + p.weight, 0);
    return {
      positions: withWeights,
      cashVal,
      total,
      invested,
      basisTotal,
      gainTotal,
      gainPctTotal: basisTotal > 0 ? gainTotal / basisTotal : 0,
      cashPct: total > 0 ? cashVal / total : 0,
      topName: top ? top.ticker : "—",
      topWeight: top ? top.weight : 0,
      top3,
    };
  }, [rows, cash]);

  const hasData = model.positions.length > 0;

  // --- Donut data by view ---
  const donut = useMemo(() => {
    if (!hasData) return [];
    if (view === "holdings") {
      const sorted = [...model.positions];
      const head = sorted.slice(0, 8).map((p) => ({ name: p.ticker, value: p.value }));
      const tail = sorted.slice(8).reduce((s, p) => s + p.value, 0);
      const arr = head;
      if (tail > 0) arr.push({ name: "Other", value: tail });
      if (model.cashVal > 0) arr.push({ name: "Cash", value: model.cashVal });
      return arr;
    }
    if (!analysis) return [];
    const key = view === "sector" ? "sector" : "assetClass";
    const lookup = {};
    (analysis.classifications || []).forEach((c) => {
      lookup[c.ticker.toUpperCase()] = c;
    });
    const buckets = {};
    model.positions.forEach((p) => {
      const label = (lookup[p.ticker] && lookup[p.ticker][key]) || "Unclassified";
      buckets[label] = (buckets[label] || 0) + p.value;
    });
    const arr = Object.entries(buckets)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
    if (model.cashVal > 0) arr.push({ name: "Cash", value: model.cashVal });
    return arr;
  }, [view, model, analysis, hasData]);

  // --- Handlers ---
  const updateRow = (i, field, val) =>
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, [field]: val } : r)));
  const addRow = () => setRows((rs) => [...rs, { ticker: "", shares: "", cost: "", price: "" }]);
  const delRow = (i) => setRows((rs) => rs.filter((_, idx) => idx !== i));

  async function runAnalysis() {
    if (!hasData) return;
    setAiError("");
    setRunning(true);
    try {
      const lines = model.positions
        .map((p) => `${p.ticker}: ${pct(p.weight)} of portfolio, return ${signedPct(p.gainPct)}`)
        .join("\n");
      const signals = `Largest position: ${model.topName} at ${pct(model.topWeight)}. Top 3 positions: ${pct(model.top3)}. Cash: ${pct(model.cashPct)}. Number of holdings: ${model.positions.length}.`;

      const system = `You are a portfolio analytics engine. You classify holdings and describe a portfolio's composition and concentration in plain, educational language.
Hard rule: you NEVER give investment advice and NEVER recommend buying, selling, holding, adding, or trimming any security or asset. You describe, you do not prescribe.
Classify each holding:
- assetClass: one of "US Equity", "International Equity", "Bond", "Real Estate", "Commodity", "Crypto", "Cash", "Other".
- sector: for single stocks use a GICS-style sector (e.g., Technology, Healthcare, Financials, Consumer Discretionary, Energy). For broad index/total-market funds use "Broad Market". For bond/other funds use the closest fit.
Then write:
- observations: 2 to 4 neutral, factual sentences about the portfolio's shape (weightings, tilts, diversification), grounded in the numbers given.
- risks: 2 to 3 plain-language notes on concentration or single-name exposure, phrased as observations of fact (e.g., "One position is X% of the portfolio, so returns depend heavily on it"), never as recommendations.
Respond with ONLY valid JSON, no markdown fences, no preamble:
{"classifications":[{"ticker":string,"assetClass":string,"sector":string}],"observations":[string],"risks":[string]}`;

      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-6",
          max_tokens: 1000,
          system,
          messages: [
            { role: "user", content: `Holdings:\n${lines}\n\n${signals}` },
          ],
        }),
      });
      const json = await res.json();
      const text = (json.content || [])
        .filter((b) => b.type === "text")
        .map((b) => b.text)
        .join("\n");
      const clean = text.replace(/```json/gi, "").replace(/```/g, "").trim();
      const parsed = JSON.parse(clean);
      setAnalysis(parsed);
      setView("sector");
    } catch (e) {
      setAiError("The analysis didn't come back clean. Check your holdings and run it again.");
    } finally {
      setRunning(false);
    }
  }

  const gainColor = model.gainTotal >= 0 ? "text-emerald-400" : "text-rose-400";

  return (
    <div className="min-h-screen bg-gradient-to-b from-neutral-900 to-neutral-950 font-sans text-neutral-200">
      <style>{`
        @keyframes sl-fade { from { opacity:0; transform: translateY(6px);} to { opacity:1; transform:none; } }
        .sl-fade { animation: sl-fade .4s cubic-bezier(.2,.7,.2,1) both; }
        @media (prefers-reduced-motion: reduce){ .sl-fade { animation: none; } }
        input::-webkit-outer-spin-button, input::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
        input::placeholder, textarea::placeholder { color: #525252; }
      `}</style>

      <div className="mx-auto max-w-5xl px-5 py-8 sm:px-8 sm:py-12">
        {/* Header */}
        <header className="mb-8 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-neutral-100 text-neutral-950">
            <Aperture className="h-5 w-5" strokeWidth={2.2} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-semibold tracking-tight">Motion</h1>
              <span className="rounded border border-amber-800 bg-amber-950 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-amber-400">
                Demo · sample data
              </span>
            </div>
            <p className="text-sm text-neutral-400">
              A portfolio analytics concept — running on synthetic data.
            </p>
          </div>
        </header>

        {/* Holdings editor */}
        <section className="mb-6 rounded-xl border border-neutral-800 bg-neutral-900 p-5">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-medium text-neutral-200">Your holdings</h2>
            <span className="text-xs text-neutral-500">
              Sample figures — edit them freely
            </span>
          </div>

          {/* Column labels */}
          <div className="mb-1 hidden grid-cols-12 gap-2 px-1 text-xs font-medium uppercase tracking-wide text-neutral-500 sm:grid">
            <div className="col-span-3">Ticker</div>
            <div className="col-span-2 text-right">Shares</div>
            <div className="col-span-2 text-right">Avg cost</div>
            <div className="col-span-2 text-right">Price now</div>
            <div className="col-span-2 text-right">Value</div>
            <div className="col-span-1" />
          </div>

          <div className="space-y-2">
            {rows.map((r, i) => {
              const val = (Number(r.shares) || 0) * (Number(r.price) || 0);
              return (
                <div key={i} className="grid grid-cols-12 items-center gap-2">
                  <input
                    value={r.ticker}
                    onChange={(e) => updateRow(i, "ticker", e.target.value)}
                    placeholder="AAPL"
                    className="col-span-6 rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 font-mono text-sm uppercase text-neutral-100 focus:border-neutral-600 focus:outline-none focus:ring-2 focus:ring-neutral-700 sm:col-span-3"
                  />
                  <input
                    type="number"
                    value={r.shares}
                    onChange={(e) => updateRow(i, "shares", e.target.value)}
                    placeholder="0"
                    className="col-span-3 rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-right font-mono text-sm tabular-nums focus:border-neutral-600 focus:outline-none focus:ring-2 focus:ring-neutral-700 sm:col-span-2"
                  />
                  <input
                    type="number"
                    value={r.cost}
                    onChange={(e) => updateRow(i, "cost", e.target.value)}
                    placeholder="0"
                    className="col-span-3 rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-right font-mono text-sm tabular-nums focus:border-neutral-600 focus:outline-none focus:ring-2 focus:ring-neutral-700 sm:col-span-2"
                  />
                  <input
                    type="number"
                    value={r.price}
                    onChange={(e) => updateRow(i, "price", e.target.value)}
                    placeholder="0"
                    className="col-span-3 rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-right font-mono text-sm tabular-nums focus:border-neutral-600 focus:outline-none focus:ring-2 focus:ring-neutral-700 sm:col-span-2"
                  />
                  <div className="col-span-2 hidden text-right font-mono text-sm tabular-nums text-neutral-300 sm:block">
                    {usd0.format(val)}
                  </div>
                  <button
                    onClick={() => delRow(i)}
                    className="col-span-3 flex justify-end text-neutral-600 transition hover:text-rose-400 sm:col-span-1"
                    aria-label="Remove holding"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              );
            })}
          </div>

          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <button
              onClick={addRow}
              className="flex items-center gap-1.5 rounded-lg border border-neutral-800 px-3 py-2 text-sm text-neutral-300 transition hover:bg-neutral-800 hover:text-neutral-100"
            >
              <Plus className="h-4 w-4" /> Add holding
            </button>
            <div className="flex items-center gap-2">
              <span className="text-sm text-neutral-400">Cash</span>
              <div className="flex items-center rounded-lg border border-neutral-800 bg-neutral-950 px-3">
                <span className="font-mono text-sm text-neutral-500">$</span>
                <input
                  type="number"
                  value={cash}
                  onChange={(e) => setCash(e.target.value)}
                  className="w-28 bg-transparent py-2 text-right font-mono text-sm tabular-nums focus:outline-none"
                />
              </div>
            </div>
          </div>
        </section>

        {!hasData ? (
          <div className="rounded-xl border border-dashed border-neutral-700 bg-neutral-900 p-10 text-center text-neutral-500">
            Add at least one holding to see your breakdown.
          </div>
        ) : (
          <>
            {/* Stat tiles */}
            <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
              {[
                { label: "Total value", value: usd0.format(model.total), tone: "text-neutral-100" },
                { label: "Total return", value: `${signedUsd(model.gainTotal)} (${signedPct(model.gainPctTotal)})`, tone: gainColor },
                { label: "Positions", value: String(model.positions.length), tone: "text-neutral-100" },
                { label: "Largest holding", value: `${model.topName} · ${pct(model.topWeight)}`, tone: "text-neutral-100" },
              ].map((t) => (
                <div key={t.label} className="rounded-xl border border-neutral-800 bg-neutral-900 p-4">
                  <div className="text-xs uppercase tracking-wide text-neutral-500">{t.label}</div>
                  <div className={`mt-1 font-mono text-lg font-semibold tabular-nums ${t.tone}`}>
                    {t.value}
                  </div>
                </div>
              ))}
            </div>

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              {/* Allocation donut */}
              <section className="rounded-xl border border-neutral-800 bg-neutral-900 p-5">
                <div className="mb-4 flex items-center justify-between">
                  <h2 className="text-sm font-medium text-neutral-200">Allocation</h2>
                  <div className="flex rounded-lg border border-neutral-800 p-0.5">
                    {[
                      { k: "holdings", label: "Holdings" },
                      { k: "sector", label: "Sectors" },
                      { k: "assetClass", label: "Assets" },
                    ].map((opt) => {
                      const locked = opt.k !== "holdings" && !analysis;
                      return (
                        <button
                          key={opt.k}
                          disabled={locked}
                          onClick={() => setView(opt.k)}
                          className={`rounded-md px-2.5 py-1 text-xs transition ${
                            view === opt.k
                              ? "bg-neutral-100 text-neutral-950"
                              : locked
                              ? "text-neutral-600"
                              : "text-neutral-400 hover:text-neutral-100"
                          }`}
                        >
                          {opt.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {donut.length === 0 ? (
                  <div className="flex h-64 items-center justify-center text-center text-sm text-neutral-500">
                    Run the X-ray to break this down by sector.
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-4 sm:flex-row">
                    <div className="relative h-52 w-52 shrink-0">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie
                            data={donut}
                            dataKey="value"
                            nameKey="name"
                            innerRadius={62}
                            outerRadius={92}
                            paddingAngle={1.5}
                            stroke="#171717"
                          >
                            {donut.map((d, i) => (
                              <Cell key={d.name} fill={colorFor(d.name, i)} />
                            ))}
                          </Pie>
                          <Tooltip
                            formatter={(v) => usd0.format(v)}
                            itemStyle={{ color: "#e5e5e5" }}
                            contentStyle={{
                              borderRadius: 8,
                              border: "1px solid #262626", backgroundColor: "#171717", color: "#e5e5e5",
                              fontSize: 12,
                              fontFamily: "monospace",
                            }}
                          />
                        </PieChart>
                      </ResponsiveContainer>
                      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                        <span className="font-mono text-lg font-semibold tabular-nums">
                          {usd0.format(model.total)}
                        </span>
                        <span className="text-xs text-neutral-500">total</span>
                      </div>
                    </div>
                    <div className="w-full space-y-1.5">
                      {donut.map((d, i) => (
                        <div key={d.name} className="flex items-center gap-2 text-sm">
                          <span
                            className="h-2.5 w-2.5 shrink-0 rounded-sm"
                            style={{ backgroundColor: colorFor(d.name, i) }}
                          />
                          <span className="flex-1 truncate text-neutral-200">{d.name}</span>
                          <span className="font-mono tabular-nums text-neutral-400">
                            {pct(d.value / model.total)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </section>

              {/* Positions table */}
              <section className="rounded-xl border border-neutral-800 bg-neutral-900 p-5">
                <h2 className="mb-4 text-sm font-medium text-neutral-200">Positions</h2>
                <div className="space-y-3">
                  {model.positions.map((p) => (
                    <div key={p.ticker} className="flex items-center gap-3">
                      <div className="w-14 shrink-0 font-mono text-sm font-medium">{p.ticker}</div>
                      <div className="flex-1">
                        <div className="mb-1 flex justify-between text-xs">
                          <span className="text-neutral-500">{pct(p.weight)}</span>
                          <span
                            className={`font-mono tabular-nums ${
                              p.gain >= 0 ? "text-emerald-400" : "text-rose-400"
                            }`}
                          >
                            {signedPct(p.gainPct)}
                          </span>
                        </div>
                        <div className="h-1.5 w-full rounded-full bg-neutral-800">
                          <div
                            className="h-1.5 rounded-full bg-neutral-100"
                            style={{ width: `${Math.max(2, p.weight * 100)}%` }}
                          />
                        </div>
                      </div>
                      <div className="w-20 shrink-0 text-right font-mono text-sm tabular-nums text-neutral-300">
                        {usd0.format(p.value)}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            </div>

            {/* Run analysis */}
            <div className="mt-6">
              {!analysis && (
                <button
                  onClick={runAnalysis}
                  disabled={running}
                  className="flex w-full items-center justify-center gap-2 rounded-xl bg-neutral-100 py-3.5 font-medium text-neutral-950 transition hover:bg-white disabled:opacity-60"
                >
                  {running ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" /> Running the X-ray…
                    </>
                  ) : (
                    <>
                      <ScanLine className="h-4 w-4" /> Run the X-ray
                    </>
                  )}
                </button>
              )}

              {aiError && (
                <div className="mt-3 flex items-start gap-2 rounded-lg border border-rose-900 bg-neutral-900 px-3 py-2 text-sm text-rose-300">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{aiError}</span>
                </div>
              )}

              {analysis && (
                <div className="sl-fade grid grid-cols-1 gap-6 lg:grid-cols-2">
                  <section className="rounded-xl border border-neutral-800 bg-neutral-900 p-5">
                    <div className="mb-3 flex items-center gap-2 text-neutral-200">
                      <Eye className="h-4 w-4" />
                      <h2 className="text-sm font-medium">What stands out</h2>
                    </div>
                    <ul className="space-y-2.5">
                      {(analysis.observations || []).map((o, i) => (
                        <li key={i} className="flex gap-2 text-sm leading-relaxed text-neutral-200">
                          <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-neutral-400" />
                          <span>{o}</span>
                        </li>
                      ))}
                    </ul>
                  </section>
                  <section className="rounded-xl border border-amber-900 bg-neutral-900 p-5">
                    <div className="mb-3 flex items-center gap-2 text-amber-400">
                      <AlertTriangle className="h-4 w-4" />
                      <h2 className="text-sm font-medium">Concentration &amp; risk</h2>
                    </div>
                    <ul className="space-y-2.5">
                      {(analysis.risks || []).map((r, i) => (
                        <li key={i} className="flex gap-2 text-sm leading-relaxed text-amber-100">
                          <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-amber-500" />
                          <span>{r}</span>
                        </li>
                      ))}
                    </ul>
                  </section>
                </div>
              )}
            </div>
          </>
        )}

        {/* Disclaimer */}
        <div className="mt-8 flex items-start gap-2 rounded-lg border border-neutral-800 bg-neutral-900 px-4 py-3 text-xs leading-relaxed text-neutral-500">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            Motion is a demonstration project. Every number here is synthetic sample data — there are
            no live prices, no brokerage connections, and no real holdings. It is not investment
            advice and describes composition only; it never tells you what to buy, sell, or hold.
            Classifications are AI-generated and may contain errors.
          </span>
        </div>
      </div>
    </div>
  );
}