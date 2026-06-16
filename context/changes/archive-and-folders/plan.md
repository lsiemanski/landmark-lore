# Archive and Folders Implementation Plan

## Overview

Build a `/archive` page where authenticated users can browse their auto-saved identified photos organized into named folders. Users can create, rename, and delete folders; move photos between folders; delete individual photos; and, right after identifying a photo on the dashboard, make an explicit Save / Discard decision — choosing a folder to file it into, or permanently discarding the auto-saved photo (DB row + storage object).

## Current State Analysis

The database schema is already fully in place — `folders`, `photos`, and `identifications` tables exist with RLS `owner_all` policies (`supabase/migrations/20260603000001_create_folders_photos_identifications.sql`). Every user automatically gets an "Uncategorized" folder on signup via a DB trigger (`create_default_folder`, line 89). Photos are auto-saved to "Uncategorized" during the `/api/identify` flow (`src/lib/identify/persistence.ts:52–63` + `src/pages/api/identify.ts:60`). No browse or organize UI exists yet — the dashboard only shows the upload/identify flow.

## Desired End State

Users navigate to `/archive` from the dashboard and see a two-panel layout: a folder sidebar on the left and a photo grid on the right. They can select "All photos" or a specific folder to filter the grid. Each photo card shows a thumbnail, the landmark name, and the saved date. An overflow menu on each card allows moving to a different folder or deleting the photo. The sidebar supports creating, renaming, and deleting folders (Uncategorized is always protected). After a successful identification on the dashboard, the result presents an explicit Save / Discard choice: Save reveals an inline folder picker so the user files the photo immediately, while Discard permanently deletes the auto-saved photo (DB row + storage object).

### Key Discoveries

- Photos already stored in Supabase Storage bucket "photos" at `{user_id}/{photo_id}.{ext}` — `src/lib/identify/storage.ts:1`
- Thumbnail URLs require signed URL generation via `supabase.storage.from('photos').createSignedUrls(paths, 3600)` — can be batched for an entire page load
- `photos.folder_id` is `NOT NULL REFERENCES folders(id) ON DELETE RESTRICT` — deleting a folder with photos throws a DB FK error; the API must pre-check and return a clear 409
- "Uncategorized" folder identity is its name (no `is_default` column exists) — API routes enforce no-rename / no-delete by checking `name === 'Uncategorized'`
- Deleting a photo cascades to `identifications` automatically (`ON DELETE CASCADE`, schema line 36) — only the `photos` row and storage object need explicit deletion
- `UploadFlow.tsx` is 205 lines — adding FolderPicker state will push it over 250; extract `FolderPicker` as a separate component
- The `requireSupabaseClient` / `requireAuthenticatedUser` helpers are currently route-private and duplicated in `src/pages/api/identify.ts:82–94` and `src/pages/api/auth/delete-account.ts:31–48` — Phase 1 step 0 extracts them to `src/lib/api/auth.ts`; new routes import that module rather than re-declaring

## What We're NOT Doing

- Sharing photos or folders with other users
- Sorting or filtering photos within a folder (beyond folder selection)
- Bulk-select / bulk-move / bulk-delete
- Photo detail lightbox on card click
- Drag-and-drop between folders
- Pagination — all photos fetched at once (acceptable at MVP scale)
- Adding an `is_default` column to protect Uncategorized at the DB level (name-check in API is sufficient for now)

## Implementation Approach

Four sequential phases, each independently testable: API + lib layer first so Phase 2 can call real endpoints; read-only archive view second to verify data flow; interactive folder and photo actions third; folder picker in UploadFlow last (smallest surface, isolated to one component).

## Phase 1: API Routes + Lib Layer

### Overview

Create the lib helpers that encapsulate all Supabase queries, then wire them into Astro API route files. No UI in this phase.

### Changes Required

#### 0. Shared API auth helpers

**File**: `src/lib/api/auth.ts` (new)

