# Account Lifecycle Implementation Plan

## Overview

Add the missing password reset flow (FR-010) and account deletion (GDPR prerequisite) to complete the account lifecycle. Sign-up (FR-001) and sign-in (FR-002) are already implemented; this plan builds the remaining pieces and verifies the full auth loop end-to-end.

## Current State Analysis

Sign-up, sign-in, and sign-out are fully wired:

- `src/pages/auth/signup.astro` + `SignUpForm.tsx` + `/api/auth/signup.ts`
- `src/pages/auth/signin.astro` + `SignInForm.tsx` + `/api/auth/signin.ts`
- `/api/auth/signout.ts`

`src/lib/supabase.ts` wraps `createServerClient` from `@supabase/ssr`, reading/writing sessions via cookies on every request. The middleware (`src/middleware.ts`) guards `/dashboard` and injects `locals.user` from `supabase.auth.getUser()`.

All user-referencing tables (`folders`, `photos`, `identifications`, `image_usage`) have `ON DELETE CASCADE` on `user_id` — deleting the Supabase auth user cascades all DB rows automatically. **Supabase Storage does not cascade**; files must be deleted manually before the user is removed.

Missing:

- No `/auth/callback` route (required for Supabase PKCE code exchange)
- No forgot-password or reset-password pages or endpoints
- No "Forgot password?" link on the sign-in form
- No account deletion endpoint or UI
- No admin Supabase client (service role key required for `auth.admin.deleteUser`)
- `SUPABASE_SERVICE_ROLE_KEY` not declared in `astro.config.mjs` env schema

## Desired End State

After this plan:

1. A user who has forgotten their password can click "Forgot password?" on the sign-in page, enter their email, receive a reset link by email, click it, enter a new password, and land back on the sign-in page with a success message.
2. An authenticated user can delete their account via a password-confirmation modal on the dashboard; all their data (storage files, DB rows, and auth record) is removed.

### Key Discoveries

- `src/lib/supabase.ts:createClient` — the pattern to follow for the new admin factory (different file, service role key, no cookie plumbing)
- `src/pages/api/identify.ts` — `requireAuthenticatedUser` / `requireSupabaseClient` / `HttpError` pattern; all new endpoints follow this convention
- `test/integration/identify-route.test.ts` — `vi.hoisted` + `vi.mock("@/lib/supabase")` + `makeAPIContext` — the test pattern to follow
- `supabase/migrations/20260603000001_create_folders_photos_identifications.sql` — confirms cascade on `user_id`; storage cleanup must come before `auth.admin.deleteUser`
- `astro.config.mjs` env schema uses `envField.string({ context: "server", access: "secret", optional: true })` for all Supabase vars

## What We're NOT Doing

- Email/password change for authenticated users — not in PRD
- Session management UI (list active sessions, revoke) — not in PRD
- Custom password reset email template — deferred for branding pass; default Supabase template ships now
- Rate limiting on forgot-password endpoint — deferred; Cloudflare handles DDoS at network layer
- Account export (GDPR Art. 20) — deferred to the full compliance pass before public launch

## Implementation Approach

Three phases in dependency order: password reset first (complete auth loop), then account deletion (clears the GDPR blocker), then tests and manual verification. The PKCE callback route (`/auth/callback`) lands in Phase 1 and is designed to be reusable if email confirmation is enabled later.

## Critical Implementation Details

**PKCE callback ordering:** `resetPasswordForEmail` stores a PKCE code verifier in the user's cookies at call time. The `/auth/callback` page must read those cookies and call `supabase.auth.exchangeCodeForSession(code)` on the **same** Supabase client instance that reads the request's `Cookie` header — the existing `createClient(Astro.request.headers, Astro.cookies)` factory does this correctly.

**Storage cleanup before user deletion:** `adminClient.auth.admin.deleteUser(userId)` cascades all DB rows immediately. Storage files must be listed and removed first (using the admin client so RLS is bypassed), otherwise orphaned files remain in the bucket.

**Admin client security boundary:** `src/lib/supabase-admin.ts` uses the service role key — it bypasses RLS on every table and bucket. It must never be called from client-side code or returned to the browser. Instantiate it only inside API route handlers after the user's identity has been verified.

