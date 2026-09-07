# Motion — backend

Real backend for Motion: auth, per-user portfolio storage, an AI analysis endpoint, and Stripe subscriptions. Node/Express + Postgres, containerized, meant to sit behind the existing React dashboard.

This has been smoke-tested end to end against a real Postgres instance: register → login → session refresh with rotation → logout revocation → per-user holdings CRUD → subscription-gated analysis endpoint. All of it passed before this was handed to you.

## Architecture in one paragraph

The frontend never talks to Postgres or Anthropic directly. It calls this API. Auth is JWT access tokens (15 min) plus an httpOnly, rotated refresh token cookie — nothing sensitive touches `localStorage`. The AI analysis route recomputes the portfolio from the database server-side (never trusts numbers the client sends) and is gated behind `requireAuth` **and** `requireSubscription`, so the Anthropic key never reaches a browser and the AI feature is genuinely paywalled, not just hidden in the UI.

## Local development

```bash
cd backend
cp .env.example .env
```

Fill in `.env`:
- `JWT_ACCESS_SECRET` — generate with `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`
- `ANTHROPIC_API_KEY` — from your Anthropic console
- `STRIPE_SECRET_KEY`, `STRIPE_PRICE_ID`, `STRIPE_WEBHOOK_SECRET` — see Stripe setup below
- `DATABASE_URL` — leave the Compose default if using Docker (see below)

Then, from the repo root:

```bash
docker compose up --build
```

This starts Postgres (with `db/schema.sql` applied automatically on first boot) and the API on `http://localhost:4000`. Check `curl http://localhost:4000/health`.

**Without Docker:** point `DATABASE_URL` at any Postgres instance, run `psql $DATABASE_URL -f backend/db/schema.sql` once, then `cd backend && npm install && npm run dev`.

## Stripe setup (test mode)

1. In the Stripe dashboard, create a recurring Price for Motion's subscription tier — copy its ID into `STRIPE_PRICE_ID`.
2. Install the [Stripe CLI](https://stripe.com/docs/stripe-cli) and run `stripe listen --forward-to localhost:4000/api/billing/webhook` — it prints a `whsec_...` value; put that in `STRIPE_WEBHOOK_SECRET`.
3. Use Stripe's test card `4242 4242 4242 4242` (any future expiry, any CVC) to complete checkout during development.

## API surface

| Route | Auth | Description |
|---|---|---|
| `POST /api/auth/register` | — | Create account, starts a session |
| `POST /api/auth/login` | — | Starts a session |
| `POST /api/auth/refresh` | refresh cookie | Rotates the refresh token, issues a new access token |
| `POST /api/auth/logout` | refresh cookie | Revokes the current session |
| `GET /api/portfolio` | access token | Cash + holdings for the caller |
| `PUT /api/portfolio` | access token | Update cash |
| `POST /api/portfolio/holdings` | access token | Add a holding |
| `PUT /api/portfolio/holdings/:id` | access token | Update a holding |
| `DELETE /api/portfolio/holdings/:id` | access token | Remove a holding |
| `POST /api/analysis` | access token + active subscription | Runs the AI classification/insight pass |
| `POST /api/billing/create-checkout-session` | access token | Returns a Stripe Checkout URL |
| `POST /api/billing/create-portal-session` | access token | Returns a Stripe Billing Portal URL |
| `POST /api/billing/webhook` | Stripe signature | Keeps `subscriptions` in sync — point Stripe here |

## What's real vs. what's next

**Done and tested:** auth with rotation/revocation, per-user data isolation, subscription gating, the Anthropic key moved server-side, Docker Compose for local dev.

**Not built yet:**
- The React frontend (`motion-portfolio-xray.jsx`) still holds its old demo-mode logic — it needs to be pointed at this API (login screen, real fetch calls instead of local state, a subscribe button hitting `/api/billing/create-checkout-session`). That's the natural next step.
- Live price data — holdings still take a hand-entered `price`. A market-data provider is a v2 concern.
- AWS deployment — this Dockerfile builds a plain Node image; the natural path is ECR + App Runner or ECS Fargate in front of RDS Postgres, but that's account/infra setup only you can do (it needs your AWS credentials).

## License

MIT — this is your product, do with it what you want.
