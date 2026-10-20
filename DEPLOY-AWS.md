# Deploying Motion to AWS

This is the runbook for taking Motion from localhost to a public URL. Budget 3–5 hours the first time.

**Cost warning before you start.** RDS `db.t4g.micro` is free-tier eligible for 12 months (750 hrs/month), but App Runner has **no free tier** — expect roughly **$5–15/month** even with zero traffic, because you pay for provisioned memory. Set a billing alarm before you deploy anything:

> AWS Console → Billing → Budgets → Create budget → Zero-spend or a $10 monthly cap with an email alert.

Delete resources when you're done experimenting. An idle App Runner service left running for a year is a real bill.

---

## Architecture

```
Browser
  ├── Frontend  →  AWS Amplify Hosting (static React build, free HTTPS)
  └── API       →  AWS App Runner (Docker container, free HTTPS)
                      └── RDS Postgres (private, via VPC connector)
```

App Runner over ECS Fargate here on purpose: Fargate needs a VPC, ALB, target groups, security groups, and a task definition before it serves a single request. App Runner gives you HTTPS and a public hostname out of the box. Once this is live and you want the harder infra credential, migrating to ECS is a good follow-up project.

---

## Step 1 — RDS Postgres

1. RDS → **Create database** → PostgreSQL → **Free tier** template
2. Instance: `db.t4g.micro`. Storage: 20 GB, **uncheck** storage autoscaling
3. Set a master username and password — **save them now**, you can't view the password again
4. Initial database name: `motion`
5. Public access: **Yes** for now (simplest path; see the hardening note at the bottom)
6. Create, then wait ~5 minutes for status **Available**
7. Copy the **endpoint** — looks like `motion-db.abc123.us-west-1.rds.amazonaws.com`
8. Click the DB's VPC security group → Inbound rules → Add rule → PostgreSQL (5432), Source: **My IP**

Apply the schema from your laptop:

```bash
cd backend
DATABASE_URL="postgres://USER:PASSWORD@YOUR-ENDPOINT:5432/motion" PGSSL=true npm run migrate
```

You should see the five tables listed back. If it hangs, the security group rule isn't letting your IP through.

---

## Step 2 — Push the container image to ECR

```bash
# from repo root
aws ecr create-repository --repository-name motion-api --region us-west-1

# authenticate docker to ECR (replace ACCOUNT_ID and region)
aws ecr get-login-password --region us-west-1 \
  | docker login --username AWS --password-stdin ACCOUNT_ID.dkr.ecr.us-west-1.amazonaws.com

cd backend

# --platform linux/amd64 is REQUIRED on Apple Silicon. Without it you build an
# arm64 image, App Runner fails with "exec format error", and the message gives
# you no hint that architecture is the problem.
docker build --platform linux/amd64 -t motion-api .

docker tag motion-api:latest ACCOUNT_ID.dkr.ecr.us-west-1.amazonaws.com/motion-api:latest
docker push ACCOUNT_ID.dkr.ecr.us-west-1.amazonaws.com/motion-api:latest
```

Needs the AWS CLI installed and `aws configure` run once with an access key.

---

## Step 3 — App Runner service

1. App Runner → **Create service** → Container registry → Amazon ECR → pick your image
2. Deployment trigger: Manual (switch to automatic later)
3. Service settings: port **4000**
4. Environment variables — set these:

| Variable | Value |
|---|---|
| `NODE_ENV` | `production` |
| `PORT` | `4000` |
| `DATABASE_URL` | your RDS connection string |
| `PGSSL` | `true` |
| `TRUST_PROXY` | `1` |
| `COOKIE_SAMESITE` | `none` |
| `JWT_ACCESS_SECRET` | generate a fresh one, not your local value |
| `ANTHROPIC_API_KEY` | your key |
| `APP_URL` | leave blank for now — you don't have the frontend URL yet |

5. Health check path: `/health`
6. Create, wait ~5 minutes, copy the service URL (`https://xxxx.us-west-1.awsapprunner.com`)

Verify: `curl https://YOUR-APP-RUNNER-URL/health` → `{"ok":true}`

---

## Step 4 — Frontend on Amplify

```bash
cd frontend
echo "VITE_API_URL=https://YOUR-APP-RUNNER-URL" > .env.production
npm run build
```

**Vite inlines env vars at build time**, not runtime. Changing the API URL later means rebuilding and redeploying — editing a config file on the server does nothing.

Then: Amplify → **Deploy without Git provider** → drag the `frontend/dist` folder in.

(Or connect the GitHub repo, set base directory to `frontend`, build command `npm run build`, output directory `dist`, and add `VITE_API_URL` as an Amplify environment variable — that gives you deploy-on-push.)

**Add the SPA rewrite** or Stripe's return URL 404s: Amplify → Rewrites and redirects → add
`</^[^.]+$|\.(?!(css|gif|ico|jpg|js|png|txt|svg|woff|woff2|ttf|map|json)$)([^.]+$)/>` → `/index.html` → **200 (Rewrite)**

---

## Step 5 — Connect the two

Go back to App Runner → Configuration → Environment variables → set `APP_URL` to your Amplify URL, then deploy. CORS rejects the frontend until you do this.

Now open the Amplify URL and register an account. **Then refresh the page.** If you're still logged in, the cross-domain cookie is working. If you get bounced to the login screen, `COOKIE_SAMESITE=none` didn't take — check it in App Runner's env vars.

---

## Step 6 — Stripe

1. Stripe Dashboard → create a Product and a recurring Price → copy the price ID
2. Developers → Webhooks → Add endpoint → `https://YOUR-APP-RUNNER-URL/api/billing/webhook`
3. Events: `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`
4. Copy the signing secret (`whsec_…`)
5. Set `STRIPE_SECRET_KEY`, `STRIPE_PRICE_ID`, `STRIPE_WEBHOOK_SECRET` in App Runner and redeploy

Stay in **test mode** until the flow works end to end. Live mode needs real business details and moves real money.

---

## Failure modes, ranked by how likely they are to get you

| Symptom | Cause |
|---|---|
| Login works, session gone on refresh | `COOKIE_SAMESITE=none` not set |
| App Runner: "exec format error" | Built arm64 on Apple Silicon — rebuild with `--platform linux/amd64` |
| Browser console: CORS error | `APP_URL` in App Runner doesn't exactly match the Amplify origin (check https, no trailing slash) |
| Frontend calls `localhost:4000` in production | Forgot `.env.production` before `npm run build` |
| Migration hangs | RDS security group doesn't allow your IP |
| Stripe pays but no access | Webhook URL wrong, or the signing secret doesn't match |
| 404 on `/billing/success` | Amplify SPA rewrite rule missing |

---

## Hardening once it works

- Make RDS **private** and connect App Runner through a **VPC connector** instead of public access
- Move secrets from plain env vars into **AWS Secrets Manager**
- Add a custom domain in Amplify. If you put the frontend and API on the same registrable domain (`app.motion.com` + `api.motion.com`), you can drop back to `COOKIE_SAMESITE=lax`, which is stricter and safer
- Enable automatic deployments from ECR
- Turn on CloudWatch alarms for App Runner 5xx rates

## Tearing it down

Delete in this order to avoid orphaned charges: App Runner service → RDS instance (**uncheck** final snapshot if you don't want it) → ECR repository → Amplify app.
