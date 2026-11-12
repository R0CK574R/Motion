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
  Search,
} from "lucide-react";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";
import { api, ApiError } from "../api/client.js";
import { useAuth } from "../auth/AuthContext.jsx";
import { ThemeToggle } from "./Chrome.jsx";
import { PageShell } from "./Backdrop.jsx";
import RiskPanel from "./RiskPanel.jsx";
import { Positions, RecordForm, Activity, INPUT_BASE } from "./LedgerPanel.jsx";
import CommandPalette from "./CommandPalette.jsx";
import { HoldingsTreemap } from "./charts/HoldingsTreemap.jsx";
import { emit, goTo } from "../lib/commands.js";
import AskPanel from "./AskPanel.jsx";
import {
  usd0,
  pct,
  signedPct,
  signedUsd,
  computePortfolio,
  normalizeHolding,
} from "../lib/portfolioModel.js";

// Allocation colours come from the theme: steps of the ink accent, then stone
// and brass, so the chart belongs to the page instead of shouting over it.
const colorFor = (name, i, chart) =>
  name === "Cash" ? chart.cash : name === "Other" ? chart.other : chart.palette[i % chart.palette.length];

const IS_MAC = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || "");

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
  const [paletteOpen, setPaletteOpen] = useState(false);

  // Cmd+K on a Mac, Ctrl+K elsewhere.
  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((open) => !open);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

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
  const record = (type) => () => {
    goTo("record");
    emit("record", type);
  };
  const commands = [
    { id: "go-positions", group: "Go to", label: "Positions", run: () => goTo("positions") },
    { id: "go-activity", group: "Go to", label: "Activity", run: () => goTo("activity") },
    ...(hasData
      ? [
          { id: "go-allocation", group: "Go to", label: "Allocation", run: () => goTo("allocation") },
          { id: "go-risk", group: "Go to", label: "Risk", run: () => goTo("risk") },
          { id: "go-ask", group: "Go to", label: "Ask your portfolio", run: () => goTo("ask") },
          { id: "go-xray", group: "Go to", label: "X-ray", run: () => goTo("xray") },
        ]
      : []),
    { id: "rec-buy", group: "Record", label: "Record a buy", run: record("BUY") },
    { id: "rec-sell", group: "Record", label: "Record a sell", run: record("SELL") },
    { id: "rec-deposit", group: "Record", label: "Deposit cash", run: record("DEPOSIT") },
    { id: "rec-withdraw", group: "Record", label: "Withdraw cash", run: record("WITHDRAWAL") },
    ...(hasData
      ? [
          { id: "ai-memo", group: "Analyse", label: "Write risk memo", run: () => { goTo("ask"); emit("memo"); } },
          ...(!analysis && !needsSubscription
            ? [{ id: "ai-xray", group: "Analyse", label: "Run the X-ray", run: () => { goTo("xray"); runAnalysis(); } }]
            : []),
        ]
      : []),
    { id: "theme-light", group: "Appearance", label: "Light theme", hint: mode === "light" ? "On" : "", run: () => setMode("light") },
    { id: "theme-dark", group: "Appearance", label: "Dark theme", hint: mode === "dark" ? "On" : "", run: () => setMode("dark") },
    { id: "theme-auto", group: "Appearance", label: "Match the time of day", hint: mode === "auto" ? "On" : "", run: () => setMode("auto") },
    { id: "sign-out", group: "Account", label: isDemo ? "Exit demo" : "Sign out", run: logout },
  ];
  const askFromPalette = hasData
    ? (text) => { goTo("ask"); emit("ask", text); }
    : undefined;

  const card = `rounded-lg border p-5 transition-colors duration-500 ${t.card}`;

  if (loading) {
    return (
      <PageShell t={t} className="flex items-center justify-center">
        <Loader2 className={`h-6 w-6 animate-spin ${t.muted}`} />
      </PageShell>
    );
  }

  return (
    <PageShell t={t}>
      <style>{`input::placeholder { color: ${t.placeholder}; }`}</style>
      {/* The carved facade stays, but recedes behind the figures. */}
      <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 transition-colors duration-500"
        style={{ background: t.veil }} />

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)}
        commands={commands} onAsk={askFromPalette} t={t} />

      <div className="mx-auto max-w-6xl px-4 py-6 sm:px-8 sm:py-8">
        <header className={`mb-6 flex items-center justify-between gap-3 rounded-lg border px-4 py-2.5 transition-colors duration-500 ${t.plaque}`}>
          <div className="flex min-w-0 items-center gap-3">
            <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-md transition-colors duration-500 ${t.logo}`}>
              <Aperture className="h-5 w-5" strokeWidth={2.2} />
            </div>
            <div className="min-w-0">
              <h1 className="font-serif text-xl leading-tight">Motion</h1>
              <p className={`truncate text-xs ${t.plaqueMuted}`}>{isDemo ? "Demo session" : user?.email}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPaletteOpen(true)}
              aria-label="Open the command palette"
              aria-keyshortcuts={IS_MAC ? "Meta+K" : "Control+K"}
              className={`flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-sm transition ${t.ghostBtn}`}
            >
              <Search className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Commands</span>
              <kbd className={`hidden rounded border px-1.5 text-xs sm:inline ${t.rule}`}>
                {IS_MAC ? "⌘K" : "Ctrl K"}
              </kbd>
            </button>
            {isSubscribed && !isDemo && (
              <button onClick={openBillingPortal} disabled={billingBusy} title="Manage billing"
                aria-label="Manage billing" className={`rounded-md border p-2 transition ${t.ghostBtn}`}>
                <CreditCard className="h-3.5 w-3.5" />
              </button>
            )}
            <ThemeToggle mode={mode} setMode={setMode} resolved={resolved} t={t} />
            <button onClick={logout} title={isDemo ? "Exit demo" : "Sign out"}
              aria-label={isDemo ? "Exit demo" : "Sign out"}
              className={`rounded-md border p-2 transition ${t.ghostBtn}`}>
              <LogOut className="h-3.5 w-3.5" />
            </button>
          </div>
        </header>

        {isDemo && (
          <div className={`mb-6 flex flex-wrap items-center justify-between gap-3 rounded-lg border px-4 py-2.5 transition-colors duration-500 ${t.demoBadge}`}>
            <span className="text-sm">
              You're viewing a demo portfolio. Record any trades you like. It won't affect anyone
              else, and it's cleared automatically.
            </span>
            <button onClick={logout} className="shrink-0 text-sm font-medium underline underline-offset-2">
              Create your own account
            </button>
          </div>
        )}

        {loadError && (
          <div role="alert" className={`mb-6 flex items-start gap-2 rounded-lg border px-3 py-2 text-sm ${t.errorBox}`}>
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{loadError}</span>
          </div>
        )}

        {/* Statement head: the one large figure on the page, then the facts that qualify it. */}
        <section className={`mb-6 grid gap-x-10 gap-y-5 rounded-lg border px-6 py-6 transition-colors duration-500 md:grid-cols-[auto_1fr] md:items-end ${t.card}`}>
          <div>
            <div className={`label ${t.muted}`}>Portfolio value</div>
            <div className={`font-display text-6xl leading-none tracking-tight sm:text-7xl ${t.heading}`}
              data-testid="total-value">
              {usd0.format(model.total)}
            </div>
          </div>
          <dl className="grid grid-cols-2 gap-x-8 gap-y-3 sm:grid-cols-4">
            {[
              {
                label: "Total return",
                value: hasData ? signedUsd(model.gainTotal) : "None yet",
                note: hasData ? signedPct(model.gainPctTotal) : "",
                tone: hasData ? gainTone : t.muted,
              },
              { label: "Cash", value: usd0.format(cash), note: model.total ? pct(cash / model.total) : "", tone: t.heading },
              { label: "Positions", value: String(model.positions.length), note: "", tone: t.heading },
              {
                label: "Largest holding",
                value: hasData ? model.topName : "None yet",
                note: hasData ? pct(model.topWeight) : "",
                tone: hasData ? t.heading : t.muted,
              },
            ].map((item) => (
              <div key={item.label} className={`border-l pl-4 ${t.rule}`}>
                <dt className={`label ${t.muted}`}>{item.label}</dt>
                <dd className={`mt-0.5 text-lg font-medium tabular-nums ${item.tone}`}>
                  {item.value}
                  {item.note && <span className={`ml-2 text-xs font-normal ${t.muted}`}>{item.note}</span>}
                </dd>
              </div>
            ))}
          </dl>
        </section>

        {/* The books: positions on the left, the journal that produces them on the right. */}
        <div className="mb-6 grid grid-cols-1 items-start gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <Positions t={t} rows={rows} cash={cash} model={model} inputBase={INPUT_BASE} onChanged={reload} />
          </div>
          <div className="space-y-6">
            <RecordForm t={t} inputBase={INPUT_BASE} onChanged={reload} />
            <Activity t={t} refreshKey={riskKey} onChanged={reload} />
          </div>
        </div>

        {hasData && (
          <>
            <div id="allocation" tabIndex={-1} className="grid grid-cols-1 gap-6 outline-none lg:grid-cols-3">
              <section className={`${card} lg:col-span-2`}>
                <h2 className={`title ${t.heading}`}>Size and return</h2>
                <p className={`mb-4 mt-1 text-xs leading-relaxed ${t.muted}`}>
                  Each tile's area is the position's share of invested value. Green means it is
                  worth more than it cost, red less; the stronger the colour, the larger the move.
                </p>
                <HoldingsTreemap positions={model.positions} dark={resolved === "dark"}
                  format={usd0.format} signedPct={signedPct} t={t} height={344} />
              </section>

              <section className={card}>
                <div className="mb-4 flex items-center justify-between gap-2">
                  <h2 className={`title ${t.heading}`}>Allocation</h2>
                  <div role="group" aria-label="Group allocation by"
                    className={`flex rounded-md border p-0.5 ${t.toggleShell}`}>
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
                          aria-pressed={view === opt.k}
                          title={locked ? "Run the X-ray to group by this" : undefined}
                          className={`rounded px-2 py-1 text-xs transition ${
                            view === opt.k ? t.toggleActive : locked ? t.toggleLocked : t.toggleIdle
                          }`}
                        >
                          {opt.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="relative mx-auto h-44 w-44">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={donut} dataKey="value" nameKey="name" innerRadius={56} outerRadius={84}
                        paddingAngle={1} stroke={t.chart.stroke} isAnimationActive={false}>
                        {donut.map((d, i) => (
                          <Cell key={d.name} fill={colorFor(d.name, i, t.chart)} />
                        ))}
                      </Pie>
                      <Tooltip
                        formatter={(v) => usd0.format(v)}
                        itemStyle={{ color: t.chart.tooltipText }}
                        contentStyle={{
                          borderRadius: 6,
                          border: `1px solid ${t.chart.tooltipBorder}`,
                          backgroundColor: t.chart.tooltipBg,
                          color: t.chart.tooltipText,
                          fontSize: 12,
                        }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                    <span className="font-display text-xl">{usd0.format(model.total)}</span>
                    <span className={`text-xs ${t.muted}`}>total</span>
                  </div>
                </div>
                <ul className="mt-4 space-y-1.5">
                  {donut.map((d, i) => (
                    <li key={d.name} className="flex items-center gap-2 text-sm">
                      <span className="h-2.5 w-2.5 shrink-0 rounded-sm"
                        style={{ backgroundColor: colorFor(d.name, i, t.chart) }} />
                      <span className={`flex-1 truncate ${t.body}`}>{d.name}</span>
                      <span className={`tabular-nums ${t.muted}`}>{pct(d.value / model.total)}</span>
                    </li>
                  ))}
                </ul>
              </section>
            </div>

            <RiskPanel t={t} refreshKey={riskKey} />

            <AskPanel t={t} />

            {/* X-ray: AI classification of the holdings */}
            <div id="xray" tabIndex={-1} className="mt-6 outline-none">
              {needsSubscription ? (
                <div className={`rounded-lg border p-6 text-center transition-colors duration-500 ${t.card}`}>
                  <Lock className={`mx-auto mb-3 h-6 w-6 ${t.muted}`} />
                  <h2 className={`title mb-1 ${t.heading}`}>The X-ray is a paid feature</h2>
                  <p className={`mx-auto mb-4 max-w-sm text-sm ${t.muted}`}>
                    Subscribe to classify your holdings by sector and asset class, and get a
                    written read on your concentration.
                  </p>
                  <button onClick={startCheckout} disabled={billingBusy}
                    className={`inline-flex items-center justify-center gap-2 rounded-md px-5 py-2.5 text-sm font-medium transition disabled:opacity-60 ${t.primaryBtn}`}>
                    {billingBusy && <Loader2 className="h-4 w-4 animate-spin" />}
                    Subscribe
                  </button>
                </div>
              ) : (
                !analysis && (
                  <section className={`${card} flex flex-wrap items-center justify-between gap-4`}>
                    <div>
                      <h2 className={`title ${t.heading}`}>X-ray</h2>
                      <p className={`mt-1 max-w-xl text-sm ${t.muted}`}>
                        Classifies each holding by sector and asset class, then describes the
                        portfolio's shape and where it is concentrated.
                      </p>
                    </div>
                    <button onClick={runAnalysis} disabled={running}
                      className={`flex shrink-0 items-center gap-2 rounded-md px-4 py-2.5 text-sm font-medium transition disabled:opacity-60 ${t.primaryBtn}`}>
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
                  </section>
                )
              )}

              {aiError && (
                <div role="alert" className={`mt-3 flex items-start gap-2 rounded-lg border px-3 py-2 text-sm ${t.errorBox}`}>
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{aiError}</span>
                </div>
              )}

              {analysis && (
                <div className="mo-fade grid grid-cols-1 gap-6 lg:grid-cols-2">
                  <section className={card}>
                    <div className={`mb-3 flex items-center gap-2 ${t.heading}`}>
                      <Eye className="h-4 w-4" />
                      <h2 className="title">What stands out</h2>
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

                  <section className={`rounded-lg border p-5 transition-colors duration-500 ${t.riskCard}`}>
                    <div className={`mb-3 flex items-center gap-2 ${t.riskHead}`}>
                      <AlertTriangle className="h-4 w-4" />
                      <h2 className="title">Concentration and risk</h2>
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

        <div className={`mt-8 flex items-start gap-2 rounded-lg border px-4 py-3 text-xs leading-relaxed transition-colors duration-500 ${t.note}`}>
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            Motion is an analytics tool, not investment advice. It describes what your portfolio is
            made of and never tells you what to buy, sell or hold. Prices are the last trade or the
            ones you enter, not live market data. Classifications are AI-generated and may contain
            errors.
          </span>
        </div>
      </div>
    </PageShell>
  );
}
