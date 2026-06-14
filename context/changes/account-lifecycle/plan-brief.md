# Account Lifecycle — Plan Brief

> Full plan: `context/changes/account-lifecycle/plan.md`

## What & Why

Complete the account lifecycle by adding password reset (FR-010) and account deletion (GDPR prerequisite). Sign-up and sign-in are already implemented; this plan closes the remaining auth gaps so the product can be used by anyone other than the owner without technical or compliance risk.

## Starting Point

`SignInForm`, `SignUpForm`, and the three `/api/auth/` endpoints for sign-in, sign-up, and sign-out are all wired and working. The Supabase client (`createServerClient` from `@supabase/ssr`) handles cookie-based sessions, and middleware guards the dashboard. There is no `/auth/callback` route, no forgot-password or reset-password pages, no admin Supabase client, and no account deletion endpoint or UI.

## Desired End State

A user who forgot their password can reset it entirely by email — clicking "Forgot password?" on the sign-in page, receiving a link, and landing back at sign-in with a success banner. An authenticated user can permanently delete their account via a password-confirmation modal on the dashboard, removing all their storage files, DB rows, and auth record in a single action.

## Key Decisions Made

| Decision                       | Choice                                              | Why (1 sentence)                                                                          | Source |
| ------------------------------ | --------------------------------------------------- | ----------------------------------------------------------------------------------------- | ------ |
| Account deletion in this slice | Yes                                                 | Required before inviting any non-owner user (GDPR prerequisite in roadmap open questions) | Plan   |
| Post-reset redirect            | Sign-in page with success banner                    | Re-authentication after a credential change is a security best practice                   | Plan   |
| "Forgot password?" entry       | Link below password field, no email pre-fill        | Clean, avoids email-in-URL (logs/history), no coupling between forms                      | Plan   |
| Expired link UX                | Error on reset-password page with resend link       | Keeps the user in the flow; no dead ends                                                  | Plan   |
| Delete confirmation            | Password re-entry modal on dashboard                | Simple credential-based gate; prevents accidental deletion                                | Plan   |
| Email template                 | Default Supabase (no customization)                 | Consistent with main_goal: speed; matches existing confirm-email approach                 | Plan   |
| Testing                        | Unit tests for new API handlers + manual smoke test | Consistent with S-01 pattern; catches handler logic regressions                           | Plan   |

## Scope

**In scope:**

- Forgot-password page + form + API endpoint
- Supabase PKCE callback route (`/auth/callback`) — reusable for future flows
- Reset-password page + form + API endpoint
- "Forgot password?" link on sign-in form; success banner after reset
- Admin Supabase client factory (`src/lib/supabase-admin.ts`)
- Delete-account API endpoint (password verify → storage cleanup → user cascade)
- Delete-account modal on dashboard
- Unit tests for all three new endpoints

**Out of scope:**

- Email/password change for authenticated users
- Custom password reset email template
- Rate limiting on forgot-password endpoint
- Account data export (GDPR Art. 20)
- Session management UI

## Architecture / Approach

Password reset uses Supabase's built-in PKCE flow: `resetPasswordForEmail` sends an email whose link points to `/auth/callback?next=/auth/reset-password`; the callback page exchanges the code for a recovery session and redirects; the reset-password page calls `supabase.auth.updateUser({ password })`. Account deletion uses a separate admin client (service role key, bypasses RLS) to list and remove storage files, then `auth.admin.deleteUser` which cascades all DB rows. All new API routes follow the `requireAuthenticatedUser` / `HttpError` handler pattern from `identify.ts`.

## Phases at a Glance

| Phase                   | What it delivers                                                                          | Key risk                                                                                         |
| ----------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| 1. Password Reset       | PKCE callback route, forgot/reset pages + endpoints, sign-in form link and success banner | PKCE cookie flow depends on the browser that initiated the reset — test in-browser, not headless |
| 2. Account Deletion     | Admin client, delete-account endpoint, dashboard modal                                    | Storage cleanup must precede `auth.admin.deleteUser`; ordering is load-bearing                   |
| 3. Tests + Verification | Unit tests for 3 new endpoints, manual smoke test                                         | Test mocking of admin client requires a second `vi.mock` for `@/lib/supabase-admin`              |

**Prerequisites:** `SUPABASE_SERVICE_ROLE_KEY` must be added as a Cloudflare Worker secret before deploying Phase 2 (`wrangler secret put SUPABASE_SERVICE_ROLE_KEY`); add to `.env.local` for local dev.

**Estimated effort:** ~2 sessions across 3 phases.

## Open Risks & Assumptions

- The `PHOTOS_BUCKET` constant (used in storage cleanup) is assumed to exist somewhere in the codebase; the delete-account endpoint must import it rather than hardcoding the string.
- PKCE code verifier storage in cookies is managed by `@supabase/ssr` automatically — assumes `createClient(Astro.request.headers, Astro.cookies)` is called before any auth methods on the forgot-password request.

## Success Criteria (Summary)

- Full password reset loop works end-to-end via Inbucket (local email) and in production
- Account deletion removes all storage files, DB rows, and the auth user — verified in Supabase Studio
- All three new endpoint test suites pass; full test suite shows no regressions
