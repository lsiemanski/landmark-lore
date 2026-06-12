---
date: 2026-06-12T11:00:00+02:00
researcher: lsiemanski
git_commit: 17c3bf52f244324e404e24ba776559b9da1738bf
branch: master
repository: Landmark-Lore
topic: "S-01: Upload, identify, and save a photo — deep architectural dive"
tags: [research, codebase, s-01, upload, identify, persistence, idempotency, supabase-storage, cloudflare-workers]
status: complete
last_updated: 2026-06-12
last_updated_by: lsiemanski
---

# Research: S-01 — Upload, identify, and save a photo

**Date**: 2026-06-12T11:00:00+02:00
**Researcher**: lsiemanski
**Git Commit**: 17c3bf52f244324e404e24ba776559b9da1738bf
**Branch**: master
**Repository**: Landmark-Lore

---

> **Provenance.** This document supersedes and incorporates the pre-research seed material (carryover from F-02) that previously occupied this file. The seed content is preserved verbatim in the §Seed Research Carryover section at the end. All new findings are from a live codebase audit on 2026-06-12.

---

## Research Question

Deep architectural dive into S-01 (first-identification-and-save): what did F-01 and F-02 actually produce, what is the exact current codebase state, what does S-01 need to build end-to-end, and what architectural decisions must be made before planning?

---

## Summary

F-01 and F-02 landed cleanly. The schema, storage bucket, typed client, AI endpoint, rate-limiting RPCs, and client-side downscale harness are all in production. The identify endpoint (`src/pages/api/identify.ts`) validates, rate-limits, calls Gemini 2.5 Flash, and returns a structured result — but **it does not persist anything**. The Supabase Storage bucket and the `photos`/`identifications` tables are fully provisioned and waiting.

S-01's delta is: **(1) persist the upload + identification, (2) add idempotency, (3) build a production upload→identify→save UI, and (4) wire the quota state into real UX.** The architecture questions centre on whether to extend the existing endpoint or create a new one, and how to implement the `request_id` dedup without a separate migration if it can be anchored to the `photos` row.

Five decisions must be made before planning starts: endpoint shape, idempotency anchor, progress feedback mechanism, photo status transition model, and whether the dashboard in S-01 shows a saved archive or just a CTA.

---

## Detailed Findings

### 1. Current state of `/api/identify` — what F-02 left

**File**: [src/pages/api/identify.ts](src/pages/api/identify.ts)

The endpoint is a clean, decomposed POST handler with seven private helpers:

```
requireApiKey()                  → validates OPENROUTER_API_KEY
requireSupabaseClient(context)   → creates typed client or throws 503
requireAuthenticatedUser(supabase) → getUser() or throws 401; RETURNS user (caller currently discards)
readImageAsBase64(request)       → validates MIME + size, returns base64 string
currentPeriod()                  → "YYYY-MM-DD" string
consumeSlot(supabase, period)    → RPC: try_consume_image_usage
refundSlot(supabase, period)     → RPC: refund_image_usage (best-effort)
identifyImage(base64, apiKey)    → OpenRouter call with fallback
```

**Critical S-01 gap:** `requireAuthenticatedUser` returns `user` but the handler discards it:
```typescript
await requireAuthenticatedUser(supabase);  // user.id is needed for storage path + photo row
```
S-01 must capture the return value: `const user = await requireAuthenticatedUser(supabase)`.

**What the endpoint does NOT do:**
- Does not upload to Supabase Storage
- Does not create a `photos` row
- Does not create an `identifications` row
- Does not return a `photo_id`
- Does not surface remaining quota in the response

The `IdentifyHarness.tsx` that drives this endpoint is explicitly marked as dev-only. Its internal comments call out what to extract for production:
- `<IdentificationResult />` — result display component
- `<DownsizedPreview />` — preview panel component
- Reuse `<ServerError />` (already in `src/components/auth/`)

**File**: [src/lib/ai/config.ts](src/lib/ai/config.ts)  
The `IDENTIFY_CONFIG` object is the single source of truth for model, limit, byte cap, allowed types, and the OpenRouter base URL. S-01 inherits it unchanged; do not duplicate any of these constants in new code.

