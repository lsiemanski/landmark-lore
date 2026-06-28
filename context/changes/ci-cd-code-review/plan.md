# AI Code Review CI/CD Workflow — Implementation Plan

## Overview

Implement a GitHub Actions workflow that runs `@landmark-lore/code-reviewer` on every PR to master. The workflow posts a PR comment with a scores table and AI-generated summary, applies `ai-cr:passed` or `ai-cr:failed` labels, and supports on-demand retry via the `ai-cr:review` label.

## Current State Analysis

The `@landmark-lore/code-reviewer` package is complete and exports `reviewCode(diff: string): Promise<Review>`. `ci.yml` handles lint/test/build/deploy and must not be modified. No composite actions exist yet under `.github/`. `OPENROUTER_API_KEY` must be added as a GitHub repository secret before the workflow can run.

## Desired End State

Three new files are the complete deliverable:

1. `scripts/review-pr.ts` — CI runner that enriches the diff with PR context and calls `reviewCode()`
2. `.github/actions/ai-code-review/action.yml` — composite action encapsulating the full review pipeline
3. `.github/workflows/code-review.yml` — orchestrator with PR triggers, concurrency, and permissions

When complete: every new PR to master triggers an AI review check, posts a comment with a 5-criterion scores table and summary, and applies `ai-cr:passed` or `ai-cr:failed`. Adding `ai-cr:review` re-triggers the review.

### Key Discoveries

- `reviewCode()` accepts only a string diff — PR title/body must be prepended to the diff string to pass context (`packages/code-reviewer/src/index.ts`)
- `Review` type has 5 numeric fields + `verdict: "pass" | "fail"` + `summary: string` (`packages/code-reviewer/src/schemas.ts`)
- `OPENROUTER_API_KEY` is read via `process.env.OPENROUTER_API_KEY` at line 7 of `packages/code-reviewer/src/agent.ts` — no guard; undefined key fails at first API call
- `tsx` is already a devDependency — no build step needed to run TS scripts
- Existing smoke-test pattern to model on: `scripts/review.ts`

## What We're NOT Doing

- Not modifying `ci.yml` or the `@landmark-lore/code-reviewer` package
- Not implementing comment deduplication (always post new comment on re-review)
- Not making the check a required merge gate — that is a branch protection configuration decision
- Not adding `npm run typecheck` to `ci.yml` (flagged gap, out of scope)

## Implementation Approach

Inside-out: runner script first (locally testable in isolation), composite action second (wires the runner into the GHA environment), workflow file last (triggers and wires the composite action). The criteria block in `requirements.md` (already filled in) is verified against `schemas.ts` in Phase 3 to keep the requirements document and the package in sync.

## Critical Implementation Details

- **`fetch-depth: 0` is required.** Without it, `git diff base...head` fails — shallow clones don't contain the full commit history needed to compute the diff.
- **Exclude generated files from the diff.** The `git diff` step must drop lockfiles so they don't dominate token cost or crowd out real code: `git diff <base>...<head> -- . ':(exclude)package-lock.json'`. This works together with the runner's `MAX_DIFF_BYTES` guard (Phase 1) as a second line of defense against oversized diffs.
- **Label 422 responses are expected.** Labels don't exist on first run; `github-script` must swallow `422 Unprocessable Entity` on `createLabel`, not throw.
- **`continue-on-error: true` on the review step is intentional.** It lets the subsequent github-script step post an error comment before the composite action fails. Without it, the action fails before the comment posts. **Verify early:** `continue-on-error` + `steps.review.outcome` inside a _composite_ action is supported in current GHA but has historically been finicky — confirm the outcome branch fires with a throwaway forced-failure run at the start of Phase 2 before building the rest of the pipeline.
- **PR body can be null.** `github.event.pull_request.body` is `null` when the PR has no description. The workflow must pass `${{ github.event.pull_request.body || '' }}` to avoid propagating null into the runner script.

---

## Phase 1: Runner Script

### Overview

A focused TypeScript script that reads PR metadata and diff location from env vars, enriches the diff with title and body context, calls `reviewCode()`, and writes the `Review` JSON to a temp file. Exits 1 with a clear stderr message on any error.

