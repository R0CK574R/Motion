import React, { useState, useMemo, useEffect, useCallback } from "react";
import {
  Aperture,
  Loader2,
  ScanLine,
  AlertTriangle,
  Eye,
  Info,
  LogOut,
  Lock,
  CreditCard,
} from "lucide-react";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";
import { api, ApiError } from "../api/client.js";
import { useAuth } from "../auth/AuthContext.jsx";
import { ThemeToggle, StatTile } from "./Chrome.jsx";
import { PageShell } from "./Backdrop.jsx";
import RiskPanel from "./RiskPanel.jsx";
import LedgerPanel from "./LedgerPanel.jsx";
import AskPanel from "./AskPanel.jsx";
import {
  usd0,
  pct,
  signedPct,
  signedUsd,
  computePortfolio,
  normalizeHolding,
} from "../lib/portfolioModel.js";

const PALETTE = [
  "#4f46e5", "#0ea5e9", "#14b8a6", "#f59e0b",
  "#f43f5e", "#8b5cf6", "#84cc16", "#ec4899",
];
const colorFor = (name, i, chart) =>
  name === "Cash" ? chart.cash : name === "Other" ? chart.other : PALETTE[i % PALETTE.length];

export default function Dashboard({ theme }) {
  const { mode, setMode, resolved, t } = theme;
  const { user, logout, isSubscribed, isDemo } = useAuth();

  const [rows, setRows] = useState([]);
  const [cash, setCash] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  const [analysis, setAnalysis] = useState(null);
  const [running, setRunning] = useState(false);
  const [aiError, setAiError] = useState("");
  const [needsSubscription, setNeedsSubscription] = useState(false);
  const [billingBusy, setBillingBusy] = useState(false);

  const [view, setView] = useState("holdings");
  // Bumped after every reload so the risk and activity sections refetch.
  const [riskKey, setRiskKey] = useState(0);

  /* ---------------- Load ---------------- */
  // Cash and holdings are derived from the ledger on the server, so after any
  // transaction the dashboard simply asks for them again.
  const reload = useCallback(async () => {
    try {
      const data = await api("/api/portfolio");
      setRows((data.holdings || []).map(normalizeHolding));
      setCash(Number(data.cash) || 0);
      setLoadError("");
      setRiskKey((k) => k + 1);
    } catch (err) {
      setLoadError(err.message || "Could not load your portfolio.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { reload(); }, [reload]);

  /* ---------------- Derived ---------------- */
  const model = useMemo(() => computePortfolio(rows, cash), [rows, cash]);
  const hasData = model.positions.length > 0;

  const donut = useMemo(() => {
    if (!hasData) return [];

    if (view === "holdings") {
      const sorted = [...model.positions];
      const slices = sorted.slice(0, 8).map((p) => ({ name: p.ticker, value: p.value }));
      const tail = sorted.slice(8).reduce((s, p) => s + p.value, 0);
      if (tail > 0) slices.push({ name: "Other", value: tail });
      if (model.cashVal > 0) slices.push({ name: "Cash", value: model.cashVal });
      return slices;
    }

    if (!analysis) return [];

    const key = view === "sector" ? "sector" : "assetClass";
    const lookup = {};
    (analysis.classifications || []).forEach((c) => {
      lookup[c.ticker.toUpperCase()] = c;
    });

    const buckets = {};
    model.positions.forEach((p) => {
      const label = lookup[p.ticker]?.[key] || "Unclassified";
      buckets[label] = (buckets[label] || 0) + p.value;
    });

    const slices = Object.entries(buckets)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
    if (model.cashVal > 0) slices.push({ name: "Cash", value: model.cashVal });
    return slices;
  }, [view, model, analysis, hasData]);

  /* ---------------- Analysis ---------------- */
  async function runAnalysis() {
    if (!hasData) return;
    setAiError("");
    setNeedsSubscription(false);
    setRunning(true);
    try {
      const parsed = await api("/api/analysis", { method: "POST" });
      setAnalysis(parsed);
      setView("sector");
    } catch (err) {
      if (err instanceof ApiError && err.status === 402) {
        setNeedsSubscription(true);
      } else {
        setAiError(err.message || "The analysis didn't come back. Try again.");
      }
    } finally {
      setRunning(false);
    }
  }

  /* ---------------- Billing ---------------- */
  async function startCheckout() {
    setBillingBusy(true);
    try {
      const { url } = await api("/api/billing/create-checkout-session", { method: "POST" });
      window.location.href = url;
    } catch (err) {
      setAiError(err.message || "Could not start checkout.");
      setBillingBusy(false);
    }
  }

  async function openBillingPortal() {
    setBillingBusy(true);
    try {
      const { url } = await api("/api/billing/create-portal-session", { method: "POST" });
      window.location.href = url;
    } catch (err) {
      setAiError(err.message || "Could not open the billing portal.");
      setBillingBusy(false);
    }
  }

  /* ---------------- Render ---------------- */
  const gainTone = model.gainTotal >= 0 ? t.up : t.down;
  if (loading) {
    return (
      <PageShell t={t} className="flex items-center justify-center">
        <Loader2 className={`h-6 w-6 animate-spin ${t.muted}`} />
      </PageShell>
    );
  }

  return (
    <PageShell t={t}>
      <style>{`
        @keyframes mo-fade { from { opacity:0; transform: translateY(6px);} to { opacity:1; transform:none; } }
        .mo-fade { animation: mo-fade .4s cubic-bezier(.2,.7,.2,1) both; }
        @media (prefers-reduced-motion: reduce){ .mo-fade { animation: none; } }
        input::-webkit-outer-spin-button, input::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
        input::placeholder { color: ${t.placeholder}; }
      `}</style>

      <div className="mx-auto max-w-5xl px-5 py-8 sm:px-8 sm:py-12">
        {/* Header */}
        <header className={`mb-8 flex items-center justify-between gap-4 rounded-xl border px-4 py-3 transition-colors duration-500 ${t.plaque}`}>
          <div className="flex items-center gap-3">
            <div
              className={`flex h-10 w-10 items-center justify-center rounded-lg transition-colors duration-500 ${t.logo}`}
            >
              <Aperture className="h-5 w-5" strokeWidth={2.2} />
            </div>
            <div>
              <h1 className="text-xl font-semibold tracking-tight">Motion</h1>
              <p className={`text-sm ${t.plaqueMuted}`}>{isDemo ? "Demo session" : user?.email}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {isSubscribed && !isDemo && (
              <button
                onClick={openBillingPortal}
                disabled={billingBusy}
                title="Manage billing"
                aria-label="Manage billing"
                className={`rounded-lg border p-2 transition ${t.ghostBtn}`}
              >
                <CreditCard className="h-3.5 w-3.5" />
              </button>
            )}
            <ThemeToggle mode={mode} setMode={setMode} resolved={resolved} t={t} />
            <button
              onClick={logout}
              title={isDemo ? "Exit demo" : "Sign out"}
              aria-label={isDemo ? "Exit demo" : "Sign out"}
              className={`rounded-lg border p-2 transition ${t.ghostBtn}`}
            >
              <LogOut className="h-3.5 w-3.5" />
            </button>
          </div>
        </header>

        {isDemo && (
          <div className={`mb-6 flex flex-wrap items-center justify-between gap-3 rounded-lg border px-4 py-3 transition-colors duration-500 ${t.demoBadge}`}>
            <span className="text-sm">
              You're viewing a demo portfolio. Record any trades you like — it won't affect
              anyone else, and it's cleared automatically.
            </span>
            <button
              onClick={logout}
              className="shrink-0 text-sm font-medium underline underline-offset-2"
            >
              Create your own account
            </button>
          </div>
        )}

        {loadError && (
          <div className={`mb-6 flex items-start gap-2 rounded-lg border px-3 py-2 text-sm ${t.errorBox}`}>
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{loadError}</span>
          </div>
        )}

        <LedgerPanel t={t} rows={rows} cash={cash} refreshKey={riskKey} onChanged={reload} />

        {!hasData ? (
          <div
            className={`rounded-xl border border-dashed p-10 text-center transition-colors duration-500 ${t.cardDashed} ${t.muted}`}
          >
            Record a deposit and a buy above to see your breakdown.
          </div>
        ) : (
          <>
            <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
              <StatTile label="Total value" value={usd0.format(model.total)} tone={t.heading} t={t} />
              <StatTile
                label="Total return"
                value={`${signedUsd(model.gainTotal)} (${signedPct(model.gainPctTotal)})`}
                tone={gainTone}
                t={t}
              />
              <StatTile label="Positions" value={String(model.positions.length)} tone={t.heading} t={t} />
              <StatTile
                label="Largest holding"
                value={`${model.topName} · ${pct(model.topWeight)}`}
                tone={t.heading}
                t={t}
              />
            </div>

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              {/* Allocation */}
              <section className={`rounded-xl border p-5 transition-colors duration-500 ${t.card}`}>
                <div className="mb-4 flex items-center justify-between">
                  <h2 className={`text-sm font-medium ${t.heading}`}>Allocation</h2>
                  <div className={`flex rounded-lg border p-0.5 ${t.toggleShell}`}>
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
                            view === opt.k ? t.toggleActive : locked ? t.toggleLocked : t.toggleIdle
                          }`}
                        >
                          {opt.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {donut.length === 0 ? (
                  <div className={`flex h-64 items-center justify-center text-center text-sm ${t.faint}`}>
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
                            stroke={t.chart.stroke}
                          >
                            {donut.map((d, i) => (
                              <Cell key={d.name} fill={colorFor(d.name, i, t.chart)} />
                            ))}
                          </Pie>
                          <Tooltip
                            formatter={(v) => usd0.format(v)}
                            itemStyle={{ color: t.chart.tooltipText }}
                            contentStyle={{
                              borderRadius: 8,
                              border: `1px solid ${t.chart.tooltipBorder}`,
                              backgroundColor: t.chart.tooltipBg,
                              color: t.chart.tooltipText,
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
                        <span className={`text-xs ${t.faint}`}>total</span>
                      </div>
                    </div>
                    <div className="w-full space-y-1.5">
                      {donut.map((d, i) => (
                        <div key={d.name} className="flex items-center gap-2 text-sm">
                          <span
                            className="h-2.5 w-2.5 shrink-0 rounded-sm"
                            style={{ backgroundColor: colorFor(d.name, i, t.chart) }}
                          />
                          <span className={`flex-1 truncate ${t.body}`}>{d.name}</span>
                          <span className={`font-mono tabular-nums ${t.muted}`}>
                            {pct(d.value / model.total)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </section>

              {/* Positions */}
              <section className={`rounded-xl border p-5 transition-colors duration-500 ${t.card}`}>
                <h2 className={`mb-4 text-sm font-medium ${t.heading}`}>Positions</h2>
                <div className="space-y-3">
                  {model.positions.map((p) => (
                    <div key={p.id} className="flex items-center gap-3">
                      <div className="w-14 shrink-0 font-mono text-sm font-medium">{p.ticker}</div>
                      <div className="flex-1">
                        <div className="mb-1 flex justify-between text-xs">
                          <span className={t.faint}>{pct(p.weight)}</span>
                          <span className={`font-mono tabular-nums ${p.gain >= 0 ? t.up : t.down}`}>
                            {signedPct(p.gainPct)}
                          </span>
                        </div>
                        <div className={`h-1.5 w-full rounded-full ${t.barTrack}`}>
                          <div
                            className={`h-1.5 rounded-full ${t.barFill}`}
                            style={{ width: `${Math.max(2, p.weight * 100)}%` }}
                          />
                        </div>
                      </div>
                      <div className={`w-20 shrink-0 text-right font-mono text-sm tabular-nums ${t.body}`}>
                        {usd0.format(p.value)}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            </div>

            <RiskPanel t={t} refreshKey={riskKey} />

            <AskPanel t={t} />

            {/* Analysis */}
            <div className="mt-6">
              {needsSubscription ? (
                <div className={`rounded-xl border p-6 text-center transition-colors duration-500 ${t.card}`}>
                  <Lock className={`mx-auto mb-3 h-6 w-6 ${t.muted}`} />
                  <h3 className={`mb-1 text-base font-medium ${t.heading}`}>
                    The X-ray is a paid feature
                  </h3>
                  <p className={`mx-auto mb-4 max-w-sm text-sm ${t.muted}`}>
                    Subscribe to classify your holdings by sector and asset class, and get a
                    written read on your concentration.
                  </p>
                  <button
                    onClick={startCheckout}
                    disabled={billingBusy}
                    className={`inline-flex items-center justify-center gap-2 rounded-lg px-5 py-2.5 text-sm font-medium transition disabled:opacity-60 ${t.primaryBtn}`}
                  >
                    {billingBusy && <Loader2 className="h-4 w-4 animate-spin" />}
                    Subscribe
                  </button>
                </div>
              ) : (
                !analysis && (
                  <button
                    onClick={runAnalysis}
                    disabled={running}
                    className={`flex w-full items-center justify-center gap-2 rounded-xl py-3.5 font-medium transition disabled:opacity-60 ${t.primaryBtn}`}
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
                )
              )}

              {aiError && (
                <div className={`mt-3 flex items-start gap-2 rounded-lg border px-3 py-2 text-sm ${t.errorBox}`}>
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{aiError}</span>
                </div>
              )}

              {analysis && (
                <div className="mo-fade grid grid-cols-1 gap-6 lg:grid-cols-2">
                  <section className={`rounded-xl border p-5 transition-colors duration-500 ${t.card}`}>
                    <div className={`mb-3 flex items-center gap-2 ${t.heading}`}>
                      <Eye className="h-4 w-4" />
                      <h2 className="text-sm font-medium">What stands out</h2>
                    </div>
                    <ul className="space-y-2.5">
                      {(analysis.observations || []).map((o, i) => (
                        <li key={i} className={`flex gap-2 text-sm leading-relaxed ${t.body}`}>
                          <span className={`mt-2 h-1 w-1 shrink-0 rounded-full ${t.bullet}`} />
                          <span>{o}</span>
                        </li>
                      ))}
                    </ul>
                  </section>

                  <section className={`rounded-xl border p-5 transition-colors duration-500 ${t.riskCard}`}>
                    <div className={`mb-3 flex items-center gap-2 ${t.riskHead}`}>
                      <AlertTriangle className="h-4 w-4" />
                      <h2 className="text-sm font-medium">Concentration &amp; risk</h2>
                    </div>
                    <ul className="space-y-2.5">
                      {(analysis.risks || []).map((r, i) => (
                        <li key={i} className={`flex gap-2 text-sm leading-relaxed ${t.riskText}`}>
                          <span className={`mt-2 h-1 w-1 shrink-0 rounded-full ${t.riskDot}`} />
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
        <div
          className={`mt-8 flex items-start gap-2 rounded-lg border px-4 py-3 text-xs leading-relaxed transition-colors duration-500 ${t.note}`}
        >
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            Motion is an analytics tool, not investment advice. It describes what your portfolio is
            made of — it never tells you what to buy, sell, or hold. Prices are the last trade or the ones you
            enter, not live market data. Classifications are AI-generated and may contain errors.
          </span>
        </div>
      </div>
    </PageShell>
  );
}
