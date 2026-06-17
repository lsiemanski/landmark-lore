# Photo Detail View — Plan Brief

> Full plan: `context/changes/photo-detail-view/plan.md`

## What & Why

The archive grid shows each photo's subject name but not its description — the description is persisted in the `identifications` table but never fetched or rendered. FR-011 closes this gap: a traveler should be able to open a saved photo and read the full identification without leaving the archive.

## Starting Point

`listPhotos` selects only `identifications(subject_name)`; `PhotoCardData` has no `description` field; `PhotoCard` renders a static image with no click behaviour. The `IdentificationResult` component was already extracted in S-01 with an explicit note that it was built for archive reuse.

## Desired End State

Clicking a photo card image opens a modal overlay showing the full photo, subject name, and description. Escape, backdrop click, or the close button dismiss it. Nothing navigates away from the archive. Description is read-only.

## Key Decisions Made

| Decision             | Choice                                  | Why (1 sentence)                                 | Source |
| -------------------- | --------------------------------------- | ------------------------------------------------ | ------ |
| Trigger              | Click card image                        | Largest target, matches gallery conventions      | Plan   |
| Modal scope          | Photo + subject name + description only | Exactly what FR-011 asks; zero new API calls     | Plan   |
| Description editable | No — read-only                          | Clean scope; post-save editing is a future slice | Plan   |
| Image URL            | Reuse signed URL from card              | 1-hour TTL is sufficient; avoids extra fetch     | Plan   |

## Scope

**In scope:** `description` added to `PhotoCardData` + `listPhotos` query; new `PhotoDetailModal` component; `onSelect` prop threaded through `PhotoGrid` and `PhotoCard`; modal state owned by `ArchiveView`.

**Out of scope:** Follow-up chat from archive; in-modal description editing; move/delete actions inside modal; fresh signed-URL fetch on open.

## Architecture / Approach

Pure UI addition on top of existing data: extend the Supabase query by one field, create `PhotoDetailModal` (mirrors `ConfirmDialog` pattern, reuses `IdentificationResult`), thread an `onSelect` callback from `ArchiveView` → `PhotoGrid` → `PhotoCard`. No new API endpoint.

## Phases at a Glance

| Phase                                 | What it delivers                                                      | Key risk                                                                                                          |
| ------------------------------------- | --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| 1. Data layer + detail modal + wiring | Description in query, modal component, click-to-open wired end-to-end | `ArchiveView.tsx` is at the 250-line limit — modal state must be extracted into `PhotoDetailModal` to avoid bloat |

**Prerequisites:** S-03 (`archive-and-folders`) done — gallery page and `PhotoCard` exist. ✓  
**Estimated effort:** ~1 session

## Open Risks & Assumptions

- `ArchiveView.tsx` is exactly 250 lines (lessons.md limit); adding `selectedPhoto` state + modal render adds ~5 lines. Acceptable because the modal logic is fully extracted into its own file.
- Signed URL TTL of 1 hour is treated as sufficient for v1; if a user has the archive open longer, the modal image may 404. Deferred.

## Success Criteria (Summary)

- Clicking a photo opens the modal with the correct subject name and description.
- All three close affordances (Escape, backdrop, close button) work correctly.
- No regressions in move, delete, folder rename, or folder delete.
