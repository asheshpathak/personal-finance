# Deployment

One GitHub repo, two independently deployed services:

| Service | Platform | Root directory |
| --- | --- | --- |
| `frontend` (Vite + React SPA) | Vercel | `frontend` |
| `backend` (Express + MongoDB) | Railway | `backend` |

Both platforms watch the same repo and only build when their own subdirectory changes.

---

## Order matters

Deploy the **backend first**. The frontend bakes `VITE_API_URL` into its bundle at build
time, so it needs the Railway URL to exist before it builds. Then come back and set
`CORS_ORIGINS` on Railway once you know the Vercel URL.

---

## 1. Database (MongoDB Atlas)

Railway has no built-in MongoDB, so use Atlas (the free M0 tier is enough).

1. Create a cluster and a database user.
2. **Network Access → Add IP Address → Allow access from anywhere (`0.0.0.0/0`)**.
   Railway does not publish static egress IPs on the starter plans, so an allowlist
   of specific IPs will silently fail to connect.
3. Copy the connection string; it becomes `MONGODB_URI`.

## 2. Backend → Railway

**New Project → Deploy from GitHub repo → set Root Directory to `backend`.**

[railway.json](backend/railway.json) already declares the build command, start command,
and a `/health` healthcheck, so no manual build settings are needed.

Set these service variables:

| Variable | Value |
| --- | --- |
| `MONGODB_URI` | Atlas connection string from step 1 |
| `JWT_SECRET` | `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` |
| `NODE_ENV` | `production` |
| `CORS_ORIGINS` | *(leave empty for now — fill in after step 3)* |
| `NPM_CONFIG_PRODUCTION` | `false` |
| `ANTHROPIC_API_KEY` | *(optional — see below)* |

Do **not** set `PORT`; Railway injects it and the server reads it.

`NPM_CONFIG_PRODUCTION=false` is required because the build runs `tsc`, which lives in
`devDependencies`. With the default production setting npm omits those and the build
fails with `tsc: not found`. It only affects the build image, not what runs.

### AI features are optional

`ANTHROPIC_API_KEY` switches on natural-language capture, the briefing on Home, the
budget reviewer and Ask Tetra. Leave it unset and every one of those surfaces hides
itself — the app has no degraded mode, no disabled buttons and no error states from
the absence. Everything else works exactly the same.

The key is read **server-side only**. It must never be given to the frontend: Vite
inlines any `VITE_`-prefixed value into the browser bundle, so a key handed to the
client is a key published on the internet. Every AI call in this app goes through the
Express server, authenticated by the same JWT as `/api/expenses`.

Two related knobs, both optional:

| Variable | Default | What it does |
| --- | --- | --- |
| `ANTHROPIC_MODEL` | `claude-sonnet-5` | Pinned in config so an upgrade is deliberate |
| `AI_REQUESTS_PER_HOUR` | `60` | Per-account ceiling, to bound the bill if a client loops |

Sonnet 5 is the default rather than Opus: roughly 2.5x cheaper per token in both
directions, and it spends far less thinking on its way to an answer. Nothing this
app asks is a hard reasoning problem.

Do **not** drop to `claude-haiku-4-5` without checking the cache floor. Its
minimum cacheable prefix is 4,096 tokens against Sonnet's 1,024; a smaller
financial context would fall under it and silently never cache — no error,
`cache_creation_input_tokens` simply stays 0 — and every request would then pay
full price for the whole prefix. The cheaper model would cost more.

Then **Settings → Networking → Generate Domain** to get a public URL. Verify:

```sh
curl https://<your-service>.up.railway.app/health
# {"status":"ok","db":"connected"}
```

If `db` says `disconnected`, the Atlas IP allowlist or the connection string is wrong.

## 3. Frontend → Vercel

**Add New Project → import the same repo → set Root Directory to `frontend`.**

Framework preset auto-detects as Vite; [vercel.json](frontend/vercel.json) handles the
rest, including the SPA rewrite that keeps `/expenses` and other deep links from 404ing
on refresh.

Set one environment variable, for all environments:

| Variable | Value |
| --- | --- |
| `VITE_API_URL` | `https://<your-service>.up.railway.app` — no trailing slash, no `/api` |

Deploy, then copy the resulting Vercel URL.

## 4. Close the CORS loop

Back on Railway, set `CORS_ORIGINS` to your Vercel production URL:

```
CORS_ORIGINS=https://your-app.vercel.app
```

Railway redeploys automatically. Until this is set the API accepts any origin, which is
fine for a first smoke test but should not be left that way.

To also allow Vercel preview deployments, add their origins as a comma-separated list.
Preview URLs are generated per-deploy, so this is easiest with a stable custom domain.

---

## Gotcha: don't put `npm ci` in Railway's build command

Nixpacks mounts a build cache at `/app/node_modules/.cache`. `npm ci` works by deleting
`node_modules` wholesale before reinstalling, and it cannot remove a live mount:

```
npm error EBUSY: resource busy or locked, rmdir '/app/node_modules/.cache'
```

Railway already runs its own install phase before the build phase, so `buildCommand`
should only ever be `npm run build`. Use `npm install` if you genuinely need to install
inside the build phase — never `npm ci`.

## Gotcha: `VITE_API_URL` is build-time, not run-time

Vite inlines `import.meta.env.VITE_*` values into the JS bundle during `npm run build`.
Changing the variable in the Vercel dashboard does **nothing** to an already-built
deployment — you must trigger a redeploy for it to take effect. This is the single most
common cause of a deployed frontend still pointing at `localhost`.

Verify what actually shipped:

```sh
curl -s https://your-app.vercel.app/assets/index-*.js | grep -o 'https://[a-z0-9.-]*railway[a-z.]*'
```

## Local development

```sh
# backend
cd backend && cp .env.example .env && npm install && npm run dev

# frontend (separate terminal)
cd frontend && npm install && npm run dev
```

The frontend falls back to `http://localhost:5001` when `VITE_API_URL` is unset, so no
`.env.local` is needed locally unless you want to point at the deployed API.

Note that with no `.env`, the backend logs a warning and boots with an insecure default
`JWT_SECRET`. That fallback is disabled when `NODE_ENV=production` — the server refuses
to start instead, so a missing secret fails loudly at deploy time rather than shipping a
forgeable token.

## Pre-deploy checklist

```sh
cd backend  && npm run build && ls dist/index.js   # start script needs this to exist
cd frontend && npx tsc --noEmit && npm run build
```
