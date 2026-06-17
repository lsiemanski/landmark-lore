<!-- IMPL-REVIEW-REPORT -->

# Implementation Review: Archive and Folders

- **Plan**: context/changes/archive-and-folders/plan.md
- **Scope**: Phase 1 of 4
- **Date**: 2026-06-16
- **Verdict**: APPROVED
- **Findings**: 0 critical, 2 warnings, 2 observations

## Verdicts

| Dimension           | Verdict |
| ------------------- | ------- |
| Plan Adherence      | PASS    |
| Scope Discipline    | WARNING |
| Safety & Quality    | WARNING |
| Architecture        | PASS    |
| Pattern Consistency | PASS    |
| Success Criteria    | PASS    |

Automated success criteria both pass: `npm run typecheck` → 0 errors; `npm run test:integration` → 36/36 tests.

## Findings

### F1 — Unplanned apiRoute() wrapper introduced and adopted repo-wide

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: src/lib/api/http.ts:3-12 (+ identify.ts, delete-account.ts)
- **Detail**: Plan step 0 scoped the refactor to extracting auth helpers. Implementation also added a new `apiRoute()` higher-order wrapper to http.ts and refactored identify.ts and delete-account.ts (plus all archive routes) to use it instead of inline try/catch. Cleaner, tests green, but not in the plan.
- **Fix**: Document the apiRoute wrapper as a plan addendum under Phase 1 step 0.
- **Decision**: FIXED — addendum added to plan.md under step 0.

### F2 — movePhoto PATCH returns 200 even when the photo doesn't exist or isn't owned

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/archive/photos.ts:48-59
- **Detail**: PATCH verifies the target folder belongs to the user, but movePhoto updated by id+user_id without checking affected rows. A non-existent/unowned photo matched 0 rows and still returned 200 — inconsistent with DELETE, which 404s. Not a security hole (RLS + user_id filter).
- **Fix**: movePhoto selects with `{ count: "exact" }` and throws HttpError(404) when 0 rows are updated.
- **Decision**: FIXED — movePhoto now throws 404 on no-op update.

### F3 — requireAuthenticatedUser masks getUser() errors as 401

- **Severity**: 📝 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: src/lib/api/auth.ts:12-24
- **Detail**: The shared helper wrapped getUser() in try/catch converting ANY thrown error to 401, hiding genuine Supabase outages behind an auth error. Plan only called for unifying the return type.
- **Fix**: Drop the catch-all; a returned auth error stays 401, a thrown outage propagates through apiRoute to a 5xx.
- **Decision**: FIXED — catch-all removed.

### F4 — Fragile photoCount transform in listFolders

- **Severity**: 📝 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: src/lib/archive/folders.ts:25
- **Detail**: `(row.photos as unknown as [{ count: number }])[0].count` double-cast through unknown and dereferenced [0] unchecked; an empty/null shape would throw a raw TypeError → unhandled 500.
- **Fix**: `(row.photos as unknown as { count: number }[] | null)?.[0]?.count ?? 0`.
- **Decision**: FIXED — safe default applied.
