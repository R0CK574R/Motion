const express = require("express");
const bcrypt = require("bcrypt");
const pool = require("../db/pool");
const crypto = require("crypto");
const requireAuth = require("../middleware/requireAuth");
const { DEMO_CASH, DEMO_HOLDINGS } = require("../lib/demoData");
const {
  signAccessToken,
  generateRefreshToken,
  hashRefreshToken,
  REFRESH_TOKEN_TTL_MS,
} = require("../utils/jwt");

const router = express.Router();

const REFRESH_COOKIE_NAME = "motion_refresh";
const isProd = process.env.NODE_ENV === "production";

/**
 * SameSite matters more than it looks.
 *
 * "lax" (the local default) only sends the cookie on same-site requests. That's
 * fine when the frontend and API share a registrable domain — localhost, or
 * app.motion.com + api.motion.com.
 *
 * But on default AWS hostnames the frontend (…amplifyapp.com) and the API
 * (…awsapprunner.com) are DIFFERENT registrable domains, so the browser treats
 * every API call as cross-site and silently drops a "lax" cookie. Login appears
 * to work, then the session vanishes on refresh — with no error anywhere.
 *
 * For that setup set COOKIE_SAMESITE=none. Browsers require Secure alongside
 * SameSite=None, so it's forced on below, which in turn requires HTTPS.
 */
const sameSite = process.env.COOKIE_SAMESITE || "lax";
const crossSite = sameSite === "none";

const cookieOptions = {
  httpOnly: true,
  // SameSite=None is invalid without Secure; browsers reject the cookie outright.
  secure: isProd || crossSite,
  sameSite,
  path: "/api/auth",
  maxAge: REFRESH_TOKEN_TTL_MS,
};

// Clearing a cookie only works if these attributes match the ones it was set
// with. Passing just { path } leaves a live session cookie in the browser.
const clearOptions = {
  httpOnly: true,
  secure: isProd || crossSite,
  sameSite,
  path: "/api/auth",
};

async function issueSession(res, userId) {
  const accessToken = signAccessToken(userId);
  const { token, hash, expiresAt } = generateRefreshToken();

  await pool.query(
    `INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)`,
    [userId, hash, expiresAt]
  );

  res.cookie(REFRESH_COOKIE_NAME, token, cookieOptions);
  return accessToken;
}

function isValidEmail(email) {
  return typeof email === "string" && /^\S+@\S+\.\S+$/.test(email);
}

router.post("/register", async (req, res) => {
  const { email, password } = req.body || {};

  if (!isValidEmail(email) || typeof password !== "string" || password.length < 8) {
    return res.status(400).json({
      error: "Valid email and a password of at least 8 characters are required.",
    });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const existing = await client.query(`SELECT id FROM users WHERE email = $1`, [
      email.toLowerCase(),
    ]);
    if (existing.rows.length > 0) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "An account with that email already exists." });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const userResult = await client.query(
      `INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id`,
      [email.toLowerCase(), passwordHash]
    );
    const userId = userResult.rows[0].id;

    await client.query(`INSERT INTO portfolios (user_id, cash) VALUES ($1, 0)`, [userId]);
    await client.query(
      `INSERT INTO subscriptions (user_id, status) VALUES ($1, 'none')`,
      [userId]
    );

    await client.query("COMMIT");

    const accessToken = await issueSession(res, userId);
    return res.status(201).json({ accessToken, user: { id: userId, email } });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Register failed", err);
    return res.status(500).json({ error: "Could not create account." });
  } finally {
    client.release();
  }
});

router.post("/login", async (req, res) => {
  const { email, password } = req.body || {};
  if (!isValidEmail(email) || typeof password !== "string") {
    return res.status(400).json({ error: "Email and password are required." });
  }

  try {
    const { rows } = await pool.query(
      `SELECT id, password_hash FROM users WHERE email = $1`,
      [email.toLowerCase()]
    );
    const user = rows[0];

    // Constant-shape response whether the email exists or not, to avoid
    // leaking account existence via response differences.
    const passwordHash = user ? user.password_hash : "$2b$12$invalidsaltinvalidsaltinvalidsaltinvalidsal";
    const valid = await bcrypt.compare(password, passwordHash);

    if (!user || !valid) {
      return res.status(401).json({ error: "Invalid email or password." });
    }

    const accessToken = await issueSession(res, user.id);
    return res.json({ accessToken, user: { id: user.id, email: email.toLowerCase() } });
  } catch (err) {
    console.error("Login failed", err);
    return res.status(500).json({ error: "Could not log in." });
  }
});

