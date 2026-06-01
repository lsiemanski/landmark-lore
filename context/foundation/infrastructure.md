---
project: landmark-lore
researched_at: 2026-05-30
recommended_platform: Cloudflare Workers
runner_up: Vercel
context_type: mvp
tech_stack:
  language: TypeScript
  framework: Astro 6 + React 19
  runtime: Cloudflare workerd (edge) / Node 22 for builds
  database: Supabase (PostgreSQL + Auth + Storage, external)
---

## Recommendation

**Deploy on Cloudflare Workers.**

Cloudflare Workers is the only platform in the candidate pool that scores Pass on all five agent-friendly criteria, is already wired into the project (the `wrangler.jsonc` at the repo root confirms this), and provides a free tier (100k requests/day) that comfortably covers the full MVP lifecycle without a credit card. The `@astrojs/cloudflare` v13+ adapter targets Workers exclusively — not Pages — so the deployment model is correct as-is. The three risks surfaced by the anti-bias cross-check (edge latency against Supabase, CPU time limits on AI routes, and stale community resources referencing the old Pages model) are all manageable at MVP scale and are recorded in the risk register below.

> **Important clarification on the stack doc:** `tech-stack.md` states `deployment_target: cloudflare-pages`. As of `@astrojs/cloudflare` v13+ (released alongside Astro 6), Cloudflare Pages no longer supports SSR. The actual deployment target is **Cloudflare Workers** — the existing `wrangler.jsonc` at the repo root reflects this correctly. The stack doc label is stale and should be treated as "Cloudflare" rather than "Cloudflare Pages" specifically.

## Platform Comparison

| Platform | CLI-first | Managed | Agent docs | Deploy API | MCP | **Total** |
|---|---|---|---|---|---|---|
| **Cloudflare Workers** | Pass | Pass | Pass | Pass | Pass | **10** |
| Vercel | Pass | Pass | Pass | Pass | Partial | 9 |
| Netlify | Partial | Pass | Pass | Pass | Pass | 9 |
| Fly.io | Partial | Partial | Partial | Pass | Partial | 6 |
| Railway | Partial | Partial | Partial | Partial | Pass | 6 |
| Render | Partial | Partial | Pass | Partial | Partial | 6 |

**Scoring notes:**

- **CLI-first:** Cloudflare and Vercel both Pass — `wrangler rollback` and `vercel rollback` are first-class CLI commands. Netlify, Fly.io, Railway, and Render all score Partial: rollback requires the dashboard or API (no dedicated CLI command).
- **Managed:** Cloudflare, Vercel, and Netlify all Pass — fully managed serverless, zero OS/network exposure. Fly.io, Railway, and Render score Partial — container-based, which introduces Dockerfile or Nixpacks config as a management surface.
- **Agent docs:** Cloudflare (`cloudflare.com/llms.txt` + `llms-full.txt`), Vercel (`vercel.com/llms.txt`), Netlify (`docs.netlify.com/llms.txt`), and Render (`render.com/llms.txt` + `llms-full.txt`) all Pass. Fly.io and Railway score Partial — docs are on GitHub as Markdown but no structured `llms.txt` index exists.
- **Deploy API:** Cloudflare (`wrangler deploy`), Vercel (`vercel --prod`), Netlify (`netlify deploy --prod`), and Fly.io (`fly deploy`) all Pass — deterministic one-command deploys with structured exit codes. Railway (`railway up`) and Render (`render deploys create`) score Partial — rollback is not CLI-scriptable.
- **MCP:** Cloudflare (13 MCP servers, GA May 2025) and Netlify (official MCP server, GA June 2025) and Railway (MCP server GA, both local and remote OAuth) Pass. Vercel (Public Beta, 13 tools, read-heavy) and Fly.io (`fly mcp server`, experimental) and Render (GA but cannot trigger deploys) score Partial.

**Soft-weight adjustments applied:**

- Q4 (single region): Slightly penalizes Cloudflare's edge architecture — the project doesn't need global distribution. Applied as a noted risk, not a score adjustment, since Workers still operates fine single-region and the free tier is a hard advantage.
- Q5 (co-location preferred): The stack commits to Supabase as external provider, so no platform achieves true co-location for the data layer. Cloudflare's D1/R2/KV are complements (not replacements) and can be adopted incrementally. This preference was noted but did not change the shortlist.

