<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Archive and Folders

- **Plan**: context/changes/archive-and-folders/plan.md
- **Scope**: Phase 4 of 4
- **Date**: 2026-06-16
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 2 warnings, 2 observations

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | PASS    |
| Scope Discipline    | WARNING |
| Safety & Quality    | WARNING |
| Architecture        | PASS    |
| Pattern Consistency | WARNING |
| Success Criteria    | PASS    |

Automated success criteria verified: `npm run typecheck` → 0 errors; `UploadFlow.tsx` = 246 lines (< 250).

## Findings

### F1 — Save/Discard never check res.ok — failed requests report success

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/components/identify/UploadFlow.tsx:112-119, 131-134
- **Detail**: `fetch` only rejects on network failure, not HTTP 4xx/5xx. handleSave awaited the PATCH with no `res.ok` check, then transitioned to `saved` — a 500 left the photo in Uncategorized while the UI announced "Saved in [chosen folder]". handleDiscard reset to idle in `finally` even when DELETE failed, so the photo persisted but the flow acted discarded. handleIdentify (line 79) already checked `res.ok`, so this was also an in-file pattern inconsistency.
- **Fix**: Guard both calls with `if (!res.ok) throw` so the existing catch blocks surface the failure; handleDiscard gained a `catch` that sets a general error state instead of falsely resetting.
- **Decision**: FIXED

### F2 — Unplanned PostIdentifyPanel.tsx extraction

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: src/components/identify/PostIdentifyPanel.tsx (new)
- **Detail**: Plan's Phase 4 lists only FolderPicker as a new component. The impl also extracted the identified/saved render branches into PostIdentifyPanel.tsx. Benign and arguably better (keeps UploadFlow at 246 lines), but an EXTRA file not described in the plan.
- **Fix**: Added a one-line impl addendum to Phase 4 documenting the PostIdentifyPanel extraction.
- **Decision**: FIXED

### F3 — Dead ternary in FolderPicker option label

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/components/identify/FolderPicker.tsx:25
- **Detail**: `{f.name === DEFAULT_FOLDER_NAME ? f.name : f.name}` — both branches returned `f.name`; the `DEFAULT_FOLDER_NAME` import existed only to feed the no-op.
- **Fix**: Replaced with `{f.name}` and removed the unused import.
- **Decision**: FIXED

### F4 — folders[0].id assumes a non-empty folder list

- **Severity**: 🔍 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/components/identify/UploadFlow.tsx:45
- **Detail**: `f.find(...)?.id ?? f[0].id` throws if `f` is empty. The `create_default_folder` DB trigger guarantees every user has an "Uncategorized" folder, so the array is never empty and the fallback is unreachable. Latent assumption, not a live bug.
- **Fix**: Optional — `?? f[0]?.id ?? ""` to harden against the empty case.
- **Decision**: SKIPPED
