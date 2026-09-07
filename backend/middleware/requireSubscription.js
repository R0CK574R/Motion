const pool = require("../db/pool");

// Must run after requireAuth — expects req.userId to already be set.
async function requireSubscription(req, res, next) {
  try {
    const { rows } = await pool.query(
      `SELECT status FROM subscriptions WHERE user_id = $1`,
      [req.userId]
    );
    const status = rows[0]?.status;

    if (status === "active" || status === "trialing") {
      return next();
    }

    return res.status(402).json({
      error: "An active subscription is required for this feature.",
      code: "SUBSCRIPTION_REQUIRED",
    });
  } catch (err) {
    console.error("requireSubscription check failed", err);
    return res.status(500).json({ error: "Could not verify subscription status" });
  }
}

module.exports = requireSubscription;
