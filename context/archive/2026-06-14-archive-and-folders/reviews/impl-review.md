<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Archive and Folders

- **Plan**: context/changes/archive-and-folders/plan.md
- **Scope**: All 4 phases
- **Date**: 2026-06-17
- **Verdict**: NEEDS ATTENTION (borderline APPROVED — all findings LOW impact; 3 of 4 fixed in triage)
- **Findings**: 0 critical, 3 warnings, 1 observation

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | PASS    |
| Scope Discipline    | PASS    |
| Safety & Quality    | WARNING |
| Architecture        | PASS    |
| Pattern Consistency | WARNING |
| Success Criteria    | PASS    |

All four documented addenda (`/gallery` naming, `apiRoute` HOF, server-side initial load,
header-based folder affordances, `PostIdentifyPanel` extraction) were honored — not drift.
Authorization is defense-in-depth: every archive query scopes by `user_id` in addition to RLS,
and photo PATCH verifies target-folder ownership before moving. No injection vectors, no secrets,
destructive deletes well-guarded. Automated: `npm run typecheck` 0 errors; `npm run test:integration` 36/36 pass.

## Findings

### F1 — UploadFlow.tsx is exactly 250 lines (budget is "under 250")

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency / Success Criteria
- **Location**: src/components/identify/UploadFlow.tsx (250 lines)
- **Detail**: Criterion 4.2 ("under 250 lines") is checked [x] and the lessons rule says "Keep files under 250 lines", but the file is exactly 250 — not under. Off by one line.
- **Fix**: Trim one line to land at ≤249, or relax the criterion wording.
- **Decision**: SKIPPED

### F2 — Unguarded f[0].id can throw on empty folder list

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (Reliability)
- **Location**: src/components/identify/UploadFlow.tsx:45
- **Detail**: `f.find(...)?.id ?? f[0].id` — the optional chain guards the `.find` result but not `f[0]`; an empty folders array makes `f[0].id` throw a TypeError (swallowed by `.catch`, picker silently vanishes).
- **Fix**: Guard the index access so an empty array degrades to `""` instead of throwing.
- **Decision**: FIXED — replaced `f[0].id` with `(f.length > 0 ? f[0].id : "")` (one line, satisfies the `no-unnecessary-condition` lint that rejects `f[0]?.id`).

### F3 — DEFAULT_FOLDER_NAME lived in a logic file, not a constants module

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/lib/archive/folders.ts:4
- **Detail**: Lessons rule "Constants belong in config/resource files, not logic files". `DEFAULT_FOLDER_NAME` sat in `folders.ts` (logic), imported by 6 sites; `PHOTOS_BUCKET` by contrast lives in dedicated `storage.ts`.
- **Fix**: Relocate to a dedicated constants module.
- **Decision**: FIXED — created `src/lib/archive/constants.ts`; moved `DEFAULT_FOLDER_NAME` there; updated 5 import sites (persistence.ts, UploadFlow.tsx, ArchiveView.tsx, folders.ts route, folders/[id].ts route).

### F4 — "identified" status string not extracted to a constant

- **Severity**: 🔭 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: src/lib/archive/photos.ts:21, src/lib/identify/persistence.ts:101
- **Detail**: Domain status literal "identified" appeared raw in two files. Lessons rule "Extract domain string identifiers to named constants".
- **Fix**: Add `PHOTO_STATUS_IDENTIFIED` to the constants module; import in both.
- **Decision**: FIXED — added `PHOTO_STATUS_IDENTIFIED` to `src/lib/archive/constants.ts`; both sites now import it.