---

## Phase 1: Password Reset Flow

### Overview

Adds the Supabase PKCE callback route, the forgot-password and reset-password pages with their React forms, and the two API endpoints that drive them. Also adds a "Forgot password?" link to the sign-in form and a success banner to the sign-in page.

### Changes Required

#### 1. "Forgot password?" link on sign-in form

**File:** `src/components/auth/SignInForm.tsx`

**Intent:** Add a link below the password field that navigates to `/auth/forgot-password`. No email pre-fill.

**Contract:** Plain anchor tag styled consistently with the existing "Don't have an account?" link. No coupling to the email field value.

---

#### 2. Success banner on sign-in page

**File:** `src/components/auth/ServerSuccess.tsx` (new)

**Intent:** Display a styled success message when the sign-in page receives `?success=...` query param (e.g., after password reset). Mirrors `ServerError.tsx` in structure.

**Contract:** Accepts a `message: string` prop. Renders a visually distinct (green/teal) banner. No state — pure display component.

---

**File:** `src/pages/auth/signin.astro`

**Intent:** Read `?success=password_reset` from the URL and render `<ServerSuccess>` above the form when present.

**Contract:** `success = Astro.url.searchParams.get("success")`. Render `<ServerSuccess message="Password updated — please sign in." />` when `success === "password_reset"`. Existing `?error=` handling is unchanged.

---

#### 3. Forgot-password form component

**File:** `src/components/auth/ForgotPasswordForm.tsx` (new)

**Intent:** Form with a single email field that POSTs to `/api/auth/forgot-password`. Shows an error from `?error=` query param on render. Reuses `FormField.tsx` and `ServerError.tsx` — no new UI primitives.

**Contract:** On success the server redirects back to `/auth/forgot-password?sent=true`; the page (not this component) renders the confirmation message. Component only owns the form state.

---

#### 4. Forgot-password page

**File:** `src/pages/auth/forgot-password.astro` (new)

**Intent:** Render `ForgotPasswordForm` when no `?sent` param is present. When `?sent=true`, hide the form and show a "Check your inbox" message. Surface `?error=` via `ServerError`.

**Contract:** Three states keyed on URL params: (a) default — show form; (b) `?sent=true` — show confirmation; (c) `?error=link_invalid` — show `ServerError` + form.

---

#### 5. Forgot-password API endpoint

**File:** `src/pages/api/auth/forgot-password.ts` (new)

**Intent:** Accept a POST with `email` in the form body. Call `supabase.auth.resetPasswordForEmail` with a `redirectTo` pointing at `/auth/callback?next=/auth/reset-password`. Redirect to `/auth/forgot-password?sent=true` on success (or on any error — never reveal whether an email exists).

**Contract:**

- Extracts `email` from `formData`
- Constructs `redirectTo` from `context.url.origin` so it works across local dev and production without hardcoding
- Always redirects to `?sent=true` regardless of Supabase response (prevents email enumeration)
- Follows the **redirect-on-error** convention of the existing auth endpoints (`signin.ts`), not the `HttpError`/JSON pattern of `identify.ts` — this route is form-driven and redirects on every outcome. Inline `createClient` guard: if `createClient` returns `null`, redirect to `/auth/forgot-password?error=link_invalid` (or a configured-error param) rather than throwing JSON
- Unauthenticated route — no auth check

---

#### 6. Auth callback page (PKCE code exchange)

**File:** `src/pages/auth/callback.astro` (new)

**Intent:** Exchange the Supabase PKCE authorization code from the email link for a live session, then redirect to the `?next=` destination. On failure, redirect to `/auth/forgot-password?error=link_invalid`.

**Contract:**

- Server-only Astro page (renders no HTML — only `return Astro.redirect(...)`)
- Reads `code` and `next` from `Astro.url.searchParams`
- Calls `supabase.auth.exchangeCodeForSession(code)` using `createClient(Astro.request.headers, Astro.cookies)` so cookie-stored PKCE verifier is available
- On success: `return Astro.redirect(next ?? "/")`
- On error or missing code: `return Astro.redirect("/auth/forgot-password?error=link_invalid")`

