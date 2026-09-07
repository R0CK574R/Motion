// Server-side mirror of the frontend's portfolio model. Kept intentionally
// simple and dependency-free so it's easy to audit against the client copy
// in frontend/src/lib/portfolioModel.js if the two ever drift.

function computePortfolio(holdings, cash) {
  const positions = holdings.map((h) => {
    const shares = Number(h.shares);
    const price = Number(h.price) || 0;
    const cost = Number(h.cost) || 0;
    const value = shares * price;
    const basis = shares * cost;
    const gain = value - basis;
    return {
      ticker: h.ticker.toUpperCase(),
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

module.exports = { computePortfolio };