### Shortlisted Platforms

#### 1. Cloudflare Workers (Recommended)

Perfect score across all five criteria. `wrangler` covers every routine operation via CLI including rollback with audit messages (`wrangler rollback --message "reason"`). Thirteen GA MCP servers (Workers Observability, Bindings, Pages management) launched May 2025. Free tier: 100k requests/day with unlimited static asset requests — comfortably covers the entire MVP lifecycle before the first user. The project already has `wrangler.jsonc` in the repo root and the `@astrojs/cloudflare` adapter is the official path for Astro 6 SSR. Supabase has a documented, GA integration with Cloudflare Workers (HTTP via PostgREST, no persistent connection needed). Workers KV auto-provisions for Astro sessions.

#### 2. Vercel

Full CLI coverage including `vercel rollback`, `vercel logs --json`, `vercel bisect` for regression hunting, and `vercel promote` to graduate a preview to production. `vercel.com/llms.txt` is comprehensive. `@astrojs/vercel` adapter is GA and maintained by Astro core. Single-region Node.js runtime means Supabase latency is predictable (deploy in the same region as your Supabase project). 300s function timeout on Pro handles long-running AI API calls with headroom. MCP server is in Public Beta — functional but limited to read-only operations (13 tools, no deploy triggering as of research). Cost: $0 on Hobby (non-commercial only) or $20/month Pro. Gaps vs. the recommendation: Hobby plan prohibits commercial use; MCP is not GA; slightly higher cost for the same workload.

#### 3. Netlify

GA MCP server (June 2025) with full site/deploy management. `netlify deploy --prod` is safe-by-default (requires explicit `--prod` flag). `docs.netlify.com/llms.txt` confirmed. Flat $20/month Pro (unlimited seats). Active caveat: `@astrojs/netlify` 6.5.0/6.5.1 has an unresolved edge runtime crash bug — pin to 6.4.x until fixed. Function timeout is 26 seconds (paid) — adequate for most AI API calls but tight if the identification provider is slow under load. No CLI rollback command; rollback is UI-only via "Publish Deploy." Dropped from first place primarily because of the active adapter bug and the tighter function timeout ceiling.

## Anti-Bias Cross-Check: Cloudflare Workers

### Devil's Advocate — Weaknesses

1. **`tech-stack.md` calls it "cloudflare-pages" but Pages SSR is gone.** The @astrojs/cloudflare v13+ adapter dropped Pages SSR support. Most community tutorials, StackOverflow answers, and GitHub examples still describe the Pages model. When debugging, wrong answers will be consistently found. This is the highest day-to-day friction risk for a solo developer working after hours.

2. **Edge architecture creates structural latency against Supabase.** Workers execute at the closest edge PoP to the user. Supabase lives in one fixed region (e.g., us-east-1). A user in Warsaw hits a Worker in Frankfurt that queries Supabase in Virginia — 200-400ms round-trip for DB calls, structurally worse than a co-located single-region server. The user confirmed "single region is fine," which argues against the edge model Cloudflare Workers is optimized for.

3. **Workers CPU time limits can bite AI-heavy server routes.** Free tier: 10ms CPU per invocation. Wall-clock time waiting on the AI API does not count, but rendering the Astro component tree, parsing the API response, Zod validation, and serializing HTML all do. AI-integrated SSR apps have heavier server-side rendering passes than static content apps. This limit is easy to miss in testing and can surface as 1101 errors under production load.

4. **Workers bundle size limit: 1MB compressed.** The Astro 6 + React 19 server bundle plus dependencies must fit. The adapter handles code-splitting, but large AI SDKs or image-processing dependencies can push this. The deploy fails hard at the limit with no gradual warning.

5. **Preview deployments require explicit setup.** Cloudflare Pages had built-in per-PR preview URLs at no extra cost. With Workers, previews need a `--env` flag in wrangler config or a custom GitHub Actions workflow. The CI auto-deploy referenced in `tech-stack.md` must be explicitly authored — it is not zero-config.

### Pre-Mortem — How This Could Fail

