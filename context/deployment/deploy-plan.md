---
project: landmark-lore
planned_at: 2026-06-01
platform: Cloudflare Workers
worker_name: landmark-lore
worker_preview_name: landmark-lore-preview
runtime: @astrojs/cloudflare v13.5.0
deployed_at: 2026-06-13
production_url: https://landmark-lore.l-siemanski.workers.dev
---

# Deployment Plan — Landmark Lore

> **Status: ✅ DEPLOYED to production** (2026-06-13)
> Live: **https://landmark-lore.l-siemanski.workers.dev**
> First successful CI deploy: GitHub Actions run `27464077966` · Worker version `6174dcd5-c145-4693-a2eb-7937c0b89907`.
> Auto-deploy on push to `master` is active and green. The per-PR `preview` job is configured but has not been exercised yet (no PR has triggered it).

## What was already done (automated)

- [x] `wrangler.jsonc` renamed worker from `10x-astro-starter` → `landmark-lore`
- [x] `wrangler.jsonc` preview environment added (`landmark-lore-preview`)
- [x] `.github/workflows/ci.yml` extended with `deploy` job (push to `master`) and `preview` job (pull requests)
- [x] `observability: { enabled: true }` already present — Workers Logs active on first deploy

---

## What you must do before the first deploy

### Gate 1 — Cloudflare account

1. Log in at `dash.cloudflare.com`
2. Go to **Workers & Pages** — your Account ID appears in the right sidebar. Copy it.
3. Go to **My Profile → API Tokens → Create Token**
   - Use template: **Edit Cloudflare Workers**
   - Permissions: `Workers Scripts:Edit` + `Workers Scripts:Read`
   - Account Resources: your account only
   - Zone Resources: none needed
4. Copy the token — it is shown only once.

### Gate 2 — Supabase project values

1. Open your Supabase project dashboard
2. Go to **Settings → API**
3. Copy:
   - **Project URL** → this is `SUPABASE_URL`
   - **anon / public** key → this is `SUPABASE_KEY`

### Gate 2b — OpenRouter API key

1. Open `openrouter.ai` → **Keys** → create a key
2. Copy it → this is `OPENROUTER_API_KEY` (a Worker runtime secret, set in Step 1 below — not a GitHub Actions secret)

### Gate 3 — GitHub repository secrets

In your GitHub repo: **Settings → Secrets and variables → Actions → New repository secret**

Add all four:

| Secret name             | Value                  |
| ----------------------- | ---------------------- |
| `CLOUDFLARE_API_TOKEN`  | token from Gate 1      |
| `CLOUDFLARE_ACCOUNT_ID` | account ID from Gate 1 |
| `SUPABASE_URL`          | URL from Gate 2        |
| `SUPABASE_KEY`          | anon key from Gate 2   |

---

## First production deploy

### Step 1 — Set the Worker runtime secrets (required)

These are `access: "secret"` env values (see `astro.config.mjs` `env.schema`) —
read at **runtime** from the Worker, NOT baked into the build. They are separate
from the GitHub Actions secrets in Gate 3 (those only authenticate CI). The
Worker degrades gracefully until each is present:

| Secret                              | Symptom if missing / malformed                                                                   |
| ----------------------------------- | ------------------------------------------------------------------------------------------------ |
| `SUPABASE_URL`                      | login fails; a malformed value (e.g. trailing newline) → `Invalid path specified in request URL` |
| `SUPABASE_KEY`                      | login / DB calls fail                                                                            |
| `OPENROUTER_API_KEY`                | `/api/identify` → `503 AI provider not configured`                                               |
| `IDENTIFY_MODEL` _(optional)_       | falls back to default in `src/lib/ai/config.ts`                                                  |
| `IDENTIFY_DAILY_LIMIT` _(optional)_ | falls back to default                                                                            |

**Recommended — Cloudflare dashboard.** Workers & Pages → `landmark-lore` →
Settings → Variables and Secrets → add each as an **encrypted secret**. Pasting
in the dashboard is the reliable path and avoids the newline trap below. (Repeat
on `landmark-lore-preview` if you use PR previews.)

