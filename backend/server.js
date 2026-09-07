require("dotenv").config();

const express = require("express");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const helmet = require("helmet");

const authRoutes = require("./routes/auth");
const portfolioRoutes = require("./routes/portfolio");
const analysisRoutes = require("./routes/analysis");
const billingRoutes = require("./routes/billing");
const { handleWebhook } = require("./routes/billing");

const app = express();

app.use(helmet());
app.use(
  cors({
    origin: process.env.APP_URL || "http://localhost:5173",
    credentials: true, // required so the httpOnly refresh cookie is sent/received
  })
);
app.use(cookieParser());

// IMPORTANT: the Stripe webhook needs the raw request body to verify the
// signature, so it must be mounted with express.raw() BEFORE express.json()
// runs on the rest of the app. Splitting billing into two mounts below keeps
// that ordering correct without special-casing inside routes/billing.js.
app.post("/api/billing/webhook", express.raw({ type: "application/json" }), handleWebhook);

app.use(express.json());

app.get("/health", (req, res) => res.json({ ok: true }));

app.use("/api/auth", authRoutes);
app.use("/api/portfolio", portfolioRoutes);
app.use("/api/analysis", analysisRoutes);
app.use("/api/billing", billingRoutes); // checkout + portal (webhook already mounted above)

app.use((req, res) => {
  res.status(404).json({ error: "Not found" });
});

// Centralized error handler — keeps stack traces out of responses.
app.use((err, req, res, next) => {
  console.error("Unhandled error", err);
  res.status(500).json({ error: "Internal server error" });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Motion API listening on port ${PORT}`);
});