### Changes Required

#### 1. Runner Script

**File**: `scripts/review-pr.ts`

**Intent**: Entry point for the CI review pipeline. Validates required env vars, builds an enriched diff string (title + body prepended), calls `reviewCode()`, and writes the result JSON to `REVIEW_OUTPUT_FILE`. On any error (missing env vars, API failure, unexpected response), writes the error message to stderr and exits with code 1.

**Contract**:

- Reads env vars: `PR_TITLE` (string), `PR_BODY` (string, may be empty), `PR_DIFF_FILE` (path), `REVIEW_OUTPUT_FILE` (path)
- Exits 1 with a readable message if `PR_DIFF_FILE` or `REVIEW_OUTPUT_FILE` is missing
- Enriched diff format: `PR: <title>\n\n<body>\n\n---\n\n<diff content>` — body block omitted when `PR_BODY` is empty
- Writes `JSON.stringify(result)` to `REVIEW_OUTPUT_FILE`
- Extract the enrichment logic into a named helper (`buildReviewInput`) — keeps the top-level `async` block as a readable sequence of steps, per the "split long functions" lesson
- **Diff-size guard**: define a `MAX_DIFF_BYTES` named constant (per the "constants in config/resource files" lesson). If the diff exceeds it, truncate to the limit and append a `\n\n[diff truncated — exceeded MAX_DIFF_BYTES]` notice to the enriched input before calling `reviewCode()`, so a huge PR (e.g. lockfile churn) can't cause a cost spike or degraded review

### Success Criteria

#### Automated Verification

- ESLint passes: `eslint scripts/review-pr.ts`
- TypeScript type check passes: `npx tsc --noEmit` (real type check; note `tsx --check` only syntax-parses and does NOT type-check). If `tsc --noEmit` surfaces unrelated project errors, scope it to the script or use `npm run typecheck` (`astro check`).

#### Manual Verification

- Run locally with a real diff file and valid `OPENROUTER_API_KEY` — verify `review.json` is produced with all 5 score fields, `verdict`, and `summary`
- Run with `PR_DIFF_FILE` unset — verify exit code 1 and a readable error on stderr
- Run with a diff larger than `MAX_DIFF_BYTES` — verify the enriched input is truncated and the truncation notice is present

**Implementation Note**: After this phase passes all automated verification, pause for manual confirmation before proceeding to Phase 2.

---

## Phase 2: Composite Action

### Overview

Encapsulates the full review pipeline as a reusable composite action: idempotent label setup, diff generation, script invocation, and result/error handling (formatted comment + label on success; error comment + failure on error).

### Changes Required

#### 1. Composite Action

**File**: `.github/actions/ai-code-review/action.yml`

**Intent**: Define a composite action with explicit inputs for all required values. Steps in order: (a) create all three labels idempotently via `github-script`, swallowing 422 errors; (b) remove any existing `ai-cr:passed`/`ai-cr:failed` labels and the `ai-cr:review` trigger label from the PR, ignoring 404s; (c) generate the diff to `/tmp/pr.diff` using `git diff <base>...<head> -- . ':(exclude)package-lock.json'`; (d) run `scripts/review-pr.ts` with env vars set and `continue-on-error: true`; (e) a single `github-script` step that reads the review step's outcome, branches on success/failure — posts a formatted scores table + summary comment and applies the result label on success; posts an error comment and throws to propagate failure on error.

**Contract**:

Inputs (all required):

- `pr-title`, `pr-body`, `base-sha`, `head-sha`, `pr-number`, `openrouter-api-key`, `github-token`

Label colors: `ai-cr:passed` → `#0e8a16`, `ai-cr:failed` → `#b60205`, `ai-cr:review` → `#e4e669`

Review step (non-obvious — `continue-on-error` + `id` pairing is critical for the outcome check):