**Intent**: Extract the `requireSupabaseClient` / `requireAuthenticatedUser` helpers — currently duplicated as route-private functions in `src/pages/api/identify.ts:82–94` and `src/pages/api/auth/delete-account.ts:31–48` — into one shared module so the four new archive routes import them instead of copying. Mirrors `src/lib/api/http.ts`, which already houses the shared `HttpError`.

**Contract**:

```typescript
export function requireSupabaseClient(context: APIContext): SupabaseClient;
export async function requireAuthenticatedUser(supabase: SupabaseClient): Promise<User>;
```

Unify the return type on `User` (the `delete-account.ts` copy already annotates this; `identify.ts` infers it). Refactor both existing routes to import from `@/lib/api/auth` and delete their local copies — small blast radius, covered by `test/integration/identify-route.test.ts` and `delete-account-route.test.ts`. All archive routes below import these helpers; do not re-declare them.

> **Addendum (impl, 2026-06-16):** Phase 1 also introduced a shared `apiRoute(handler)` higher-order wrapper in `src/lib/api/http.ts` that centralises the `try/catch (HttpError → toResponse)` boilerplate. `identify.ts` and `delete-account.ts` were refactored to use it (dropping their local try/catch), and all new archive routes adopt it. Not in the original step-0 scope, but it removes duplicated error-handling boilerplate and keeps every route's catch behaviour identical; all integration tests stay green.

#### 1. Folder lib helpers

**File**: `src/lib/archive/folders.ts`

**Intent**: Provide typed functions for all folder CRUD operations — listing (with photo count), creating, renaming, and deleting. Keeps Supabase query logic out of the route handlers.

**Contract**:

```typescript
export interface FolderWithCount {
  id: string;
  name: string;
  photoCount: number;
  createdAt: string;
}

export async function listFolders(supabase: SupabaseClient, userId: string): Promise<FolderWithCount[]>;
export async function createFolder(supabase: SupabaseClient, userId: string, name: string): Promise<{ id: string }>;
export async function renameFolder(
  supabase: SupabaseClient,
  userId: string,
  folderId: string,
  name: string,
): Promise<void>;
export async function deleteFolder(supabase: SupabaseClient, userId: string, folderId: string): Promise<void>;
```

`listFolders` uses `.select('id, name, created_at, photos(count)')` — Supabase returns `photos` as `[{ count: number }]`; transform to `photoCount`. `deleteFolder` checks `photoCount > 0` first and throws `HttpError(409, ...)` rather than letting the FK constraint surface a 500.

#### 2. Photo lib helpers

**File**: `src/lib/archive/photos.ts`

**Intent**: Provide typed functions for listing photos (joined to identifications, with signed URLs), moving a photo to a different folder, and deleting a photo record and its storage object.

**Contract**:

```typescript
export interface PhotoCardData {
  id: string;
  signedUrl: string;
  subjectName: string;
  folderId: string;
  createdAt: string;
}

export async function listPhotos(
  supabase: SupabaseClient,
  params: { userId: string; folderId?: string },
): Promise<PhotoCardData[]>;

export async function movePhoto(
  supabase: SupabaseClient,
  params: { userId: string; photoId: string; targetFolderId: string },
): Promise<void>;

export async function deletePhotoRecord(
  supabase: SupabaseClient,
  params: { userId: string; photoId: string },
): Promise<{ storagePath: string }>;

export async function deletePhotoFromStorage(supabase: SupabaseClient, storagePath: string): Promise<void>;
```

