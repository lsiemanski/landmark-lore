# First Identification and Save (S-01) Implementation Plan

## Overview

Extend the existing `identify.ts` endpoint to persist photo uploads and identification results to Supabase Storage and the database, add `request_id`-based idempotency to prevent duplicate rows on retry, and ship the `UploadFlow` React component directly on the dashboard — the app's primary action after login.

## Current State Analysis

F-01 and F-02 are cleanly landed, and F-03 (`testing-harness-bootstrap`) has since landed too. The schema, storage bucket, typed client, AI endpoint, and client-side downscale harness are all in production. The `identify.ts` endpoint already handles auth, rate-limiting, and the OpenRouter AI call — but **persists nothing**. Post-F-03 the endpoint is **114 lines** (down from 178): the AI logic was extracted into `src/lib/ai/identification.ts` and `identify.ts:5` now imports `identifyImage` from it. The `HttpError`/`jsonResponse` and quota helpers are still inline in `identify.ts`. The `photos` and `identifications` tables and the private `photos` storage bucket are fully provisioned and waiting.

## Desired End State

A logged-in user visits `/dashboard`, is immediately presented with the upload form (file input + "Identify" button), picks a photo, and after a spinner-and-status-text loading period receives the subject name and description in-place — with a "Saved to your archive" confirmation beneath. If the subject is unrecognised, a "Try another photo" CTA is shown (nothing is persisted). The daily limit (100 identifications) appears only when the user hits the cap (429). No separate `/upload` route exists — identification is the dashboard.

### Key Discoveries:

- `requireAuthenticatedUser()` in `identify.ts:46` returns `user` but the caller at `identify.ts:13` discards it — S-01 must capture it for storage path and `photos` INSERT
- `readImageAsBase64` at `identify.ts:54` reads the `ArrayBuffer` and discards it after converting to base64 — S-01 needs both the base64 string (for AI) and the raw bytes (for Storage upload); the helper must be refactored
- `identifications.photo_id` is `UNIQUE` (one-to-one) — attempting a second INSERT for the same `photo_id` will throw a constraint violation; idempotency at the `photos.request_id` level prevents reaching this
- `folders` has a trigger that auto-creates an "Uncategorized" folder for every new auth user — every user already has one; `photos.folder_id` is NOT NULL RESTRICT, so it must be looked up before INSERT
- Storage and DB writes are not atomic — a crash after `storage.upload()` but before `photos` INSERT leaves an orphan object; this is an accepted MVP risk at the current volume
- The `IdentifyHarness.tsx` at `src/components/identify/IdentifyHarness.tsx:31` contains the spinner pattern, downscale call, and error display that the production UI must inherit and extend — do not copy it wholesale; extract by domain boundary

## What We're NOT Doing

- Streaming / SSE progress (deferred to S-02)
- Quota display in the dashboard header or on the upload page (shown only on 429)
- Archive grid / thumbnail list on the dashboard (that is S-03)
- Saving unrecognized photos (the AI call consumes a quota slot; no photo row or identifications row is created)
- Auto-retry on identification failure (user re-initiates)
- Cleanup of orphaned Storage objects on crash (accepted MVP risk, future S-03/GDPR)
- A detail page at `/photos/:id` (inline result on the dashboard is sufficient for S-01)
- A dedicated `/upload` route (the upload form lives on the dashboard)

## Implementation Approach

**Single endpoint extension (Option A), write-on-completion**: extend `identify.ts` with new private helpers following the existing decomposition pattern (lessons.md: "Split long functions"). Storage upload and DB writes happen only after the AI call returns `recognised: true` — nothing is persisted for unrecognized results, so no rollback or cleanup is needed on that path. The client sends `request_id` as an additional FormData field alongside `photo`; the Worker checks for an existing `photos` row with that `request_id` before proceeding (idempotency cache only applies to recognized/saved results, since unrecognized results leave no row).

**Image sizing strategy**: the client downscales to `MAX_EDGE=2048px` (JPEG, quality 0.8) before sending. This single blob is used for both the AI call (Gemini handles 2048px without meaningful cost difference vs 1024px) and Storage (giving archive viewers enough resolution to zoom into panoramic and detail shots). Display in the S-01 result screen uses `URL.createObjectURL(photo)` — the local `File` already in memory, CSS-constrained to fit the layout — so no Storage fetch is needed for the preview. For S-03 archive thumbnails, Supabase Storage image transforms (`createSignedUrl` with `transform: { width, resize }`) serve the stored 2048px file at any display size without a second upload. Note: `MAX_EDGE` in `src/lib/client/downscale.ts` changes from `1024` to `2048`; this also affects `IdentifyHarness.tsx` (acceptable — it is a dev tool).

---

## Phase 1: Schema — `request_id` on `photos`

### Overview

Add a nullable `request_id UUID UNIQUE` column to the `photos` table via a new migration, then regenerate the TypeScript types so the new column is visible to the type system.

### Changes Required:

#### 1. Migration file

**File**: `supabase/migrations/20260612000001_add_request_id_to_photos.sql`