```yaml
- id: review
  continue-on-error: true
  shell: bash
  env:
    OPENROUTER_API_KEY: ${{ inputs.openrouter-api-key }}
    PR_TITLE: ${{ inputs.pr-title }}
    PR_BODY: ${{ inputs.pr-body }}
    PR_DIFF_FILE: /tmp/pr.diff
    REVIEW_OUTPUT_FILE: /tmp/review.json
  run: npx tsx scripts/review-pr.ts
```

PR comment format:

```
<!-- ai-code-review -->
## AI Code Review

| Criterion | Score |
|-----------|-------|
| Correctness | N/10 |
| Security & Safety | N/10 |
| Readability | N/10 |
| Performance | N/10 |
| Test Coverage | N/10 |

**Verdict: ✅ PASSED** (or **❌ FAILED**)

<summary from AI>
```

### Success Criteria

#### Automated Verification

- YAML syntax is valid: `yamllint .github/actions/ai-code-review/action.yml` (or `actionlint` if available)

#### Manual Verification

- Labels are created on first run; no error on subsequent runs (idempotent)
- Previous `ai-cr:passed`/`ai-cr:failed` label is removed before new one is applied
- `ai-cr:review` label is removed after triggered run so it can be re-added
- Error comment posts and check fails when `OPENROUTER_API_KEY` is intentionally invalid

**Implementation Note**: After this phase passes manual verification, pause for confirmation before proceeding to Phase 3.

---

## Phase 3: Orchestrator Workflow + Requirements Update

### Overview

The workflow file that triggers the composite action on the correct PR events, with proper permissions and concurrency. Also verifies the criteria block in requirements.md is consistent with `schemas.ts`.

### Changes Required

#### 1. Workflow File

**File**: `.github/workflows/code-review.yml`

