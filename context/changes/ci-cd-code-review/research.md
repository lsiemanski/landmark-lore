---
date: 2026-06-28T00:00:00+00:00
researcher: lsiemanski
git_commit: f9ad8a0e54f31ec8fd1177b3bd04fff7c34e7e01
branch: docs/plan-review-tool-loop-agent
repository: landmark-lore
topic: "CI/CD workflow for automated PR code reviews using @landmark-lore/code-reviewer"
tags: [research, ci-cd, github-actions, code-review, openrouter, composite-action]
status: complete
last_updated: 2026-06-28
last_updated_by: lsiemanski
---

# Research: CI/CD workflow for automated PR code reviews

**Date**: 2026-06-28  
**Researcher**: lsiemanski  
**Git Commit**: f9ad8a0e54f31ec8fd1177b3bd04fff7c34e7e01  
**Branch**: docs/plan-review-tool-loop-agent  
**Repository**: landmark-lore

## Research Question

Design a GitHub Actions workflow that runs AI code review on every PR to master, using the `@landmark-lore/code-reviewer` package. Inputs: PR title, PR description, git diff. Outputs: PR comment with summary, labels `ai-cr:passed`/`ai-cr:failed`. Supports on-demand retry via `ai-cr:review` label.

## Summary

The `@landmark-lore/code-reviewer` package is complete and production-ready — it exposes `reviewCode(diff: string): Promise<Review>` and runs Claude Sonnet 4.5 via OpenRouter. The existing `ci.yml` already handles lint/test/build/deploy; the AI review workflow should be a separate file with a composite action to keep concerns isolated. A Node.js runner script (building on `scripts/review.ts`) bridges the package to the GHA environment. Labels, PR comments, and label lifecycle management can be handled entirely via the built-in `GITHUB_TOKEN` — no PAT needed. One hard gap: the `{{CR_CRITERIA}}` placeholder in `requirements.md` is already defined in `packages/code-reviewer/src/schemas.ts` and `prompts.ts` — the plan should fill this in or reference the schema directly.

---

## Detailed Findings

### Area 1 — Existing CI Infrastructure

**File**: [.github/workflows/ci.yml](.github/workflows/ci.yml) (66 lines)

Three jobs, always triggered on push to master or PR to master:

| Job       | Condition                    | Steps                                                                   |
| --------- | ---------------------------- | ----------------------------------------------------------------------- |
| `ci`      | always                       | checkout → Node 22 → `npm ci` → `astro sync` → lint → test → build      |
| `deploy`  | `ci` passed + push to master | checkout → Node 22 → `npm ci` → build → `wrangler deploy`               |
| `preview` | `ci` passed + PR to master   | checkout → Node 22 → `npm ci` → build → `wrangler deploy --env preview` |

**Secrets already in use**: `SUPABASE_URL`, `SUPABASE_KEY`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`.

**Key gaps in current `ci.yml`** (relevant to the new workflow):

- No `permissions` block — defaults to read-only. The new code-review workflow needs `pull-requests: write` explicitly.
- No `concurrency` block — multiple reviews could race on rapid pushes.
- No composite actions defined yet — `.github/` has no `actions/` subdirectory.
- `npm run typecheck` (`astro check`) is not run in CI.
- Duplicate builds across jobs (artifact-passing not used).

The new workflow should **not** modify `ci.yml` — it should be a separate file (`.github/workflows/code-review.yml`) so it can be triggered independently.

### Area 2 — `@landmark-lore/code-reviewer` Package API

**Public API** ([packages/code-reviewer/src/index.ts](packages/code-reviewer/src/index.ts)):

```typescript
// Primary entry point
export async function reviewCode(diff: string): Promise<Review>;

