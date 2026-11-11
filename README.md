# Motion

Portfolio analytics built the way a bank keeps books. Every deposit and trade is posted to a double-entry ledger; holdings, cost basis and gains are derived from it. On top of that: allocation breakdown, a C++ risk engine (value at risk, stress tests), and an AI pass that classifies holdings and describes the portfolio's shape in plain language.

Motion describes composition. It does not give investment advice, and never tells anyone what to buy, sell, or hold — that constraint is enforced in the AI system prompt, not just the footer.

```
motion/
├── backend/          Java 21 + Spring Boot API: auth, double-entry ledger, audit log, AI proxy, Stripe
├── risk-engine/      C++17 risk library, served to the API over HTTP
├── frontend/         React + Vite dashboard
├── e2e/              Browser test of the whole stack (Playwright)
├── evals/            Live evaluation of the AI features against the real model
└── docker-compose.yml
```

## Status

| Piece | State |
|---|---|
| Backend auth (JWT + rotated refresh cookie, reuse detection, rate limiting) | Working, tested in CI |
| Double-entry ledger (append-only, idempotent, reversals) | Working, tested in CI |
| Audit log and admin role | Working, tested in CI |
| Subscription gating on the AI endpoints | Working (returns 402 without an active sub) |
| Ask your portfolio and risk memo (AI with tools, figure check, advice filter, call log) | Working with a scripted model in CI; not yet run against the real model |
| AI evaluation suite (18 live cases) | Written; needs your API key to run |
| Stripe checkout / portal / webhook | Webhook tested with signed events; checkout and portal need your Stripe keys to exercise |
| Frontend dashboard + adaptive theme | Working |
| Command palette (Ctrl/Cmd+K) and statement-style design | Working, covered by the browser test |
| Carved-stone cathedral backdrop (WebGL2 shaders, line-art fallback) | Working |
| Aperture logo intro (WebGL2, once per session, skippable) | Working |
| One-click demo mode (no signup wall) | Working |
| C++ risk engine: value at risk, expected shortfall, risk contributions, stress tests | Working, unit-tested, on an illustrative model (no live data yet) |
| CI (GitHub Actions): backend tests on Postgres, engine tests, frontend build, full-stack browser test, Docker run, secret scan | Running on every pull request |
| Login / register / session persistence | Working |
| Frontend wired to the backend (auth, persistence, paywall) | Working |
| Live market prices | Not built — prices are entered by hand |
| Deployment | Not deployed |

The backend tests run against a real Postgres in CI, because the ledger's guarantees are enforced by database triggers. A separate job starts the whole stack and drives it with a browser.

## How it fits together

The frontend holds the access token **in memory only** — never `localStorage`, which any XSS payload can read. The session survives a page reload via the httpOnly refresh cookie: on mount the app calls `/api/auth/refresh`, and a single-flight refresh transparently retries any request that 401s.

Nothing about a portfolio is edited in place. The dashboard records transactions (deposit, withdraw, buy, sell) and then asks the server for the resulting cash and holdings, which it derives from the ledger. The only directly editable number is a ticker's current price, which is market data rather than a money movement.

The AI call goes to `POST /api/analysis`, which holds the Anthropic key server-side, rebuilds the portfolio from the ledger rather than trusting client numbers, and returns 402 without an active subscription. The paywall is enforced on the server, not hidden in the UI.

## The ledger

A portfolio's state is never stored. It is the sum of an append-only journal:

| Transaction | Debit | Credit |
|---|---|---|
| Deposit $1,000 | Cash 1,000 | Contributions 1,000 |
| Buy 10 AAPL at $150 | Securities (AAPL) 1,500 | Cash 1,500 |
| Sell 5 AAPL at $200 (average cost $150) | Cash 1,000 | Securities (AAPL) 750, Realized gain 250 |

- **Every transaction balances.** A deferred constraint trigger in Postgres rejects any transaction whose entries do not sum to zero, so no application bug can leave the books uneven.
- **Nothing is edited or deleted.** Triggers refuse `UPDATE` and `DELETE` on the journal. A mistake is corrected by posting a reversal, and history shows both.
- **No double spending.** Each posting locks the portfolio row first, so two simultaneous sells cannot both sell the same shares. A test fires six at once and checks that exactly one succeeds.
- **Retries are safe.** A request with an `Idempotency-Key` header is recorded once however many times it is sent.
- **Money is exact.** Amounts are `BigDecimal` in Java and `NUMERIC` in Postgres, rounded half-to-even to the cent. No floating point touches a balance.

Details and the API are in [`backend/README.md`](backend/README.md).

## The backdrop

The background is a Gothic cathedral facade rendered live with WebGL2 shaders (`frontend/src/lib/cathedral.js`). It takes three passes:

1. **Scene.** Evaluates the rose window, the lancet arcade, and the quatrefoil wall as an analytic height field, using rotational symmetry folds.
2. **Light.** Lights that height field like carved stone, with surface normals, soft cast shadows, ambient occlusion, and grain. Window openings are cut through to pure black.
3. **Resolve.** Supersamples the result down to the screen, so ordinary 1× monitors get Retina-quality edges.

The facade renders once per resize or theme change, never per frame, so it costs nothing while you scroll. Day mode is morning sun on limestone; night mode is moonlit silver tracery. Where WebGL2 isn't available, it falls back to SVG line art.

## The intro

On a visitor's first load, Motion's aperture logo appears as a carved-stone iris, rendered in a single WebGL2 shader (`frontend/src/lib/apertureIntro.js`). It swings up to face the viewer, light sweeps across it, the six blades open from a black pupil, and the view flies through the opening into the app. The opening is transparent, so the real first screen shows through as the iris widens.

