const express = require("express");
const Stripe = require("stripe");
const pool = require("../db/pool");
const requireAuth = require("../middleware/requireAuth");

const router = express.Router();
const stripe = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null;

function ensureStripeConfigured(res) {
  if (!stripe) {
    res.status(500).json({ error: "Stripe is not configured on this server." });
    return false;
  }
  return true;
}

// POST /api/billing/create-checkout-session — start a subscription
router.post("/create-checkout-session", requireAuth, async (req, res) => {
  if (!ensureStripeConfigured(res)) return;
  if (!process.env.STRIPE_PRICE_ID) {
    return res.status(500).json({ error: "STRIPE_PRICE_ID is not configured." });
  }

  try {
    const userRow = await pool.query(`SELECT email FROM users WHERE id = $1`, [req.userId]);
    const sub = await pool.query(
      `SELECT stripe_customer_id FROM subscriptions WHERE user_id = $1`,
      [req.userId]
    );

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: sub.rows[0]?.stripe_customer_id || undefined,
      customer_email: sub.rows[0]?.stripe_customer_id ? undefined : userRow.rows[0]?.email,
      line_items: [{ price: process.env.STRIPE_PRICE_ID, quantity: 1 }],
      success_url: `${process.env.APP_URL}/billing/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.APP_URL}/billing/cancelled`,
      client_reference_id: req.userId,
    });

    return res.json({ url: session.url });
  } catch (err) {
    console.error("Create checkout session failed", err);
    return res.status(500).json({ error: "Could not start checkout." });
  }
});

// POST /api/billing/create-portal-session — manage/cancel existing subscription
router.post("/create-portal-session", requireAuth, async (req, res) => {
  if (!ensureStripeConfigured(res)) return;

  try {
    const sub = await pool.query(
      `SELECT stripe_customer_id FROM subscriptions WHERE user_id = $1`,
      [req.userId]
    );
    const customerId = sub.rows[0]?.stripe_customer_id;
    if (!customerId) {
      return res.status(400).json({ error: "No billing account found for this user yet." });
    }

    const portal = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${process.env.APP_URL}/settings/billing`,
    });

    return res.json({ url: portal.url });
  } catch (err) {
    console.error("Create portal session failed", err);
    return res.status(500).json({ error: "Could not open billing portal." });
  }
});

module.exports = router;

// Exported separately (not as part of the router above) because the Stripe
// webhook needs express.raw() body parsing, mounted at its own exact path
// in server.js, BEFORE express.json() runs for the rest of the app. Mounting
// this inside the router above would receive an already-JSON-parsed body by
// the time it ran, which breaks Stripe's signature verification.
async function handleWebhook(req, res) {
  if (!ensureStripeConfigured(res)) return;
  if (!process.env.STRIPE_WEBHOOK_SECRET) {
    return res.status(500).json({ error: "STRIPE_WEBHOOK_SECRET is not configured." });
  }

  let event;
  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      req.headers["stripe-signature"],
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error("Stripe webhook signature verification failed", err.message);
    return res.status(400).send(`Webhook signature verification failed`);
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object;
        const userId = session.client_reference_id;
        if (userId) {
          await pool.query(
            `UPDATE subscriptions
             SET stripe_customer_id = $1, stripe_subscription_id = $2, status = 'active', updated_at = now()
             WHERE user_id = $3`,
            [session.customer, session.subscription, userId]
          );
        }
        break;
      }
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        const subscription = event.data.object;
        await pool.query(
          `UPDATE subscriptions
           SET status = $1, current_period_end = to_timestamp($2), updated_at = now()
           WHERE stripe_subscription_id = $3`,
          [subscription.status, subscription.current_period_end, subscription.id]
        );
        break;
      }
      default:
        break; // ignore events we don't act on
    }
    return res.json({ received: true });
  } catch (err) {
    console.error("Webhook handling failed", err);
    return res.status(500).json({ error: "Webhook handler failed." });
  }
}

module.exports.handleWebhook = handleWebhook;
