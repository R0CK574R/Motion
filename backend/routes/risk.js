const express = require("express");
const pool = require("../db/pool");
const requireAuth = require("../middleware/requireAuth");

const router = express.Router();

// Only these settings are offered, so the query string is an allow-list
// rather than free-form numbers passed through to the engine.
const CONFIDENCE_LEVELS = [0.95, 0.99];
const HORIZONS = [1, 10];
const ENGINE_TIMEOUT_MS = 5000;

// GET /api/risk?confidence=0.95&horizon=1
// Loads the caller's holdings from the database and asks the C++ risk engine
// (risk-engine/, reached over HTTP) for VaR, expected shortfall, risk
// contributions and stress tests. Position values are computed here, from the
// database, so the browser never supplies the numbers that get analysed.
router.get("/", requireAuth, async (req, res) => {
  const confidence = Number(req.query.confidence ?? 0.95);
  const horizon = Number(req.query.horizon ?? 1);
  if (!CONFIDENCE_LEVELS.includes(confidence) || !HORIZONS.includes(horizon)) {
    return res.status(400).json({ error: "Unsupported confidence or horizon." });
  }

  const engineUrl = process.env.RISK_ENGINE_URL;
  if (!engineUrl) {
    return res
      .status(503)
      .json({ error: "The risk engine is not configured.", code: "RISK_ENGINE_UNAVAILABLE" });
  }

  let payload;
  try {
    const { rows } = await pool.query(
      `SELECT p.cash, h.ticker, h.shares, h.price
       FROM portfolios p
       LEFT JOIN holdings h ON h.portfolio_id = p.id
       WHERE p.user_id = $1`,
      [req.userId]
    );
    payload = {
      cash: rows.length ? Number(rows[0].cash) || 0 : 0,
      positions: rows
        .filter((r) => r.ticker)
        .map((r) => ({ ticker: r.ticker, value: Number(r.shares) * Number(r.price) }))
        .filter((p) => p.value > 0),
      confidence,
      horizon_days: horizon,
    };
  } catch (err) {
    console.error("Risk: could not load portfolio", err);
    return res.status(500).json({ error: "Could not load portfolio." });
  }

  try {
    const engineRes = await fetch(`${engineUrl.replace(/\/+$/, "")}/risk`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(ENGINE_TIMEOUT_MS),
    });
    if (!engineRes.ok) {
      console.error("Risk engine rejected request", engineRes.status, await engineRes.text());
      return res.status(502).json({ error: "The risk engine could not process this portfolio." });
    }
    return res.json(await engineRes.json());
  } catch (err) {
    console.error("Risk engine unreachable", err.message);
    return res
      .status(503)
      .json({ error: "The risk engine is offline.", code: "RISK_ENGINE_UNAVAILABLE" });
  }
});

module.exports = router;