// Advanced usage exports
export { reviewerAgent }; // ToolLoopAgent instance
export { REVIEW_SCHEMA }; // Zod schema
export type { Review }; // Inferred TypeScript type
```

**Review output type** ([packages/code-reviewer/src/schemas.ts](packages/code-reviewer/src/schemas.ts)):

```typescript
type Review = {
  correctness: number; // Logic correctness, no bugs (1–10)
  securitySafety: number; // Input validation, no vulnerabilities/secret leaks (1–10)
  readability: number; // Clarity, naming, project style consistency (1–10)
  performance: number; // Efficiency, no obvious inefficiencies (1–10)
  testCoverage: number; // Test coverage and testability (1–10)
  verdict: "pass" | "fail"; // Fails if any score < 5 OR significant security issue
  summary: string; // Markdown summary (in Polish)
};
```

**Verdict logic** (from [packages/code-reviewer/src/prompts.ts](packages/code-reviewer/src/prompts.ts)): `"fail"` when any score < 5 or a significant security issue is present.

**Environment variable**: `OPENROUTER_API_KEY` — read via `process.env.OPENROUTER_API_KEY` in [packages/code-reviewer/src/agent.ts:7](packages/code-reviewer/src/agent.ts). No validation guard; undefined key fails at first API call.

**Model**: `"anthropic/claude-sonnet-4.5"` hardcoded as `DEFAULT_REVIEWER_MODEL` in [packages/code-reviewer/src/agent.ts:10](packages/code-reviewer/src/agent.ts). The `.env` also declares `OPENROUTER_REVIEW_MODEL=anthropic/claude-sonnet-4.5` but the agent does **not** read it — the constant is hardcoded.

**Package format**: ES module (`"type": "module"`), exports TypeScript source directly (`"exports": { ".": "./src/index.ts" }`). Run via `tsx` in development.

**Error handling**: None at the API boundary — errors from OpenRouter propagate raw to the caller.

### Area 3 — Monorepo Tooling for GHA

**Node version**: 22.14.0 (`.nvmrc`). Matches existing `ci.yml` (`node-version: 22`).

**Package runner**: `tsx` is a devDependency — already available after `npm ci`. The GHA runner script can be invoked as `npx tsx scripts/review-pr.ts`.

**Existing smoke-test script**: [scripts/review.ts](scripts/review.ts) demonstrates the pattern — imports `reviewCode`, passes a hardcoded diff, logs JSON. For the CI use case, a new `scripts/review-pr.ts` should read the diff from a file and PR metadata from environment variables, then exit with a code-review JSON payload.

**Lint coverage**: `eslint.config.js` covers `*.ts` files including `scripts/`. Any new script must pass `eslint .`.

**Key env vars** (from `astro.config.mjs` env schema):

- `OPENROUTER_API_KEY` — already declared as server-side; needs to be added as a GitHub repository secret.

### Area 4 — Workflow Design Architecture

The requirements call for:

1. Trigger: new PR to master, plus on-demand retry via label `ai-cr:review`
2. Composite action separation for the review logic
3. Post PR comment + apply label

**Recommended file structure:**

```
.github/
  workflows/
    ci.yml                         (existing, untouched)
    code-review.yml                (NEW — orchestrator)
  actions/
    ai-code-review/
      action.yml                   (NEW — composite action)
scripts/
  review.ts                        (existing smoke-test, keep as-is)
  review-pr.ts                     (NEW — CI runner script)
```

**`code-review.yml` trigger design:**

```yaml
on:
  pull_request:
    branches: [master]
    types: [opened, synchronize, reopened, labeled]
```

The `labeled` type catches the on-demand `ai-cr:review` trigger. The job then conditionally skips:

```yaml
if: >
  github.event.action != 'labeled' ||
  github.event.label.name == 'ai-cr:review'
```

This ensures the job only runs on normal PR events OR when the specific label is added — not when other labels (e.g. `bug`) are applied.

**Permissions block** (must be explicit since we write to PRs):

```yaml
permissions:
  contents: read
  pull-requests: write
```

`GITHUB_TOKEN` with these permissions is sufficient for: posting PR comments, adding/removing labels. No PAT needed.

**Concurrency** (prevents stale review races):

```yaml
concurrency:
  group: ai-code-review-${{ github.event.pull_request.number }}
  cancel-in-progress: true