---

#### 7. Reset-password form component

**File:** `src/components/auth/ResetPasswordForm.tsx` (new)

**Intent:** Two-field form (new password + confirm password) that POSTs to `/api/auth/reset-password`. Validates that fields match client-side before submission. Reuses `FormField.tsx` and `PasswordToggle.tsx`.

**Contract:** Password minimum 6 characters (matching sign-up). Confirm field validated against the password field value. `ServerError` shown when `?error=` is present on the page (passed in as prop from the parent page).

---

#### 8. Reset-password page

**File:** `src/pages/auth/reset-password.astro` (new)

**Intent:** Gate on `Astro.locals.user` (set by middleware via the recovery session). Render `ResetPasswordForm` when the user is authenticated; redirect to `/auth/forgot-password?error=session_expired` when not.

**Contract:**

- No `?code=` handling — code exchange is handled by `/auth/callback`; by the time the user reaches this page, they already have a session
- `error` prop passed to `ResetPasswordForm` from `?error=` query param

---

#### 9. Reset-password API endpoint

**File:** `src/pages/api/auth/reset-password.ts` (new)

**Intent:** Accept a POST with `password` and `confirmPassword`. Validate they match, then call `supabase.auth.updateUser({ password })`. On success, redirect to `/auth/signin?success=password_reset`.

**Contract:**

- Follows the **redirect-on-error** convention of `signin.ts`, not the `HttpError`/JSON pattern of `identify.ts` — every outcome (including a missing/expired session) ends in a redirect, never a raw JSON body served to the browser
- Auth gate: inline `createClient` + `supabase.auth.getUser()`; if there is no user (recovery session expired between page load and submit), redirect to `/auth/forgot-password?error=session_expired` — do **not** throw `HttpError(401)` JSON
- Returns 400 via redirect to `?error=passwords_mismatch` if fields don't match
- On Supabase error, redirect to `/auth/reset-password?error=update_failed`
- On success, redirect to `/auth/signin?success=password_reset`

---

### Success Criteria

#### Automated Verification

- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`

#### Manual Verification

- "Forgot password?" link appears below the password field on `/auth/signin`
- Submitting `/auth/forgot-password` with any email shows the "Check your inbox" state
- Password reset email appears in local Inbucket (http://localhost:54324)
- Clicking the email link arrives at `/auth/reset-password` with a valid session
- Submitting a new password redirects to `/auth/signin` with the success banner
- Signing in with the new password succeeds
- Entering an expired or missing link code at `/auth/callback` redirects to `/auth/forgot-password?error=link_invalid` and shows an error

**Implementation Note:** After completing this phase and all automated verification passes, pause here for manual confirmation before proceeding to Phase 2.

### Addendum (discovered during implementation)

- **`eslint.config.js` — disabled `@typescript-eslint/no-misused-promises` for `.astro` files.** The new `callback.astro` and `reset-password.astro` use a top-level `return Astro.redirect(...)` in frontmatter, which crashes `astro-eslint-parser` when this type-aware rule runs. Disabled at the config level for all `.astro` files (commit `8725049`). Trade-off: the rule no longer guards floating/misused promises on any Astro page. Revisit with a scoped `overrides` block if a future parser release fixes the crash.

---

## Phase 2: Account Deletion

### Overview

Adds the admin Supabase client, the delete-account API endpoint (password verification → storage cleanup → user cascade), and the confirmation modal on the dashboard.

### Changes Required

#### 1. Service role key env declaration

**File:** `astro.config.mjs`

**Intent:** Declare `SUPABASE_SERVICE_ROLE_KEY` in the env schema so it is available via `astro:env/server` in the delete-account endpoint and the admin client factory.

**Contract:** `envField.string({ context: "server", access: "secret", optional: true })` — matches the pattern of the existing Supabase vars. The actual secret is set as a Cloudflare Worker secret via `wrangler secret put SUPABASE_SERVICE_ROLE_KEY`, not in `wrangler.jsonc`.

---

#### 2. Admin Supabase client factory

**File:** `src/lib/supabase-admin.ts` (new)

**Intent:** Create a plain (non-SSR) Supabase client using the service role key. Used only inside API route handlers to perform admin operations that bypass RLS.

**Contract:**

- Imports `createClient` from `@supabase/supabase-js` (not `@supabase/ssr` — no cookie plumbing needed)
- `createAdminClient()` returns `null` when `SUPABASE_URL` or `SUPABASE_SERVICE_ROLE_KEY` are absent
- Options: `auth: { autoRefreshToken: false, persistSession: false }` — no token refresh, no local storage
- Never imported from client-side code

---

#### 3. Photos bucket constant

**File:** `src/lib/identify/storage.ts` (new) + `src/lib/identify/persistence.ts` (edit)

**Intent:** Hoist the hardcoded `"photos"` storage bucket name into a single exported `PHOTOS_BUCKET` constant so uploads and account-deletion cleanup reference one source of truth (lesson: constants belong in config/resource files, not logic files).

**Contract:**

- Add `export const PHOTOS_BUCKET = "photos";` in `src/lib/identify/storage.ts` (new)
- Refactor the storage call site in `persistence.ts` (`supabase.storage.from("photos")`, line ~73) to import and use `PHOTOS_BUCKET`. The DB table calls `supabase.from("photos")` (lines ~33, ~87) are a different namespace (table, not bucket) — leave them as-is
- `delete-account.ts` imports `PHOTOS_BUCKET` from the same module

---

#### 4. Delete-account API endpoint

**File:** `src/pages/api/auth/delete-account.ts` (new)

**Intent:** Verify the user's password, clean up their storage files, then delete the auth user (which cascades all DB rows). Return JSON so the React modal can handle success/error without a page reload.

**Contract:**

- Accepts POST with JSON body `{ password: string }`
- `requireSupabaseClient` + `requireAuthenticatedUser` — must be authenticated
- Password verification: call `supabase.auth.signInWithPassword({ email: user.email!, password })` — if error, return `HttpError(401, { error: "Wrong password" })` as JSON
- Storage cleanup: page through `adminClient.storage.from(PHOTOS_BUCKET).list(user.id, { limit, offset })` — `list` returns at most 100 objects by default, so loop (incrementing `offset` by the page size, or re-listing after each delete) until a page returns fewer than `limit`, accumulating names; map each to a full path `${user.id}/${name}`; batch-delete via `.remove(paths)`. Tolerate an empty first page (no photos uploaded yet). **Do not** rely on a single `list()` call — a user with >100 photos would otherwise leave orphaned files
- User deletion: `adminClient.auth.admin.deleteUser(user.id)` — cascades all DB rows
- Sign out: `supabase.auth.signOut()` — clears session cookies
- Return `Response.json({ success: true })` on completion
- `PHOTOS_BUCKET` is imported from `src/lib/identify/storage.ts` (added in §3 above) — do not hardcode the string

Extraction helpers (following `identify.ts` style):

- `verifyPassword(supabase, user, password)` — throws `HttpError(401)` on mismatch
- `deleteUserStorage(adminClient, userId)` — pages through `list()` and removes all storage objects under the user prefix (handles >100 files)
- `deleteAuthUser(adminClient, userId)` — calls `auth.admin.deleteUser`

---

#### 5. Delete-account modal component

**File:** `src/components/auth/DeleteAccountModal.tsx` (new)

**Intent:** Modal with a password input and a confirmation button. On submit, POSTs JSON to `/api/auth/delete-account` via `fetch`. On success, navigates to `/`. On 401, shows "Wrong password" inline. On other errors, shows a generic error.

**Contract:**

- Accepts an `open` prop (boolean) and an `onClose` callback; rendered from `dashboard.astro`
- Uses `FormField.tsx` for the password input and `PasswordToggle.tsx` for show/hide
- No full page reload on error — error state is local React state
- On success response: `window.location.href = "/"` — forces a full navigation so session cookies are cleared from the browser
- Destructive action button styled distinctly (e.g., red/danger color) to signal irreversibility

---

#### 6. Dashboard — delete account UI

**File:** `src/pages/dashboard.astro`

**Intent:** Add a "Delete account" link/button that opens `DeleteAccountModal`. The modal is conditionally rendered via React state.

**Contract:**

- `DeleteAccountModal` is wrapped in a React island that manages the `open` state — the trigger button can be a small text link in the header area, styled clearly as a destructive action
- No `confirm()` dialog — the modal IS the confirmation step

---

### Success Criteria

#### Automated Verification

- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`

