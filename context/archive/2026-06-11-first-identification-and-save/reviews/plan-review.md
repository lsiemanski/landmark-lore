<!-- PLAN-REVIEW-REPORT -->

# Plan Review: First Identification and Save (S-01)

- **Plan**: context/changes/first-identification-and-save/plan.md
- **Mode**: Deep (re-review after `testing-harness-bootstrap` / F-03 landed)
- **Date**: 2026-06-13
- **Verdict**: REVISE → SOUND after fixes (all 5 findings fixed)
- **Findings**: 2 critical, 2 warnings, 1 observation

> Re-review context: the prior plan-review (2026-06-12) brought this plan to SOUND against the
> _pre-F-03_ codebase (its F2 cited `identifyImage` at `identify.ts:110-117`). F-03 has since
> landed and been archived, moving the ground under several plan assumptions. All five findings
> below share that single root cause; every fix is a targeted re-grounding edit, not a redesign.

## Verdicts

| Dimension             | Verdict (pre-fix) | After fixes |
| --------------------- | ----------------- | ----------- |
| End-State Alignment   | WARNING           | PASS        |
| Lean Execution        | PASS              | PASS        |
| Architectural Fitness | FAIL              | PASS        |
| Blind Spots           | FAIL              | PASS        |
| Plan Completeness     | WARNING           | PASS        |

## Grounding

7/7 paths ✓ (identify.ts, identification.ts, downscale.ts, dashboard.astro, config.ts, identify-route.test.ts, schema migration), 4/4 symbols ✓ (`IDENTIFY_CONFIG.{allowedTypes,maxBytes,dailyImageLimit}`, `requireAuthenticatedUser`, `identifyImage`, `IdentificationResult`). `src/lib/identify/` + `src/lib/api/` correctly absent (to be created). brief↔plan ⚠️ — brief was stale on tests (fixed under F3). Extra checks: `.husky/pre-commit` runs `lint-staged` → `vitest related --run` on staged `*.{ts,tsx}`; `.github/workflows/ci.yml` runs no tests (lint + build only) — both informed F2.

## Findings

### F1 — Phase 2 §0 plans to extract AI logic that F-03 already extracted

- **Severity**: ❌ CRITICAL
- **Impact**: 🔬 HIGH — architectural stakes
- **Dimension**: Architectural Fitness
- **Location**: Phase 2 §0 + file-layout table (plan.md:98, 106-116); Current State (plan.md:9)
- **Detail**: F-03 already moved `identifyImage`/`requestIdentification`/`visionMessages`/`identificationSchema` into `src/lib/ai/identification.ts`; `identify.ts:5` imports it; the `IdentificationResult` interface already exists (`identification.ts:20-24`). Executing §0 verbatim finds nothing to move, duplicates the module at a new path, and breaks the 6 unit tests importing `@/lib/ai/identification`. Only the guard + return-type tightening genuinely remain.
- **Fix**: Re-pointed the `ai.ts` table row and §0 at the existing `src/lib/ai/identification.ts` (edit in place — no move, no new file); kept only the `isIdentificationResult` guard + `Promise<unknown>` → `Promise<IdentificationResult>` change; added an explicit "keep the path / tests import it" warning.
- **Decision**: FIXED (Fix in plan)

### F2 — Existing F-03 route test breaks; Phase 2/3 gates don't run the suite

- **Severity**: ❌ CRITICAL
- **Impact**: 🔬 HIGH — architectural stakes
- **Dimension**: Blind Spots
- **Location**: Phase 2 handler steps (plan.md:180-194); Success Criteria (plan.md:200-204, 284-288)
- **Detail**: `test/integration/identify-route.test.ts` mocks only `auth.getUser()` + `rpc()` and sends no `request_id`. S-01's recognised:true path calls idempotency/folder/storage/two inserts (none mocked) and `parseUploadRequest` throws 400 without `request_id` — the existing test goes red. No plan task updated it, and Phase 2/3 automated gates ran only astro check + lint + wrangler dry-run, so the regression would ship silently. (The husky pre-commit `vitest related --run` would in fact block the commit; CI runs no tests at all.)
- **Fix**: Added Phase 2 §9 (update `identify-route.test.ts`: extend the mock for persistence, add `request_id`, assert `{ result, photoId }`); added Phase 2 §10 (wire `npm test` into `ci.yml` `ci` job so `deploy`/`preview` are gated); added `npm test` to Phase 2 + Phase 3 automated criteria and a CI manual check; added Progress items 2.10, 2.11, 3.13. Resolved per the user's "full npm test gate + CI pre-deploy gate" direction.
- **Decision**: FIXED (Fix differently — full `npm test` gate + route-test task + CI wiring)

### F3 — Testing Strategy treats F-03 as an unlanded blocker (and contradicts it)

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff
- **Dimension**: End-State Alignment
- **Location**: What We're NOT Doing (plan.md:32); Testing Strategy (plan.md:306-315); brief (31, 46, 60, 67)
- **Detail**: Plan said tests are "blocked on testing-harness-bootstrap … must land first" and "should be written as the first deliverable of testing-harness-bootstrap." F-03 has landed AND explicitly assigned Risk #3/#5/#6 to S-01. The brief carried the same stale framing.
- **Fix**: Removed the stale "NOT Doing" line; rewrote Testing Strategy as actionable, mapping each risk to its F-03 helper (`makeCompletionResponse`/`makeAPIContext`/`createTestClient`) and the recording-mock-vs-real-Supabase choice for Risk #3; updated all four stale brief rows.
- **Decision**: FIXED (Fix in plan + brief)

### F4 — Current State / Key Discoveries cite stale line numbers & a 178-line file

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Current State (plan.md:9); Key Discoveries (plan.md:17-18); Phase 2 premise (plan.md:89)
- **Detail**: Post-F-03 `identify.ts` is 114 lines (not 178) and no longer contains the AI logic; cited line numbers for `requireAuthenticatedUser` (:61→:46) and `readImageAsBase64` (:69→:54) are stale; the "past 250 lines" framing is softer.
- **Fix**: Refreshed the line numbers, the 178→114 count, and the Phase 2 line-ceiling framing; noted `identify.ts:5` already imports `identifyImage` from `@/lib/ai/identification`.
- **Decision**: FIXED (Fix in plan)

### F5 — Directory-convention split: src/lib/ai/ vs proposed src/lib/identify/

- **Severity**: 💡 OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff
- **Dimension**: Architectural Fitness
- **Location**: Phase 2 file-layout table (plan.md:96-99)
- **Detail**: F-03 established `src/lib/ai/` as the home; the plan adds a parallel `src/lib/identify/`. Since the AI module must stay in `src/lib/ai/` (F1), the feature's code spans two sibling dirs.
- **Fix A ⭐ Recommended**: New modules go in `src/lib/identify/`; AI concerns stay in `src/lib/ai/`. Minimal churn, no test/import breakage.
- **Fix B**: Consolidate upload/quota/persistence under `src/lib/ai/` too — one dir, but "ai" becomes a misnomer.
- **Fix**: Added a "Directory convention" note after the file-layout table explaining the deliberate split-by-concern and why `identification.ts` isn't relocated.
- **Decision**: FIXED via Fix A