**File**: [src/lib/ai/identify-prompts.yaml](src/lib/ai/identify-prompts.yaml)  
System prompt + JSON shape hint live here. The prompt explicitly rejects people as subjects (`recognised=false`). No changes needed for S-01.

---

### 2. Schema: what exists, exactly

**Migration 1**: [supabase/migrations/20260603000001_create_folders_photos_identifications.sql](supabase/migrations/20260603000001_create_folders_photos_identifications.sql)

**`folders`**: id (UUID PK), user_id (→ auth.users CASCADE), name, created_at, updated_at. RLS: owner-all. Trigger: new auth user → "Uncategorized" folder auto-created.

**`photos`**: id (UUID PK), user_id (→ auth.users CASCADE), folder_id (→ folders RESTRICT), storage_path (`"{user_id}/{photo_id}.{ext}"`), original_filename, file_size (nullable), mime_type, status (`photo_status` enum: `pending|identified|unrecognized|error`), created_at, updated_at. RLS: owner-all.

**`identifications`**: id (UUID PK), photo_id (UUID, UNIQUE → photos CASCADE — one-to-one), subject_name, description, created_at. RLS: owner-all via photos join.

**Migration 2**: [supabase/migrations/20260603000002_create_photos_storage_bucket.sql](supabase/migrations/20260603000002_create_photos_storage_bucket.sql)

Private `photos` bucket, 50 MiB per file, allowed: JPEG/PNG/WebP/HEIC/HEIF. RLS on `storage.objects`: INSERT/SELECT/DELETE scoped to `(storage.foldername(name))[1] = auth.uid()::text`.

**Migration 3**: [supabase/migrations/20260611000001_create_image_usage.sql](supabase/migrations/20260611000001_create_image_usage.sql)

`image_usage (user_id, period, count)` with two `SECURITY DEFINER` RPCs:
- `try_consume_image_usage(p_period, p_limit) → (allowed boolean, used integer)` — atomic check-and-consume, SELECT FOR UPDATE serialises concurrent callers
- `refund_image_usage(p_period) → integer` — decrement floored at 0

**TypeScript types**: [src/types/supabase.ts](src/types/supabase.ts)

All four tables are typed. Key Insert shapes for S-01:
```typescript
// photos Insert — required: folder_id, mime_type, original_filename, storage_path, user_id
// identifications Insert — required: description, photo_id, subject_name
```
The `photo_status` enum is `"pending" | "identified" | "unrecognized" | "error"`.

**Important constraint on `identifications`:** `photo_id` is UNIQUE — one identification per photo. This is the right model; a retry that creates a second identification row for the same photo would violate this constraint. This is part of the natural dedup story (see §Idempotency below).

---

### 3. Client-side downscale — what F-02 built

The `IdentifyHarness.tsx` contains the client-side downscale logic that S-01's production UI will reuse:

**Location**: [src/components/identify/IdentifyHarness.tsx](src/components/identify/IdentifyHarness.tsx)

Flow: file input → `downscale(file)` → POST FormData `photo` field → parse `{ result?, error? }` response.

`downscale()` is referenced but its actual module location needs verifying (likely `src/lib/client/downscale.ts` or inline in the harness). It must:
- `createImageBitmap(blob, { imageOrientation: "from-image" })` (EXIF orientation)
- Scale so `max(width, height) ≤ 1024` preserving aspect ratio, no upscaling
- `canvas.toBlob("image/jpeg", 0.8)` → `FormData` under `"photo"` field

In-flight guard is in place: `busy` state disables the "Identify" button while a request is outstanding; no auto-retry on error.

---

### 4. Dashboard and page structure — what exists

**[src/pages/dashboard.astro](src/pages/dashboard.astro)**: Minimal — shows user email and a sign-out button. No upload CTA, no archive grid, no quota display.

**[src/pages/identify-test.astro](src/pages/identify-test.astro)**: Dev harness page. Renders `<IdentifyHarness client:only="react" />`. This page exists and is accessible to logged-in users.

