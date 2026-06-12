<!-- PLAN-REVIEW-REPORT -->
# Plan Review: First Identification and Save (S-01)

- **Plan**: context/changes/first-identification-and-save/plan.md
- **Mode**: Deep
- **Date**: 2026-06-12
- **Verdict**: REVISE → SOUND after fixes (all 6 findings fixed in plan)
- **Findings**: 2 critical, 3 warnings, 1 observation

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | WARNING |
| Lean Execution | WARNING |
| Architectural Fitness | PASS |
| Blind Spots | WARNING |
| Plan Completeness | FAIL |

## Grounding

5/5 paths ✓ (identify.ts, schema migration, downscale.ts, types/supabase.ts, IdentifyHarness.tsx), 5/5 symbols ✓ (consumeSlot, refundSlot, currentPeriod, IDENTIFY_CONFIG, photo_status enum), brief↔plan ✓ (minor brief staleness: brief row labels post-save destination "/upload" while the plan correctly uses the dashboard).

## Findings

### F1 — Success criterion contradicts the "don't persist unrecognized" design

- **Severity**: ❌ CRITICAL
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Phase 2 — Manual Verification (plan.md:213)
- **Detail**: Line 213 said an unrecognised photo creates a `photos` row with `status='unrecognized'`. Every other part of the plan and the brief say nothing is persisted for unrecognized. Leftover from an earlier status model; could mislead the implementer into building forbidden persistence.
- **Fix**: Rewrote the bullet to match Progress 2.9 — no rows created, quota slot consumed (no refund).
- **Decision**: FIXED

### F2 — Plan assumes a typed `IdentificationResult`, but `identifyImage` returns `unknown`

- **Severity**: ❌ CRITICAL
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Completeness
- **Location**: Phase 2 §0 (ai.ts move), handler steps 10/13, persistence §7
- **Detail**: `identifyImage` (identify.ts:110-117) returns `unknown`; no `IdentificationResult` type exists in the API layer. A "verbatim move" + reading `result.recognised`/`subjectName` breaks `npx astro check` (criterion 2.1). The json_object fallback (133-139) is not schema-enforced, so unvalidated fields could reach the NOT NULL `identifications` columns.
- **Fix A ⭐ Recommended**: Define `IdentificationResult` in ai.ts and parse-and-validate (hand-rolled guard, dependency-free) in `identifyImage` before returning it typed; throw on failure so the slot is refunded and 502 returned.
  - Strength: Closes the type gap AND the unvalidated-persist blind spot in one move.
  - Tradeoff: Slightly more than a relocation; bundle cost re-confirmed via Phase 2 wrangler dry-run.
  - Confidence: HIGH — fallback path genuinely bypasses schema enforcement.
  - Blind spot: Validation-lib bundle cost — avoided by using a hand-rolled guard.
- **Fix B**: Define type + cast only, no runtime validation.
  - Strength: Minimal, no dependency.
  - Tradeoff: Leaves the malformed-response blind spot.
  - Confidence: MED.
  - Blind spot: Partial-JSON behaviour untested.
- **Decision**: FIXED via Fix A

### F3 — MIME (415) and size (413) validation may be dropped in the refactor

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Blind Spots
- **Location**: Phase 2 §1 parseUploadRequest (plan.md:118-124)
- **Detail**: `readImageAsBase64` (identify.ts:69-80) does File-instance + allowedTypes (415) and maxBytes (413) checks. The new parseUploadRequest contract only specified a 400 for request_id; criterion 2.7 expects 415 for invalid MIME.
- **Fix**: Extended the parseUploadRequest contract to preserve the 415 (File/allowedTypes) and 413 (maxBytes) checks.
- **Decision**: FIXED

### F4 — `MAX_EDGE` 1024→2048 change has no phase, criterion, or checkbox

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Completeness
- **Location**: Implementation Approach (plan.md:40); absent from Phase 3 Changes
- **Detail**: The store-what-we-send strategy depends on MAX_EDGE=2048 (still 1024 at downscale.ts:10), but no phase listed editing downscale.ts, no criterion, no Progress checkbox.
- **Fix**: Added a Phase 3 change #0 (edit downscale.ts: MAX_EDGE 1024→2048), a matching success-criteria bullet, and Progress item 3.12.
- **Decision**: FIXED

### F5 — Testing-strategy Risk #3 contradicts the "store the downscaled copy" design

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: End-State Alignment
- **Location**: Testing Strategy (plan.md:302)
- **Detail**: Risk #3 said the stored bytes must match the original file (not the downsized copy), but the design uploads the 2048px downscaled blob — the test asserted the opposite of intended behaviour.
- **Fix**: Reworded Risk #3 to assert the stored object is the downscaled blob that was sent.
- **Decision**: FIXED

### F6 — `checkIdempotencyCache` handles a `status='error'` row this plan never creates

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Lean Execution
- **Location**: Phase 2 §4 (plan.md:146-148)
- **Detail**: The contract handled a `status='error'` fall-through, but no S-01 path writes that status (persistence only writes 'identified'; unrecognized writes nothing). Dead logic.
- **Fix**: Dropped the status='error' branch from the Intent and Contract, with a one-line note that it would only matter if a future slice introduces a partial-write/error state.
- **Decision**: FIXED