**Intent**: Define a `pull_request` trigger for `[opened, synchronize, reopened, labeled]` events on the `master` branch. Include a job-level `if` guard so that `labeled` events only proceed when the label is `ai-cr:review`. Configure `permissions: {contents: read, pull-requests: write}` and `concurrency: {group: ai-code-review-<pr-number>, cancel-in-progress: true}`. The single job: checkout with `fetch-depth: 0`, setup-node via `node-version-file: .nvmrc` (deliberate: tracks the pinned `.nvmrc` = 22.14.0; ci.yml's hardcoded `node-version: 22` is the looser equivalent — either is fine, this one stays in sync with the repo pin), `npm ci`, then call `./.github/actions/ai-code-review` with all inputs wired from the GitHub event context.

**Contract**:

Trigger (the `if` guard is non-obvious — without it, any label triggers a review):

```yaml
on:
  pull_request:
    branches: [master]
    types: [opened, synchronize, reopened, labeled]
```

Job-level condition:

```yaml
if: >
  github.event.action != 'labeled' ||
  github.event.label.name == 'ai-cr:review'
```

`GITHUB_TOKEN` is passed as `${{ secrets.GITHUB_TOKEN }}` (automatically available, no setup required).

#### 2. Requirements Criteria Consistency Check

**File**: `context/changes/ci-cd-code-review/requirements.md`

**Intent**: The `{{CR_CRITERIA}}` placeholder was already filled in during planning — requirements.md (lines ~12–22) lists the 5 criteria and the verdict rule. This step is now a **verification**, not a replacement: confirm the criteria block still matches the 5 fields in `packages/code-reviewer/src/schemas.ts` (`correctness`, `securitySafety`, `readability`, `performance`, `testCoverage`) and the verdict semantics. If they have drifted, reconcile requirements.md to the schema (schema is source of truth).

**Contract**: requirements.md must list these 5 criteria and verdict rule (the expected current content):

```
1. **Correctness** (1–10) — Logic correctness, no bugs
2. **Security & Safety** (1–10) — Input validation, no vulnerabilities or secret leaks
3. **Readability** (1–10) — Clarity, naming, project style consistency
4. **Performance** (1–10) — Efficiency, no obvious inefficiencies
5. **Test Coverage** (1–10) — Test coverage and testability

**Verdict**: `fail` if any score < 5 OR a significant security issue is present.
```

No edit is expected unless drift is found.

### Success Criteria

#### Automated Verification

- YAML syntax is valid for `.github/workflows/code-review.yml`
- `gh workflow list` shows the `AI Code Review` workflow

#### Manual Verification

- Open a test PR to master — the `AI Code Review` check appears and runs automatically
- PR comment is posted with the correct scores table and AI summary
- `ai-cr:passed` or `ai-cr:failed` label is applied
- A new push to the PR replaces the previous result label (not accumulated)
- Adding `ai-cr:review` label triggers re-review; label is removed after completion
- Adding an unrelated label (e.g. `bug`) does not trigger a re-review
- Multiple rapid pushes to the PR result in only one completed review (concurrency cancel)

---

## Testing Strategy

### Automated

- ESLint on `scripts/review-pr.ts`
- TypeScript check on `scripts/review-pr.ts`
- YAML lint on action and workflow files

### Manual Integration

1. Add `OPENROUTER_API_KEY` to repo secrets (one-time prerequisite)
2. Create a test PR to master with a small code change
3. Verify `AI Code Review` check triggers automatically
4. Verify PR comment with scores table and summary appears
5. Verify a label is applied
6. Push another commit — verify old label is replaced
7. Add `ai-cr:review` label — verify re-review fires and label is removed
8. Add unrelated label — verify no review triggered
9. Make rapid successive pushes — verify only one review completes (concurrency cancel)

## Migration Notes

**One-time manual prerequisite:** Add `OPENROUTER_API_KEY` to `Settings > Secrets and variables > Actions > New repository secret`. Labels are self-initializing — no manual label creation needed.

**Known limitation — forked PRs:** On a `pull_request` from a fork, GitHub withholds repo secrets (`OPENROUTER_API_KEY` is empty) and downgrades `GITHUB_TOKEN` to read-only, so the review step fails and the comment/label steps cannot write. This is acceptable for this solo repo (PRs come from branches, not forks). Do **not** switch to `pull_request_target` to work around it — that would run untrusted PR code with secrets exposed.

## References

- Requirements: `context/changes/ci-cd-code-review/requirements.md`
- Research: `context/changes/ci-cd-code-review/research.md`
- `reviewCode()` entry point: `packages/code-reviewer/src/index.ts`
- `Review` type and criteria: `packages/code-reviewer/src/schemas.ts`
- Smoke-test pattern to model on: `scripts/review.ts`
- Existing CI workflow (do not modify): `.github/workflows/ci.yml`

---

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Runner Script

#### Automated

- [ ] 1.1 ESLint passes: `eslint scripts/review-pr.ts`
- [ ] 1.2 TypeScript type check passes on `scripts/review-pr.ts`

#### Manual

- [ ] 1.3 Run locally with valid diff and OPENROUTER_API_KEY — review.json produced with all fields
- [ ] 1.4 Run with PR_DIFF_FILE unset — exit code 1 and readable stderr message
- [ ] 1.5 Run with a diff larger than MAX_DIFF_BYTES — enriched input truncated with notice

### Phase 2: Composite Action

#### Automated

- [ ] 2.1 YAML syntax valid for `.github/actions/ai-code-review/action.yml`

#### Manual

- [ ] 2.2 Labels created on first run; no error on subsequent runs (idempotent)
- [ ] 2.3 Previous pass/fail label removed before new one applied
- [ ] 2.4 `ai-cr:review` label removed after triggered run
- [ ] 2.5 Error comment posts and check fails when OPENROUTER_API_KEY is invalid

### Phase 3: Orchestrator Workflow + Requirements Update

#### Automated

- [ ] 3.1 YAML syntax valid for `.github/workflows/code-review.yml`
- [ ] 3.2 `gh workflow list` shows AI Code Review workflow

#### Manual

- [ ] 3.3 Test PR triggers check automatically and posts comment with scores table
- [ ] 3.4 Pass/fail label applied to PR
- [ ] 3.5 New push replaces previous label (not accumulated)
- [ ] 3.6 `ai-cr:review` label triggers re-review and is removed after completion
- [ ] 3.7 Unrelated labels do not trigger re-review
- [ ] 3.8 Rapid pushes result in only one completed review (concurrency cancel)