#### Manual Verification

- "Delete account" button is visible on the dashboard
- Clicking it opens the password modal
- Entering the wrong password shows "Wrong password" inline; modal stays open
- Entering the correct password triggers deletion; browser redirects to `/`
- After deletion, attempting to sign in with the old credentials fails
- Supabase Storage bucket contains no files for the deleted user (verified via Studio)
- Supabase Auth user table contains no record for the deleted user (verified via Studio)

**Implementation Note:** After completing this phase and all automated verification passes, pause here for manual confirmation before proceeding to Phase 3.

---

## Phase 3: Tests and Verification

### Overview

Adds unit tests for the three new API endpoints and documents the manual smoke test checklist for the complete auth loop.

### Changes Required

#### 1. Forgot-password route tests

**File:** `test/integration/forgot-password-route.test.ts` (new)

**Intent:** Verify that the forgot-password endpoint calls `resetPasswordForEmail` with the right arguments and always redirects to `?sent=true` regardless of outcome (including when Supabase returns an error).

**Contract:** Mock `supabase.auth.resetPasswordForEmail` via `vi.hoisted`. Two cases: (a) happy path — verify `redirectTo` contains `/auth/callback?next=` and response redirects to `?sent=true`; (b) Supabase error — response still redirects to `?sent=true` (no email enumeration).

---

#### 2. Reset-password route tests

**File:** `test/integration/reset-password-route.test.ts` (new)

**Intent:** Verify that the reset-password endpoint validates matching passwords, calls `supabase.auth.updateUser`, and redirects correctly on success and failure.

**Contract:** Three cases: (a) passwords mismatch — redirects to `?error=passwords_mismatch`, `updateUser` not called; (b) success — `updateUser` called with `{ password }`, redirects to `/auth/signin?success=password_reset`; (c) Supabase update error — redirects to `?error=update_failed`.

---

#### 3. Delete-account route tests

**File:** `test/integration/delete-account-route.test.ts` (new)

**Intent:** Verify the delete-account endpoint's sequence: password verification, storage cleanup, user deletion, sign-out. Mock both the regular Supabase client and the admin client factory.

**Contract:**

- Mock `@/lib/supabase` (`createClient`) via `vi.hoisted` for user client operations
- Mock `@/lib/supabase-admin` (`createAdminClient`) via `vi.hoisted` for admin operations
- Cases: (a) wrong password — 401 JSON, no storage or user deletion calls; (b) success — `signInWithPassword` called (returns user), storage list + remove called, `auth.admin.deleteUser` called, `signOut` called, returns `{ success: true }`; (c) no photos in storage — storage `list` returns empty array, `remove` not called, deletion proceeds; (d) pagination — `list` returns a full page (e.g. 100 items) then a short page; assert `list` is called more than once and every path across both pages is passed to `remove` (no files orphaned past the first page)

---

### Success Criteria

#### Automated Verification

