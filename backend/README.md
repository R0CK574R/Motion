# Motion API

Java 21, Spring Boot 3, PostgreSQL. Auth, a double-entry ledger, an audit log, AI analysis and Stripe billing.

```
src/main/java/com/motion/
├── auth/        register, login, refresh rotation, demo accounts, JWT signing
├── ledger/      LedgerRules (pure bookkeeping), LedgerService, LedgerRepository
├── portfolio/   cash and holdings, derived from the ledger
├── risk/        calls the C++ risk engine
├── ai/          ask-your-portfolio and risk memo: model client, tools, guardrails, call log
├── analysis/    AI classification of holdings (paid feature)
├── billing/     Stripe checkout, portal and webhook
├── audit/       append-only audit log
├── common/      error format, rate limiting, health check
└── config/      security, CORS, datasource, settings
src/main/resources/db/migration/   Flyway migrations (applied on startup)
```

## Run it

```bash
cp .env.example .env        # fill in JWT_ACCESS_SECRET at minimum
docker compose up --build   # from the repo root: Postgres, risk engine, API on :4000
```

Without Docker, with Java 21, Maven and a local Postgres:

```bash
export DATABASE_URL=postgres://motion:motion@localhost:5432/motion
export JWT_ACCESS_SECRET=$(openssl rand -hex 48)
mvn spring-boot:run
```

Interactive API docs are served at `http://localhost:4000/swagger-ui.html`.

## Test it

```bash
createdb motion_test                     # once
mvn verify                               # uses postgres://motion:motion@localhost:5432/motion_test
TEST_DATABASE_URL=postgres://... mvn verify   # or point it elsewhere
```

The tests need a real Postgres because the ledger's guarantees are enforced by database triggers.

- `LedgerRulesTest`: the bookkeeping rules on their own, no database.
- `ApiIntegrationTest`: every endpoint through the real HTTP and security layers, including a concurrency test and attempts to tamper with the journal directly in SQL.
- `RateLimitTest`: sign-in throttling.
- `AiGuardsTest`: the figure check and the advice filter on their own.
- `AiIntegrationTest`: the AI endpoints with the model replaced by a script, so each test can make "the model" invent a number, give advice, call a tool that does not exist, or never stop.

## API

All errors have the shape `{"error": "message", "code": "OPTIONAL_CODE"}`.

| Method | Path | Notes |
|---|---|---|
| POST | `/api/auth/register` | Creates the account and signs in |
| POST | `/api/auth/login` | |
| POST | `/api/auth/refresh` | Rotates the refresh cookie, returns a new access token |
| POST | `/api/auth/logout` | Revokes the refresh token |
| POST | `/api/auth/demo` | Throwaway account with a seeded portfolio |
| GET | `/api/auth/me` | Identity and subscription status |
| GET | `/api/portfolio` | Cash and holdings, derived from the ledger |
| PUT | `/api/portfolio/prices/{ticker}` | Update the latest known price of a held ticker |
| GET | `/api/ledger/transactions` | Journal, newest first, with debit and credit entries |
| POST | `/api/ledger/transactions` | Record a `DEPOSIT`, `WITHDRAWAL`, `BUY` or `SELL` |
| POST | `/api/ledger/transactions/{id}/reversal` | Undo a transaction by posting its mirror image |
| GET | `/api/ledger/trial-balance` | Per-account totals; they always sum to zero |
| GET | `/api/risk` | Value at risk, expected shortfall, stress tests (from the C++ engine) |
| POST | `/api/analysis` | AI classification of holdings; needs an active subscription (402 otherwise) |
| GET | `/api/ai/status` | Whether the caller gets live answers, sample answers, or needs a subscription |
| POST | `/api/ai/ask` | Answer a question about the caller's portfolio |
| POST | `/api/ai/memo` | Write a short risk memo |
| GET | `/api/ai/calls` | The caller's recent AI requests and what the checks found |
| POST | `/api/billing/create-checkout-session` | Start a Stripe subscription |
| POST | `/api/billing/create-portal-session` | Manage or cancel it |
| POST | `/api/billing/webhook` | Stripe events, verified by signature |
| GET | `/api/audit` | The caller's own activity |
| GET | `/api/admin/audit` | Everyone's activity; `ADMIN` role only |
| GET | `/health` | |

### Recording a transaction

```bash
curl -X POST localhost:4000/api/ledger/transactions \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -H "Idempotency-Key: $(uuidgen)" \
  -d '{"type": "BUY", "ticker": "AAPL", "quantity": 10, "price": 150}'
```

- `DEPOSIT` and `WITHDRAWAL` take `amount`. `BUY` and `SELL` take `ticker`, `quantity` and `price`.
- A buy or withdrawal larger than the cash balance is refused with 422 `INSUFFICIENT_CASH`; a sale larger than the holding with 422 `INSUFFICIENT_SHARES`.
- Sending the same `Idempotency-Key` again returns the original transaction with status 200 and an `Idempotent-Replay: true` header. The same key with a different body is a 409.
- Amounts with more precision than the ledger stores (more than 2 decimals for money, 4 for prices, 6 for share quantities) are rejected, not rounded.