`listPhotos` joins `identifications(subject_name)`, filters `status = 'identified'`, orders by `created_at DESC`, then calls `createSignedUrls(paths, 3600)` in one batch and merges signed URLs by index. If no rows match, early-return `[]` before calling `createSignedUrls` (don't pass an empty path array). `deletePhotoRecord` reads `storage_path` first, then deletes the `photos` row (cascade removes identification); returns `storagePath` so the caller handles storage separately. Import `PHOTOS_BUCKET` from `@/lib/identify/storage`.

#### 3. Folders API — collection

**File**: `src/pages/api/archive/folders.ts`

**Intent**: Handle `GET` (list folders) and `POST` (create folder) for the authenticated user.

**Contract**:

- `GET` → `200 { folders: FolderWithCount[] }`
- `POST` body `{ name: string }` → `201 { id: string }`; validates name is non-empty and not "Uncategorized"
- Auth errors → 401; validation errors → 400; imports `requireSupabaseClient` / `requireAuthenticatedUser` from `@/lib/api/auth` (step 0) — all archive routes do the same

#### 4. Folders API — individual

**File**: `src/pages/api/archive/folders/[id].ts`

**Intent**: Handle `PATCH` (rename) and `DELETE` (delete) for a single folder.

**Contract**:

- `PATCH` body `{ name: string }` → 200; rejects if `name === 'Uncategorized'` (400) or the folder's current name is "Uncategorized" (403 — protected folder)
- `DELETE` → 200; rejects if folder name is "Uncategorized" (403) or folder has photos (409 with `{ error: "Folder is not empty" }`)

#### 5. Photos API — collection

**File**: `src/pages/api/archive/photos.ts`

**Intent**: Return the user's identified photos with signed thumbnail URLs. Accepts optional `?folderId=` query param to filter by folder.

**Contract**: `GET` → `200 { photos: PhotoCardData[] }`

#### 6. Photos API — individual

**File**: `src/pages/api/archive/photos/[id].ts`

**Intent**: Handle `PATCH` (move to folder) and `DELETE` (permanently remove photo + storage file).

**Contract**:

- `PATCH` body `{ folderId: string }` → 200; verifies target folder belongs to the user before updating
- `DELETE` → 200; calls `deletePhotoRecord` then `deletePhotoFromStorage`; storage failure logs but does not fail the request (orphan object is an accepted risk, consistent with `persistence.ts:87`)

#### 7. Integration tests

**Files**: `test/integration/archive-folders-route.test.ts`, `test/integration/archive-photos-route.test.ts`

**Intent**: Cover the route behaviours asserted below so the "Automated Verification" items are actually automated, not manual. Follow the existing pattern in `test/integration/identify-route.test.ts` and `delete-account-route.test.ts`, reusing `test/helpers/route.ts` and `test/helpers/supabase-test.ts`.

**Contract**: Assert each status-code behaviour in the Automated Verification list — 401 when unauthenticated; folder list shape; create + duplicate-"Uncategorized" 400; rename + protected-folder 403; non-empty-folder delete 409; photos list with non-empty `signedUrl`; move updates `folder_id`; delete removes row (+ storage). Run via `npm run test:integration`. Where signed-URL or storage assertions can't be stubbed with the existing helpers, leave them in Manual Verification and note it.

### Success Criteria

#### Automated Verification

- TypeScript passes: `npm run typecheck`
- Auth helpers extracted to `src/lib/api/auth.ts`; `identify.ts` and `delete-account.ts` import them (no local copies remain); `npm run test:integration` stays green

The route behaviours below are asserted by the Phase 1 integration tests (step 7) and run with `npm run test:integration`:

- `GET /api/archive/folders` returns 401 when unauthenticated, 200 with folder list when authenticated
- `POST /api/archive/folders` creates a folder; re-posting with name "Uncategorized" returns 400
- `PATCH /api/archive/folders/[id]` renames a folder; naming the Uncategorized folder returns 403
- `DELETE /api/archive/folders/[id]` on a non-empty folder returns 409
- `GET /api/archive/photos` returns identified photos with non-empty `signedUrl` fields
- `PATCH /api/archive/photos/[id]` updates `folder_id` in the DB
- `DELETE /api/archive/photos/[id]` removes the photo row and the storage object

#### Manual Verification

- All endpoints return the correct shape in Supabase Studio or a REST client
- Signed URLs resolve to the actual photo images in a browser

**Implementation Note**: After all automated checks pass, manually verify endpoints return correct data before proceeding.

---

## Phase 2: Archive Page — Read View

### Overview

Build the `/archive` page shell and the read-only components (sidebar folder list + photo grid). Users can see and filter their photos but not yet manage folders or perform photo actions.

### Changes Required

#### 1. Middleware — add route

**File**: `src/middleware.ts`

**Intent**: Protect `/gallery` the same way `/dashboard` is protected.

**Contract**: Add `"/gallery"` to the `PROTECTED_ROUTES` array (line 4).

> **Addendum (impl, 2026-06-16):** The user-facing page route was named **`/gallery`** (page file `src/pages/gallery.astro`, dashboard link labelled "Gallery") rather than `/archive`. The `/api/archive/*` routes and `src/lib/archive/*` modules keep the `archive` name — only the browse page is "gallery". References below and in Phase 4 use `/gallery` accordingly.

#### 2. Gallery page shell

**File**: `src/pages/gallery.astro`

**Intent**: Authenticated Astro page that provides the cosmic-theme layout and mounts the interactive archive island.

**Contract**: Mirror the dashboard shell (`src/pages/dashboard.astro`) — `bg-cosmic`, max-width container (widen to `max-w-4xl` to accommodate sidebar), header with "Landmark Lore" gradient and `AccountMenu`, plus a "← Dashboard" text link. Mount `<ArchiveView client:only="react" />`.

#### 3. ArchiveView orchestrator

**File**: `src/components/archive/ArchiveView.tsx`

**Intent**: Fetch folders and photos on mount, hold selected-folder state (`"all" | string`), and pass data down to FolderSidebar and PhotoGrid.

**Contract**:

```typescript
type SelectedFolder = "all" | string; // folderId
```

Fetches `/api/archive/folders` and `/api/archive/photos` in parallel on mount. Re-fetches photos when `selectedFolder` changes (passes `?folderId=` to photos endpoint). Renders a two-column layout: `FolderSidebar` (left, fixed width ~200px) + `PhotoGrid` (right, flex-1). Expose `onFolderSelect`, `onPhotoMoved`, `onPhotoDeleted`, `onFolderCreated`, `onFolderRenamed`, `onFolderDeleted` as local callbacks mutating state without re-fetching (optimistic update).

> **Addendum (impl, 2026-06-16):** The read path was implemented with **server-side data loading** rather than client-side fetch-on-mount. `gallery.astro` calls `listFolders` / `listPhotos` directly in its frontmatter and passes `initialFolders` / `initialPhotos` as props to `ArchiveView`; the component holds them in state and filters by selected folder **client-side via `useMemo`** — no `/api/archive/photos` round-trip and no loading state. This matches the SSR data-loading pattern already used in the dashboard shell and removes the loading flash. The optimistic count-sync callback contract below is unchanged and honoured. Consequence: the `?folderId=` server filter on `GET /api/archive/photos` is currently unexercised by the UI (it remains available for future use, e.g. pagination). These callbacks must keep `folders[].photoCount` in sync with the photo list in the same state update — `onPhotoMoved` decrements the source folder's count and increments the target; `onPhotoDeleted` decrements the photo's folder count; `onFolderCreated` adds the folder with count 0. The Phase 3 delete guard (trash disabled when `photoCount > 0`) reads these counts, so stale counts would leave a now-empty folder undeletable without a refresh.

#### 4. Folder sidebar

**File**: `src/components/archive/FolderSidebar.tsx`

**Intent**: Display "All photos" plus each folder with its photo count chip. Highlight the currently selected entry. No create/rename/delete affordances yet.

**Contract**:

```typescript
interface Props {
  folders: FolderWithCount[];
  selected: SelectedFolder;
  onSelect: (id: SelectedFolder) => void;
}
```

"All photos" entry always appears first. Each folder row shows name + count badge (white/10 pill). Active row highlighted (white/20 bg). `getByRole("button")` locators must work (accessible button elements, not div clicks).

#### 5. Photo grid

**File**: `src/components/archive/PhotoGrid.tsx`

**Intent**: Render a responsive grid of `PhotoCard` components or an empty state message.

**Contract**:

```typescript
interface Props {
  photos: PhotoCardData[];
  folders: FolderWithCount[];
  onMoved: (photoId: string, targetFolderId: string) => void;
  onDeleted: (photoId: string) => void;
}
```

Empty state: "No photos yet — identify a landmark to get started." CSS grid with `grid-cols-2 sm:grid-cols-3` (or similar).

#### 6. Photo card

**File**: `src/components/archive/PhotoCard.tsx`

**Intent**: Render a single saved photo — thumbnail, landmark name, date. No actions yet.

**Contract**:

```typescript
interface Props {
  photo: PhotoCardData;
  folders: FolderWithCount[];
  onMoved: (photoId: string, targetFolderId: string) => void;
  onDeleted: (photoId: string) => void;
}
```

`<img src={photo.signedUrl} alt={photo.subjectName} />` in a rounded card. Name truncated to one line (`truncate`). Date formatted `DD MMM YYYY` using `Date.toLocaleDateString`. No overflow menu in this phase — the `onMoved`/`onDeleted` props are wired in Phase 3.

#### 7. Dashboard — gallery link

**File**: `src/pages/dashboard.astro`

**Intent**: Let users discover the gallery from the dashboard.

**Contract**: Add a "Gallery" anchor link to `/gallery` in the header row alongside the AccountMenu (line 12), styled as a subtle text link (white/60, hover white).

### Success Criteria

#### Automated Verification

- TypeScript passes: `npm run typecheck`
- `/gallery` route exists in the middleware `PROTECTED_ROUTES`

#### Manual Verification

- `/gallery` redirects unauthenticated users to `/auth/signin`
- Authenticated users see their identified photos in a grid with thumbnails, names, and dates
- Selecting a folder in the sidebar filters the grid
- "All photos" shows all photos across all folders
- Empty state appears when no identified photos exist
- "← Dashboard" link navigates back to `/dashboard`
- Dashboard header shows "Gallery" link pointing to `/gallery`

**Implementation Note**: Manually verify thumbnails load (signed URLs work) and folder filtering is correct before proceeding to Phase 3.

---

## Phase 3: Folder Management + Photo Actions

### Overview

Add interactive folder management to the sidebar (create, rename, delete) and a photo overflow menu (move, delete) with confirmation dialogs.

### Changes Required

#### 1. FolderSidebar extended

**File**: `src/components/archive/FolderSidebar.tsx`

**Intent**: Extend with create-folder input and per-folder rename/delete controls. "Uncategorized" folder shows no rename or delete icons.

**Contract**: Add a "+" button at the bottom of the folder list — clicking it renders an inline `<input>` below the list. Submit (Enter or blur) calls `POST /api/archive/folders`, then invokes `onFolderCreated` with the new folder. Each non-Uncategorized folder row shows a pencil icon and a trash icon on hover/focus. Pencil click replaces the folder name with an `<input>` pre-filled with the current name; Enter/blur calls `PATCH /api/archive/folders/[id]`, Escape cancels. Trash icon is disabled (visually and `aria-disabled`) if `photoCount > 0`; when enabled, sets `pendingDeleteFolder` state which triggers the confirmation dialog. File must stay under 250 lines — extract `FolderRow` as a sibling component in the same file if needed.

> **Addendum (impl, 2026-06-16):** The rename/delete affordances were **not** placed as per-row pencil/trash icons in the sidebar. Instead the sidebar (`FolderSidebar.tsx`) carries only the create-folder control, and rename/delete live in a header above the photo grid (`ArchiveView.tsx`), acting on the **currently selected** folder. Pencil → inline rename input (Enter/blur commits, Escape cancels); trash → `pendingDeleteFolder` (disabled with `aria-disabled` + `cursor-not-allowed` when `photoCount > 0`); `isProtected` (`name === DEFAULT_FOLDER_NAME`) hides both for Uncategorized. Consequence: a folder must be selected before it can be renamed/deleted (no hover affordance on unselected rows). This satisfies the Phase 3 manual criteria (3.3 / 3.4 / 3.7) and keeps `FolderSidebar` small enough that the planned `FolderRow` extraction was unnecessary (106 lines). `gallery.astro` also gained a `Cache-Control: private, no-store` response header so the per-user, signed-URL page is never cached by shared/browser caches.

#### 2. Confirmation dialog

**File**: `src/components/archive/ConfirmDialog.tsx`

**Intent**: Reusable modal for destructive confirmations, following the accessibility pattern in `AccountMenu.tsx` (role="dialog", aria-modal, aria-labelledby, Escape closes).

**Contract**:

```typescript
interface Props {
  open: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}
```

#### 3. ArchiveView — delete orchestration

**File**: `src/components/archive/ArchiveView.tsx`

**Intent**: Manage `pendingDeleteFolder` and `pendingDeletePhoto` state; render `ConfirmDialog` for each. On confirm, call the appropriate DELETE endpoint then invoke the local state callbacks.

**Contract**: Add two state entries:

```typescript
const [pendingDeleteFolder, setPendingDeleteFolder] = useState<string | null>(null);
const [pendingDeletePhoto, setPendingDeletePhoto] = useState<string | null>(null);
```

Pass `onRequestDeleteFolder` and `onRequestDeletePhoto` down to sidebar and grid respectively.

#### 4. PhotoCard overflow menu

**File**: `src/components/archive/PhotoCard.tsx`

**Intent**: Extend with a "⋮" overflow button that opens a small dropdown with "Move to…" folder options and a "Delete" action.

**Contract**: Overflow button appears on hover (`group-hover:flex`) and on keyboard focus. Dropdown lists all user folders (except the photo's current folder); clicking a folder calls `PATCH /api/archive/photos/[id]` then invokes `onMoved`. "Delete" invokes `onDeleted` (which bubbles up to ArchiveView to open `ConfirmDialog`). Dropdown closes on Escape, click-outside, and after selection.

### Success Criteria

#### Automated Verification

- TypeScript passes: `npm run typecheck`

#### Manual Verification

- User can create a new folder — appears in sidebar with count 0
- User can rename a folder — name updates in sidebar immediately
- Attempting to rename "Uncategorized" via the UI is impossible (no pencil icon shown)
- Attempting to delete a non-empty folder: trash icon is disabled (no click)
- User can delete an empty folder — folder disappears from sidebar
- Moving a photo: photo disappears from the current folder's view and appears in the target folder; both folders' count badges update without a refresh
- Moving or deleting the last photo out of a folder drops its count to 0 and enables its trash icon (no refresh needed)
- Deleting a photo: confirmation dialog appears; on confirm, photo is gone from the grid
- Cancelling the confirmation dialog leaves the photo/folder unchanged
- "Uncategorized" folder has no rename or delete affordances

**Implementation Note**: Verify all destructive actions and their cancellation paths manually before proceeding.

---

## Phase 4: Save or Discard Decision + Folder Picker

### Overview

Replace the passive "Saved to your archive" confirmation with an active Save / Discard choice. The photo is still auto-saved to DB + storage on identification (preserving idempotency), but the user now decides whether to keep it. "Save to archive" lets them pick a folder; "Discard" permanently deletes the photo via the DELETE endpoint from Phase 1.

### Changes Required

#### 1. FolderPicker component

**File**: `src/components/identify/FolderPicker.tsx`

**Intent**: Render a controlled folder selection control — tracks which folder the user has selected, but does not call any API itself. The parent (`UploadFlow`) owns the save/discard actions.

**Contract**:

```typescript
interface Props {
  folders: FolderWithCount[];
  selectedFolderId: string;
  onChange: (folderId: string) => void;
  disabled?: boolean;
}
```

Renders a `<select>` with folder names. Controlled via `selectedFolderId` + `onChange`. Import `FolderWithCount` type from `@/lib/archive/folders`.

#### 2. UploadFlow extended

**File**: `src/components/identify/UploadFlow.tsx`

**Intent**: After identification, show the result with a folder picker and explicit Save / Discard buttons instead of a passive confirmation. Discarding permanently deletes the photo; saving (optionally) moves it to the chosen folder, then shows a success state.

**Contract**:

Add `"saved"` to `FlowState`:

```typescript
| { status: "saved"; subjectName: string; folderName: string }
```

Add `folders` state (`FolderWithCount[] | null`) and `selectedFolderId` state (string). When `flowState.status` becomes `"identified"`, fetch `GET /api/archive/folders` and set both states (pre-select the "Uncategorized" folder id).

In the `identified` branch (lines 126–147), replace "Saved to your archive" + "Identify another" with:

- `<IdentificationResult>` panel (unchanged)
- `<FolderPicker>` (shown only if folders loaded; skip if fetch failed)
- **"Save to archive"** button (primary): if `selectedFolderId` differs from the Uncategorized id, call `PATCH /api/archive/photos/[id]` with the selected folder; then transition to `{ status: "saved", subjectName, folderName }`. If already Uncategorized (no PATCH needed), transition directly.
- **"Discard"** button (secondary/danger): call `DELETE /api/archive/photos/[id]`; on success, call `resetToIdle()`.

In the `saved` branch, show: "✓ Saved in [folderName]" + "Identify another" button (calls `resetToIdle()`) + a "View in gallery →" anchor link to `/gallery`.

Both Save and Discard buttons must be disabled while their respective requests are in-flight.

If the folders fetch fails, skip `FolderPicker` entirely — show Save / Discard without a folder selector (Save goes to Uncategorized by default).

The file must stay under 250 lines — `FolderPicker` extraction in step 1 keeps this within budget.

### Success Criteria

#### Automated Verification

- TypeScript passes: `npm run typecheck`
- UploadFlow source remains under 250 lines

#### Manual Verification

- After identifying a landmark, the result shows Save / Discard buttons and a folder picker (when folders load)
- "Save to archive" with a non-Uncategorized folder selected: photo moves; "Saved in [folder] ✓" appears; `/gallery` shows it in the correct folder
- "Save to archive" with Uncategorized selected: photo stays in Uncategorized; success state shows
- "Discard": photo is permanently deleted; flow resets to idle; `/gallery` does not show the photo
- If folders API fails, Save / Discard buttons still appear (Save defaults to Uncategorized); no picker shown
- Save and Discard buttons are disabled while their request is in-flight
- "Identify another" (post-save) resets the full flow; "View in gallery →" link navigates to `/gallery`

**Implementation Note**: Manually test all three paths — save to Uncategorized, save to named folder, and discard — and verify `/archive` state after each before marking complete.

---

## Testing Strategy

### Manual Testing Steps

1. Sign in and go to `/dashboard` → verify "Gallery" link visible in header
2. Identify a landmark → verify Save / Discard buttons + folder picker appear → select a named folder → click "Save to archive" → verify "Saved in [folder] ✓" appears
3. Navigate to `/gallery` → verify photo appears in the correct folder and in "All photos"
   3a. Identify another landmark → click "Discard" → verify flow resets to idle and photo absent from `/gallery`
4. Create a new folder in the sidebar → verify it appears with count 0
5. Rename the new folder → verify name updates
6. Move the photo to the new folder via the overflow menu → verify it moves in the grid
7. Delete the photo via the overflow menu → confirm dialog → verify photo removed
8. Try to delete the now-empty folder → confirm dialog → folder removed
9. Verify "Uncategorized" folder shows no rename/delete icons
10. Sign out → navigate to `/gallery` → verify redirect to `/auth/signin`

## Performance Considerations

Signed URLs expire after 1 hour — acceptable for a browse session. If users leave the archive open for more than 1 hour, thumbnails will 403; a page refresh re-fetches. This is a known MVP limitation.

Photos are fetched without pagination. If a user accumulates hundreds of photos, the initial load and signed-URL batch call will grow. Pagination is out of scope for now.

## References

- Schema: `supabase/migrations/20260603000001_create_folders_photos_identifications.sql`
- Persistence helpers: `src/lib/identify/persistence.ts`
- API route pattern: `src/pages/api/identify.ts`
- Dashboard (layout reference): `src/pages/dashboard.astro`
- AccountMenu (modal/dialog pattern reference): `src/components/auth/AccountMenu.tsx`
- Storage bucket constant: `src/lib/identify/storage.ts`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: API Routes + Lib Layer

#### Automated

- [x] 1.1 TypeScript passes: `npm run typecheck` — 023f480
- [x] 1.11 Auth helpers extracted to `src/lib/api/auth.ts`; `identify.ts` + `delete-account.ts` import them; `npm run test:integration` stays green — 023f480
- [x] 1.2 `GET /api/archive/folders` returns 401 when unauthenticated, 200 with folder list when authenticated — 023f480
- [x] 1.3 `POST /api/archive/folders` creates a folder; re-posting with name "Uncategorized" returns 400 — 023f480
- [x] 1.4 `PATCH /api/archive/folders/[id]` renames a folder; naming the Uncategorized folder returns 403 — 023f480
- [x] 1.5 `DELETE /api/archive/folders/[id]` on a non-empty folder returns 409 — 023f480
- [x] 1.6 `GET /api/archive/photos` returns identified photos with non-empty `signedUrl` fields — 023f480
- [x] 1.7 `PATCH /api/archive/photos/[id]` updates `folder_id` in the DB — 023f480
- [x] 1.8 `DELETE /api/archive/photos/[id]` removes the photo row and the storage object — 023f480

#### Manual

- [x] 1.9 All endpoints return the correct shape in a REST client — 023f480
- [x] 1.10 Signed URLs resolve to actual photo images in a browser — 023f480

### Phase 2: Archive Page — Read View

#### Automated

- [x] 2.1 TypeScript passes: `npm run typecheck` — 0bf0c8a
- [x] 2.2 `/gallery` route exists in middleware `PROTECTED_ROUTES` — 0bf0c8a

#### Manual

- [x] 2.3 `/gallery` redirects unauthenticated users to `/auth/signin` — 0bf0c8a
- [x] 2.4 Authenticated users see identified photos with thumbnails, names, and dates — 0bf0c8a
- [x] 2.5 Selecting a folder in the sidebar filters the grid — 0bf0c8a
- [x] 2.6 "All photos" shows all photos across all folders — 0bf0c8a
- [x] 2.7 Empty state appears when no identified photos exist — 0bf0c8a
- [x] 2.8 "← Dashboard" link navigates back; dashboard header shows "Gallery" link — 0bf0c8a

### Phase 3: Folder Management + Photo Actions

#### Automated

- [x] 3.1 TypeScript passes: `npm run typecheck`

#### Manual

- [x] 3.2 User can create a new folder
- [x] 3.3 User can rename a folder; "Uncategorized" shows no pencil icon
- [x] 3.4 Trash icon disabled on non-empty folders; empty folders can be deleted
- [x] 3.5 Moving a photo updates both old and new folder views and both count badges
- [x] 3.8 Emptying a folder (move/delete last photo) drops its count to 0 and enables its trash without a refresh
- [x] 3.6 Deleting a photo: confirmation → gone from grid; cancel → unchanged
- [x] 3.7 "Uncategorized" folder shows no rename or delete affordances

### Phase 4: Save or Discard Decision + Folder Picker

#### Automated

- [ ] 4.1 TypeScript passes: `npm run typecheck`
- [ ] 4.2 UploadFlow source remains under 250 lines

#### Manual

- [ ] 4.3 Save / Discard buttons and folder picker appear after identification
- [ ] 4.4 "Save to archive" with named folder: photo moves; "Saved in [folder] ✓" shows; `/gallery` reflects it
- [ ] 4.5 "Save to archive" with Uncategorized: success state shows; photo in Uncategorized in `/gallery`
- [ ] 4.6 "Discard": flow resets to idle; photo absent from `/gallery`
- [ ] 4.7 Folders API failure: Save / Discard still present; no picker; Save defaults to Uncategorized
- [ ] 4.8 Buttons disabled while request is in-flight; "Identify another" resets the full flow
- [ ] 4.9 "View in gallery →" link appears in the saved state and navigates to `/gallery`
