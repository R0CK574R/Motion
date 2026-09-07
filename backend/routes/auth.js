const express = require("express");
const bcrypt = require("bcrypt");
const pool = require("../db/pool");
const requireAuth = require("../middleware/requireAuth");
const {
  signAccessToken,
  generateRefreshToken,
  hashRefreshToken,
  REFRESH_TOKEN_TTL_MS,
} = require("../utils/jwt");

const router = express.Router();

const REFRESH_COOKIE_NAME = "motion_refresh";
const isProd = process.env.NODE_ENV === "production";

const cookieOptions = {
  httpOnly: true,
  secure: isProd, // requires HTTPS in production (true once deployed behind TLS)
  sameSite: "lax",
  path: "/api/auth",
  maxAge: REFRESH_TOKEN_TTL_MS,
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
      res.clearCookie(REFRESH_COOKIE_NAME, { path: "/api/auth" });
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

// GET /api/auth/me — identity + subscription status in one call, so the
// frontend can decide what to render without a second round trip.
router.get("/me", requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT u.id, u.email, s.status, s.current_period_end
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
      user: { id: row.id, email: row.email },
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
  res.clearCookie(REFRESH_COOKIE_NAME, { path: "/api/auth" });
  return res.status(204).send();
});

module.exports = router;
