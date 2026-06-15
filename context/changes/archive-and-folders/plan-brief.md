# Archive and Folders — Plan Brief

> Full plan: `context/changes/archive-and-folders/plan.md`

## What & Why

Users already get their identified photos auto-saved to an "Uncategorized" folder after each identification, but there's no way to browse or organize them. This change adds a `/archive` page with folder-based organization so users can revisit their identifications and keep them tidy.

## Starting Point

The database schema is complete and live — `folders`, `photos`, and `identifications` tables exist with RLS, and every user already has an "Uncategorized" folder. Photos are being saved there automatically. The only missing piece is the UI to browse and manage them.

## Desired End State

Users can open `/archive` from the dashboard, see all their saved photos in a two-column layout (folder sidebar left, photo grid right), organize photos into named folders, and delete photos or folders they no longer want. After identifying a new photo, a folder picker appears inline so they can file it immediately.

## Key Decisions Made

| Decision                | Choice                                       | Why (1 sentence)                                                                                   |
| ----------------------- | -------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Archive location        | Separate `/archive` page                     | Keeps dashboard focused on identifying; archive has its own context and URL                        |
| Folder management scope | Full CRUD (create/rename/delete)             | Delivers the complete organizational promise; empty-only delete constraint keeps it safe           |
| Move photos             | Dropdown on photo card ("Move to...")        | Touch-friendly, discoverable, matches existing menu component patterns                             |
| Photo deletion          | Yes, with confirmation                       | Users need an escape valve for unwanted photos                                                     |
| Photo card content      | Thumbnail + landmark name + date             | Most scannable; signed URLs batched in one API call                                                |
| Save flow               | Explicit Save / Discard after identification | Users choose to keep or delete the auto-saved photo; idempotency preserved without a schema change |
| Archive layout          | Left sidebar + right photo grid              | Familiar pattern; both dimensions visible at once                                                  |

## Scope

**In scope:**

- `/archive` page (protected route) with sidebar + photo grid
- Folder create, rename, delete (empty only; "Uncategorized" protected)
- Photo card with thumbnail, name, date, overflow menu (move/delete)
- Folder picker in UploadFlow after successful identification
- Dashboard link to `/archive`

**Out of scope:**

- Photo detail / lightbox
- Bulk select / bulk move / bulk delete
- Drag-and-drop between folders
- Sorting or search within a folder
- Pagination
- Sharing photos/folders

## Architecture / Approach

New API layer in `src/pages/api/archive/` (folders collection + individual, photos collection + individual). Lib helpers in `src/lib/archive/folders.ts` and `src/lib/archive/photos.ts` encapsulate all Supabase queries and signed-URL generation. The `/archive` Astro page mounts a single `ArchiveView` React island (`client:only="react"`) that fetches data client-side and passes it to `FolderSidebar` and `PhotoGrid`. A shared `ConfirmDialog` component handles all destructive confirmations. `FolderPicker` is extracted as a separate component so `UploadFlow.tsx` stays under 250 lines.

## Phases at a Glance

| Phase                                | What it delivers                                                               | Key risk                                                                                                                 |
| ------------------------------------ | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| 1. API Routes + Lib Layer            | All endpoints; folder and photo CRUD; signed-URL generation                    | Signed URLs require Storage bucket access; "Uncategorized" protection is name-based (fragile if name changes)            |
| 2. Archive Page — Read View          | `/archive` route, sidebar, photo grid, dashboard link                          | Signed URL expiry (1hr) means stale thumbnails after long sessions                                                       |
| 3. Folder Management + Photo Actions | Create/rename/delete folders; move/delete photos; confirmation dialogs         | FolderSidebar approaching 250 lines — may need internal `FolderRow` extraction                                           |
| 4. Save or Discard + Folder Picker   | Explicit Save / Discard buttons after identification; folder picker for filing | UploadFlow must stay under 250 lines; "Discard" path must clean up storage; picker fetch failing must degrade gracefully |

**Prerequisites:** Supabase project running, `SUPABASE_URL` + `SUPABASE_KEY` set, "photos" storage bucket exists (already in use by identification flow)
**Estimated effort:** ~3–4 sessions across 4 phases

## Open Risks & Assumptions

- "Uncategorized" is identified by name, not a DB flag — if the name were to change (e.g., i18n), the protection logic breaks
- Storage orphan risk on photo delete (same accepted risk as in `persistence.ts:87`) — storage failure logs but doesn't block the response
- No pagination — large archives (100s of photos) will be slow on first load; acceptable at MVP scale

## Success Criteria (Summary)

- User can navigate to `/archive`, see all saved photos organized by folder, and manage both folders and photos
- After identifying a landmark, a folder picker lets the user file it immediately
- All destructive actions require confirmation and are reversible only before confirmation