router.post("/refresh", async (req, res) => {
  const token = req.cookies?.[REFRESH_COOKIE_NAME];
  if (!token) {
    return res.status(401).json({ error: "No refresh session found." });
  }

  const tokenHash = hashRefreshToken(token);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const { rows } = await client.query(
      `SELECT id, user_id, expires_at, revoked FROM refresh_tokens WHERE token_hash = $1 FOR UPDATE`,
      [tokenHash]
    );
    const record = rows[0];

    if (!record || record.revoked || new Date(record.expires_at) < new Date()) {
      await client.query("ROLLBACK");
      res.clearCookie(REFRESH_COOKIE_NAME, clearOptions);
      return res.status(401).json({ error: "Refresh session expired or invalid." });
    }

    // Rotate: revoke the old token, issue a brand new one.
    await client.query(`UPDATE refresh_tokens SET revoked = true WHERE id = $1`, [record.id]);

    const { token: newToken, hash: newHash, expiresAt } = generateRefreshToken();
    await client.query(
      `INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)`,
      [record.user_id, newHash, expiresAt]
    );

    await client.query("COMMIT");

    res.cookie(REFRESH_COOKIE_NAME, newToken, cookieOptions);
    const accessToken = signAccessToken(record.user_id);
    return res.json({ accessToken });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Refresh failed", err);
    return res.status(500).json({ error: "Could not refresh session." });
  } finally {
    client.release();
  }
});

// POST /api/auth/demo — one-click demo. Creates a throwaway account with a
// seeded portfolio so visitors (recruiters, in practice) never hit a signup
// wall. Each click gets its own sandbox, so concurrent visitors can't disturb
// each other's view and can edit freely.
router.post("/demo", async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Opportunistic cleanup — keeps demo accounts from accumulating forever
    // without needing a separate cron job.
    await client.query(
      `DELETE FROM users WHERE is_demo = true AND created_at < now() - interval '24 hours'`
    );

    const email = `demo+${crypto.randomUUID()}@motion.invalid`;
    // Random unusable password: the account can only be reached via this
    // endpoint, never by signing in.
    const passwordHash = await bcrypt.hash(crypto.randomBytes(24).toString("hex"), 10);

    const userResult = await client.query(
      `INSERT INTO users (email, password_hash, is_demo) VALUES ($1, $2, true) RETURNING id`,
      [email, passwordHash]
    );
    const userId = userResult.rows[0].id;

    const portfolioResult = await client.query(
      `INSERT INTO portfolios (user_id, cash) VALUES ($1, $2) RETURNING id`,
      [userId, DEMO_CASH]
    );
    const portfolioId = portfolioResult.rows[0].id;

    for (const h of DEMO_HOLDINGS) {
      await client.query(
        `INSERT INTO holdings (portfolio_id, ticker, shares, cost, price)
         VALUES ($1, $2, $3, $4, $5)`,
        [portfolioId, h.ticker, h.shares, h.cost, h.price]
      );
    }

    await client.query(`INSERT INTO subscriptions (user_id, status) VALUES ($1, 'none')`, [
      userId,
    ]);

    await client.query("COMMIT");

    const accessToken = await issueSession(res, userId);
    return res.status(201).json({
      accessToken,
      user: { id: userId, email },
      isDemo: true,
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Demo session failed", err);
    return res.status(500).json({ error: "Could not start the demo." });
  } finally {
    client.release();
  }
});

// GET /api/auth/me — identity + subscription status in one call, so the
// frontend can decide what to render without a second round trip.
router.get("/me", requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT u.id, u.email, u.is_demo, s.status, s.current_period_end
       FROM users u
       LEFT JOIN subscriptions s ON s.user_id = u.id
       WHERE u.id = $1`,
      [req.userId]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: "User not found." });
    }
    const row = rows[0];
    return res.json({
      user: { id: row.id, email: row.email, isDemo: row.is_demo === true },
      subscription: {
        status: row.status || "none",
        currentPeriodEnd: row.current_period_end,
      },
    });
  } catch (err) {
    console.error("Fetch /me failed", err);
    return res.status(500).json({ error: "Could not load account." });
  }
});

router.post("/logout", async (req, res) => {
  const token = req.cookies?.[REFRESH_COOKIE_NAME];
  if (token) {
    const tokenHash = hashRefreshToken(token);
    await pool.query(`UPDATE refresh_tokens SET revoked = true WHERE token_hash = $1`, [
      tokenHash,
    ]);
  }
  res.clearCookie(REFRESH_COOKIE_NAME, clearOptions);
  return res.status(204).send();
});

module.exports = router;
