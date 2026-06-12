# First Identification and Save (S-01) — Plan Brief

> Full plan: `context/changes/first-identification-and-save/plan.md`
> Research: `context/changes/first-identification-and-save/research.md`

## What & Why

Build the end-to-end upload → identify → save flow that is the product's core hypothesis. A logged-in user picks a photo, receives an AI-generated identification (subject name + description), and the photo is saved to their private archive in one session — no page reload, no separate save step. This is S-01, the north-star slice: everything else (follow-up questions, archive management) only matters if this works.

## Starting Point

F-01 and F-02 landed cleanly. The `photos` / `identifications` tables, Storage bucket, RLS policies, rate-limit RPCs, and the `identify.ts` endpoint (auth + quota + OpenRouter AI call) are all in production. The endpoint returns an identification result but **persists nothing**. The dashboard is a stub (user email + sign-out only). There is no production upload UI.

## Desired End State

A logged-in user visits `/dashboard`, is immediately presented with the upload form (file input + "Identify" button), picks a photo, and sees a spinner with "Identifying…" text, then sees the subject name and description in-place with a "Saved to your archive" confirmation. If the subject is unrecognised, a "Try another photo" CTA is shown — nothing is persisted. The 100-per-day quota appears only when the user hits the cap. No separate `/upload` route — identification is the dashboard.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
|---|---|---|---|
| Endpoint shape | Extend existing `identify.ts` (Option A) | Existing helpers absorb new concerns cleanly; no new route surface area needed at this scale | Research |
| Idempotency | `request_id UUID UNIQUE` on `photos` table (Option 1a) | Converts the 100/day cap from "attempts" to "distinct successes"; prevents duplicate rows on retry | Plan |
| Photo status model | Write-on-completion (no pending state) | AI call happens first; Storage + DB writes only on `recognised: true` — no rollback or cleanup needed for unrecognized results | Plan |
| Progress feedback | Spinner + "Identifying…" status text | Satisfies the NFR (continuous visible feedback, result in-place) without SSE/streaming complexity | Plan |
| Post-save destination | Inline result on `/upload` | No navigation needed; archive (S-03) can be added later without changing this flow | Plan |
| Unrecognised UX | Do not save; quota slot consumed; "Try another photo" CTA | Archive only holds meaningful identified photos; no rollback/cleanup needed with write-on-completion | Plan |
| Quota display | 429 error state only | Quota info is contextual; daily limit is high enough that proactive display adds friction without benefit | Plan |
| Dashboard scope | CTA only (no archive grid) | Archive grid is S-03 scope; CTA alone is sufficient to make the save feel real | Plan |
| Upload page | Embedded in `/dashboard` | Identification IS the app — surfacing it directly after login eliminates a navigation step; URL was never meaningful with inline-result display anyway | Plan |
| Tests | Excluded — blocked on `testing-harness-bootstrap` | No test runner is set up yet; S-01 is blocked on that change completing first | Plan |

## Scope

**In scope:**
- `request_id` migration + type regeneration (Phase 1)
- Extend `identify.ts` with Storage upload, DB inserts, idempotency check, unrecognised handling, `{ result, photoId }` response (Phase 2)
- `UploadFlow.tsx` React component + embed in `dashboard.astro` as main content (Phase 3)

**Out of scope:**
- Streaming / SSE progress
- Quota display outside the 429 state
- Dashboard archive grid / thumbnail list (S-03)
- `/photos/:id` detail page
- Storage orphan cleanup
- Integration test setup (`testing-harness-bootstrap`)

## Architecture / Approach

The existing `identify.ts` handler is extended with new private helpers following the decomposition pattern already established (lessons.md): `parseUploadRequest` (reads FormData, returns `{ photo: File, requestId }`), `encodeForAI` (base64 encodes the photo for the AI call), `checkIdempotencyCache`, `lookupDefaultFolder`, `persistPhotoAndIdentification` (Storage upload + `photos` INSERT + `identifications` INSERT — only called when `recognised: true`). Write-on-completion: nothing is persisted for unrecognized results, so no rollback is needed. The client downscales to `MAX_EDGE=2048px` before sending — the same blob goes to the AI and Storage. The `UploadFlow` React component owns the five-state machine (idle → working → identified / unrecognized / error), shows a photo preview via `URL.createObjectURL(photo)` (local — no Storage fetch in S-01), and uses `photoId` presence in the response (not the `recognised` flag) to determine whether to show "Saved".

## Phases at a Glance

| Phase | What it delivers | Key risk |
|---|---|---|
| 1. Schema migration | `request_id` column on `photos`; types regenerated | Migration must apply cleanly to a live Supabase stack |
| 2. Backend | Full persist + idempotency in `identify.ts`; response extended to `{ result, photoId }` | Atomicity gap between Storage upload and DB insert (accepted MVP risk) |
| 3. Production UI | `UploadFlow` component + embed in dashboard as main content | Getting all five UI states (idle/working/identified/unrecognized/error) polished in one phase |

**Prerequisites:** `testing-harness-bootstrap` must complete before any integration tests are written (S-01 itself proceeds without tests; the test slice is a hard dependency for future coverage).  
**Estimated effort:** ~2 sessions across 3 phases

## Open Risks & Assumptions

- Storage upload and DB insert are not atomic — a crash between them leaves an orphan object in the `photos` bucket. This is accepted at MVP volume; cleanup is a future GDPR/S-03 concern.
- The "Uncategorized" folder is assumed to exist for every user (created by the F-01 trigger). The `lookupDefaultFolder` helper throws 500 if it's missing, which should never happen in practice.
- `testing-harness-bootstrap` must land before integration tests can be written; if it slips, S-01's test coverage gap widens.

## Success Criteria (Summary)

- A logged-in user can upload a recognisable photo and see the subject name and description in-place, with a DB row in `photos` (status `identified`) and a row in `identifications`
- Retrying the same photo (same `request_id`) returns the cached result without creating a duplicate row or consuming an extra quota slot
- An unrecognised photo shows "Couldn't identify this photo" with a "Try another" CTA — no DB row is created, quota slot is consumed (no refund)