The Landmark Lore team launched on Cloudflare Workers because the bootstrapper said "cloudflare-pages" and wrangler was already configured. The first friction appeared at week one: the GitHub Actions CI workflow for auto-deploy was missing, and every tutorial found described the Pages model — wrong flags, wrong config format, wrong deploy command. Three hours were spent authoring the workflow from scratch.

Month two: the AI identification endpoint started throwing 1101 errors under moderate upload volume. The Workers free tier 10ms CPU limit was being hit during Astro server-side rendering + AI response parsing. Upgrading to the $5/month paid plan fixed it, but the CPU-time billing model was opaque — a week of heavy uploads generated an unexpected $45 invoice before the team understood what was being metered.

The subtler, longer-term problem was Supabase latency. Workers at the edge execute close to users but far from Supabase. European users saw 250-400ms database round-trips compared to the 40-80ms the team expected from a local test environment. The "edge" model was optimized for a globally distributed, mostly-static workload — Landmark Lore is user-specific, auth-gated, and data-heavy. Six months in, the team seriously considered migrating to a single-region Node.js server (Vercel Pro, same Supabase region) to recover the latency budget.

### Unknown Unknowns

- **Workers CPU time accounting is counterintuitive for AI workloads.** Awaiting an external API response costs zero CPU time. But parsing the response, Zod validation, rendering React components, and serializing HTML all do. AI-integrated SSR apps hit the CPU budget in ways that pure API-proxy Workers don't.
- **The @astrojs/cloudflare Pages→Workers migration is recent enough that the ecosystem hasn't caught up.** Community search results for "Astro Cloudflare deploy" overwhelmingly surface Pages instructions. Stale resources will be the default find when debugging.
- **`wrangler.jsonc` is not widely supported outside Cloudflare tooling.** IDE validators, CI config linters, and community examples use `wrangler.toml`. Format friction is ongoing.
- **GitHub Actions CI requires a scoped Cloudflare API token.** The token needs `Workers Scripts:Edit` + `Workers Scripts:Read` for the specific account. Cloudflare's error messages for wrong token scope are not diagnostic.
- **The free tier's 100k requests/day is account-wide, not per project.** Other Workers on the same Cloudflare account share the daily budget.

**User decision:** Proceed with Cloudflare Workers — all risks absorbed into the risk register below.

## Operational Story

- **Preview deploys:** No automatic per-PR previews out of the box with Workers. Set up a wrangler environment (e.g., `[env.preview]` in `wrangler.jsonc`) and a GitHub Actions job that runs `wrangler deploy --env preview` on pull requests. Preview Workers are deployed to a `<name>-preview.<account>.workers.dev` subdomain. Add Cloudflare Access in front of preview URLs to prevent public exposure of pre-release builds.
- **Secrets:** Environment variables go in `wrangler.jsonc` for non-sensitive values. Secrets go through `wrangler secret put <KEY>` (interactive) or `echo "<VALUE>" | wrangler secret put <KEY>` (scriptable, use in CI). Secrets are encrypted at rest in Cloudflare's secret store; the agent can set them via CLI but cannot read them back. Rotation: `wrangler secret put <KEY>` overwrites in place; redeployment is not required after a secret update.
- **Rollback:** `wrangler rollback` reverts to the previous stable deployment immediately. `wrangler rollback <version-id>` targets a specific version from `wrangler deployments list`. Include `--message "reason"` for the audit log. Time-to-revert is typically under 30 seconds globally. Caveat: rollback reverts code only — KV, D1, or R2 data changes are not rolled back automatically.
- **Approval:** The agent may deploy to Workers, tail logs, update secrets, and rollback unattended. Human-only operations: rotating Cloudflare account-level API keys, modifying DNS records, billing tier changes, and deleting a Worker entirely. Any action that affects other projects on the same Cloudflare account requires a human click.
- **Logs:** Real-time tail: `wrangler tail --format json`. Filter by status: `wrangler tail --status error`. Persistent logs require adding `[observability]` config to `wrangler.jsonc` and redeploying (Workers Logs, GA April 2025). Structured log query: Workers Observability MCP server at `https://observability.mcp.cloudflare.com/mcp` (OAuth, GA).

