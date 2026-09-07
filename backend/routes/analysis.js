const express = require("express");
const pool = require("../db/pool");
const requireAuth = require("../middleware/requireAuth");
const requireSubscription = require("../middleware/requireSubscription");
const { computePortfolio } = require("../utils/portfolioMath");

const router = express.Router();

const pct = (n) => `${(n * 100).toFixed(1)}%`;
const signedPct = (n) => `${n >= 0 ? "+" : ""}${(n * 100).toFixed(1)}%`;

const SYSTEM_PROMPT = `You are a portfolio analytics engine. You classify holdings and describe a portfolio's composition and concentration in plain, educational language.
Hard rule: you NEVER give investment advice and NEVER recommend buying, selling, holding, adding, or trimming any security or asset. You describe, you do not prescribe.
Classify each holding:
- assetClass: one of "US Equity", "International Equity", "Bond", "Real Estate", "Commodity", "Crypto", "Cash", "Other".
- sector: for single stocks use a GICS-style sector (e.g., Technology, Healthcare, Financials, Consumer Discretionary, Energy). For broad index/total-market funds use "Broad Market". For bond/other funds use the closest fit.
Then write:
- observations: 2 to 4 neutral, factual sentences about the portfolio's shape (weightings, tilts, diversification), grounded in the numbers given.
- risks: 2 to 3 plain-language notes on concentration or single-name exposure, phrased as observations of fact, never as recommendations.
Respond with ONLY valid JSON, no markdown fences, no preamble:
{"classifications":[{"ticker":string,"assetClass":string,"sector":string}],"observations":[string],"risks":[string]}`;

// POST /api/analysis — auth + active subscription required
router.post("/", requireAuth, requireSubscription, async (req, res) => {
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: "Server is not configured with an AI provider key." });
  }

  try {
    const portfolioRow = await pool.query(`SELECT id, cash FROM portfolios WHERE user_id = $1`, [
      req.userId,
    ]);
    if (portfolioRow.rows.length === 0) {
      return res.status(404).json({ error: "No portfolio found for this account." });
    }
    const { id: portfolioId, cash } = portfolioRow.rows[0];

    const holdingsRows = await pool.query(
      `SELECT ticker, shares, cost, price FROM holdings WHERE portfolio_id = $1`,
      [portfolioId]
    );
    if (holdingsRows.rows.length === 0) {
      return res.status(400).json({ error: "Add at least one holding before running analysis." });
    }

    // Recomputed server-side from the DB — never trusts numbers from the client.
    const model = computePortfolio(holdingsRows.rows, cash);

    const lines = model.positions
      .map((p) => `${p.ticker}: ${pct(p.weight)} of portfolio, return ${signedPct(p.gainPct)}`)
      .join("\n");
    const signals = `Largest position: ${model.topName} at ${pct(model.topWeight)}. Top 3 positions: ${pct(
      model.top3
    )}. Cash: ${pct(model.cashPct)}. Number of holdings: ${model.positions.length}.`;

    const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 1000,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: `Holdings:\n${lines}\n\n${signals}` }],
      }),
    });

    if (!anthropicRes.ok) {
      const detail = await anthropicRes.text();
      console.error("Anthropic API error", anthropicRes.status, detail);
      return res.status(502).json({ error: "AI provider request failed." });
    }

    const json = await anthropicRes.json();
    const text = (json.content || [])
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n");
    const clean = text.replace(/```json/gi, "").replace(/```/g, "").trim();

    let parsed;
    try {
      parsed = JSON.parse(clean);
    } catch (parseErr) {
      console.error("Could not parse AI response as JSON", clean);
      return res.status(502).json({ error: "AI response was not valid JSON." });
    }

    return res.json(parsed);
  } catch (err) {
    console.error("Analysis failed", err);
    return res.status(500).json({ error: "Could not run analysis." });
  }
});

module.exports = router;
