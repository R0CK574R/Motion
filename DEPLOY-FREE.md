# Deploying Motion for free

Puts Motion on a public address for $0 a month, with no credit card: the database on Neon, the API and the risk engine on Render, the website on Vercel. Allow about 30 minutes, most of it waiting for builds.

For the paid AWS route, see [`DEPLOY-AWS.md`](DEPLOY-AWS.md).

```
Visitor ──> Vercel: the website, with /api/* forwarded to ──> Render: API (Java) ──> Neon: Postgres
                                                                   │
                                                                   └──> Render: risk engine (C++)
```

Two choices shape this setup:

- **The website and the API share one address.** Vercel forwards every `/api/*` request to the API (the rule is in [`frontend/vercel.json`](frontend/vercel.json)), so the sign-in cookie belongs to the website's own address. Safari blocks cookies sent between different sites, as do stricter privacy settings in other browsers, and that would sign those visitors out on every reload.
- **The database is on Neon, not Render.** Render's free Postgres is deleted after 30 days; Neon's free tier does not expire.

Do the steps in order: Render asks for the database string and the website's address when it creates the services, so you need both first.

---

## 1. Database: Neon (5 minutes)

1. Go to [neon.com](https://neon.com) and sign up with GitHub. No card is needed.
2. Create a project:
   - **Project name:** `motion`
   - **Region:** AWS US West 2 (Oregon). The API runs in Render's Oregon region, so the two sit next to each other.
   - Leave the Postgres version as it is.
3. On the project's dashboard, click **Connect**. In the window that opens, turn **Connection pooling** off, then copy the connection string. It starts with `postgresql://` and ends with `sslmode=require&channel_binding=require`.

The string contains the database password. Paste it only into Render in step 3: never into a file in the repo, an issue or a chat.

Pooling is off because the API keeps its own small pool, and the migration tool that creates the tables needs a direct connection. There is no schema to load by hand: the API creates its tables the first time it starts.

## 2. Website: Vercel (5 minutes)

1. Go to [vercel.com](https://vercel.com), click **Sign Up**, choose the **Hobby** plan and **Continue with GitHub**.
2. Click **Add New…** > **Project**. Under **Import Git Repository**, find **Motion** and click **Import**. If it is not listed, click **Adjust GitHub App Permissions** and give Vercel access to the repository.
3. On **Configure Project**:
   - **Project Name:** `motion-r0ck574r`. This becomes the address, https://motion-r0ck574r.vercel.app.
   - **Root Directory:** click **Edit**, choose `frontend`, then **Continue**.
   - **Framework Preset:** Vite. Vercel fills this in.
   - Leave **Environment Variables** empty.
4. Click **Deploy**. When it finishes, copy the address shown under **Domains**.

The site opens but says it can't reach its server, because the API does not exist yet. That's expected.

## 3. API and risk engine: Render (15 minutes, mostly building)

1. Go to [render.com](https://render.com), click **Get Started** and sign up with GitHub. Free instances need no card.
2. Click **New** > **Blueprint**. Connect GitHub if asked, then pick **R0CK574R/Motion**. Render reads [`render.yaml`](render.yaml) from the repository.
3. Name the Blueprint `motion`. Render lists two web services on the Free plan, `motion-api-r0ck574r` and `motion-risk-r0ck574r`, and asks for two values:
   - **DATABASE_URL:** the Neon string from step 1.
   - **APP_URL:** the Vercel address from step 2, starting with `https://` and with no `/` at the end.

   Everything else is already set. Render generates the API's signing secret and the token the API uses to call the risk engine.
4. Click **Deploy Blueprint**. The risk engine builds in about 3 minutes and the API in 5 to 10. Both should end as **Live**.
5. Open each service and check the address at the top of its page:
   - `https://motion-api-r0ck574r.onrender.com`
   - `https://motion-risk-r0ck574r.onrender.com`

   If either has extra characters (Render adds some when a name is already taken), see [If an address is different](#if-an-address-is-different).

Leave your Anthropic API key off Render. Demo visitors get sample answers and never reach the model, so nothing needs it. Add it only if you want real accounts to call the model, which costs credits.

## 4. Check it the way a recruiter would

Open the Vercel address in a private window.

1. The first visit after a quiet spell shows **Starting the server** for about a minute while both services wake up.
2. Click **Try the demo without signing up**. You land on a seeded portfolio: 7 holdings worth $69,065.
3. The risk section fills in with value at risk and stress tests. If it says **Starting the risk engine**, give it a minute.
4. Click **What is my largest position?** The answer is a sample built from the portfolio's own numbers.
5. Reload the page. You should still be signed in.

Or let GitHub run the same browser test CI uses, against the live site: **Actions** tab > **Live check** > **Run workflow**, paste the Vercel address, then **Run workflow**. It wakes both services first.

---

## If an address is different

- **API:** in [`frontend/vercel.json`](frontend/vercel.json), replace `motion-api-r0ck574r.onrender.com` with the real address and commit to `main`. Vercel redeploys by itself.
- **Risk engine:** Render > `motion-api-r0ck574r` > **Environment** > set `RISK_ENGINE_URL` to the real address > **Save, rebuild, and deploy**. Use the same address in Live check's risk engine field.
- **Website** (you renamed the Vercel project or added your own domain): Render > `motion-api-r0ck574r` > **Environment** > `APP_URL`.

## After this, every push to `main`

- Vercel rebuilds the website.
- Render rebuilds a service only when its own folder (`backend/` or `risk-engine/`) changed, and only after CI has passed on that commit.
- The API applies any new database migrations when it starts.

Vercel also builds a preview for each pull request. The API accepts browser requests only from `APP_URL`, so a preview may not be able to sign in; try changes on the main address after merging.

## What the free tier is like

Measured in CI by the `free-tier` job, which runs both services under the same limits as Render's free instances (0.1 CPU, 512 MB):

| | |
|---|---|
| API start from asleep | 26 to 41 s across runs; about 80 s before the image was tuned, 2 s on a full CPU |
| Risk engine start | 4 to 6 s |
| Demo sign-in | 2 s the first time, 0.4 s after |
| Other requests | 0.3 to 0.5 s |
| Peak memory | API 132 MB, risk engine 46 MB, of 512 MB each |

Render also needs time to schedule the instance and pull the image, so a visitor waits a little longer than the start time above.

| Service | Free plan |
|---|---|
| Render | 0.1 CPU and 512 MB per service. Sleeps after 15 minutes without traffic and takes about a minute to wake. 750 instance hours a month per workspace. |
| Neon | 1 GB of storage and 100 compute hours a month. Suspends after 5 minutes without queries and resumes in under a second. |
| Vercel | Hobby plan, for personal projects. |

Don't add an uptime pinger to keep the services awake. Two services awake all month need about 1,440 instance hours, nearly twice Render's 750, and Render would suspend them until the month ends. If the wake-up matters during application season, a paid instance for the API removes it.

Demo accounts delete themselves after 24 hours, so the database stays small.

## Putting it on your resume

Link the live address and the repository, and say what it is in one line:

> **Motion**: portfolio analytics built on a double-entry ledger. Java/Spring Boot, C++ risk engine, React, PostgreSQL, Claude API. Append-only ledger enforced by database triggers, audit log, rotating refresh tokens, AI answers checked against the ledger's own numbers. *[live demo] · [GitHub]*

Point the link at the Vercel address. The demo button lets whoever clicks it see the real product at once, with no sign-up.
