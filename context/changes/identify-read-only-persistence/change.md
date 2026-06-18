---
change_id: identify-read-only-persistence
title: Identify is read-only — persist only on explicit Save
status: complete
created: 2026-06-18
updated: 2026-06-18
---

## Problem

`POST /api/identify` both ran the AI _and_ persisted a photo + identification
row (guarded by an idempotency cache keyed on `request_id`). Every identification
the user merely previewed left a storage object and DB row behind, and "discard"
had to issue a `DELETE` to clean up. The idempotency cache (`checkIdempotencyCache`,
`CachedIdentification`) existed only to make that eager write replay-safe.

## Change

Split the AI call from persistence:

- **`POST /api/identify` is now read-only.** It runs the model and returns the
  result; it persists nothing. An un-saved identification leaves no storage
  object or DB row. The idempotency cache and its helpers are removed.
- **`POST /api/archive/photos` (new) commits the photo.** The client re-sends the
  image + thumbnail plus a JSON `payload` (subjectName, description, folderId,
  requestId). The `(user_id, request_id)` unique index still dedupes a repeat
  save. Folder is resolved here (explicit folder or the default).
- **Upload parsing split** — `validatePhotoFields(form)` (shared) +
  `parseUploadRequest` (identify: photo only) + `isValidRequestId`. `request_id`
  is now validated on the save path, not at identify time.
- **Client (`UploadFlow`)** keeps the image/thumbnail/requestId in React state
  after identify; Save POSTs them to the new route; Discard is purely
  client-side (nothing to delete).

## Files

- `src/pages/api/identify.ts` — read-only; 429 mapping shared with the rate-limit fix.
- `src/pages/api/archive/photos.ts` — new `POST` save handler + `resolveFolder`.
- `src/lib/identify/save-request.ts` — new; parses the save payload.
- `src/lib/identify/upload.ts` — `validatePhotoFields` / `parseUploadRequest` / `isValidRequestId`.
- `src/lib/identify/persistence.ts` — removed `checkIdempotencyCache` / `CachedIdentification`.
- `src/components/identify/{UploadFlow,PostIdentifyPanel}.tsx` — save-on-explicit-save flow.
- `test/integration/save-photo-route.test.ts` (new) + identify/upload-flow test updates.

## Known gap

A duplicate-`request_id` save hits the unique index and currently surfaces as a
generic `500` rather than an idempotent replay (the old cache returned the prior
result). See the impl-review finding F2 — candidate follow-up: detect the 23505
conflict and return the existing `photoId`.
