import React, { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  BookOpen,
  Check,
  ChevronDown,
  ChevronRight,
  Loader2,
  Undo2,
} from "lucide-react";
import { api } from "../api/client.js";
import { usd0, usd2, pct, signedPct, signedUsd, signedUsd2 } from "../lib/portfolioModel.js";
import { on } from "../lib/commands.js";

const shares = (n) => Number(n).toLocaleString("en-US", { maximumFractionDigits: 6 });

const TYPES = [
  { key: "BUY", label: "Buy", trade: true },
  { key: "SELL", label: "Sell", trade: true },
  { key: "DEPOSIT", label: "Deposit", trade: false },
  { key: "WITHDRAWAL", label: "Withdraw", trade: false },
];

const ACCOUNT_LABELS = {
  CASH: "Cash",
  SECURITIES: "Securities",
  CONTRIBUTIONS: "Contributions",
  REALIZED_PNL: "Realized gain / loss",
};

/** What happened, in words. */
function describe(tx) {
  const trade = `${shares(tx.quantity)} ${tx.ticker} at ${usd2.format(tx.price)}`;
  switch (tx.type) {
    case "DEPOSIT": return "Cash deposited";
    case "WITHDRAWAL": return "Cash withdrawn";
    case "BUY": return `Bought ${trade}`;
    case "SELL": return `Sold ${trade}`;
    default: return tx.memo || "Reversal";
  }
}

/** Net effect on cash: debits to the cash account minus credits. */
function cashEffect(tx) {
  return (tx.entries || [])
    .filter((e) => e.account === "CASH")
    .reduce((sum, e) => sum + (Number(e.debit) || 0) - (Number(e.credit) || 0), 0);
}

/* ------------------------------------------------------------------ *
 * Positions: derived from the ledger, so only the price can be edited.
 * ------------------------------------------------------------------ */
function PriceCell({ row, t, inputBase, onChanged }) {
  const [draft, setDraft] = useState(String(row.price));
  const [state, setState] = useState("idle"); // idle | saving | error
  useEffect(() => { setDraft(String(row.price)); }, [row.price]);

  async function commit() {
    const price = Number(draft);
    if (draft === "" || !Number.isFinite(price) || price < 0) {
      setDraft(String(row.price));
      return;
    }
    if (price === Number(row.price)) return;
    setState("saving");
    try {
      await api(`/api/portfolio/prices/${encodeURIComponent(row.ticker)}`, {
        method: "PUT",
        body: JSON.stringify({ price }),
      });
      setState("idle");
      onChanged();
    } catch {
      setState("error");
      setDraft(String(row.price));
    }
  }

  return (
    <input
      type="number"
      min="0"
      step="0.01"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
      disabled={state === "saving"}
      aria-label={`Current price of ${row.ticker}`}
      aria-invalid={state === "error"}
      className={`w-full text-right tabular-nums ${inputBase} ${t.input}`}
    />
  );
}

/**
 * The holdings as a ledger page: ruled rows, right-aligned figures, and a
 * total closed off with a double rule. Shares and cost come from the journal;
 * `model` adds each position's weight and unrealised return.
 */
