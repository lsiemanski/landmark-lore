<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Data Schema Implementation Plan

- **Plan**: context/changes/data-schema/plan.md
- **Scope**: All 3 phases (complete)
- **Date**: 2026-06-03
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 3 warnings, 2 observations

> Note: `supabase` CLI and `psql` were not available in the review environment, so the
> DB-dependent automated checks (1.1–1.4, 2.1–2.3) could not be re-run; they carry commit
> stamps (7f8dd3e) from implementation time. The type-gen checks (3.x) were re-run.

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | PASS |
| Scope Discipline | WARNING |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | PASS |
| Success Criteria | WARNING |

## Findings

### F1 — Generated types file is UTF-16; criterion 3.3 actually fails

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Success Criteria
- **Location**: src/types/supabase.ts
- **Detail**: File was committed as UTF-16 LE with BOM (FF FE), not UTF-8. git treated it as binary (`Bin` in --stat, no line diffs), defeating the plan's stated reason for committing it (reviewable diff + CI). Automated criterion 3.3 `grep -c "folders\|photos\|identifications"` returned 0, not > 0, despite being marked [x]. `astro check` (3.2) passed because tsc reads the BOM. Root cause: PowerShell `>` redirection of `supabase gen types` emits UTF-16.
- **Fix**: Re-encode to UTF-8 without BOM (iconv UTF-16LE→UTF-8, strip BOM + CR).
- **Decision**: FIXED — re-encoded to UTF-8 (ASCII); grep now returns 7; diff is text.

### F2 — SECURITY DEFINER function has mutable search_path

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: supabase/migrations/20260603000001_create_folders_photos_identifications.sql:89
- **Detail**: `create_default_folder()` is SECURITY DEFINER without a pinned search_path. Supabase's database linter flags this (`function_search_path_mutable`). Practical risk is low because the INSERT already fully-qualifies `public.folders`, but the hardening is a one-liner and matches Supabase's recommended pattern.
- **Fix**: Add `SET search_path = ''` to the function definition.
- **Decision**: FIXED — added `SET search_path = ''`; body already schema-qualified. Requires `supabase db reset` to apply.

### F3 — Unplanned scratch file committed

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: supabase/snippets/Untitled query 899.sql
- **Detail**: A Supabase Studio scratch query (the manual RLS verification from step 1.6) was committed. Not in the plan's file list; auto-generated name signals an editor artifact.
- **Fix**: `git rm` the file and add `supabase/snippets/` to .gitignore.
- **Decision**: SKIPPED

### F4 — wrangler.jsonc reformatted out of scope

- **Severity**: 📝 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: wrangler.jsonc
- **Detail**: Whole file reflowed from 2-space to tab indentation and the trailing newline stripped — unrelated to the data-schema change, likely an editor autosave. No functional effect.
- **Fix**: Revert wrangler.jsonc to its prior formatting.
- **Decision**: SKIPPED

### F5 — Unplanned supabase dependency bump

- **Severity**: 📝 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: package.json
- **Detail**: Plan's Current State pinned the supabase CLI at v2.23.4; package.json bumps it to ^2.104.0 (a large jump) without mention. Dev dependency only, low risk; plausibly needed for `gen types`.
- **Fix**: Note the bump in change.md so the plan's version pin isn't silently stale.
- **Decision**: SKIPPED
