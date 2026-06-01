---
project: landmark-lore
planned_at: 2026-06-01
platform: Cloudflare Workers
worker_name: landmark-lore
worker_preview_name: landmark-lore-preview
runtime: @astrojs/cloudflare v13.5.0
---

# Deployment Plan — Landmark Lore

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

### Gate 3 — GitHub repository secrets

In your GitHub repo: **Settings → Secrets and variables → Actions → New repository secret**

Add all four:

| Secret name | Value |
|---|---|
| `CLOUDFLARE_API_TOKEN` | token from Gate 1 |
| `CLOUDFLARE_ACCOUNT_ID` | account ID from Gate 1 |
| `SUPABASE_URL` | URL from Gate 2 |
| `SUPABASE_KEY` | anon key from Gate 2 |

---

## First production deploy (run once locally)

```bash
# 1. Set Supabase secrets in Cloudflare (run interactively or pipe values)
echo "<your-supabase-url>" | npx wrangler secret put SUPABASE_URL
echo "<your-supabase-anon-key>" | npx wrangler secret put SUPABASE_KEY

# 2. Build and deploy
npm run build
npx wrangler deploy
```

Expected output:
```
Deployed landmark-lore (XX ms)
  https://landmark-lore.<account>.workers.dev
```

After this, CI takes over — every push to `master` triggers the `deploy` job automatically.

---

## Ongoing CI/CD

| Trigger | Job | Action |
|---|---|---|
| Push to `master` | `deploy` | Builds + deploys to production Worker `landmark-lore` |
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

- [ ] `wrangler deploy` succeeds locally → note the `.workers.dev` URL
- [ ] `https://landmark-lore.<account>.workers.dev` — homepage renders
- [ ] `/auth/signin` — page loads without errors (confirms Supabase secrets are wired)
- [ ] Cloudflare Dashboard → Workers → `landmark-lore` → Metrics → requests incrementing
- [ ] Push a commit to `master` → GitHub Actions `deploy` job passes
- [ ] Open a test PR → `preview` job deploys to `landmark-lore-preview.<account>.workers.dev`
- [ ] `wrangler tail --status error` → no errors at idle

---

## Human-only operations (do not automate)

- Rotating Cloudflare account-level API keys
- Modifying DNS records
- Billing tier changes
- Deleting the Worker entirely (`wrangler delete`)
- Any action affecting other projects on the same Cloudflare account

---

## Risk notes (from infrastructure.md risk register)

| Risk | Status |
|---|---|
| Stale `cloudflare-pages` references | `wrangler deploy` used throughout — Pages commands excluded |
| Workers CPU time limit (free 10ms / paid metered) | Upgrade to paid ($5/mo) if 1101 errors appear; monitor `cpu_time_ms` in `wrangler tail` JSON |
| Edge latency to Supabase (300-400ms EU→US-East-1) | Deploy Supabase project in region closest to majority of users |
| Workers bundle size (1MB compressed) | Check with `npx wrangler deploy --dry-run` before adding large dependencies |
| CPU billing spike under heavy upload | Set Cloudflare billing alert at $10 and $25 in Dashboard → Billing |
