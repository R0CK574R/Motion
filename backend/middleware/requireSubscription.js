const pool = require("../db/pool");

// Must run after requireAuth — expects req.userId to already be set.
async function requireSubscription(req, res, next) {
  try {
    const { rows } = await pool.query(
      `SELECT u.is_demo, s.status
       FROM users u
       LEFT JOIN subscriptions s ON s.user_id = u.id
       WHERE u.id = $1`,
      [req.userId]
    );

    // Demo accounts see the paid feature — that's the point of the demo. They
    // are served cached output, so this never touches the AI provider.
    if (rows[0]?.is_demo === true) {
      req.isDemo = true;
      return next();
    }

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