It runs for 1.85 seconds and plays once per browser session. Any click, tap, or key skips it. It is skipped entirely for visitors who prefer reduced motion and on browsers without WebGL2. The blade geometry matches the lucide Aperture icon in the header: six blades around a flat-topped hexagon, each edge running on clockwise as the seam over the next blade.

## Design

The interface borrows from the things a bank actually prints: statements, ledgers and certificates.

- **Type.** Libre Caslon for the wordmark, headings and the portfolio value, the kind of face found on share certificates. IBM Plex Sans for everything else, with tabular figures so columns of numbers line up. Both are bundled with the app, so no page view calls out to a font service.
- **Colour.** Stone, paper and one blue-black ink. Green and red are reserved for gains and losses.
- **Accounting conventions.** Negative amounts are written in parentheses, `($120)`, and the totals row sits under a single rule and over a double one, as on a printed statement.
- **Density.** Positions are a real table with value, weight and return per row, and invested, cash and total at the foot. On a phone it drops to ticker, price, value and return.
- **Keyboard.** `Ctrl+K` (`Cmd+K` on a Mac) opens a command palette: jump to a section, start a buy or a deposit, switch theme, write the memo, or type a question for the AI.
- **The cathedral stays**, behind a veil so it reads as texture and the figures stay in front.

## The AI layer

"Ask your portfolio" answers questions in plain English, and a second feature writes a one-page risk memo. The model is treated as an untrusted component:

```
question -> model -> asks for a tool -> server runs it on the caller's own data -> model writes an answer
                                                                                      |
                                              advice filter -> figure check -> shown, with what was checked
```

- **Tools, not memory.** The model has four read-only tools (positions, risk, stress tests, recent transactions). The user id comes from the caller's token, never from the model, so it cannot be talked into reading another account.
- **Every figure is checked.** Before an answer is shown, each number in it must match a number in the tool results. An invented figure is sent back to the model once for a rewrite; if it survives, the answer is shown with the figure named as unverified.
- **No advice.** The prompt forbids recommendations, and the finished answer is scanned again in code. An answer that reads as advice is replaced with a fixed explanation.
- **Everything is logged.** Each request records the model, prompt version, tools used, tokens, latency and what both checks found.
- **The key and the bill are protected.** The API key is read from an environment variable and never logged, stored or sent to a browser. Real accounts need a subscription and have a daily cap. Demo accounts get sample answers built from the same data without calling the model, unless a daily demo budget is set.

The plumbing is tested in CI with a scripted model (one that invents numbers, gives advice, calls tools that do not exist, or never stops). Whether the real model behaves is a separate question, answered by the live suite in [`evals/`](evals/README.md).

## The risk engine

Risk is computed in C++17 ([`risk-engine/`](risk-engine/README.md)), wrapped for Python with pybind11 and served to the API over HTTP:

```
browser -> Motion API (/api/risk) -> risk service (FastAPI) -> C++ engine
```

- **Value at risk and expected shortfall**, computed two ways: in closed form, and by Monte Carlo with correlated shocks drawn through a Cholesky factor of the covariance matrix. A unit test requires the two to agree, which is how the simulation is validated.
- **Risk contribution** per position: who is responsible for the portfolio's variance, compared with who holds the money.
- **Stress tests**: the loss if 2008, the 2020 crash, the 2022 rate shock or the dot-com bust repeated.

The API computes position values from the database and sends only those to the engine, so the browser never supplies the numbers being analysed. If the engine is down, `/api/risk` returns 503 and the dashboard shows the risk section as offline while everything else keeps working.

There is no market-data feed yet, so the engine runs on an illustrative one-factor model (a beta and a volatility per ticker). The dashboard says so next to the numbers, and the limits are listed in the engine's README.

## Quick start

**Backend + database:**

```bash
cp backend/.env.example backend/.env   # then fill it in — see backend/README.md
docker compose up --build              # API on http://localhost:4000, plus Postgres and the risk engine
```

**Frontend:**

```bash
cd frontend
npm install
cp .env.example .env
npm run dev                            # http://localhost:5173
```

See [`backend/README.md`](backend/README.md) for the full API surface, environment variables, and Stripe setup.

## Before this can take real users

1. **Live price data.** The biggest remaining gap. Prices are entered by hand, and a portfolio tool where you retype every price won't retain anyone past day one.
2. **Deploy.** See [`DEPLOY-FREE.md`](DEPLOY-FREE.md) for the $0 path (Neon + Render + Vercel), or [`DEPLOY-AWS.md`](DEPLOY-AWS.md) for the AWS runbook — RDS, ECR, App Runner, and Amplify, with the cross-domain cookie and Apple Silicon build gotchas called out.
3. **Stripe live mode.** Create the product/price in live mode, register the production webhook endpoint, and swap the keys.
4. **SPA fallback.** Stripe returns users to `/billing/success?session_id=…`. Vite's dev server handles this automatically; a production static host needs a rewrite rule sending unknown paths to `index.html`.
5. **Email verification and password reset.** Neither exists yet.

## Security notes

- `backend/.env` is gitignored. Don't commit it. If a key ever lands in a commit, rotate it — scrubbing git history is not enough, it's already been published.
- The Anthropic API key lives server-side only, by design.
- Refresh tokens are stored as SHA-256 hashes, so a database dump doesn't hand out live sessions.
- Passwords are bcrypt-hashed at cost factor 12.

## License

MIT