export function Positions({ t, rows, cash, model, inputBase, onChanged }) {
  const byTicker = new Map((model?.positions || []).map((p) => [p.ticker, p]));
  const invested = rows.reduce((sum, r) => sum + r.shares * r.price, 0);
  const th = `label px-2 pb-2 text-right ${t.faint}`;
  const td = `px-2 py-2 text-right tabular-nums ${t.body}`;

  return (
    <section id="positions" tabIndex={-1}
      className={`rounded-lg border p-5 outline-none transition-colors duration-500 ${t.card}`}>
      <h2 className={`title mb-3 ${t.heading}`}>Positions</h2>

      {rows.length === 0 ? (
        <>
          <p className={`rounded-md border border-dashed px-4 py-6 text-center text-sm ${t.rule} ${t.muted}`}>
            No positions yet. Deposit cash, then record a buy.
          </p>
          <p className={`mt-3 text-sm ${t.muted}`}>
            Cash{" "}
            <span className={`tabular-nums ${t.body}`} data-testid="cash-balance">{usd2.format(cash)}</span>
          </p>
        </>
      ) : (
        <div className="-mx-2 overflow-x-auto">
          <table className="w-full border-collapse text-sm sm:min-w-[620px]">
            <thead>
              <tr>
                <th scope="col" className={`label px-2 pb-2 text-left ${t.faint}`}>Ticker</th>
                <th scope="col" className={`${th} hidden sm:table-cell`}>Shares</th>
                <th scope="col" className={`${th} hidden sm:table-cell`}>Avg cost</th>
                <th scope="col" className={`${th} w-20 sm:w-28`}>Price</th>
                <th scope="col" className={th}>Value</th>
                <th scope="col" className={`${th} hidden sm:table-cell`}>Weight</th>
                <th scope="col" className={th}>Return</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const p = byTicker.get(r.ticker);
                return (
                  <tr key={r.ticker} data-testid={`position-${r.ticker}`}
                    className={`border-t transition-colors ${t.rule} ${t.rowHover}`}>
                    <th scope="row" className="px-2 py-2 text-left font-semibold">{r.ticker}</th>
                    <td className={`${td} hidden sm:table-cell`}>{shares(r.shares)}</td>
                    <td className={`${td} hidden sm:table-cell`}>{usd2.format(r.cost)}</td>
                    <td className="py-1 pl-2">
                      <PriceCell row={r} t={t} inputBase={inputBase} onChanged={onChanged} />
                    </td>
                    <td className={td}>{usd0.format(r.shares * r.price)}</td>
                    <td className={`${td} hidden sm:table-cell`}>{p ? pct(p.weight) : ""}</td>
                    <td className={`px-2 py-2 text-right tabular-nums ${p && p.gain < 0 ? t.down : t.up}`}>
                      {p ? signedUsd(p.gain) : ""}
                      {p && <span className={`ml-2 hidden text-xs sm:inline ${t.muted}`}>{signedPct(p.gainPct)}</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className={`border-t ${t.rule}`}>
                <th scope="row" className={`px-2 py-2 text-left font-normal ${t.muted}`}>Invested</th>
                <td className="hidden sm:table-cell" /><td className="hidden sm:table-cell" /><td />
                <td className={td}>{usd0.format(invested)}</td>
                <td className={`${td} hidden sm:table-cell`}>{model?.total ? pct(invested / model.total) : ""}</td>
                <td />
              </tr>
              <tr className={`border-t ${t.rule}`}>
                <th scope="row" className={`px-2 py-2 text-left font-normal ${t.muted}`}>Cash</th>
                <td className="hidden sm:table-cell" /><td className="hidden sm:table-cell" /><td />
                <td className={td} data-testid="cash-balance">{usd2.format(cash)}</td>
                <td className={`${td} hidden sm:table-cell`}>{model?.total ? pct(cash / model.total) : ""}</td>
                <td />
              </tr>
              <tr className="total-row">
                <th scope="row" className={`px-2 py-2 text-left font-semibold ${t.ruleStrong}`}>Total</th>
                <td className={`hidden sm:table-cell ${t.ruleStrong}`} /><td className={`hidden sm:table-cell ${t.ruleStrong}`} /><td className={t.ruleStrong} />
                <td className={`px-2 py-2 text-right font-semibold tabular-nums ${t.ruleStrong}`}>
                  {usd0.format(invested + cash)}
                </td>
                <td className={`hidden sm:table-cell ${t.ruleStrong}`} />
                <td className={`px-2 py-2 text-right tabular-nums ${t.ruleStrong} ${model && model.gainTotal < 0 ? t.down : t.up}`}>
                  {model ? signedUsd(model.gainTotal) : ""}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
      {rows.length > 0 && (
        <p className={`mt-3 text-xs ${t.faint}`}>
          Shares and cost come from your transactions and can't be edited directly. Price is the
          last trade unless you update it.
        </p>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ *
 * Record a transaction
 * ------------------------------------------------------------------ */
export function RecordForm({ t, inputBase, onChanged }) {
  const [type, setType] = useState("BUY");
  const [ticker, setTicker] = useState("");
  const [quantity, setQuantity] = useState("");
  const [price, setPrice] = useState("");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState("");

  // One key per distinct submission. A retry of the same form (after a
  // timeout, say) reuses it, so the server records the transaction once.
  const keyRef = useRef(null);
  const firstField = useRef(null);

  // The command palette can open this form on a given transaction type.
  useEffect(
    () =>
      on("record", (nextType) => {
        keyRef.current = null;
        setError("");
        setDone("");
        setType(nextType);
        setTimeout(() => firstField.current?.focus(), 0);
      }),
    []
  );

  const touch = (setter) => (value) => {
    keyRef.current = null;
    setError("");
    setDone("");
    setter(value);
  };

  const meta = TYPES.find((x) => x.key === type);
  const total = Number(quantity) * Number(price);
  const ready = meta.trade
    ? ticker.trim() && Number(quantity) > 0 && Number(price) > 0
    : Number(amount) > 0;

  async function submit(e) {
    e.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    setError("");
    setDone("");
    keyRef.current = keyRef.current || crypto.randomUUID();
    const body = meta.trade
      ? { type, ticker: ticker.trim().toUpperCase(), quantity: Number(quantity), price: Number(price) }
      : { type, amount: Number(amount) };
    try {
      const tx = await api("/api/ledger/transactions", {
        method: "POST",
        headers: { "Idempotency-Key": keyRef.current },
        body: JSON.stringify(body),
      });
      keyRef.current = null;
      setDone(`Recorded: ${describe(tx).toLowerCase()}.`);
      setTicker(""); setQuantity(""); setPrice(""); setAmount("");
      onChanged();
    } catch (err) {
      setError(err.message || "Could not record the transaction.");
    } finally {
      setBusy(false);
    }
  }

  const field = `w-full ${inputBase} ${t.input}`;
  const label = `mb-1 block label ${t.faint}`;

  return (
    <section id="record" tabIndex={-1}
      className={`rounded-lg border p-5 outline-none transition-colors duration-500 ${t.card}`}>
      <h2 className={`title mb-3 ${t.heading}`}>Record a transaction</h2>
      <form onSubmit={submit} className="space-y-3">
        <div role="group" aria-label="Transaction type"
          className={`flex rounded-lg border p-0.5 transition-colors duration-500 ${t.toggleShell}`}>
          {TYPES.map((x) => (
            <button
              key={x.key}
              type="button"
              onClick={() => touch(setType)(x.key)}
              aria-pressed={type === x.key}
              className={`flex-1 rounded-md px-2 py-1.5 text-xs font-medium transition ${
                type === x.key ? t.toggleActive : t.toggleIdle
              }`}
            >
              {x.label}
            </button>
          ))}
        </div>

        {meta.trade ? (
          <div className="grid grid-cols-3 gap-2">
            <label>
              <span className={label}>Ticker</span>
              <input ref={firstField} value={ticker} onChange={(e) => touch(setTicker)(e.target.value)}
                placeholder="AAPL" maxLength={12} className={`uppercase ${field}`} />
            </label>
            <label>
              <span className={label}>Shares</span>
              <input type="number" min="0" step="any" value={quantity}
                onChange={(e) => touch(setQuantity)(e.target.value)} placeholder="0"
                className={`text-right tabular-nums ${field}`} />
            </label>
            <label>
              <span className={label}>Price</span>
              <input type="number" min="0" step="any" value={price}
                onChange={(e) => touch(setPrice)(e.target.value)} placeholder="0.00"
                className={`text-right tabular-nums ${field}`} />
            </label>
          </div>
        ) : (
          <label className="block">
            <span className={label}>Amount</span>
            <input ref={firstField} type="number" min="0" step="0.01" value={amount}
              onChange={(e) => touch(setAmount)(e.target.value)} placeholder="0.00"
              className={`text-right tabular-nums ${field}`} />
          </label>
        )}

        <div className="flex items-center justify-between gap-3">
          <span className={`tabular-nums text-sm ${t.muted}`}>
            {meta.trade && total > 0 ? `Total ${usd2.format(total)}` : " "}
          </span>
          <button
            type="submit"
            disabled={!ready || busy}
            className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition disabled:opacity-40 ${t.primaryBtn}`}
          >
            {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Record {meta.label.toLowerCase()}
          </button>
        </div>

        {error && (
          <div role="alert" className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-sm ${t.errorBox}`}>
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}
        {done && (
          <div role="status" className={`flex items-center gap-2 text-sm ${t.up}`}>
            <Check className="h-4 w-4" /> {done}
          </div>
        )}
      </form>
    </section>
  );
}

/* ------------------------------------------------------------------ *
 * Activity: the journal, newest first
 * ------------------------------------------------------------------ */
export function Activity({ t, refreshKey, onChanged }) {
  const [transactions, setTransactions] = useState(null);
  const [balanced, setBalanced] = useState(null);
  const [open, setOpen] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [list, trial] = await Promise.all([
          api("/api/ledger/transactions?limit=25"),
          api("/api/ledger/trial-balance"),
        ]);
        if (cancelled) return;
        setTransactions(list.transactions || []);
        setBalanced(trial.balanced === true);
      } catch (err) {
        if (!cancelled) setError(err.message || "Could not load activity.");
      }
    })();
    return () => { cancelled = true; };
  }, [refreshKey]);

  async function reverse(tx) {
    setBusyId(tx.id);
    setError("");
    try {
      await api(`/api/ledger/transactions/${tx.id}/reversal`, { method: "POST" });
      onChanged();
    } catch (err) {
      setError(err.message || "Could not reverse the transaction.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section id="activity" tabIndex={-1}
      className={`rounded-lg border p-5 outline-none transition-colors duration-500 ${t.card}`}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className={`flex items-center gap-2 ${t.heading}`}>
          <BookOpen className="h-4 w-4" />
          <h2 className="title">Activity</h2>
        </div>
        {balanced !== null && (
          <span className={`flex items-center gap-1.5 text-xs ${balanced ? t.up : t.down}`}
            title="Every transaction's debits equal its credits">
            {balanced ? <Check className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
            {balanced ? "Books balance" : "Books do not balance"}
          </span>
        )}
      </div>

      {error && (
        <div role="alert" className={`mb-3 flex items-start gap-2 rounded-lg border px-3 py-2 text-sm ${t.errorBox}`}>
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {transactions === null && !error && <Loader2 className={`h-4 w-4 animate-spin ${t.faint}`} />}
      {transactions && transactions.length === 0 && (
        <p className={`text-sm ${t.muted}`}>Nothing recorded yet.</p>
      )}

      <ul className="max-h-[28rem] space-y-1 overflow-y-auto pr-1">
        {(transactions || []).map((tx) => {
          const effect = cashEffect(tx);
          const isOpen = open === tx.id;
          return (
            <li key={tx.id} className="text-sm">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setOpen(isOpen ? null : tx.id)}
                  aria-expanded={isOpen}
                  aria-label={`${isOpen ? "Hide" : "Show"} entries for ${describe(tx)}`}
                  className={`shrink-0 rounded p-0.5 transition ${t.toggleIdle}`}
                >
                  {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                </button>
                <div className="min-w-0 flex-1">
                  <div className={`leading-snug ${tx.reversed ? `line-through ${t.faint}` : t.body}`}>
                    {describe(tx)}
                  </div>
                  <div className={`text-xs ${t.faint}`}>
                    {new Date(tx.createdAt).toLocaleString(undefined, {
                      month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
                    })}
                    {tx.reversed && ", reversed"}
                  </div>
                </div>
                <div className={`shrink-0 tabular-nums ${effect >= 0 ? t.up : t.body}`}>
                  {signedUsd2(effect)}
                </div>
                {tx.reversible ? (
                  <button
                    onClick={() => reverse(tx)}
                    disabled={busyId !== null}
                    title="Reverse this transaction"
                    aria-label={`Reverse: ${describe(tx)}`}
                    className={`shrink-0 rounded-lg border p-1.5 transition disabled:opacity-40 ${t.ghostBtn}`}
                  >
                    {busyId === tx.id
                      ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      : <Undo2 className="h-3.5 w-3.5" />}
                  </button>
                ) : (
                  <span className="w-[30px] shrink-0" />
                )}
              </div>

              {isOpen && (
                <table className={`mb-2 ml-7 mt-1 w-[calc(100%-1.75rem)] text-xs ${t.muted}`}>
                  <thead>
                    <tr className={`text-left  ${t.faint}`}>
                      <th className="py-1 font-medium">Account</th>
                      <th className="py-1 text-right font-medium">Debit</th>
                      <th className="py-1 text-right font-medium">Credit</th>
                    </tr>
                  </thead>
                  <tbody className="tabular-nums">
                    {tx.entries.map((e, i) => (
                      <tr key={i}>
                        <td className="py-0.5 font-sans">
                          {ACCOUNT_LABELS[e.account] || e.account}
                          {e.ticker ? ` (${e.ticker})` : ""}
                        </td>
                        <td className="py-0.5 text-right">{e.debit != null ? usd2.format(e.debit) : ""}</td>
                        <td className="py-0.5 text-right">{e.credit != null ? usd2.format(e.credit) : ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export const INPUT_BASE =
  "rounded-md border px-3 py-2 text-sm transition-colors duration-500 focus:outline-none focus:ring-2";