**Intent**: Add `request_id` to `photos` so the Worker can detect a duplicate submission for the same logical identify action and return the cached result rather than making a second paid AI call.

**Contract**: Column is nullable (existing rows keep NULL), UUID type, with a **partial unique index** scoped to `(user_id, request_id) WHERE request_id IS NOT NULL` — semantically correct since idempotency is per-user, and the partial predicate indexes only rows that actually carry a `request_id`. A plain UNIQUE on `request_id` alone would also work (UUIDs are globally unique), but the composite index is more explicit. Note: this is a partial unique index rather than a table-level `UNIQUE` constraint; the two are equivalent for uniqueness enforcement here (Postgres treats NULLs as distinct either way), but a partial index cannot back an `INSERT ... ON CONFLICT (user_id, request_id)` unless the same `WHERE request_id IS NOT NULL` predicate is repeated — not a concern in S-01, where idempotency is a SELECT-before-INSERT (Phase 2 §4). No RLS changes needed; the existing owner-all policy on `photos` already applies.

#### 2. TypeScript types

**File**: `src/types/supabase.ts`

**Intent**: Add `request_id: string | null` to the `photos` Row, Insert, and Update shapes so the TypeScript compiler enforces the new column.

**Contract**: Run `supabase gen types typescript --local > src/types/supabase.ts` after applying the migration locally. The `photos.Row` gains `request_id: string | null`; `photos.Insert` gains `request_id?: string | null`; `photos.Update` gains `request_id?: string | null`. All three shapes must be updated; a partial update causes type drift.

### Success Criteria:

#### Automated Verification:

- Migration applies cleanly against the local Supabase stack: `supabase db reset`
- TypeScript types compile without error: `npx astro check`
- Lint passes: `npm run lint`

#### Manual Verification:

- `supabase db diff` shows no unexpected schema drift after reset
- `photos` table in Supabase Studio shows the `request_id` column as nullable UUID

**Implementation Note**: After this phase passes automated verification and the manual check confirms the column exists, pause for human confirmation before proceeding to Phase 2.

---

## Phase 2: Backend — persistence + idempotency

### Overview

Extend the identify endpoint with persistence, idempotency, and upload handling. `identify.ts` is already 114 lines post-F-03 (the AI logic is in `src/lib/ai/identification.ts`); adding the upload, persistence, and idempotency helpers inline would push it back past the 250-line ceiling (lessons.md: "Keep files under 250 lines"), so the remaining concerns are split across new modules by single responsibility. The handler file becomes thin orchestration only.

**New file layout:**

| File                                                          | Responsibility                                                                                                                                                                                                                                                                                                                                                    | Est. lines |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| `src/lib/api/http.ts`                                         | `HttpError` — moved out of `identify.ts`; reusable by any API route. (Reconciled 2026-06-14, impl-review F4: `jsonResponse` was **not** extracted — the handler uses native `Response.json()` instead.)                                                                                                                                                           | ~12        |
| `src/lib/identify/upload.ts`                                  | `parseUploadRequest`, `encodeForAI`                                                                                                                                                                                                                                                                                                                               | ~30        |
| `src/lib/identify/quota.ts`                                   | `currentPeriod`, `consumeSlot`, `refundSlot` — moved from `identify.ts`                                                                                                                                                                                                                                                                                           | ~25        |
| `src/lib/ai/identification.ts` _(exists — extracted by F-03)_ | Already holds `identificationSchema`, `identifyImage`, `requestIdentification`, `visionMessages` and the `IdentificationResult` interface. S-01 edits it **in place** — no move, no new file: add zod schema validation (`safeParse`) and change `identifyImage`'s return from `Promise<unknown>` → `Promise<IdentificationResult>` (see §0 reconciliation note). | ~+15       |
| `src/lib/identify/persistence.ts`                             | `checkIdempotencyCache`, `lookupDefaultFolder`, `uploadPhotoToStorage`, `persistPhotoAndIdentification`                                                                                                                                                                                                                                                           | ~85        |
| `src/pages/api/identify.ts`                                   | `requireApiKey`, `requireSupabaseClient`, `requireAuthenticatedUser`, `POST` handler                                                                                                                                                                                                                                                                              | ~50        |

