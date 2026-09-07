const express = require("express");
const pool = require("../db/pool");
const requireAuth = require("../middleware/requireAuth");

const router = express.Router();
router.use(requireAuth);

async function getOrCreatePortfolioId(userId) {
  const existing = await pool.query(`SELECT id FROM portfolios WHERE user_id = $1`, [userId]);
  if (existing.rows.length > 0) return existing.rows[0].id;

  const created = await pool.query(
    `INSERT INTO portfolios (user_id, cash) VALUES ($1, 0) RETURNING id`,
    [userId]
  );
  return created.rows[0].id;
}

// GET /api/portfolio — cash + all holdings for the logged-in user
router.get("/", async (req, res) => {
  try {
    const portfolioId = await getOrCreatePortfolioId(req.userId);
    const portfolio = await pool.query(`SELECT cash FROM portfolios WHERE id = $1`, [
      portfolioId,
    ]);
    const holdings = await pool.query(
      `SELECT id, ticker, shares, cost, price FROM holdings WHERE portfolio_id = $1 ORDER BY created_at ASC`,
      [portfolioId]
    );
    return res.json({ cash: portfolio.rows[0].cash, holdings: holdings.rows });
  } catch (err) {
    console.error("Get portfolio failed", err);
    return res.status(500).json({ error: "Could not load portfolio." });
  }
});

// PUT /api/portfolio — update cash balance
router.put("/", async (req, res) => {
  const { cash } = req.body || {};
  if (typeof cash !== "number" || cash < 0) {
    return res.status(400).json({ error: "cash must be a non-negative number." });
  }
  try {
    const portfolioId = await getOrCreatePortfolioId(req.userId);
    await pool.query(`UPDATE portfolios SET cash = $1, updated_at = now() WHERE id = $2`, [
      cash,
      portfolioId,
    ]);
    return res.json({ cash });
  } catch (err) {
    console.error("Update cash failed", err);
    return res.status(500).json({ error: "Could not update cash." });
  }
});

function validHolding(body) {
  const { ticker, shares, cost, price } = body || {};
  return (
    typeof ticker === "string" &&
    ticker.trim().length > 0 &&
    typeof shares === "number" &&
    shares > 0 &&
    typeof cost === "number" &&
    cost >= 0 &&
    typeof price === "number" &&
    price >= 0
  );
}

// POST /api/portfolio/holdings — add a holding
router.post("/holdings", async (req, res) => {
  if (!validHolding(req.body)) {
    return res.status(400).json({ error: "ticker, shares, cost, and price are required." });
  }
  const { ticker, shares, cost, price } = req.body;
  try {
    const portfolioId = await getOrCreatePortfolioId(req.userId);
    const result = await pool.query(
      `INSERT INTO holdings (portfolio_id, ticker, shares, cost, price)
       VALUES ($1, $2, $3, $4, $5) RETURNING id, ticker, shares, cost, price`,
      [portfolioId, ticker.trim().toUpperCase(), shares, cost, price]
    );
    return res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error("Add holding failed", err);
    return res.status(500).json({ error: "Could not add holding." });
  }
});

// PUT /api/portfolio/holdings/:id — update a holding (must belong to caller)
router.put("/holdings/:id", async (req, res) => {
  if (!validHolding(req.body)) {
    return res.status(400).json({ error: "ticker, shares, cost, and price are required." });
  }
  const { ticker, shares, cost, price } = req.body;
  try {
    const result = await pool.query(
      `UPDATE holdings SET ticker = $1, shares = $2, cost = $3, price = $4, updated_at = now()
       WHERE id = $5 AND portfolio_id = (SELECT id FROM portfolios WHERE user_id = $6)
       RETURNING id, ticker, shares, cost, price`,
      [ticker.trim().toUpperCase(), shares, cost, price, req.params.id, req.userId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Holding not found." });
    }
    return res.json(result.rows[0]);
  } catch (err) {
    console.error("Update holding failed", err);
    return res.status(500).json({ error: "Could not update holding." });
  }
});

// DELETE /api/portfolio/holdings/:id
router.delete("/holdings/:id", async (req, res) => {
  try {
    const result = await pool.query(
      `DELETE FROM holdings
       WHERE id = $1 AND portfolio_id = (SELECT id FROM portfolios WHERE user_id = $2)
       RETURNING id`,
      [req.params.id, req.userId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Holding not found." });
    }
    return res.status(204).send();
  } catch (err) {
    console.error("Delete holding failed", err);
    return res.status(500).json({ error: "Could not delete holding." });
  }
});

module.exports = router;
