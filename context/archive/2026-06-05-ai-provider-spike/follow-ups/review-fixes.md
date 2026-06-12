# Review Follow-ups — ai-provider-spike

Backlog items surfaced by the Phase 1 implementation review (2026-06-11).

## Project-wide lint/format pass (from F3)

- **Problem**: `npm run lint` fails with 1176 errors across 28 pre-existing
  committed files (prettier semicolons + CRLF/LF line endings). The F-02 new
  files (`identify.ts`, `models.ts`) lint clean; this is pre-existing repo debt,
  not a Phase-1 regression.
- **Action**: Run a one-time `npm run lint:fix` + `npm run format` pass as its
  own chore commit, **outside the F-02 spike**. Verify `.gitattributes`/editor
  config pins LF to stop CRLF churn from recurring.
- **Scope**: Standalone chore — do not bundle into the spike diff.
