<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: F-02 AI Provider Spike

- **Plan**: context/changes/ai-provider-spike/plan.md
- **Scope**: Phase 1 of 3
- **Date**: 2026-06-11
- **Verdict**: NEEDS ATTENTION (F1 fixed during triage → effectively APPROVED)
- **Findings**: 0 critical, 1 warning, 3 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | WARNING |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | PASS |

Automated re-runs: `npm run build` PASS · new-file lint PASS (exit 0) ·
`wrangler deploy --dry-run` PASS (447.64 KiB gzip, well under 1 MB).

## Findings

### F1 — Daily rate limit is bypassable by any authenticated user

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20260611000001_create_image_usage.sql:14-16; src/pages/api/identify.ts:165-167
- **Detail**: The route wrote usage with the same anon-key client the browser holds, and the RLS "upsert own usage" policy (`for all`, `using auth.uid() = user_id`) permitted client self-writes — so an authenticated user could directly upsert `count = 0` and defeat the 100/day cap. The plan's parked list covered the increment race but not this direct-write bypass.
- **Fix**: Hardened — dropped the client write policy; table is read-only to clients, all writes go through two `SECURITY DEFINER` RPCs. Final design (per follow-up discussion) is **consume-on-attempt + refund-on-failure**: `try_consume_image_usage(period, limit)` does an atomic check-and-consume under `SELECT … FOR UPDATE` (concurrent callers serialise → cap can't be overshot); `refund_image_usage(period)` decrements (floored at 0) when the AI call fails, so only successful identifications count. Route consumes after cheap validation and refunds in the `catch`. Generated types updated; build + lint + dry-run green.
- **Decision**: FIXED (hardened in place). Closes both the reset-bypass and the overshoot race — the latter was the plan's parked S-01 item, now delivered in-spike. Remaining S-01 scope: app/UX integration + idempotency keys. Requires `supabase db push` to apply.

### F2 — Unplanned .gitignore entry (.mcp.json)

- **Severity**: ◽ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: .gitignore:66-67
- **Detail**: A `#mcp` / `.mcp.json` ignore entry, unrelated to F-02 and not in the plan, rides along in the spike working tree.
- **Fix**: Commit separately to keep the spike diff scoped.
- **Decision**: SKIPPED

### F3 — Lint criterion (1.2) green only for new files, not project-wide

- **Severity**: ◽ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: Progress 1.2; 28 pre-existing files incl. src/types/supabase.ts
- **Detail**: `npm run lint` reports 1176 errors across 28 pre-existing committed files (prettier semicolons + CRLF/LF). New files lint clean (exit 0); pre-existing debt, not a Phase-1 regression.
- **Fix**: One-time `lint:fix` + `format` pass as its own chore, outside the spike.
- **Decision**: BACKLOG — queued in follow-ups/review-fixes.md

### F4 — Usage increment result is unchecked (silent under-count)

- **Severity**: ◽ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/identify.ts:165-168 (rpc increment call)
- **Detail**: The increment is awaited but its `{ error }` is never inspected; a failed write returns 200 uncounted, drifting usage below actual.
- **Fix**: Optional — log on error without failing the 200; revisit with S-01 rate-limit hardening.
- **Decision**: SKIPPED (acceptable for spike)
