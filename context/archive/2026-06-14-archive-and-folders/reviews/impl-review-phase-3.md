<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Archive and Folders

- **Plan**: context/changes/archive-and-folders/plan.md
- **Scope**: Phase 3 of 4
- **Date**: 2026-06-16
- **Verdict**: NEEDS ATTENTION (all findings triaged — see Decisions)
- **Findings**: 0 critical, 3 warnings, 3 observations

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | WARNING |
| Scope Discipline    | WARNING |
| Safety & Quality    | WARNING |
| Architecture        | PASS    |
| Pattern Consistency | WARNING |
| Success Criteria    | PASS    |

## Findings

### F1 — Unrelated JPEG_QUALITY change bundled into Phase 3

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Scope Discipline
- **Location**: src/lib/client/downscale.ts:13
- **Detail**: `JPEG_QUALITY` changed 0.8 → 1.0 (client upload re-encode). Unrelated to Phase 3, in no plan phase, inflates every uploaded photo's size.
- **Fix**: Revert to 0.8 unless intentional.
- **Decision**: ACCEPTED — user confirmed the bump to 1.0 is intentional. Should ideally land as its own change rather than bundled here.

### F2 — "Uncategorized" hardcoded instead of the existing constant

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/components/archive/ArchiveView.tsx:102
- **Detail**: Hardcoded `=== "Uncategorized"` while `DEFAULT_FOLDER_NAME` is exported from src/lib/archive/folders.ts. Violates the accepted lesson "Extract domain string identifiers to named constants".
- **Fix**: Import `DEFAULT_FOLDER_NAME` and compare against it.
- **Decision**: FIXED — imported `DEFAULT_FOLDER_NAME`; `isProtected` now compares against the constant.

### F3 — Rename/delete moved from sidebar rows to grid header (undocumented drift)

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Adherence
- **Location**: ArchiveView.tsx:118-171, FolderSidebar.tsx
- **Detail**: Plan #1 specified per-row pencil/trash icons in the sidebar; actual implementation places rename/delete in the grid header acting on the selected folder. Functional and meets manual criteria, but undocumented.
- **Fix A ⭐ Recommended**: Document the relocation as a Phase 3 plan addendum.
- **Fix B**: Re-implement per-row sidebar affordances as planned.
- **Decision**: FIXED via Fix A — addendum added to Phase 3 #1 in plan.md recording the relocation and its UX consequence.

### F4 — Unplanned Cache-Control header on gallery.astro

- **Severity**: 🔎 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: src/pages/gallery.astro:9
- **Detail**: Added `Cache-Control: private, no-store`. Correct for a per-user signed-URL page but a Phase 2 file touched without plan reference.
- **Fix**: Keep it; note in the addendum.
- **Decision**: FIXED — kept the header; noted in the Phase 3 addendum.

### F5 — Mutating fetches silently swallow failures

- **Severity**: 🔎 OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: ArchiveView.tsx, FolderSidebar.tsx, PhotoCard.tsx
- **Detail**: Create/rename/move/delete checked `res.ok` with no else; failed requests gave no user feedback.
- **Fix**: Surface a minimal error on failure for the destructive paths.
- **Decision**: FIXED — added a dismissible error banner in ArchiveView, threaded an `onError` callback through FolderSidebar / PhotoGrid / PhotoCard, and wrapped every mutating fetch in try/catch that reports on `!res.ok` or thrown errors.

### F6 — Possible double-submit on Enter+blur for folder create/rename

- **Severity**: 🔎 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: FolderSidebar.tsx (commitCreate), ArchiveView.tsx (commitRename)
- **Detail**: Commit fires on both Enter and blur; Enter unmounts the input, and an unmount-triggered blur could run the POST/PATCH twice.
- **Fix**: Guard with a once-per-lifecycle ref.
- **Decision**: FIXED — added a `committed` / `renameCommitted` ref guard, reset when the input is opened.