```

**Getting the diff** in the composite action:

```bash
git diff ${{ inputs.base-sha }}...${{ inputs.head-sha }} > /tmp/pr.diff
```

Requires `fetch-depth: 0` on checkout.

### Area 5 — Composite Action Design

The composite action at `.github/actions/ai-code-review/action.yml` should:

1. **Accept inputs**: `pr-title`, `pr-description`, `base-sha`, `head-sha`, `pr-number`, `openrouter-api-key`, `github-token`
2. **Generate diff**: `git diff $base...$head > pr.diff`
3. **Run review**: `npx tsx scripts/review-pr.ts` with diff path + PR metadata as env vars → writes `review.json`
4. **Manage labels**: Use `actions/github-script@v7` to:
   - Create labels idempotently (avoids hard dependency on manual setup)
   - Remove previous `ai-cr:passed` / `ai-cr:failed` labels
   - Remove `ai-cr:review` label (so it can be re-applied for next retry)
   - Apply new result label
5. **Post comment**: Use `actions/github-script@v7` to post a formatted Markdown comment with scores table and summary

**Label colors** (hex, per requirements):

- `ai-cr:passed` → `#0e8a16` (green)
- `ai-cr:failed` → `#b60205` (red)
- `ai-cr:review` → `#e4e669` (yellow — trigger label)

### Area 6 — Runner Script Design (`scripts/review-pr.ts`)

The script reads from environment variables and outputs JSON to stdout (captured by the workflow):

```typescript
import { reviewCode } from "@landmark-lore/code-reviewer";
import { readFileSync } from "node:fs";

const diffFile = process.env.PR_DIFF_FILE;
const diff = diffFile ? readFileSync(diffFile, "utf-8") : "";

const result = await reviewCode(diff);
process.stdout.write(JSON.stringify(result));
```

PR title/description may optionally be prepended to the diff as context — a decision for the plan phase.

**Output** captured as a step output via:

```bash
echo "review=$(npx tsx scripts/review-pr.ts)" >> $GITHUB_OUTPUT
```

Or written to a temp file and parsed in `github-script`.

---

## Code References

- [packages/code-reviewer/src/index.ts](packages/code-reviewer/src/index.ts) — `reviewCode()` function (lines 7-10)
- [packages/code-reviewer/src/schemas.ts](packages/code-reviewer/src/schemas.ts) — `REVIEW_SCHEMA` with 5 criteria + verdict + summary (lines 1-13)
- [packages/code-reviewer/src/prompts.ts](packages/code-reviewer/src/prompts.ts) — system prompt and verdict logic in Polish (lines 1-10)
- [packages/code-reviewer/src/agent.ts](packages/code-reviewer/src/agent.ts) — `DEFAULT_REVIEWER_MODEL`, OpenRouter setup (lines 6-16)
- [.github/workflows/ci.yml](.github/workflows/ci.yml) — existing workflow (66 lines)
- [scripts/review.ts](scripts/review.ts) — smoke-test pattern to model the CI runner on
- [packages/code-reviewer/package.json](packages/code-reviewer/package.json) — `"exports": { ".": "./src/index.ts" }` (ESM, tsx-runnable)
- [.nvmrc](.nvmrc) — Node 22.14.0
- [wrangler.jsonc](wrangler.jsonc) — no env bindings in config; secrets via `wrangler secret put`

---

## Architecture Insights

**1. Workflow separation is the right call.** The new review workflow is semantically independent of lint/test/build/deploy — different trigger conditions, different permissions, different failure semantics. Keeping it in a separate file avoids polluting `ci.yml` with PR-only concerns.

**2. `GITHUB_TOKEN` is sufficient.** For posting comments and applying labels within the same repo on `pull_request` events (not `pull_request_target`), the auto-generated `GITHUB_TOKEN` with `pull-requests: write` is enough. No secrets beyond `OPENROUTER_API_KEY`.

**3. Composite action for testability.** The composite action receives all inputs explicitly, making it independently testable and reusable. The orchestrator workflow stays declarative.

**4. `tsx` is the right runner.** The package exports TypeScript source directly — `tsx` handles this transparently, is already a devDependency, and requires no build step. Avoids adding complexity for a single CI script.

**5. Idempotent label creation.** Labels must exist before they can be applied. Creating them on first use (via `github-script` with error swallowing on 422 Unprocessable Entity) is simpler than a separate bootstrap step and makes the workflow self-initializing.

**6. Label lifecycle matters.** To support re-review: (a) remove `ai-cr:review` after triggered run so it can be re-added; (b) remove the previous pass/fail label before applying the new one — otherwise both accumulate. This logic belongs in the composite action.