**Alternative — wrangler CLI.** ⚠️ Do **not** use `echo "$value" | wrangler secret put …`:
`echo` appends a newline that gets stored in the secret, corrupting e.g.
`SUPABASE_URL` into `…supabase.co\n` and breaking every request. Use interactive
mode, or `printf '%s'` (no trailing newline):

```bash
npx wrangler secret put SUPABASE_URL          # interactive: paste value, then Enter
# or non-interactively (no trailing newline):
printf '%s' 'https://<your-ref>.supabase.co' | npx wrangler secret put SUPABASE_URL
printf '%s' '<your-supabase-key>'            | npx wrangler secret put SUPABASE_KEY
printf '%s' '<your-openrouter-key>'          | npx wrangler secret put OPENROUTER_API_KEY
```

Runtime secrets persist across deploys and apply **immediately — no redeploy**.
Verify with `npx wrangler secret list`.

### Step 2 — Build and deploy

```bash
npm run build
npx wrangler deploy
```

Expected output:

```
Deployed landmark-lore (XX ms)
  https://landmark-lore.l-siemanski.workers.dev
```

After this, CI takes over — every push to `master` triggers the `deploy` job
automatically. CI re-runs `wrangler deploy`; the runtime secrets above live on
the Worker and persist independently of CI.

---

## Ongoing CI/CD

| Trigger                       | Job       | Action                                                 |
| ----------------------------- | --------- | ------------------------------------------------------ |
| Push to `master`              | `deploy`  | Builds + deploys to production Worker `landmark-lore`  |
| Pull request against `master` | `preview` | Builds + deploys to `landmark-lore-preview` for review |

Both jobs depend on the `ci` job (lint + build) passing first.

---

## Rollback

```bash
# List recent deployments
npx wrangler deployments list

# Roll back to previous deployment
npx wrangler rollback --message "reason for rollback"

# Roll back to a specific version
npx wrangler rollback <version-id> --message "reason"
```

Rollback is code-only — Supabase data is not affected.

---

## Operational commands

```bash
# Stream live logs (all requests)
npx wrangler tail --format json

# Stream only errors
npx wrangler tail --status error

# Update a secret without redeploying
npx wrangler secret put SUPABASE_KEY

# Check current deployment
npx wrangler deployments list
```

---

## Verification checklist

- [x] `wrangler deploy` succeeds → live `.workers.dev` URL (via CI `deploy` job, run `27464077966`)
- [x] `https://landmark-lore.l-siemanski.workers.dev` — homepage renders
- [x] `/auth/signin` — page loads without errors (confirms Supabase secrets are wired)
- [x] Cloudflare Dashboard → Workers → `landmark-lore` → Metrics → requests incrementing
- [x] Push a commit to `master` → GitHub Actions `deploy` job passes
- [ ] Open a test PR → `preview` job deploys to `landmark-lore-preview.l-siemanski.workers.dev` _(not yet run — no PR has triggered the preview job)_
- [x] `wrangler tail --status error` → no errors at idle

---

## Human-only operations (do not automate)

- Rotating Cloudflare account-level API keys
- Modifying DNS records
- Billing tier changes
- Deleting the Worker entirely (`wrangler delete`)
- Any action affecting other projects on the same Cloudflare account

---

## Risk notes (from infrastructure.md risk register)

| Risk                                              | Status                                                                                       |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Stale `cloudflare-pages` references               | `wrangler deploy` used throughout — Pages commands excluded                                  |
| Workers CPU time limit (free 10ms / paid metered) | Upgrade to paid ($5/mo) if 1101 errors appear; monitor `cpu_time_ms` in `wrangler tail` JSON |
| Edge latency to Supabase (300-400ms EU→US-East-1) | Deploy Supabase project in region closest to majority of users                               |
| Workers bundle size (1MB compressed)              | Check with `npx wrangler deploy --dry-run` before adding large dependencies                  |
| CPU billing spike under heavy upload              | Set Cloudflare billing alert at $10 and $25 in Dashboard → Billing                           |
