import React, { useState, useMemo, useEffect, useRef, useCallback } from "react";
import {
  Aperture,
  Plus,
  X,
  Loader2,
  ScanLine,
  AlertTriangle,
  Eye,
  Info,
  LogOut,
  Check,
  CloudOff,
  Lock,
  CreditCard,
} from "lucide-react";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";
import { api, ApiError } from "../api/client.js";
import { useAuth } from "../auth/AuthContext.jsx";
import { ThemeToggle, StatTile } from "./Chrome.jsx";
import {
  usd0,
  pct,
  signedPct,
  signedUsd,
  computePortfolio,
  normalizeHolding,
  isSavableRow,
} from "../lib/portfolioModel.js";

const PALETTE = [
  "#4f46e5", "#0ea5e9", "#14b8a6", "#f59e0b",
  "#f43f5e", "#8b5cf6", "#84cc16", "#ec4899",
];
const colorFor = (name, i, chart) =>
  name === "Cash" ? chart.cash : name === "Other" ? chart.other : PALETTE[i % PALETTE.length];

const SAVE_DEBOUNCE_MS = 800;

export default function Dashboard({ theme }) {
  const { mode, setMode, resolved, t } = theme;
  const { user, logout, isSubscribed, refreshAccount } = useAuth();

  const [rows, setRows] = useState([]);
  const [cash, setCash] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [saveState, setSaveState] = useState("idle"); // idle | saving | saved | error

  const [analysis, setAnalysis] = useState(null);
  const [running, setRunning] = useState(false);
  const [aiError, setAiError] = useState("");
  const [needsSubscription, setNeedsSubscription] = useState(false);
  const [billingBusy, setBillingBusy] = useState(false);

  const [view, setView] = useState("holdings");

  // Refs let the debounced flush read current values without stale closures.
  const rowsRef = useRef(rows);
  const cashRef = useRef(cash);
  const dirtyRef = useRef({ rows: new Set(), cash: false });
  const timerRef = useRef(null);
  useEffect(() => { rowsRef.current = rows; }, [rows]);
  useEffect(() => { cashRef.current = cash; }, [cash]);

  /* ---------------- Load ---------------- */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await api("/api/portfolio");
        if (cancelled) return;
        setRows((data.holdings || []).map(normalizeHolding));
        setCash(Number(data.cash) || 0);
      } catch (err) {
        if (!cancelled) setLoadError(err.message || "Could not load your portfolio.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  /* ---------------- Persist ---------------- */
  const flush = useCallback(async () => {
    const pendingRows = [...dirtyRef.current.rows];
    const pendingCash = dirtyRef.current.cash;
    dirtyRef.current = { rows: new Set(), cash: false };

    if (!pendingRows.length && !pendingCash) return;

    try {
      if (pendingCash) {
        await api("/api/portfolio", {
          method: "PUT",
          body: JSON.stringify({ cash: Number(cashRef.current) || 0 }),
        });
      }

      for (const rowId of pendingRows) {
        const row = rowsRef.current.find((r) => r.id === rowId);
        if (!row) continue;              // deleted while the timer was pending
        if (!isSavableRow(row)) continue; // half-typed draft; wait for more input

        const payload = {
          ticker: row.ticker.trim().toUpperCase(),
          shares: Number(row.shares),
          cost: Number(row.cost) || 0,
          price: Number(row.price) || 0,
        };

        if (row.isDraft) {
          const created = await api("/api/portfolio/holdings", {
            method: "POST",
            body: JSON.stringify(payload),
          });
          // Swap the temporary local id for the real database id.
          setRows((rs) =>
            rs.map((r) => (r.id === rowId ? { ...normalizeHolding(created) } : r))
          );
        } else {
          await api(`/api/portfolio/holdings/${row.id}`, {
            method: "PUT",
            body: JSON.stringify(payload),
          });
        }
      }
      setSaveState("saved");
    } catch (err) {
      console.error("Save failed", err);
      setSaveState("error");
    }
  }, []);

  const scheduleSave = useCallback(() => {
    setSaveState("saving");
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(flush, SAVE_DEBOUNCE_MS);
  }, [flush]);

  // Flush anything pending on unmount so edits aren't lost on navigation.
  useEffect(() => () => clearTimeout(timerRef.current), []);

  /* ---------------- Mutations ---------------- */
  const updateRow = (id, field, val) => {
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, [field]: val } : r)));
    dirtyRef.current.rows.add(id);
    scheduleSave();
  };

  const addRow = () => {
    // Local-only until it has a ticker and shares — avoids junk rows in the DB.
    const draft = {
      id: `draft-${Date.now()}`,
      ticker: "",
      shares: "",
      cost: "",
      price: "",
      isDraft: true,
    };
    setRows((rs) => [...rs, draft]);
  };

  const delRow = async (id) => {
    const row = rows.find((r) => r.id === id);
    setRows((rs) => rs.filter((r) => r.id !== id));
    dirtyRef.current.rows.delete(id);
    if (!row || row.isDraft) return; // never persisted, nothing to delete
    try {
      await api(`/api/portfolio/holdings/${id}`, { method: "DELETE" });
      setSaveState("saved");
    } catch (err) {
      console.error("Delete failed", err);
      setSaveState("error");
    }
  };

  const updateCash = (val) => {
    setCash(val);
    dirtyRef.current.cash = true;
    scheduleSave();
  };

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
      // The server analyzes what's in the database, so pending edits must land
      // first or the AI would describe a stale portfolio.
      clearTimeout(timerRef.current);
      await flush();

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
  const inputBase =
    "rounded-lg border px-3 py-2 font-mono text-sm transition-colors duration-500 focus:outline-none focus:ring-2";

  const saveLabel = {
    idle: null,
    saving: { Icon: Loader2, text: "Saving…", spin: true },
    saved: { Icon: Check, text: "Saved", spin: false },
    error: { Icon: CloudOff, text: "Not saved", spin: false },
  }[saveState];

  if (loading) {
    return (
      <div className={`flex min-h-screen items-center justify-center font-sans ${t.page}`}>
        <Loader2 className={`h-6 w-6 animate-spin ${t.muted}`} />
      </div>
    );
  }

  return (
    <div className={`min-h-screen font-sans transition-colors duration-500 ${t.page}`}>
      <style>{`
        @keyframes mo-fade { from { opacity:0; transform: translateY(6px);} to { opacity:1; transform:none; } }
        .mo-fade { animation: mo-fade .4s cubic-bezier(.2,.7,.2,1) both; }
        @media (prefers-reduced-motion: reduce){ .mo-fade { animation: none; } }
        input::-webkit-outer-spin-button, input::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
        input::placeholder { color: ${t.placeholder}; }
      `}</style>

      <div className="mx-auto max-w-5xl px-5 py-8 sm:px-8 sm:py-12">
        {/* Header */}
        <header className="mb-8 flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div
              className={`flex h-10 w-10 items-center justify-center rounded-lg transition-colors duration-500 ${t.logo}`}
            >
              <Aperture className="h-5 w-5" strokeWidth={2.2} />
            </div>
            <div>
              <h1 className="text-xl font-semibold tracking-tight">Motion</h1>
              <p className={`text-sm ${t.muted}`}>{user?.email}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {isSubscribed && (
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
              title="Sign out"
              aria-label="Sign out"
              className={`rounded-lg border p-2 transition ${t.ghostBtn}`}
            >
              <LogOut className="h-3.5 w-3.5" />
            </button>
          </div>
        </header>

        {loadError && (
          <div className={`mb-6 flex items-start gap-2 rounded-lg border px-3 py-2 text-sm ${t.errorBox}`}>
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{loadError}</span>
          </div>
        )}

        {/* Holdings editor */}
        <section className={`mb-6 rounded-xl border p-5 transition-colors duration-500 ${t.card}`}>
          <div className="mb-3 flex items-center justify-between">
            <h2 className={`text-sm font-medium ${t.heading}`}>Your holdings</h2>
            {saveLabel && (
              <span className={`flex items-center gap-1.5 text-xs ${saveState === "error" ? t.down : t.faint}`}>
                <saveLabel.Icon className={`h-3 w-3 ${saveLabel.spin ? "animate-spin" : ""}`} />
                {saveLabel.text}
              </span>
            )}
          </div>

          <div
            className={`mb-1 hidden grid-cols-12 gap-2 px-1 text-xs font-medium uppercase tracking-wide sm:grid ${t.faint}`}
          >
            <div className="col-span-3">Ticker</div>
            <div className="col-span-2 text-right">Shares</div>
            <div className="col-span-2 text-right">Avg cost</div>
            <div className="col-span-2 text-right">Price</div>
            <div className="col-span-2 text-right">Value</div>
            <div className="col-span-1" />
          </div>

          <div className="space-y-2">
            {rows.map((r) => {
              const val = (Number(r.shares) || 0) * (Number(r.price) || 0);
              return (
                <div key={r.id} className="grid grid-cols-12 items-center gap-2">
                  <input
                    value={r.ticker}
                    onChange={(e) => updateRow(r.id, "ticker", e.target.value)}
                    placeholder="AAPL"
                    aria-label="Ticker"
                    className={`col-span-6 uppercase sm:col-span-3 ${inputBase} ${t.input}`}
                  />
                  {["shares", "cost", "price"].map((field, idx) => (
                    <input
                      key={field}
                      type="number"
                      value={r[field]}
                      onChange={(e) => updateRow(r.id, field, e.target.value)}
                      placeholder="0"
                      aria-label={["Shares", "Average cost", "Current price"][idx]}
                      className={`col-span-3 text-right tabular-nums sm:col-span-2 ${inputBase} ${t.input}`}
                    />
                  ))}
                  <div className={`col-span-2 hidden text-right font-mono text-sm tabular-nums sm:block ${t.body}`}>
                    {usd0.format(val)}
                  </div>
                  <button
                    onClick={() => delRow(r.id)}
                    className={`col-span-3 flex justify-end transition sm:col-span-1 ${t.deleteIdle}`}
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
              className={`flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm transition ${t.ghostBtn}`}
            >
              <Plus className="h-4 w-4" /> Add holding
            </button>
            <div className="flex items-center gap-2">
              <span className={`text-sm ${t.muted}`}>Cash</span>
              <div className={`flex items-center rounded-lg border px-3 transition-colors duration-500 ${t.input}`}>
                <span className={`font-mono text-sm ${t.faint}`}>$</span>
                <input
                  type="number"
                  value={cash}
                  onChange={(e) => updateCash(e.target.value)}
                  aria-label="Cash balance"
                  className="w-28 bg-transparent py-2 text-right font-mono text-sm tabular-nums focus:outline-none"
                />
              </div>
            </div>
          </div>
        </section>

        {!hasData ? (
          <div
            className={`rounded-xl border border-dashed p-10 text-center transition-colors duration-500 ${t.cardDashed} ${t.muted}`}
          >
            Add a holding above to see your breakdown.
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
            made of — it never tells you what to buy, sell, or hold. Prices are the ones you enter,
            not live market data. Classifications are AI-generated and may contain errors.
          </span>
        </div>
      </div>
    </div>
  );
}
