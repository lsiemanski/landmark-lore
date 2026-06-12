<!-- IMPL-REVIEW-REPORT -->
# Implementation Review (re-review): F-02 AI Provider Spike

- **Plan**: context/changes/ai-provider-spike/plan.md
- **Scope**: Phase 1 of 3 (re-review after prior phase-1 review F1–F4)
- **Date**: 2026-06-11
- **Verdict**: APPROVED
- **Findings**: 0 critical, 0 warnings, 1 observation

## Context

Re-review of the post-refactor / post-OpenRouter-switch tree. Confirms the prior
review's fixes landed:

- **Prior F1 (RLS rate-limit bypass) resolved**: `image_usage` is read-only to
  clients; both writes go through atomic `SECURITY DEFINER` RPCs
  (`try_consume_image_usage` under `SELECT … FOR UPDATE`, `refund_image_usage`
  floored at 0). Generated RPC types `{ allowed, used }` match the route's
  consumption (`consumed.allowed` / `consumed.used`). Grants scoped to
  `authenticated`; `revoke all from public`.
- **"Split long functions" lesson applied**: the `identify.ts` POST now reads as
  requireApiKey → requireSupabaseClient → requireAuthenticatedUser →
  readImageAsBase64 → consumeSlot → identifyImage → refundSlot.
- Automated re-runs (current tree): `npm run build` PASS · new-file lint PASS
  (exit 0) · `wrangler deploy --dry-run` PASS (448 KiB gzip, well under 1 MB).

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | PASS |
| Safety & Quality | PASS |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | PASS |

## Findings

### F1 — image_usage table absent from generated Supabase types

- **Severity**: ◽ OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/types/supabase.ts (Functions present; image_usage table was missing)
- **Detail**: The migration creates `public.image_usage` plus a "users can view own
  usage" SELECT policy ("for future X of 100 used UI"), but the generated types
  contained only the two RPCs, not the table. The spike route uses only `.rpc()`,
  so Phase 1 was unaffected; the first S-01 `.from("image_usage")` select would
  have been untyped (`never`). Root cause: types appear hand-edited for the RPCs
  rather than regenerated from an applied migration.
- **Fix**: Added the `image_usage` table type (Row/Insert/Update, alphabetically
  placed, FK→auth.users as empty Relationships) matching the generator's shape.
  Build green. Going forward, after `supabase db push` regenerate via
  `supabase gen types typescript` rather than hand-editing.
- **Decision**: FIXED (Fix now)
