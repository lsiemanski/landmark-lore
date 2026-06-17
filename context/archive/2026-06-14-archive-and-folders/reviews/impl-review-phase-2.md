<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Archive and Folders

- **Plan**: context/changes/archive-and-folders/plan.md
- **Scope**: Phase 2 of 4
- **Date**: 2026-06-16
- **Verdict**: NEEDS ATTENTION (all findings triaged)
- **Findings**: 0 critical, 4 warnings, 2 observations

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | WARNING |
| Scope Discipline    | WARNING |
| Safety & Quality    | WARNING |
| Architecture        | WARNING |
| Pattern Consistency | WARNING |
| Success Criteria    | PASS    |

## Findings

### F1 — Read path uses SSR props, not the planned client fetch

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Architecture
- **Location**: src/pages/gallery.astro:15-20, src/components/archive/ArchiveView.tsx:14-22
- **Detail**: Plan §3 specified client-side fetch-on-mount + re-fetch on folder change via `?folderId=`. Implementation fetches both folders+photos server-side in `gallery.astro`, passes them as props, and filters client-side via `useMemo`. Count-sync callbacks are honoured. SSR is sound/arguably better but undocumented; the `?folderId=` server filter is now unused by the UI.
- **Fix A ⭐ Recommended**: Keep SSR; document as a plan addendum and update the §3 contract.
  - Strength: Preserves working idiomatic Astro code; updates source of truth before Phase 3/4.
  - Tradeoff: §3 contract rewritten rather than matched as-is.
  - Confidence: HIGH — matches dashboard SSR pattern.
  - Blind spot: `?folderId=` server filter stays unused until a future need.
- **Fix B**: Revert to client-side fetch-on-mount per original §3.
- **Decision**: FIXED via Fix A — added Phase 2 §3 addendum to plan documenting SSR data loading.

### F2 — Feature renamed archive → gallery without updating plan/criteria

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Plan Adherence
- **Location**: src/pages/gallery.astro, src/middleware.ts:4, src/pages/dashboard.astro:17
- **Detail**: Code consistently uses `gallery.astro`, `/gallery` route, "Gallery" link. Plan + all Phase 2 criteria (2.2-2.8) and Phase 4 `/archive` references were stale; checkbox 2.2 ("/archive route exists") was marked done but literally false. `/api/archive/*` and `src/lib/archive/*` keep the archive name — only the browse page is "gallery".
- **Fix A ⭐ Recommended**: Gallery is canonical — update plan Phase 2 §1/§2/§7, criteria 2.2-2.8, Progress mirror, Phase 4 refs, and Testing Strategy.
- **Fix B**: Rename code back to archive.
- **Decision**: FIXED via Fix A — plan, criteria, Progress, Phase 4, and Testing Strategy reconciled to `/gallery`; an addendum records the rename and that API/lib keep `archive`.

### F3 — Unplanned Cache-Control headers risk stale list data in Phase 3/4

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: src/pages/api/archive/photos.ts:11, src/pages/api/archive/folders.ts:10-13
- **Detail**: Phase 2 working tree modified two Phase-1 routes to add caching (photos: `private, max-age=3600`; folders: `private, max-age=600, stale-while-revalidate=3600`). No effect on the SSR read view today, but Phase 3/4 client mutations + a client GET could serve stale lists (deleted photo shown, new folder missing) for 10-60 min, and cached signed URLs near 1h expiry may 403.
- **Fix**: Revert both Cache-Control headers to their 023f480 state (no caching on these list endpoints).
- **Decision**: FIXED — both headers removed; endpoints return plain `Response.json`.

### F4 — Out-of-scope SubmitButton refactor bundled into Phase 2

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: src/components/auth/SubmitButton.tsx:1-19
- **Detail**: Dropped `useFormStatus()`, added `pending?: boolean` (default false); no caller passes it. Behaviorally neutral (useFormStatus is a no-op on native form POSTs), but it's an auth-component change unrelated to Phase 2, untested here, and leaves a dead `pending` prop.
- **Fix**: Revert SubmitButton; handle the useFormStatus cleanup separately.
- **Decision**: SKIPPED — user chose to keep as-is and accept the change in this change-set.

### F5 — AccountMenu cursor-pointer drive-by (out of scope, benign)

- **Severity**: 📝 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: src/components/auth/AccountMenu.tsx (4 hunks)
- **Detail**: Adds `cursor-pointer` to four interactive elements in an auth component outside Phase 2 scope. Harmless and aligned with the existing "Interactive elements must have cursor-pointer" lesson.
- **Fix**: Keep; optionally note as a lesson-aligned drive-by.
- **Decision**: SKIPPED — user chose to keep as-is.

### F6 — "all" magic string + missing SelectedFolder type

- **Severity**: 📝 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/components/archive/FolderSidebar.tsx:5-6,19; src/components/archive/ArchiveView.tsx:7
- **Detail**: ArchiveView defined `const ALL = "all"` but FolderSidebar hardcoded `onSelect("all")` and typed `selected: string`. Plan §3 specified a shared `SelectedFolder` type, never created.
- **Fix**: Add shared `SelectedFolder` type + `ALL` constant; use them in FolderSidebar.
- **Decision**: FIXED — exported `ALL` and `SelectedFolder` from ArchiveView; FolderSidebar imports and uses them. (`SelectedFolder` collapses to `string` — the lint rule `no-redundant-type-constituents` rejects `"all" | string` since `"all"` is a subtype of `string`.)
