# Deploying Motion for free

Gets Motion onto a public URL you can put on a resume, for **$0/month, no credit card**. Budget about 90 minutes.

For the paid AWS version (better infra credential, ~$5–15/month), see [`DEPLOY-AWS.md`](DEPLOY-AWS.md).

```
Browser
  ├── Frontend  →  Vercel        (free, instant)
  ├── API       →  Render        (free web service)
  └── Database  →  Neon Postgres (free, permanent)
```

**Why Neon and not Render's own free Postgres:** Render's free database is deleted after 30 days. Your link would work for a month, then every account and portfolio would silently disappear. Neon's free tier doesn't expire and needs no card.

---

## Step 1 — Database (Neon, ~10 min)

1. Sign up at **neon.tech** with GitHub. No card.
2. Create a project — name it `motion`, pick the region closest to you.
3. Copy the **connection string** (`postgres://user:pass@ep-xxx.neon.tech/neondb?sslmode=require`).

Apply the schema from your laptop:

```bash
cd backend
DATABASE_URL="your-neon-connection-string" PGSSL=true npm run migrate
```

You should see the five tables listed back.

---

## Step 2 — Backend (Render, ~20 min)

1. Sign up at **render.com** with GitHub. No card for the free tier.
2. **New** → **Web Service** → connect your Motion repo
3. Settings:
   - Root Directory: `backend`
   - Runtime: Node
   - Build Command: `npm install`
   - Start Command: `node server.js`
   - Instance Type: **Free**
4. Environment variables:

| Key | Value |
|---|---|
| `NODE_ENV` | `production` |
| `DATABASE_URL` | your Neon connection string |
| `PGSSL` | `true` |
| `TRUST_PROXY` | `1` |
| `COOKIE_SAMESITE` | `none` |
| `JWT_ACCESS_SECRET` | generate a fresh one (command below) |
| `APP_URL` | leave blank — you'll fill it in at Step 4 |

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

5. Create, wait ~5 min, copy the URL (`https://motion-api-xxxx.onrender.com`)

Verify: `curl https://YOUR-RENDER-URL/health` → `{"ok":true}`

You do **not** need `ANTHROPIC_API_KEY` for the demo to work — demo accounts get a cached analysis. Add it only when you want real accounts running live AI calls, and note that costs credits.

---

## Step 3 — Frontend (Vercel, ~10 min)

1. Sign up at **vercel.com** with GitHub
2. **Add New** → **Project** → import your Motion repo
3. Settings:
   - Framework Preset: **Vite**
   - Root Directory: `frontend`
4. Environment variable: `VITE_API_URL` = your Render URL (no trailing slash)
5. Deploy

Vite inlines env vars **at build time**. If you change `VITE_API_URL` later you must redeploy — editing it without rebuilding does nothing.

Vercel handles SPA routing automatically, so Stripe's `/billing/success` return path works with no extra config.

---

## Step 4 — Connect them

Render → your service → Environment → set `APP_URL` to your Vercel URL (e.g. `https://motion-xxx.vercel.app`, no trailing slash) → save. It redeploys automatically.

Without this, CORS blocks every request from the frontend.

---

## Step 5 — Test it like a recruiter would

Open your Vercel URL in a **private window**:

1. Click **View demo — no signup**. First click may take 30–60s while Render wakes up.
2. You should land on a seeded 7-holding portfolio.
3. Click **Run the X-ray** — it returns instantly with sector and asset-class breakdowns.
4. Refresh the page. Still logged in? The cross-domain cookie is working.

If you're bounced to the login screen on refresh, `COOKIE_SAMESITE=none` isn't set on Render.

---

## The cold start, and what to do about it

Render's free web service sleeps after 15 minutes idle and takes 30–60 seconds to wake. Your Vercel-hosted login page loads instantly either way, but that first demo click can hang.

Options, cheapest first:

- **Accept it.** The login screen renders immediately, so visitors see a real product, not a blank page.
- **Keep it warm.** A free uptime monitor (UptimeRobot, cron-job.org) pinging `/health` every 10 minutes keeps the service awake. Render's free tier includes 750 instance-hours/month, which covers one always-on service. Render doesn't officially support this, so treat it as a workaround rather than a guarantee.
- **Pay $7/month** for Render's Starter tier, which removes spin-down entirely. Worth it during heavy application season, cancellable after.

---

## Putting it on your resume

Link the live URL and the repo, and say what it is in one line:

> **Motion** — portfolio analytics SaaS. React/Vite, Node/Express, PostgreSQL, Stripe, Claude API. JWT auth with rotating refresh tokens, subscription-gated AI analysis. *[live demo] · [github]*

Point the link at your Vercel URL. The demo button means whoever clicks it sees the actual product in one click, with no signup wall.

---

## Free-tier limits worth knowing

| Service | Limit |
|---|---|
| Neon | 0.5 GB storage, 100 compute-hours/month, scales to zero when idle |
| Render | 512 MB RAM, 750 instance-hours/month, sleeps after 15 min idle |
| Vercel | 100 GB bandwidth/month on the Hobby plan |

For a portfolio project these are not close to binding. Demo accounts auto-delete after 24 hours, so the database won't creep toward the storage cap.
