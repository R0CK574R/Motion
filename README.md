# Motion

Portfolio analytics — see what a portfolio is actually made of. Allocation breakdown, concentration risk, and an AI pass that classifies holdings by sector and asset class and describes the portfolio's shape in plain language.

Motion describes composition. It does not give investment advice, and never tells anyone what to buy, sell, or hold — that constraint is enforced in the AI system prompt, not just the footer.

```
motion/
├── backend/          Node/Express + Postgres API — auth, portfolio storage, AI proxy, Stripe
├── frontend/         React + Vite dashboard
└── docker-compose.yml
```

## Status

| Piece | State |
|---|---|
| Backend auth (JWT + rotated refresh cookie, revocation) | Working, smoke-tested end to end |
| Per-user portfolio storage (Postgres) | Working, smoke-tested |
| Subscription gating on the AI endpoint | Working (returns 402 without an active sub) |
| Stripe checkout / portal / webhook | Written, needs your Stripe keys to exercise |
| Frontend dashboard + adaptive theme | Working |
| Carved-stone cathedral backdrop (WebGL2 shaders, line-art fallback) | Working |
| Aperture logo intro (WebGL2, once per session, skippable) | Working |
| One-click demo mode (no signup wall) | Working |
| Login / register / session persistence | Working |
| Frontend wired to the backend (auth, persistence, paywall) | Working |
| Live market prices | Not built — prices are entered by hand |
| Deployment | Not deployed |

The backend was tested against a real Postgres instance: register → login → refresh with rotation → logout revocation → per-user holdings CRUD → subscription-gated analysis. All passed.

## How it fits together

The frontend holds the access token **in memory only** — never `localStorage`, which any XSS payload can read. The session survives a page reload via the httpOnly refresh cookie: on mount the app calls `/api/auth/refresh`, and a single-flight refresh transparently retries any request that 401s.

Portfolio edits autosave on an 800 ms debounce. New rows stay local until they have a ticker and share count, so half-typed input never reaches the database. Before running the X-ray the client flushes pending saves first — the server analyzes what's in the database, so unsaved edits would otherwise produce a reading of a stale portfolio.

The AI call goes to `POST /api/analysis`, which holds the Anthropic key server-side, recomputes the portfolio from the database rather than trusting client numbers, and returns 402 without an active subscription. The paywall is enforced on the server, not hidden in the UI.

One note on Postgres: `NUMERIC` columns come back as **strings** (`"25.000000"`), so `lib/portfolioModel.js` normalizes them to numbers on load. Skip that and you get string concatenation instead of arithmetic.

## The backdrop

The background is a Gothic cathedral facade rendered live with WebGL2 shaders (`frontend/src/lib/cathedral.js`). It takes three passes:

1. **Scene.** Evaluates the rose window, the lancet arcade, and the quatrefoil wall as an analytic height field, using rotational symmetry folds.
2. **Light.** Lights that height field like carved stone, with surface normals, soft cast shadows, ambient occlusion, and grain. Window openings are cut through to pure black.
3. **Resolve.** Supersamples the result down to the screen, so ordinary 1× monitors get Retina-quality edges.

The facade renders once per resize or theme change, never per frame, so it costs nothing while you scroll. Day mode is morning sun on limestone; night mode is moonlit silver tracery. Where WebGL2 isn't available, it falls back to SVG line art.

## The intro

On a visitor's first load, Motion's aperture logo appears as a carved-stone iris, rendered in a single WebGL2 shader (`frontend/src/lib/apertureIntro.js`). It swings up to face the viewer, light sweeps across it, the six blades open from a black pupil, and the view flies through the opening into the app. The opening is transparent, so the real first screen shows through as the iris widens.

It runs for 1.85 seconds and plays once per browser session. Any click, tap, or key skips it. It is skipped entirely for visitors who prefer reduced motion and on browsers without WebGL2. The blade geometry matches the lucide Aperture icon in the header: six blades around a flat-topped hexagon, each edge running on clockwise as the seam over the next blade.

## Quick start

**Backend + database:**

```bash
cp backend/.env.example backend/.env   # then fill it in — see backend/README.md
docker compose up --build              # API on http://localhost:4000
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