## How the ledger works

Four accounts per portfolio. Entry amounts are signed: a debit is positive, a credit negative.

| Account | Kind | Balance means |
|---|---|---|
| `CASH` | asset | cash on hand |
| `SECURITIES` (per ticker) | asset | what the shares held cost |
| `CONTRIBUTIONS` | owner's equity | money paid in, net of withdrawals |
| `REALIZED_PNL` | income | gains (credit) and losses (debit) locked in by selling |

**Cost basis** uses the average-cost method: selling part of a position removes the same fraction of its total cost. Selling all of it removes the entire remaining cost, so no rounding residue is left behind.

**A posting** runs in one database transaction: lock the portfolio row, read the balances, let `LedgerRules` decide the entries, insert them. `LedgerRules` is pure Java with no database or framework, which is what makes each rule unit-testable.

**The database enforces the invariants itself** (`V2__ledger_and_audit.sql`):

- a deferred constraint trigger rejects any transaction whose entries do not sum to zero;
- triggers refuse `UPDATE` and `DELETE` on the journal and the audit log;
- unique constraints make an idempotency key usable once per portfolio and a transaction reversible once.

**Reversals.** Any deposit or withdrawal can be reversed if the result would not overdraw cash. For trades, only the most recent one in a ticker can be reversed, because undoing an older one would change the average cost that later sales were already booked at; the fix for an old mistake is an offsetting trade.

**Known limits.** Balances are computed by summing every entry each time, which is fine at this scale; a busier system would keep periodic snapshots. There are no fees, dividends, stock splits or multiple currencies yet.

## How the AI layer works

`ModelClient` is the only interface to a language model; `AnthropicModelClient` implements it against the Claude Messages API, and tests swap in a scripted fake.

1. **Access** (`AiService.access`). Real accounts need an active subscription and are capped per day. Demo accounts get `SampleAnswers` (templated from real data, no model call) unless `AI_DEMO_DAILY_LIMIT` is above zero.
2. **Tool loop.** The model is sent the question and four read-only tool definitions (`AiTools`). When it asks for a tool, the server runs it for the caller and returns the JSON. A failing or unknown tool is reported back as an error result. The loop stops after six model calls.
3. **Advice filter** (`AdviceGuard`). The finished text is scanned for prescriptive wording; a hit replaces the answer with a fixed explanation.
4. **Figure check** (`GroundingVerifier`). Every number in the answer must match a number in the tool results or the question, at the precision the answer used. A miss triggers one rewrite request; a second miss is returned to the client in `checks.ungroundedFigures`.
5. **Log** (`AiCallLog`, table `ai_calls`). Model, prompt version, tools, tokens, latency, both check results and any error. The API key is never written anywhere.

Tools round figures once (cents for money, one decimal for percentages) so the model can quote them as given.

**Known limits of the figure check.** It compares numbers, not what they measure: it catches a figure that appears nowhere in the data, but not a real figure attached to the wrong label (the right dollar amount next to the wrong ticker). It also rejects arithmetic the model does itself, even when correct, which is deliberate. The live evaluation suite is what measures how often answers are right overall.

## Security

- **Tokens.** Access tokens are JWTs (HS256) valid for 15 minutes and kept in browser memory. The refresh token is 48 random bytes in an httpOnly cookie scoped to `/api/auth`; only its SHA-256 hash is stored. Each refresh rotates it, and a rotated token replayed later is treated as theft and ends all of that user's sessions.
- **Passwords** are hashed with bcrypt (cost 12). Sign-in takes the same time whether or not the email exists.
- **Rate limiting.** Sign-in, registration and demo creation are capped per IP address (20 a minute, in memory, single instance).
- **Authorization.** Every ledger query is scoped to the caller's own portfolio; another user's transaction id returns 404. The role is a claim in the token, and `/api/admin/**` requires `ADMIN`.
- **Stripe webhooks** are trusted only if the signature over the raw request body verifies.
- **Secrets** come from environment variables and are never sent to the browser. See `.env.example`. `scripts/check-secrets.sh` runs in CI and fails a pull request containing anything shaped like a real credential.
- **The AI provider key** is sent only as a header to the provider. Errors are logged by HTTP status alone, never with headers or bodies.

Not built yet: two-factor sign-in, email verification and password reset.

## Stripe setup

1. Create a product with a recurring price in the Stripe dashboard and put the price id in `STRIPE_PRICE_ID`.
2. Put your secret key in `STRIPE_SECRET_KEY`.
3. Forward webhooks locally with `stripe listen --forward-to localhost:4000/api/billing/webhook` and put the signing secret it prints in `STRIPE_WEBHOOK_SECRET`.