- Forgot-password tests pass: `npm run test -- test/integration/forgot-password-route.test.ts`
- Reset-password tests pass: `npm run test -- test/integration/reset-password-route.test.ts`
- Delete-account tests pass: `npm run test -- test/integration/delete-account-route.test.ts`
- Full test suite still passes: `npm run test`
- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`

#### Manual Verification

- Full password reset loop: sign in → forgot password → email in Inbucket → click link → set new password → sign in with new password ✓
- Full deletion loop: sign in → delete account → confirm with password → redirect to home → old credentials rejected ✓
- Deletion cascade: no storage files, no DB rows, no auth user for deleted account (verified in Supabase Studio) ✓
- No regressions: sign-up and sign-in flows work as before ✓

---

## Testing Strategy

### Unit Tests

New tests in `test/integration/` following the existing `identify-route.test.ts` pattern:

- `vi.hoisted` mocks for `@/lib/supabase` (and `@/lib/supabase-admin` for delete)
- `makeAPIContext` helper from `test/helpers/route.ts`
- MSW only needed for external HTTP calls; password reset and deletion are Supabase SDK calls (mocked at module level)

### Manual Testing Steps

1. Start local Supabase: `npx supabase start`
2. Start dev server: `npm run dev`
3. Navigate to `/auth/forgot-password` and submit an email address
4. Open Inbucket at http://localhost:54324 and verify the reset email arrives
5. Click the link — verify `/auth/callback` exchanges the code and redirects to `/auth/reset-password`
6. Submit new password — verify redirect to `/auth/signin` with success banner
7. Sign in with new password — verify dashboard loads
8. Open "Delete account" modal, enter wrong password — verify inline error, modal stays open
9. Enter correct password — verify redirect to `/`, check Supabase Studio for deleted user + empty storage

## Migration Notes

No schema migrations required. The PKCE callback route and the delete endpoint work with the existing schema; the cascade-on-delete behavior is already in place.

The `SUPABASE_SERVICE_ROLE_KEY` must be added as a Cloudflare Worker secret before deploying Phase 2:

```
wrangler secret put SUPABASE_SERVICE_ROLE_KEY
```

For local dev, add it to `.env.local` (which is gitignored).

## References

- PRD: `context/foundation/prd.md` — FR-001, FR-002, FR-010
- Roadmap: `context/foundation/roadmap.md` — S-04
- Existing auth routes: `src/pages/api/auth/signin.ts`, `signup.ts`, `signout.ts`
- Handler pattern reference: `src/pages/api/identify.ts`
- Test pattern reference: `test/integration/identify-route.test.ts`

---

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Password Reset Flow

#### Automated

- [x] 1.1 Type checking passes: `npm run typecheck` — 8725049
- [x] 1.2 Linting passes: `npm run lint` — 8725049

#### Manual

- [x] 1.3 "Forgot password?" link appears below the password field on `/auth/signin` — 8725049
- [x] 1.4 Submitting `/auth/forgot-password` with any email shows the "Check your inbox" state — 8725049
- [x] 1.5 Password reset email appears in local Inbucket (http://localhost:54324) — 8725049
- [x] 1.6 Clicking the email link arrives at `/auth/reset-password` with a valid session — 8725049
- [x] 1.7 Submitting a new password redirects to `/auth/signin` with the success banner — 8725049
- [x] 1.8 Signing in with the new password succeeds — 8725049
- [x] 1.9 Expired/invalid link at `/auth/callback` redirects to `/auth/forgot-password?error=link_invalid` — 8725049

### Phase 2: Account Deletion

#### Automated

- [ ] 2.1 Type checking passes: `npm run typecheck`
- [ ] 2.2 Linting passes: `npm run lint`

#### Manual

- [ ] 2.3 "Delete account" button is visible on the dashboard
- [ ] 2.4 Clicking it opens the password modal
- [ ] 2.5 Wrong password shows "Wrong password" inline; modal stays open
- [ ] 2.6 Correct password triggers deletion; browser redirects to `/`
- [ ] 2.7 Old credentials rejected after deletion
- [ ] 2.8 No storage files remain for the deleted user (Supabase Studio)
- [ ] 2.9 No auth user record remains for the deleted user (Supabase Studio)

### Phase 3: Tests and Verification

#### Automated

- [ ] 3.1 Forgot-password tests pass: `npm run test -- test/integration/forgot-password-route.test.ts`
- [ ] 3.2 Reset-password tests pass: `npm run test -- test/integration/reset-password-route.test.ts`
- [ ] 3.3 Delete-account tests pass: `npm run test -- test/integration/delete-account-route.test.ts`
- [ ] 3.4 Full test suite passes: `npm run test`
- [ ] 3.5 Type checking passes: `npm run typecheck`
- [ ] 3.6 Linting passes: `npm run lint`

#### Manual

- [ ] 3.7 Full password reset loop verified end-to-end
- [ ] 3.8 Full deletion loop verified end-to-end
- [ ] 3.9 Deletion cascade: no storage files, no DB rows, no auth user for deleted account (Supabase Studio)
- [ ] 3.10 Sign-up and sign-in regressions: both flows work as before