**[src/middleware.ts](src/middleware.ts)**: Protects `/dashboard`. S-01 will need to add any new production upload page to this protected list.

---

### 5. Infrastructure constraints that affect S-01

**Workers CPU time**: 10ms free / paid metered. Current identify endpoint chain: session check (~2ms DB) + consume slot (~2ms DB) + base64 encode + OpenRouter call (I/O wait — zero CPU). Adding two DB writes (INSERT photos + INSERT identifications) + one Storage upload (I/O wait) adds ~2-4ms CPU. Total stays well under 10ms. No profiling blocker for S-01.

**Bundle size**: Currently 447.64 KiB gzip after F-02 (`wrangler deploy --dry-run` result). Adding Storage API calls uses the existing `@supabase/supabase-js` SDK (already bundled). No new dependencies required for persistence. Bundle risk remains low.

**Storage upload from Worker**: The Supabase client's `storage.from('photos').upload(path, file)` can accept an `ArrayBuffer` directly — no server-side image processing needed. The Worker already has the raw bytes from `request.formData()`.

**`photo_id` for storage path**: The `photos` row doesn't exist yet when the upload happens. Two valid approaches:
- **Pre-generate ID client-side** (UUID): client sends `photo_id` with the request, Worker uses it for both the storage path and the INSERT PK.
- **Server-generates ID**: Worker calls `crypto.randomUUID()` before uploading, uses it as the storage path and the `photos.id`.

Server-generates is simpler and avoids trusting client-supplied UUIDs.

---

## Architecture Options for the Upload→Identify→Save Flow

### Option A: Extend existing `/api/identify` (single endpoint)

Extend `identify.ts` to add persistence after the AI call:
1. `requireApiKey()` → `requireSupabaseClient()` → `requireAuthenticatedUser()` (capture user)
2. `readImageAsBase64()` (already exists) — also hold the `ArrayBuffer` for storage upload
3. `consumeSlot()` (already exists)
4. Generate `photo_id = crypto.randomUUID()`
5. Upload to Storage: `photos/{user_id}/{photo_id}.{ext}` (new)
6. `createPhotoRow(supabase, user, photoId, ...)` → INSERT photos (status='pending') (new)
7. `identifyImage()` (already exists)
8. `persistResult(supabase, photoId, result)` → INSERT identifications + UPDATE photos.status (new)
9. Refund on failure (already exists, extend to also update photos.status='error')
10. Return `{ result, photoId }` (extend response)

**Pros**: No new route, minimal surface area, reuses existing helpers cleanly.  
**Cons**: Route accumulates more responsibility; rollback is harder if storage upload succeeds but DB insert fails.

### Option B: New `/api/photos` route

Separate route that owns the full lifecycle. `identify.ts` becomes internal (or is retired from direct client use).

**Pros**: Clean separation; `identify.ts` stays as pure AI endpoint for potential reuse.  
**Cons**: More files; the rate-limit and AI code must be re-called or imported.

### Option C: Two-step (upload first, identify second)

`POST /api/photos` → returns `photo_id`. `POST /api/photos/:id/identify` → calls AI + updates row.

**Pros**: Allows progress polling (client can poll the second step).  
**Cons**: Two round-trips; more complexity in client state management.

**Recommendation for S-01**: Option A (extend existing). The existing helpers are clean enough to absorb persistence. The `lessons.md` "Split long functions" rule is already satisfied by the helper architecture — adding `uploadPhoto`, `createPhotoRow`, and `persistResult` helpers keeps the handler readable. Option B adds file surface area without a clear benefit at this scale; Option C adds client complexity.

---

## Design Decisions Required Before Planning

### Decision 1: Idempotency anchor