## Risk Register

| Risk | Source | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| Stale "cloudflare-pages" references cause wrong config, wrong CLI commands during debugging | Research finding + Unknown unknowns | H | M | Add a `CLAUDE.md` note: "SSR deploys to Workers via `wrangler deploy`, not Pages. Ignore any tutorial referencing `wrangler pages deploy` for SSR." |
| Workers CPU time limit (10ms free / paid metered) exceeded by AI-heavy server routes | Devil's advocate | M | M | Upgrade to paid ($5/month) from day one. Profile the identification endpoint with `wrangler tail --format json` and check CPU time in log entries before public launch. |
| Edge latency to Supabase (300-400ms round-trip for EU users hitting US-East-1 Supabase) | Devil's advocate | M | M | Deploy the Supabase project in the region closest to the majority of expected users. If single-region is confirmed, set `wrangler.jsonc` `compatibility_flags` to route Workers close to Supabase's region. Evaluate Hyperdrive (GA, paid plan) for connection pooling if latency is unacceptable in production. |
| Workers bundle size limit (1MB compressed) exceeded if large AI SDK is bundled | Devil's advocate | L | H | Pin to a lightweight AI SDK client (no bundled dependencies). Use tree-shaking and dynamic imports. Check bundle size with `wrangler deploy --dry-run` before each dependency addition. |
| GitHub Actions CI workflow not present; auto-deploy from `tech-stack.md` requires manual authoring | Pre-mortem | H | M | Write the Actions workflow as step one of the deploy plan. Template: `wrangler deploy` with CLOUDFLARE_API_TOKEN secret and account-id from wrangler.jsonc. |
| Preview deployments not automatic (unlike Pages); stale previews accumulate on Workers | Unknown unknowns | M | L | Configure `[env.preview]` in wrangler.jsonc and a PR-triggered Actions job. Set a TTL policy or manual cleanup step for preview Workers (`wrangler delete --env preview`). |
| CPU-time billing spike under heavy upload traffic generates unexpected invoice | Pre-mortem | M | M | Set a Cloudflare billing alert at $10 and $25. Monitor CPU time in Workers Analytics dashboard. The $5/month paid plan includes 30M CPU-ms/month — audit actual CPU consumption at first traffic spike. |

## Getting Started

1. **Verify adapter version:** Confirm `@astrojs/cloudflare` is v13+ in `package.json`. If it shows a v12.x or earlier entry referencing Pages, run `npm install @astrojs/cloudflare@latest` and update `astro.config.mjs` to remove any `cloudflareModules` option and any reference to `Astro.locals.runtime`.

2. **Confirm build and deploy work locally:**
   ```bash
   npm run build          # produces dist/ with workerd-compatible output
   npx wrangler dev       # local dev server using workerd (not Node.js) — production parity
   npx wrangler deploy    # first deploy; prompts for account ID and creates the Worker
   ```

3. **Set Supabase secrets:**
   ```bash
   echo "$SUPABASE_URL" | npx wrangler secret put SUPABASE_URL
   echo "$SUPABASE_ANON_KEY" | npx wrangler secret put SUPABASE_ANON_KEY
   ```
   Set the same keys in your GitHub repository secrets for CI use.

4. **Wire up GitHub Actions CI** (create `.github/workflows/deploy.yml`):
   - Trigger: `push` to `main`
   - Steps: `npm ci` → `npm run build` → `npx wrangler deploy`
   - Secrets needed: `CLOUDFLARE_API_TOKEN` (scoped to `Workers Scripts:Edit` + `Workers Scripts:Read` for your account), `CLOUDFLARE_ACCOUNT_ID`

5. **Add Workers Observability for persistent logs** (add to `wrangler.jsonc`):
   ```jsonc
   {
     "observability": { "enabled": true }
   }
   ```
   Then redeploy once. After this, `wrangler tail` streams live logs and the Workers dashboard retains structured logs for query.

## Out of Scope

The following were not evaluated in this research:
- Docker image configuration
- CI/CD pipeline implementation (workflow file contents)
- Production-scale architecture (multi-region, HA, DR)
- Cloudflare D1/R2 as Supabase replacements (out of scope for MVP; Supabase is committed)
