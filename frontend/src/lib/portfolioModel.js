/* Formatters */
export const usd0 = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});
export const pct = (n) => `${(n * 100).toFixed(1)}%`;
export const usd2 = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

// Signed figures follow accounting convention: a loss is written in
// parentheses, ($1,245), the way it appears on a statement. Percentages use a
// true minus sign so they never look like a hyphenated range.
export const signedPct = (n) => `${n >= 0 ? "+" : "\u2212"}${Math.abs(n * 100).toFixed(1)}%`;
export const signedUsd = (n) =>
  n >= 0 ? `+${usd0.format(n)}` : `(${usd0.format(Math.abs(n))})`;
export const signedUsd2 = (n) =>
  n >= 0 ? `+${usd2.format(n)}` : `(${usd2.format(Math.abs(n))})`;

/**
 * Weights, gains and totals for display. The inputs (shares, average cost,
 * price) come from the server, which derives them from the ledger; this only
 * does the arithmetic the charts need.
 */
export function computePortfolio(rows, cash) {
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
        id: r.id,
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
}

/** One holding as the API returns it: derived from the ledger, keyed by ticker. */
export function normalizeHolding(h) {
  return {
    id: h.ticker,
    ticker: h.ticker || "",
    shares: Number(h.shares) || 0,
    cost: Number(h.cost) || 0,
    price: Number(h.price) || 0,
  };
}