**Directory convention:** the AI module stays in `src/lib/ai/` (F-03's established home — see Phase 2 §0); the new request-glue modules (`upload.ts`, `quota.ts`, `persistence.ts`) live under a new `src/lib/identify/`. This is a deliberate split by concern — `src/lib/ai/` holds model/prompt/identification logic, `src/lib/identify/` holds the route's upload/persistence plumbing — chosen over relocating `identification.ts` (which would break the F-03 unit tests that import `@/lib/ai/identification`).

The response extends from `{ result }` to `{ result, photoId? }`.

### Changes Required:

#### 0. Move existing concerns to new modules

**Files created**: `src/lib/api/http.ts`, `src/lib/identify/quota.ts`
**File edited (already exists)**: `src/lib/ai/identification.ts`

**Intent**: Before adding new helpers, relocate the still-inline private functions from `identify.ts` into their single-responsibility homes. **Note:** F-03 already extracted the AI logic into `src/lib/ai/identification.ts` (`identify.ts:5` imports `identifyImage` from it), so the AI module is _edited in place_, not moved. This keeps the handler file within the 250-line ceiling as new helpers land.

**Contract**:

- `src/lib/api/http.ts` — receives `HttpError` (verbatim move, no logic change). Export it; update the import in `identify.ts`. (`jsonResponse` was not extracted — see the file-layout table note; the handler returns `Response.json(...)` directly.)
- `src/lib/ai/identification.ts` — **already exists (F-03 extraction); edit in place, do not create a new file and do not move anything.** It already contains `identificationSchema`, `identifyImage`, `requestIdentification`, `visionMessages` and exports the `IdentificationResult` interface (`{ recognised: boolean; subjectName: string; description: string }`, `identification.ts:20-24`). S-01's remaining work: (a) validate the parsed response and narrow it to `IdentificationResult`; (b) change `identifyImage`'s return from `Promise<unknown>` (`identification.ts:26`) to `Promise<IdentificationResult>` — after `JSON.parse`, validate and throw on failure so the handler's outer try/catch refunds the slot and returns 502. This closes the `npx astro check` gap (the handler and persistence read `result.recognised` / `result.subjectName` / `result.description` off a typed value) and guarantees the json_object fallback path — which is **not** schema-enforced — can never write malformed values into the NOT NULL `identifications` columns. **Reconciled (2026-06-14, impl-review F2):** the original plan called for a hand-rolled `isIdentificationResult` guard to avoid a validation dependency for bundle reasons — but `zod` is already a transitive dependency (`^4.3.6` in `package-lock.json` via `openai`/`astro`), so using it directly adds **zero** bundle weight. The implementation defines `IdentificationResultSchema = z.object({...})`, validates via `IdentificationResultSchema.safeParse(...)` (throwing `"Malformed AI response"` on failure), derives `IdentificationResult` via `z.infer`, and replaces the prior hand-written JSON-schema literal with `z.toJSONSchema(...)`. Bundle budget re-confirmed via the Phase 2 `wrangler deploy --dry-run` (criterion 2.3). **Keep the module path `@/lib/ai/identification`** — `test/unit/identification.test.ts` (6 tests) imports from it; moving the file would break them.
- `src/lib/identify/quota.ts` — receives `currentPeriod`, `consumeSlot`, `refundSlot` (verbatim move). Export all three.
- `src/pages/api/identify.ts` — retains only `requireApiKey`, `requireSupabaseClient`, `requireAuthenticatedUser`, and the `POST` handler; imports everything else from the new modules.

#### 1. `parseUploadRequest` — replace `readImageAsBase64`

**File**: `src/lib/identify/upload.ts`

**Intent**: Reads the FormData once and returns the two values the handler needs immediately: the uploaded file and the idempotency key. Replaces `readImageAsBase64`, which conflated stream parsing, encoding, and metadata extraction into one function. The `File` object carries its own `type` (MIME) and `name` (original filename) — callers read those fields directly rather than receiving extracted copies.

**Contract**: Returns `{ photo: File; requestId: string }`. Throws `HttpError(400, { error: 'Missing request_id' })` if `request_id` is absent or not a valid UUID v4. **Preserves the existing upload validation from `readImageAsBase64` (identify.ts:69-80):** throws `HttpError(415, { error: 'Unsupported media type' })` if the `photo` field is not a `File` or its `type` is not in `IDENTIFY_CONFIG.allowedTypes`, and `HttpError(413, { error: 'File too large' })` if `photo.size > IDENTIFY_CONFIG.maxBytes`. These checks back success criterion 2.7 (invalid MIME → 415).

#### 2. `encodeForAI` and `hashPhoto` — encode image for the AI call and compute content hash

**File**: `src/lib/identify/upload.ts`

**Intent**: Two separate pure functions over the same `File`, kept together because both operate on raw bytes before any I/O.

- `encodeForAI` — encodes the photo as a base64 string for the OpenRouter/Gemini API call.
- `hashPhoto` — computes a SHA-256 hex digest of the photo bytes via `crypto.subtle.digest("SHA-256", ...)`. Used by the handler immediately after parsing to enable content-based idempotency validation (§4).

**Contract**: Both accept `photo: File` and return `Promise<string>`. No side effects. `crypto.subtle` is available on Cloudflare Workers and Node 18+.

#### 3. `requireAuthenticatedUser` — capture return value

**File**: `src/pages/api/identify.ts` (stays in handler; thin auth guard specific to this route's `APIContext`)

**Intent**: The handler currently calls `await requireAuthenticatedUser(supabase)` but discards the returned `user`. The user's `id` is needed for the Storage path prefix (`photos/{user_id}/{photo_id}.ext`) and the `photos.user_id` INSERT field.

**Contract**: Change `await requireAuthenticatedUser(supabase)` to `const user = await requireAuthenticatedUser(supabase)` in the handler. The helper itself (`identify.ts:61`) is unchanged.

#### 4. `checkIdempotencyCache` — new helper

**File**: `src/lib/identify/persistence.ts`

**Intent**: Before consuming a quota slot, check whether a `photos` row with this `(user_id, request_id)` pair already exists. If it does (in S-01 such a row always has `status='identified'` with an `identifications` row), return the cached result immediately without calling the AI. Also returns the stored `photo_hash` so the handler can detect `request_id` reuse with a different photo (which indicates a client bug) and return 409 instead of silently serving the wrong cached result.

**Contract**: Query `photos` WHERE `user_id = userId AND request_id = requestId`, left-join `identifications`, selecting `id, photo_hash, identifications(subject_name, description)`. Returns `null` (no cache hit) or `{ photoId: string; photoHash: string | null; result: IdentificationResult }`. Since unrecognized photos are never saved and persistence only ever writes `status='identified'`, a cache hit guarantees an `identifications` row exists. The handler compares `cached.photoHash !== photoHash` (where `photoHash` is a SHA-256 hex digest of the incoming photo bytes, computed via `crypto.subtle.digest`) and throws `HttpError(409, { error: 'request_id already used with a different photo' })` on mismatch. On hash match (true retry), the handler returns `jsonResponse({ result, photoId })` immediately. (No `status='error'` handling is needed in S-01 — no code path writes that status; it would only become relevant if a future slice introduces a partial-write/error state.)

#### 5. `lookupDefaultFolder` — new helper

**File**: `src/lib/identify/persistence.ts`

**Intent**: Every `photos` INSERT requires a `folder_id`. The user's "Uncategorized" folder was auto-created by the trigger in F-01's migration. This helper fetches its `id` so the photo row can be inserted.

**Contract**: `SELECT id FROM folders WHERE user_id = userId AND name = 'Uncategorized' LIMIT 1`. Throws `HttpError(500, { error: 'Default folder not found' })` if no row is returned (should never happen due to the trigger, but a missing folder would otherwise cause a FK violation on INSERT).

#### 6. `uploadPhotoToStorage` — new helper

**File**: `src/lib/identify/persistence.ts`

**Intent**: Upload the raw image bytes to the private `photos` Storage bucket at the path `{user_id}/{photo_id}.{ext}`. The extension is derived from the MIME type.

**Contract**: Uses `supabase.storage.from('photos').upload(path, arrayBuffer, { contentType: mimeType })`. Path format: `{userId}/{photoId}.{ext}` where ext is derived from mimeType (`image/jpeg` → `jpg`, `image/png` → `png`, `image/webp` → `webp`). Throws `HttpError(502, { error: 'Storage upload failed' })` on error. Returns the `storagePath` string used for the `photos` INSERT.

#### 7. `persistPhotoAndIdentification` — new helper

**File**: `src/lib/identify/persistence.ts`

**Intent**: Called only when `recognised: true`. Performs the three writes that make an identification permanent: Storage upload of the 2048px client-downscaled image, `photos` INSERT (final status `'identified'` — no `'pending'` intermediate), and `identifications` INSERT. Placing all three writes here keeps the happy path atomic from the handler's perspective.

**Contract**: Accepts four typed parameters — `supabase` (infrastructure), `user` (auth context), `upload: { photoId: string; requestId: string; photo: File; folderId: string; photoHash: string }` (what is being saved), and `result: IdentificationResult` (AI output). Grouping by concern means the caller passes coherent objects rather than a flat bag of seven unrelated values. Reads `upload.photo.type` for MIME type, `upload.photo.name` for original filename, and `upload.photo.arrayBuffer()` for raw bytes — consumed internally. Sequence: (1) `uploadPhotoToStorage` — upload raw bytes to `photos/{userId}/{photoId}.{ext}`; throws `HttpError(500)` on storage error. (2) INSERT into `photos` with `status='identified'`, `request_id`, `photo_hash`, and all required fields; throws `HttpError(500)` on error. (3) INSERT into `identifications` with `photo_id`, `subject_name = result.subjectName`, `description = result.description`; throws `HttpError(500)` on error. A Storage upload that succeeds but whose DB insert fails leaves an orphan object — this is the accepted MVP atomicity risk; document but do not handle in S-01. **Caveat (2026-06-14, impl-review F3):** the three writes are also non-atomic _relative to each other_. If the `photos` INSERT succeeds but the `identifications` INSERT fails, a `photos` row exists for that `(user_id, request_id)` with no `identifications` child. On retry, `checkIdempotencyCache` sees `identifications = null`, treats it as a cache miss, and the fresh persist reuses the same `request_id` → partial-unique-index violation → 500. That `request_id` is then permanently stuck (the user must start a new identify action to get a fresh key). This contradicts §4's "a cache hit guarantees an `identifications` row exists" in the half-written case. Accepted for S-01 (DB insert rarely half-fails); the half-written `photos` row is a cleanup target for S-03/GDPR work.

#### 8. Handler orchestration update

**File**: `src/pages/api/identify.ts` (imports from all four new modules; contains only the `POST` handler and its three thin guards)

**Intent**: Wire the new helpers into the handler in the correct order. Storage and DB writes now happen only after a successful `recognised: true` AI result — nothing is written for unrecognized outcomes.

**Contract**: Updated handler sequence:

1. `requireApiKey()`
2. `requireSupabaseClient()`
3. `const user = requireAuthenticatedUser(supabase)`
4. `const { photo, requestId } = await parseUploadRequest(request)`
5. `const photoHash = await hashPhoto(photo)` — SHA-256 hex digest; computed once here, used in steps 6 and 13
6. `const cached = await checkIdempotencyCache(supabase, user.id, requestId)` — if hit and `cached.photoHash !== photoHash`: throw 409; else return `jsonResponse({ result, photoId })` immediately
7. `const period = currentPeriod()`
8. `consumeSlot(supabase, period)`
9. `const base64 = await encodeForAI(photo)`
10. `const result = await identifyImage(base64, apiKey)` — in inner try/catch; on AI exception: `refundSlot(supabase, period)` + throw 502
11. If `!result.recognised` → return `jsonResponse({ result })` (no photoId; nothing persisted)
12. `const photoId = crypto.randomUUID()`
13. `const folderId = await lookupDefaultFolder(supabase, user.id)`
14. `await persistPhotoAndIdentification(supabase, user, { photoId, requestId, photo, folderId, photoHash }, result)` — on failure: `refundSlot(supabase, period)` + throw 500
15. Return `jsonResponse({ result, photoId })`

Response type: `{ result: IdentificationResult; photoId?: string }` — `photoId` is present only when the photo was saved (i.e., `recognised: true`). The client uses the presence of `photoId` to determine whether to show the "Saved" confirmation.

#### 9. Update the existing route integration test

**File**: `test/integration/identify-route.test.ts` (exists — created by F-03)

**Intent**: F-03's route test mocks Supabase with only `auth.getUser()` + `rpc()` and its `makeFormData()` sends no `request_id`. The S-01 handler changes (idempotency check, folder lookup, Storage upload, two inserts, and the mandatory `request_id`) will make the existing "returns 200 recognised: true" test go red — and the husky pre-commit (`vitest related --run`) will block the commit until it's fixed. Update it alongside the handler.

**Contract**: Extend the `vi.mock('@/lib/supabase')` factory so the mock client also implements the persistence calls S-01 adds — `from('photos')`/`from('folders')`/`from('identifications')` (select + insert) and `storage.from('photos').upload()` — returning success shapes (e.g. idempotency select returns no cached row; folder select returns `{ id }`; inserts return `{ error: null }`; upload returns `{ error: null }`). Add `request_id` (a valid UUID) to `makeFormData()`. The recognised-true test now asserts the response body is `{ result, photoId }` (a non-empty `photoId`); the recognised-false test asserts `{ result }` with **no** `photoId` and that no insert/upload mock was called. This stays a mocked-Supabase test (no `supabase start` needed) so it runs in pre-commit and CI.

#### 10. Wire the test suite into CI before deploy

**File**: `.github/workflows/ci.yml`

**Intent**: CI currently runs only `astro sync` + `lint` + `build`; the `deploy` and `preview` jobs (`needs: ci`) ship without running any tests. Add the suite as a gate so a red test blocks deployment.

**Contract**: Add a `- run: npm test` step to the `ci` job (after `npm run lint`, before or after `npm run build`). Because `deploy`/`preview` already declare `needs: ci`, gating the `ci` job is sufficient — no change to the deploy jobs. The current suite (6 unit + 2 mocked-Supabase integration tests) needs no live Supabase, so `npm test` runs green on the stock GitHub runner. **Caveat:** if S-01's Risk #3 test (Testing Strategy) is implemented against a _real_ local Supabase, CI will need a Supabase service/container before that test can run there — call that out when that test lands (see Open Question on Risk #3 storage assertion in `research.md`).

### Success Criteria:

#### Automated Verification:

- TypeScript compiles without error: `npx astro check`
- Lint passes: `npm run lint`
- Workers bundle dry-run succeeds within size budget: `npx wrangler deploy --dry-run`
- Full test suite passes (incl. the updated route test): `npm test`

#### Manual Verification:

- POST to `/api/identify` with a valid photo and a fresh `request_id` returns `{ result, photoId }` and creates a `photos` row + `identifications` row (check in Supabase Studio)
- A second POST with the same `request_id` returns the same `{ result, photoId }` without creating a duplicate `photos` row (idempotency confirmed)
- A POST without a session cookie returns 401 before any quota is consumed
- A POST with an invalid/unsupported MIME type returns 415
- Sending a request after the daily cap is exhausted returns 429 with `{ error, limit, used }` in the body
- A photo where Gemini returns `recognised: false` creates NO `photos` row and NO `identifications` row; the quota slot is consumed (no refund)
- `.github/workflows/ci.yml` `ci` job runs `npm test`, so a red test fails CI and blocks the `deploy`/`preview` jobs (`needs: ci`)

**Implementation Note**: After automated checks pass, verify all six manual scenarios above. The idempotency check in particular must be verified by inspecting the `photos` table — the response alone does not prove dedup. Pause for human confirmation before proceeding to Phase 3.

---

## Phase 3: Production UI

### Overview

Update the dashboard to mount `UploadFlow` as its main content and build the `UploadFlow` React component that drives the full user-facing flow from file selection through result display. No new Astro page and no middleware change are needed — identification lives directly on the dashboard.

### Changes Required:

#### 0. Bump client downscale resolution

**File**: `src/lib/client/downscale.ts`

**Intent**: The "store the blob we send" strategy (Implementation Approach) depends on the downscaled image being large enough for S-03 archive zoom. Raise the longest-edge target so stored photos carry enough resolution.

**Contract**: Change `MAX_EDGE` from `1024` to `2048` (currently `downscale.ts:10`). No signature change. This also affects `IdentifyHarness.tsx`, which imports `downscale` — acceptable, it is a dev tool. `CLIENT_BYTE_CAP` (5 MB) and `JPEG_QUALITY` (0.8) are unchanged; a 2048px JPEG at q0.8 stays well under both the client cap and `IDENTIFY_CONFIG.maxBytes`.

#### 1. Dashboard main content

**File**: `src/pages/dashboard.astro`

**Intent**: Replace the placeholder content with `UploadFlow` as the page's primary body, making the dashboard immediately useful — no CTA or navigation step needed. Identification IS the dashboard.

**Contract**: Import `UploadFlow` from `@/components/identify/UploadFlow`. Render `<UploadFlow client:only="react" />` as the main content inside the existing layout. The sign-out form remains. Do not add a quota display or archive grid — those are S-03. No middleware change is needed; `/dashboard` is already protected.

#### 2. `UploadFlow` React component

**File**: `src/components/identify/UploadFlow.tsx`

**Intent**: The production upload/identify/save UI. Handles five distinct UI states using a state-machine approach: `idle`, `working`, `identified`, `unrecognized`, and `error`. Generates a fresh `requestId` per identify action. Uses `downscale` from `@/lib/client/downscale` and posts to `/api/identify`.

**Contract**:

State transitions:

- `idle` → `working` on "Identify" click (generates `crypto.randomUUID()` as `requestId`)
- `working` → `identified` on successful response with `result.recognised = true`
- `working` → `unrecognized` on successful response with `result.recognised = false`
- `working` → `error` on 4xx/5xx or network failure
- `identified` → `idle` on "Identify another" CTA (clears file + result)
- `unrecognized` → `idle` on "Try another photo" CTA (clears file + result; new `requestId` on next action)
- `error` → `idle` on "Try again" CTA

State-specific UI:

- **`idle`**: file input (`accept={ACCEPT_IMAGE_TYPES}`) + disabled "Identify" button until a file is selected. **Reconciled (2026-06-14, impl-review F2):** the accepted MIME list is extracted into a dependency-free, client-safe module `src/lib/media-types.ts` (`ALLOWED_IMAGE_TYPES` + the comma-joined `ACCEPT_IMAGE_TYPES`). `IDENTIFY_CONFIG.allowedTypes` (the server gate in `upload.ts`) now sources its list from there too, so client picker and server gate share one source of truth. The constant was extracted rather than importing `IDENTIFY_CONFIG` directly because `config.ts` imports `astro:env/server` and cannot be pulled into a `client:only` island. `IdentifyHarness.tsx` was migrated to the same constant.
- **`working`**: spinner + "Identifying…" text; button disabled; no auto-retry. **Reconciled (2026-06-14, impl-review F1):** the working state shows the spinner only — no photo preview. The downscaled `previewUrl` is created at this point but is rendered for the first time in the `identified`/`unrecognized` panels, not during the wait. (Deliberate; the original plan's "preview during working" was dropped by choice.)
- **`identified`**: photo preview (same local object URL, same CSS constraint) + subject name (heading) + description (body text) + "Saved to your archive" confirmation badge + "Identify another" CTA. **Reconciled (2026-06-14, impl-review F3):** the subject-heading + description panel is extracted into `src/components/identify/IdentificationResult.tsx` (`<IdentificationResult title description />`) and reused by both the `identified` (title = `result.subjectName`) and `unrecognized` (title = "Couldn't identify this photo") branches — satisfying the Key Discovery's "extract by domain boundary" and the `IdentifyHarness.tsx` "extract this FIRST" guidance. S-02/S-03 render the same panel via this component.
- **`unrecognized`**: photo preview + "Couldn't identify this photo" heading + the AI's `result.description` as the body + "Try another photo" CTA — no save confirmation (nothing was persisted). **Reconciled (2026-06-14, impl-review F4):** the body shows the model's own `result.description` (rendered via the shared `<IdentificationResult />`) rather than the static guidance copy the original plan suggested — the AI explanation tends to say _why_ the subject couldn't be identified, which is more useful. Depends on the model returning sensible prose on the `recognised:false` path.
- **`error.quota`**: "Daily limit reached" message with the `limit` and `used` values from the 429 response body — "Come back tomorrow" copy
- **`error.general`**: generic error message from the response body

The photo preview uses `URL.createObjectURL(photo)` — the downscaled `File` already in memory after the user selects it. No Storage URL is fetched in S-01. Display size is controlled by CSS (e.g. `max-w-sm` or `max-w-md`); the stored 2048px file is served at larger sizes in S-03 via Supabase signed URL transforms.

The component generates a new `requestId = crypto.randomUUID()` at the moment the user clicks "Identify" (not on page load and not on file select), so picking a different file for the same session doesn't accidentally reuse a prior `requestId`.

FormData sent to `/api/identify`: `{ photo: downsizedBlob, request_id: requestId }`.

Expected response shapes:

- Recognised: `{ result: { recognised: true; subjectName: string; description: string }; photoId: string }` — show result + "Saved" confirmation
- Unrecognized: `{ result: { recognised: false; subjectName: string; description: string } }` — no `photoId`; show "couldn't identify" panel; nothing was persisted
- Quota: `{ error: string; limit: number; used: number }` with HTTP 429
- Other error: `{ error: string }` with HTTP 4xx/5xx

The component uses the presence of `photoId` in the response (not `result.recognised`) to determine whether to show the "Saved to your archive" confirmation — this keeps the display logic decoupled from the recognition flag.

### Success Criteria:

#### Automated Verification:

- TypeScript compiles without error: `npx astro check`
- Lint passes: `npm run lint`
- Workers bundle dry-run succeeds: `npx wrangler deploy --dry-run`
- Full test suite passes: `npm test`

#### Manual Verification:

- `/dashboard` while logged out redirects to `/auth/signin` (unchanged — already protected)
- `/dashboard` while logged in renders the upload form (file input + "Identify" button) as main content
- Uploading a photo of a recognisable landmark: spinner appears → result panel renders subject name + description + "Saved to your archive"
- Uploading a photo of a face or non-identifiable subject: spinner appears → unrecognized panel renders with "Try another photo" CTA
- Clicking "Identify another" resets the form to `idle`
- Clicking "Try another photo" resets the form to `idle`
- Exhausting the daily quota (or simulating a 429 response): quota-error panel renders with limit/used values
- No console errors in the browser DevTools for any of the above flows
- A saved photo's stored object in the `photos` bucket has a longest edge of 2048px (confirms `MAX_EDGE` was bumped)

**Implementation Note**: Test all manual scenarios end-to-end in a browser with the local dev server (`npm run dev`). The spinner + result-in-place experience is the core user-facing promise of S-01 — verify it feels responsive. Pause for human confirmation before reporting the slice complete.

---

## Testing Strategy

`testing-harness-bootstrap` (F-03) has **landed** (archived 2026-06-12) — the runner (Vitest + MSW), the route-test pattern, and the shared helpers all exist, so S-01 writes its tests as part of this change. F-03 deliberately scoped Risk #3/#5/#6 _out_ of itself and assigned them to S-01 (see `context/archive/2026-06-12-testing-harness-bootstrap/plan.md` "What We're NOT Doing"). Cover these test-plan (§2 Risk Map) scenarios, reusing the existing helpers rather than building new infrastructure:

- **Risk #1 / #4** — `recognised: false` surfaces the unrecognised state; a malformed AI response yields a graceful 502, not a fabricated success. _Largely covered already_ by `test/unit/identification.test.ts` (F-03); S-01's `isIdentificationResult` guard (Phase 2 §0) adds the "malformed/partial JSON → throw" case there, asserted via an MSW handler built with `makeCompletionResponse` (`test/helpers/openrouter.ts`).
- **Risk #5** — an unauthenticated request is rejected before any quota slot is consumed. Mocked-Supabase route test (`vi.mock('@/lib/supabase')` with `auth.getUser()` → no user; assert 401 and that `rpc('try_consume_image_usage')` was never called), using `makeAPIContext` (`test/helpers/route.ts`).
- **Risk #6** — disallowed MIME type and oversized payload are rejected server-side regardless of client claims. Mocked-Supabase route test driving `parseUploadRequest` (assert 415 / 413). No network or Supabase round-trip needed.
- **Risk #3** — the bytes uploaded to Storage match the downscaled blob that was sent to `/api/identify` (the single 2048px client-downscaled copy; by design the original is never uploaded). This needs to observe the actual upload payload: either a **recording storage mock** (extend the `vi.mock('@/lib/supabase')` factory so `storage.from('photos').upload` captures its `arrayBuffer` argument, then assert it equals the posted bytes — no live Supabase, runs in CI) **or** a **real local-Supabase** round-trip via `createTestClient` (`test/helpers/supabase-test.ts`, requires `supabase start` and a Supabase service in CI). Decide per the Open Question in `research.md`; the recording-mock path is preferred to keep CI free of a Supabase dependency.

All four risks live alongside the F-03 suite under `test/unit/**` and `test/integration/**` and run via `npm test` (the Phase 2/3 automated gate and the new CI gate). Note the **existing** F-03 route test must be updated in lockstep with the handler — see Phase 2 §9.

## Performance Considerations

Adding Storage upload (~I/O wait, zero CPU) + two DB writes (~2-4ms CPU) + one DB read (folder lookup, ~2ms CPU) keeps the Worker well within the 10ms free-tier CPU budget. Bundle size after Phase 2 uses only the existing `@supabase/supabase-js` SDK (already in bundle) — no new dependencies.

## Migration Notes

The `request_id` column is nullable, so the migration applies to existing rows without a default value. Any pre-existing `photos` rows (none in production at time of writing) will have `request_id = NULL`, which is valid — the partial unique index excludes NULL `request_id` rows via its `WHERE request_id IS NOT NULL` predicate.

**Addendum (2026-06-14, impl-review F1):** `photo_hash` was **not** present in the base schema (`20260603000001_create_folders_photos_identifications.sql`); Phase 1 added only `request_id`. The plan's Phase 2 §4/§7 referenced `photos.photo_hash` as if it existed — this was a plan gap. Phase 2 closed it with two new migrations: `20260614000001_add_photo_hash_to_photos.sql` (add nullable `TEXT`) and `20260614000002_photo_hash_not_null.sql` (backfill-by-deletion of hash-less rows, then `SET NOT NULL`). The second migration's `DELETE FROM identifications`/`DELETE FROM photos WHERE photo_hash IS NULL` is **destructive**: harmless against an empty `photos` table (a no-op), but silent data loss against a populated one. **Pre-deploy check:** confirm the production `photos` table has no rows before this migration ships (expected — F-02 persisted nothing). The delete only targets rows predating the `photo_hash` column, which in production should be none.

## References

- Research: `context/changes/first-identification-and-save/research.md`
- Roadmap slice: S-01 in `context/foundation/roadmap.md`
- Existing endpoint: `src/pages/api/identify.ts`
- Downscale utility: `src/lib/client/downscale.ts`
- Dev harness (source of patterns to extract): `src/components/identify/IdentifyHarness.tsx`
- Schema baseline: `supabase/migrations/20260603000001_create_folders_photos_identifications.sql`
- Test plan: `context/foundation/test-plan.md` (§3 Phase 1–2 for future test writing)

---

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Schema — `request_id` on `photos`

#### Automated

- [x] 1.1 Migration applies cleanly: `supabase db reset` — 1f9f4fd
- [x] 1.2 TypeScript compiles: `npx astro check` — 1f9f4fd
- [x] 1.3 Lint passes: `npm run lint` — 1f9f4fd

#### Manual

- [x] 1.4 `supabase db diff` shows no unexpected drift after reset — 1f9f4fd
- [x] 1.5 `photos` table in Supabase Studio shows `request_id` column as nullable UUID — 1f9f4fd

### Phase 2: Backend — persistence + idempotency

#### Automated

- [x] 2.1 TypeScript compiles: `npx astro check`
- [x] 2.2 Lint passes: `npm run lint`
- [x] 2.3 Workers bundle dry-run succeeds: `npx wrangler deploy --dry-run`
- [x] 2.10 Full test suite passes (incl. updated route test): `npm test`

#### Manual

- [x] 2.4 POST with valid photo + fresh `request_id` returns `{ result, photoId }` and creates DB rows
- [x] 2.5 Second POST with same `request_id` returns cached result, no duplicate `photos` row
- [x] 2.5b Same `request_id` + different photo returns 409 (hash mismatch)
- [x] 2.6 POST without session returns 401 before quota consumed
- [x] 2.7 POST with invalid MIME type returns 415
- [x] 2.8 POST after cap exhausted returns 429 with `{ error, limit, used }`
- [x] 2.9 Unrecognised photo: API returns `{ result }` with no `photoId`; no `photos` row or `identifications` row created; quota slot consumed (no refund)
- [x] 2.11 `ci.yml` `ci` job runs `npm test`, gating `deploy`/`preview` (`needs: ci`)

### Phase 3: Production UI

#### Automated

- [x] 3.1 TypeScript compiles: `npx astro check` — a2656f8
- [x] 3.2 Lint passes: `npm run lint` — a2656f8
- [x] 3.3 Workers bundle dry-run succeeds: `npx wrangler deploy --dry-run` — a2656f8
- [x] 3.13 Full test suite passes: `npm test` — a2656f8

#### Manual

- [x] 3.4 `/dashboard` unauthenticated redirects to `/auth/signin` (unchanged) — a2656f8
- [x] 3.5 `/dashboard` authenticated renders upload form (file input + "Identify" button) as main content — a2656f8
- [x] 3.6 Recognisable landmark: spinner → result panel with subject name, description, saved confirmation — a2656f8
- [x] 3.7 Unidentifiable photo: spinner → unrecognised panel with "Try another photo" CTA — a2656f8
- [x] 3.8 "Identify another" resets to idle — a2656f8
- [x] 3.9 "Try another photo" resets to idle — a2656f8
- [x] 3.10 Quota error: 429 panel shows limit and used values — a2656f8
- [x] 3.11 No browser console errors across all flows — a2656f8
- [x] 3.12 `MAX_EDGE` in `src/lib/client/downscale.ts` is `2048`; a saved photo's stored object has a longest edge of 2048px (verify dimensions of the file in the `photos` bucket) — a2656f8