The seed research established that `request_id` is needed to prevent double-spend on retries. The `identifications.photo_id` UNIQUE constraint provides partial dedup (you can't INSERT two identifications for the same photo), but it doesn't prevent two *separate* photo rows from being created for the same logical request.

**Options:**

**1a. `request_id` on `photos` table** (new migration)
- Client generates UUID per identify action, sends as form field
- Worker checks: does `photos` row with this `request_id` already exist for this user? → return its cached identification. Otherwise proceed.
- Requires new column + unique constraint + new migration.

**1b. No explicit `request_id` — use in-flight guard only**
- The harness already has the in-flight guard (disabled button, no auto-retry). S-01's production UI inherits it.
- A second request from a different tab or after a page reload would still create a duplicate photo row.
- Simple; no migration. Acceptable for S-01 MVP given the harness pattern.

**1c. `request_id` on `photos` table, client-side UUID per-session**
- Middle ground: client persists the UUID in sessionStorage; on page reload, re-check before sending.

**Owner**: User. S-01 can ship safely with 1b if the production UI has the in-flight guard. Option 1a is the rigorous fix but requires a migration. The seed research recommends 1a; the plan should decide before implementing.

---

### Decision 2: Photo status transition model

`photos.status` has four values: `pending | identified | unrecognized | error`.

Two models:
- **Write-pending-first**: INSERT with `status='pending'` before the AI call → UPDATE to `identified/unrecognized/error` after. This means a crashed request leaves a `pending` orphan in the DB.
- **Write-on-completion**: INSERT with final status in one step after the AI call completes. Cleaner but storage upload happens before the row exists (orphaned object on crash).

Either way, a crash after storage upload but before DB insert leaves an orphan in Storage. The orphan cleanup is a future problem (S-03 or GDPR delete); for S-01 the volume is low enough to ignore.

**Recommendation**: Write-pending-first. Gives a consistent row for any future progress-polling approach. The `status='pending'` row is observable (useful for future S-02/S-03 work).

---

### Decision 3: Progress feedback mechanism

**From roadmap Unknowns**: Streaming vs. polling. Owner: User. Not a blocker.

**Options:**
- **Streaming (SSE/chunked)**: Worker streams AI response tokens as they arrive. Requires a separate SSE endpoint or `TransformStream`. Complex client-side handling.
- **Simple spinner**: Synchronous fetch with a loading state in the UI. Satisfies the NFR ("continuous visible progress feedback; result appears without reload") — a spinner + result render in-place counts.
- **Polling**: Client posts job, gets `job_id`, polls `/api/photos/:id/status`. Requires Option C architecture above.

**Recommendation**: Simple spinner for S-01. The NFR is "continuous visible feedback + no page reload" — a spinner satisfies this. Streaming is a S-02 enhancement if desired. Polling requires the two-step architecture (higher complexity). **Confirm with user before planning.**

---

### Decision 4: What `identify.ts` returns after S-01

Currently returns `{ result: { recognised, subjectName, description } }`.

After S-01 persistence, it should return `{ result, photoId }` (or `{ result, photo }` with the full row). The `photoId` is needed for the client to link to the saved archive entry, and for future S-03 navigation.

No ambiguity here — `{ result, photoId }` is the right extension. Just noting it for the plan.

---

### Decision 5: What the dashboard shows in S-01

The dashboard is currently a stub. S-01 must add *something* to make the "save" meaningful.

**Options:**
- **Minimal**: Just a "Upload a photo" CTA. Archive is S-03.
- **Inline result page**: After upload→identify→save, show the identified photo + name + description in-place (single-photo view). User doesn't see an "archive" yet — that's S-03.
- **Minimal archive**: Show a grid of thumbnails with subject names on the dashboard. Needs S-03 scope but allows the "save" to feel real.

**Recommendation for S-01**: Inline result page approach. The flow ends on a "here's what you found" page with the identification result and a saved confirmation. The dashboard gets a CTA to start a new identification. Archive grid stays for S-03. **Confirm with user before planning.**

---

## Code References

- [src/pages/api/identify.ts](src/pages/api/identify.ts) — POST endpoint (extend for persistence)
- [src/lib/ai/config.ts](src/lib/ai/config.ts) — `IDENTIFY_CONFIG` (do not duplicate constants)
- [src/lib/ai/models.ts](src/lib/ai/models.ts) — `MODELS.paid/free`
- [src/lib/ai/identify-prompts.yaml](src/lib/ai/identify-prompts.yaml) — system prompt + fallback hint
- [src/lib/supabase.ts](src/lib/supabase.ts) — `createClient()` helper
- [src/types/supabase.ts](src/types/supabase.ts) — generated DB types (regenerate after new migration)
- [src/components/identify/IdentifyHarness.tsx](src/components/identify/IdentifyHarness.tsx) — dev harness; extract components from here
- [src/pages/identify-test.astro](src/pages/identify-test.astro) — dev harness page (keep as-is)
- [src/pages/dashboard.astro](src/pages/dashboard.astro) — stub; needs CTA in S-01
- [src/middleware.ts](src/middleware.ts) — add new production upload/result page to protected list
- [supabase/migrations/20260603000001_create_folders_photos_identifications.sql](supabase/migrations/20260603000001_create_folders_photos_identifications.sql) — schema baseline
- [supabase/migrations/20260603000002_create_photos_storage_bucket.sql](supabase/migrations/20260603000002_create_photos_storage_bucket.sql) — storage bucket + RLS
- [supabase/migrations/20260611000001_create_image_usage.sql](supabase/migrations/20260611000001_create_image_usage.sql) — usage RPCs

---

## Architecture Insights

### Patterns to preserve from F-02

- **One constant location**: All config in `src/lib/ai/config.ts`. Any new S-01 constants (e.g. `defaultFolderName`) go in their own config/constants file, not in route logic (lessons.md: "Constants belong in config/resource files").
- **Helper decomposition**: The `identify.ts` handler pattern (each concern = one named function) must be maintained when extending. New helpers: `uploadToStorage(supabase, user, arrayBuffer, mimeType)`, `createPhotoRow(supabase, userId, photoId, ...)`, `persistIdentification(supabase, photoId, result)`.
- **OUT params for RPCs**: Any new Supabase RPC must use OUT params (not RETURNS TABLE) — lessons.md lesson is firm.
- **Security definer for rate-limit writes**: If a new `request_id` dedup table is introduced, its write function must be SECURITY DEFINER (client cannot write directly).

### New patterns needed for S-01

- **ArrayBuffer retention**: `readImageAsBase64` currently returns only the base64 string. S-01 also needs the raw bytes for Storage upload. Either return both from the helper, or call `file.arrayBuffer()` once and derive base64 + keep the buffer.
- **Folder lookup**: Every `photos` INSERT requires a `folder_id`. The user's "Uncategorized" folder must be looked up (by `user_id` and `name='Uncategorized'`) before the INSERT. This is a new DB read in the request path (~2ms).
- **Signed URLs for the result**: After upload, the client needs a URL to display the photo. Use `supabase.storage.from('photos').createSignedUrl(path, 3600)` in the Worker response, or let the client derive the path from `photo_id` and call the Storage API directly. The latter is simpler.

### Workers constraint: atomicity

There is no true transaction across Storage upload + DB insert. The failure modes are:
1. Storage upload fails → no orphan, return error.
2. Storage succeeds, `photos` INSERT fails → orphan in Storage (very low probability; acceptable for MVP).
3. `photos` INSERT succeeds, `identifications` INSERT fails → photo row exists with status='error'; no identification row. Idempotent re-run of the AI call on the existing photo is a future enhancement.

For S-01, this is acceptable. Document in the plan as a known limitation.

---

## Historical Context (from prior changes)

- [context/archive/2026-06-03-data-schema/plan.md](context/archive/2026-06-03-data-schema/plan.md) — full schema design; the `ON DELETE RESTRICT` on `photos.folder_id` means we cannot delete a folder with photos (intentional — relevant for S-03, not S-01).
- [context/archive/2026-06-05-ai-provider-spike/plan.md](context/archive/2026-06-05-ai-provider-spike/plan.md) — full F-02 implementation plan; §Parked lists what S-01 owns (idempotency, app UX integration, quota surface).
- [context/archive/2026-06-05-ai-provider-spike/reviews/impl-review-phase-1.md](context/archive/2026-06-05-ai-provider-spike/reviews/impl-review-phase-1.md) — F2 (`.gitignore`), F3 (lint debt), F4 (unchecked refund result) are known but resolved/backlogged.

---

## Open Questions (must resolve before `/10x-plan`)

| # | Question | Owner | Default if not answered |
|---|----------|-------|------------------------|
| 1 | **Idempotency**: Add `request_id` column + migration (Option 1a) or ship with in-flight-guard-only (Option 1b)? | User | 1b (harness guard only) |
| 2 | **Progress feedback**: Simple spinner or streaming? | User | Simple spinner |
| 3 | **Post-save destination**: Inline result page (then "Upload another") or route back to a dashboard archive view? | User | Inline result page |
| 4 | **Dashboard scope in S-01**: Just a CTA or add a minimal recent-identifications list? | User | CTA only (archive is S-03) |

---

## Appendix: Seed Research Carryover

> The following is the carryover material from the F-02 discussion (2026-06-11), preserved verbatim. Its analyses remain valid; see §Open Questions above for how each open question maps to the current decisions.

### Where F-02 left the rate-limit story (don't redo this in S-01)

F-02 built the `/api/identify` endpoint with a per-user daily cap (100) backed by `image_usage`. The enforcement is **already hardened** in the spike — S-01 inherits it, it does not rebuild it:

- **Atomic enforcement (no overshoot).** `try_consume_image_usage(p_period, p_limit)` does an `INSERT … ON CONFLICT DO NOTHING` then `SELECT … FOR UPDATE`, so concurrent requests serialise on the user's row and the cap can never be exceeded. Returns a single record `(allowed, used)` (OUT params — see lessons.md "Use OUT params for single-row RPCs").
- **No reset bypass.** `image_usage` has a SELECT-only RLS policy; the anon-key client cannot write it. All writes go through two `security definer` functions.
- **Success-only counting.** `refund_image_usage(p_period)` decrements (floored at 0) when the AI call fails. Net: **consume-on-attempt, refund-on-failure** — only successful identifications ultimately count.

### What S-01 owns (from F-02 discussion)

**1. Idempotency — the headline S-01 item**

The endpoint is **not idempotent**. A retried/duplicated request consumes a fresh slot and makes a fresh paid AI call. This matters more once S-01 **persists** identifications (FR-006): a retry would create a **duplicate, possibly conflicting** identification row.

Design: client generates `request_id` (UUID) per logical identify action → store as unique key on the usage/identification write → on retry with same `request_id`, return prior stored result.

Open questions: idempotency window/TTL; whether key lives on the identification row, a dedicated table, or both; composition with `(user_id, period)` usage row. (See §Open Questions Decision 1 above.)

**2. Why refund does NOT substitute for idempotency**

Refund = failure-path counter accuracy, not duplicate suppression. Three different jobs:
- **In-flight guard (F-02 Phase 2 client):** prevents double-send at the source.
- **Idempotency / `request_id` (S-01):** neutralises retries that slip through, incl. success-success.
- **Refund (built in F-02):** keeps failure accounting honest so consume-on-attempt stays success-only.

**3. Cap semantics to correct**

Until idempotency lands, the 100/day cap bounds **attempts**, not guaranteed-distinct successful identifications. S-01's `request_id` dedup is what converts it back to "100 successes". Reflect this in "X of 100 used" UI copy.

**4. Refund robustness (lower priority)**

Refund is currently best-effort (`{ error }` not inspected). A failed refund leaks one slot. S-01 can decide: accept the leak, or add a small retry. Tie to the idempotency ledger if one is introduced.

**5. Wire the cap into real app usage/UX**

F-02's endpoint is a developer harness. S-01 integrates the cap into the real upload→identify→save flow: surface remaining quota, render the `429` state for users, and connect to the persisted archive (FR-006).

### Runtime config tunability (model / limit) — env now, KV later

F-02 made `model` and `dailyImageLimit` runtime-tunable without a rebuild via `astro:env/server` (`IDENTIFY_MODEL`, `IDENTIFY_DAILY_LIMIT`). S-01 inherits this as-is.

The KV upgrade path (for truly live zero-deploy tuning) is parked unless env-var ergonomics pinch.
