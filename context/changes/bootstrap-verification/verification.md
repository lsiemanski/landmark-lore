---
bootstrapped_at: 2026-05-30T19:38:00Z
starter_id: 10x-astro-starter
starter_name: "10x Astro Starter (Astro + Supabase + Cloudflare)"
project_name: landmark-lore
language_family: js
package_manager: npm
cwd_strategy: git-clone
bootstrapper_confidence: first-class
phase_3_status: ok
audit_command: "npm audit --json"
---

## Hand-off

```yaml
starter_id: 10x-astro-starter
package_manager: npm
project_name: landmark-lore
hints:
  language_family: js
  team_size: solo
  deployment_target: cloudflare-pages
  ci_provider: github-actions
  ci_default_flow: auto-deploy-on-merge
  bootstrapper_confidence: first-class
  path_taken: standard
  quality_override: false
  self_check_answers: null
  has_auth: true
  has_payments: false
  has_realtime: false
  has_ai: true
  has_background_jobs: false
```

### Why this stack

Landmark Lore is a solo-built web app shipping on an after-hours, 3-week timeline with auth, file storage, and an AI identification layer as must-have FRs. The recommended default for `(web-app, js)` is 10x-astro-starter — Astro 6 + React 19 + Supabase + Cloudflare — which covers auth (Supabase Auth), file storage (Supabase Storage), and PostgreSQL out of the box, meaning the three hardest-to-retrofit FRs are solved at scaffold time. TypeScript across the full stack keeps the AI integration layer explicit and type-safe with Zod schemas at every boundary. The starter clears all four agent-friendly quality gates; bootstrapper confidence is first-class. AI identification (FR-004/FR-005) will be integrated via an external AI service API call from Astro server endpoints — no starter-level change required. Deployment lands on Cloudflare Pages with GitHub Actions auto-deploying on merge to main, matching the starter's default operational shape and keeping infra setup minimal for a solo developer working after hours.

## Pre-scaffold verification

| Signal      | Value   | Severity | Notes                                                                      |
| ----------- | ------- | -------- | -------------------------------------------------------------------------- |
| npm package | not run | —        | `cmd_template` starts with `git clone`; npm package version check skipped |
| GitHub repo | not run | —        | `gh` CLI not found on PATH; recency check unavailable                     |

## Scaffold log

**Resolved invocation**: `git clone https://github.com/przeprogramowani/10x-astro-starter .bootstrap-scaffold && cd .bootstrap-scaffold && npm install`

**Strategy**: clone starter repo without keeping its git history

**Exit code**: 0

**Recovery note**: Initial `npm install` exited non-zero (code 1) — the `supabase` npm package postinstall script failed to download the Supabase CLI binary from GitHub due to a Windows SSL certificate verification error (`UNABLE_TO_VERIFY_LEAF_SIGNATURE`). Recovery via `npm install --ignore-scripts` succeeded (exit 0; 772 packages installed). The Supabase CLI binary is a local development convenience tool; the Astro project itself is fully functional without it. The `.git/` directory from the cloned starter was deleted before move-up.

**Files moved**: 19

**Conflicts (.scaffold siblings)**:
- `CLAUDE.md.scaffold` — existing `CLAUDE.md` (skill/project rules) preserved; starter's agent rules landed as sibling
- `src.scaffold/` — existing `src/` (Java Maven source tree) preserved; Astro project source landed as sibling

**.gitignore handling**: append-merged — Maven .gitignore kept in order; Astro-specific patterns appended after `# from 10x-astro-starter` separator. No exact-match duplicate lines found.

**.bootstrap-scaffold cleanup**: deleted

Files moved into cwd:

| File / Directory    | Action         |
| ------------------- | -------------- |
| `.env.example`      | moved silently |
| `.github/`          | moved silently |
| `.gitignore`        | append-merged  |
| `.husky/`           | moved silently |
| `.nvmrc`            | moved silently |
| `.prettierrc.json`  | moved silently |
| `.vscode/`          | moved silently |
| `CLAUDE.md`         | → `CLAUDE.md.scaffold` (existing wins) |
| `README.md`         | moved silently |
| `astro.config.mjs`  | moved silently |
| `components.json`   | moved silently |
| `eslint.config.js`  | moved silently |
| `node_modules/`     | moved silently |
| `package-lock.json` | moved silently |
| `package.json`      | moved silently |
| `public/`           | moved silently |
| `src/`              | → `src.scaffold/` (existing wins) |
| `supabase/`         | moved silently |
| `tsconfig.json`     | moved silently |
| `wrangler.jsonc`    | moved silently |

`context/` was not present in the scaffold — preserved verbatim in cwd per conflict policy.

## Post-scaffold audit

**Tool**: `npm audit --json`

**Status**: failed to run

**Reason**: Windows SSL certificate verification error (`UNABLE_TO_VERIFY_LEAF_SIGNATURE`) — npm cannot reach `https://registry.npmjs.org/-/npm/v1/security/advisories/bulk`. Same root cause as the postinstall failure during install.

**Workaround**: once the SSL issue is resolved (e.g. by running Node.js with `--use-system-ca` or installing the enterprise root CA into the system trust store), run `npm audit` manually to get a full vulnerability report.

## Hints recorded but not acted on

| Hint                    | Value                |
| ----------------------- | -------------------- |
| bootstrapper_confidence | first-class          |
| quality_override        | false                |
| path_taken              | standard             |
| self_check_answers      | null                 |
| team_size               | solo                 |
| deployment_target       | cloudflare-pages     |
| ci_provider             | github-actions       |
| ci_default_flow         | auto-deploy-on-merge |
| has_auth                | true                 |
| has_payments            | false                |
| has_realtime            | false                |
| has_ai                  | true                 |
| has_background_jobs     | false                |

## Next steps

Next: a future skill will set up agent context (CLAUDE.md, AGENTS.md). For now, your project is scaffolded and verified — happy hacking.

Useful manual steps in the meantime:
- `git init` (if you have not already) to start your own repo history.
- Review the two `.scaffold` siblings and decide what to keep:
  - `CLAUDE.md.scaffold` — the starter's agent rules. Merge useful sections (commands, architecture, conventions) into your existing `CLAUDE.md`.
  - `src.scaffold/` — the Astro project source tree (components, pages, layouts, auth endpoints, middleware). Your existing `src/` is the old Java Maven source. Rename `src.scaffold/` → `src/` after removing or relocating the Java source tree.
- Copy `.env.example` to `.env` and fill in `SUPABASE_URL` and `SUPABASE_KEY` for local Node development, or `.dev.vars` for Cloudflare local dev.
- Run `npm run dev` to start the Astro dev server once environment variables are configured.
- Fix the Windows SSL issue for `npm audit` and the Supabase CLI binary: run Node.js with `--use-system-ca` or install the root CA into the system trust store, then re-run `npm install` (without `--ignore-scripts`) and `npm audit`.
