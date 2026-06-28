# AI Code Review CI/CD Workflow — Plan Brief

> Full plan: `context/changes/ci-cd-code-review/plan.md`
> Research: `context/changes/ci-cd-code-review/research.md`

## What & Why

Wire the `@landmark-lore/code-reviewer` package into GitHub Actions so that every PR to master receives an automated code review. The goal is to surface potential issues (correctness, security, readability, performance, test coverage) before merge, with zero manual trigger cost and a label-based retry mechanism.

## Starting Point

The `@landmark-lore/code-reviewer` package is complete and exports `reviewCode(diff: string): Promise<Review>`. The existing `ci.yml` handles lint/test/build/deploy and must not be modified. No composite actions exist yet; `OPENROUTER_API_KEY` must be added as a GitHub secret before first run.

## Desired End State

Every PR to master triggers an `AI Code Review` check. The PR thread receives a comment with a 5-criterion scores table and an AI-written summary (in Polish). One of `ai-cr:passed` or `ai-cr:failed` is applied as a label. Adding `ai-cr:review` to any PR triggers a re-review. API failures post an error comment and fail the check visibly.

## Key Decisions Made

| Decision            | Choice                                  | Why (1 sentence)                                                               | Source   |
| ------------------- | --------------------------------------- | ------------------------------------------------------------------------------ | -------- |
| PR context input    | Title + body prepended to diff          | Full intent context for the reviewer at negligible token cost (~50–200 tokens) | Plan     |
| Comment strategy    | Always post new                         | Simpler than deduplication; all review history preserved in the thread         | Plan     |
| Error mode          | Fail check + error comment              | Failures surface on the PR and can be retried via label                        | Plan     |
| Script output       | Write to temp file (`/tmp/review.json`) | Avoids JSON escaping issues with newlines in `GITHUB_OUTPUT`                   | Plan     |
| Workflow separation | Separate `code-review.yml`              | Independent trigger conditions and permissions from `ci.yml`                   | Research |
| Token auth          | `GITHUB_TOKEN` only                     | `pull-requests: write` is sufficient; no PAT or additional secrets needed      | Research |
| Label bootstrap     | Idempotent creation in action           | Self-initializing on first run; no manual label setup required                 | Research |
| Re-review trigger   | Remove `ai-cr:review` after run         | Allows re-adding the label for subsequent retries                              | Research |

## Scope

**In scope:**

- `scripts/review-pr.ts` — CI runner script
- `.github/actions/ai-code-review/action.yml` — composite action
- `.github/workflows/code-review.yml` — orchestrator workflow
- Fill `{{CR_CRITERIA}}` placeholder in `context/changes/ci-cd-code-review/requirements.md`

**Out of scope:**

- Changes to `@landmark-lore/code-reviewer` package or `ci.yml`
- Making the check a required merge gate (branch protection config)
- Comment deduplication / update-in-place
- Adding `npm run typecheck` to `ci.yml`

## Architecture / Approach

The runner script (`review-pr.ts`) handles the TypeScript layer: reads env vars, enriches the diff with PR title and body, calls `reviewCode()`, and writes `review.json` to a temp path. The composite action wraps everything in GHA: creates labels idempotently, removes stale labels, generates the git diff, runs the script with `continue-on-error: true`, then uses `github-script` to branch on the outcome — post a formatted comment and apply a result label on success, or post an error comment and throw on failure. The orchestrator workflow provides triggers, permissions (`pull-requests: write`), concurrency (cancel-in-progress per PR), and job setup (checkout with `fetch-depth: 0`, Node, `npm ci`) before calling the composite action.

## Phases at a Glance

| Phase                    | What it delivers                                                           | Key risk                                                           |
| ------------------------ | -------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| 1. Runner Script         | Locally testable TS script that calls `reviewCode()` with enriched context | Null/empty `PR_BODY` handling; missing env var exits               |
| 2. Composite Action      | Full pipeline in reusable `action.yml`                                     | Label 422 swallowing; `continue-on-error` + outcome check ordering |
| 3. Orchestrator Workflow | Wired workflow with correct triggers and concurrency                       | `fetch-depth: 0` required for diff; null body from GitHub event    |

**Prerequisites:** `OPENROUTER_API_KEY` added to repo → `Settings > Secrets and variables > Actions`.  
**Estimated effort:** ~2 sessions across 3 phases

## Open Risks & Assumptions

- `OPENROUTER_API_KEY` must be manually added before the workflow runs — not automated by the plan
- The package has no API-key guard; first failure is at the OpenRouter call (accepted per impl-review)
- Estimated review cost: ~$0.01–0.05 per PR at Sonnet 4.5 rates (1–5K token diffs)

## Success Criteria (Summary)

- Every new PR to master triggers the check and posts a comment with the scores table and label
- Adding `ai-cr:review` fires a re-review and the label is removed after completion
- API failures produce a visible error comment and a failed check, not a silent skip