**7. `{{CR_CRITERIA}}` is already defined.** The requirements placeholder maps directly to `REVIEW_SCHEMA` in `schemas.ts`. The 5 criteria are: `correctness`, `securitySafety`, `readability`, `performance`, `testCoverage`. The plan should fill in `requirements.md` with these, or reference the schema as the source of truth.

**8. `OPENROUTER_REVIEW_MODEL` env var is disconnected.** The `.env` has `OPENROUTER_REVIEW_MODEL=anthropic/claude-sonnet-4.5` but `agent.ts` uses a hardcoded constant and never reads it. This is not a problem for CI — just set `OPENROUTER_API_KEY` as a GitHub secret. Leave model configuration as-is (per the lessons "constants belong in config files" finding from impl-review, marked acceptable).

**9. `pull_request` vs `pull_request_target` — use `pull_request`.** Using `pull_request` is the safe default: it runs in the context of the PR branch with limited permissions. `pull_request_target` runs in the base branch context (full write access) and is a security risk for fork PRs. Since AI code review doesn't need elevated access beyond `pull-requests: write`, `pull_request` is correct.

---

## Historical Context

- [context/changes/tool-loop-agent/plan.md](context/changes/tool-loop-agent/plan.md) — Full implementation spec for `@landmark-lore/code-reviewer`. Establishes: no `.min()/.max()` on Zod numbers (Anthropic rejects range constraints), `Output.object({ schema })` for structured output, standalone tsconfig, workspace hoisting pattern.
- [context/changes/tool-loop-agent/reviews/impl-review.md](context/changes/tool-loop-agent/reviews/impl-review.md) — Implementation review (APPROVED). F1 flags missing API-key guard; F2 flags `DEFAULT_REVIEWER_MODEL` in logic file. Both marked SKIPPED/acceptable.
- [context/foundation/infrastructure.md](context/foundation/infrastructure.md) — Confirms GitHub Actions as CI provider; establishes secrets via `wrangler secret put`; documents Workers free-tier limits (1MB bundle, 10ms CPU). The AI review workflow runs on GitHub's infra, not Workers, so bundle limits don't apply.
- [context/archive/2026-06-05-ai-provider-spike/](context/archive/2026-06-05-ai-provider-spike/) — Established OpenRouter as the AI provider gateway. The code-reviewer inherits this decision (uses `@openrouter/ai-sdk-provider`).

---

## Open Questions

1. **`{{CR_CRITERIA}}` in requirements.md** — This placeholder is unfilled. The actual criteria live in `packages/code-reviewer/src/schemas.ts` (5 dimensions). Should `requirements.md` be updated to reference the schema, or does the user want different criteria defined there? **Recommend:** fill in with the existing schema during planning.

2. **PR description as review input** — Requirements flag this as a cost tradeoff (`??`). Including body adds ~50–200 tokens per review (negligible cost at ~$0.003/1K input tokens for Sonnet 4.5). But the current `reviewCode(diff)` API only accepts a diff — passing PR metadata would require either prepending it to the diff string or extending the API. **Recommend:** decide scope before planning.

3. **`OPENROUTER_API_KEY` GitHub secret** — This must be added manually to the repository secrets (`Settings > Secrets > Actions`). The plan should call this out as a prerequisite.

4. **Label bootstrap** — Labels `ai-cr:passed`, `ai-cr:failed`, `ai-cr:review` don't exist yet. Recommend idempotent creation in the composite action itself (first-run self-initializing).

5. **`ai-cr:review` label removal after trigger** — Should the workflow remove this label after it fires (so the reviewer can re-add it for another run)? Yes, per UX expectations for label-triggered workflows.

6. **Previous result label cleanup** — Should the workflow remove the previous `ai-cr:passed`/`ai-cr:failed` before applying the new one? Yes — otherwise a PR accumulates both after re-reviews.

7. **Comment update vs new comment** — On re-review, should the workflow edit the previous AI review comment (requires finding it by marker) or post a new one? Edit is cleaner UX but requires a "find previous comment" step.

8. **`npm run typecheck` gap in `ci.yml`** — Not in scope for this change, but flagged as a gap. Worth fixing in a separate PR.
