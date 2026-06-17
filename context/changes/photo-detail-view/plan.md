# Photo Detail View Implementation Plan

## Overview

Add a read-only detail modal to the archive: clicking a photo card thumbnail opens a modal showing the full photo, subject name, and description. The description is already persisted in the `identifications` table but not currently fetched or surfaced in the archive.

## Current State Analysis

- `PhotoCardData` (`src/lib/archive/photos.ts:6`) carries `id, signedUrl, subjectName, folderId, createdAt` — no `description`.
- `listPhotos` selects `identifications(subject_name)` only — `description` is never fetched.
- `PhotoCard` renders `subjectName` + date + a kebab action menu; the image is not clickable.
- `ArchiveView.tsx` is at exactly 250 lines (lessons.md limit) — the modal state and render must be extracted into their own component to stay within budget.
- `IdentificationResult` (`src/components/identify/IdentificationResult.tsx`) was explicitly built for archive reuse (its JSDoc says so) and takes `title` + `description`.
- `ConfirmDialog` establishes the modal pattern: `fixed inset-0 z-50 bg-black/60 backdrop-blur-sm`, Escape-to-close, `role="dialog"` / `aria-modal`.

## Desired End State

Clicking any photo card image in the archive opens a modal overlay showing the full-size photo, the subject name as a heading, and the identification description. Pressing Escape or clicking the backdrop closes it. No navigation away from the archive occurs. The description is read-only.

### Key Discoveries

- `IdentificationResult` is already extracted and ready to reuse — no new display logic needed.
- Signed URLs have a 1-hour TTL; reusing the URL already on the card is sufficient for a normal session.
- No new API endpoint is required — `description` is fetched by extending the existing `listPhotos` query.
- `ArchiveView.tsx` is at 249 lines (the lessons ceiling). The detail modal is a fully self-contained component with its own Escape listener, so `ArchiveView` only stores `selectedPhoto: PhotoCardData | null` and the close handler. But those additions (import + `useState` + `onSelect` prop + modal render ≈ 4 lines) still push the file over 250 — extracting the modal body to its own file does not help, because the state/render/import must live in `ArchiveView`. To stay under the limit, the inline error banner (current lines 129–146) is first extracted into a small `ErrorBanner` component, yielding a net-negative line delta.

## What We're NOT Doing

- No follow-up chat from the archive (FollowUpChat requires an `imageBlob`, not a signed URL).
- No in-modal edit of the description (read-only per decision; editing belongs to a future slice).
- No move/delete actions inside the modal (those remain on the card's kebab menu).
- No fresh signed-URL fetch on modal open (1-hour TTL is sufficient; deferred to a future slice if needed).

## Implementation Approach

Single-phase: extend the data layer (one query change + one type field), create `PhotoDetailModal`, then thread an `onSelect` callback from `ArchiveView` → `PhotoGrid` → `PhotoCard`. The modal follows the exact `ConfirmDialog` pattern; `IdentificationResult` is reused with one additive, backward-compatible change (an optional `titleId` prop for `aria-labelledby`).

## Phase 1: Data layer + detail modal + wiring

### Overview

Fetch `description` from the DB, build `PhotoDetailModal`, make the card image clickable, and wire the modal state into `ArchiveView`.

### Changes Required

#### 1. Extend `PhotoCardData` and `listPhotos`

**File**: `src/lib/archive/photos.ts`

**Intent**: Add `description` to the type and to the Supabase query so it reaches the client.

**Contract**:

- Add `description: string` to the `PhotoCardData` interface (after `subjectName`).
- Change the `.select()` call from `identifications(subject_name)` to `identifications(subject_name, description)`.
- In the `.map()` that builds the return array, add `description: row.identifications?.description ?? ""`.

#### 2. Create `PhotoDetailModal`

**File**: `src/components/archive/PhotoDetailModal.tsx` (new file)

**Intent**: A read-only overlay that shows the photo image, `IdentificationResult`, and a close affordance. Follows the `ConfirmDialog` modal pattern exactly.

**Contract**:

- Props: `photo: PhotoCardData | null`, `onClose: () => void`.
- Returns `null` when `photo` is `null`.
- Backdrop: `fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm`; clicking the backdrop calls `onClose`.
- Inner panel: `w-full max-w-lg rounded-2xl border border-white/10 bg-[#0f1117] p-6 shadow-2xl` with `role="dialog"` `aria-modal="true"` `aria-labelledby="detail-modal-title"`.
- Inner panel click must call `e.stopPropagation()` so backdrop click doesn't bubble.
- Photo `<img>` rendered above the `IdentificationResult`; pass `title={photo.subjectName}` / `description={photo.description}` and `titleId="detail-modal-title"` (the new optional prop added in change #3) so the panel's `aria-labelledby` resolves to the rendered `<h2>`.
- Escape listener in a `useEffect` (same pattern as `ConfirmDialog:15-22`).
- Close button (`✕` or `X` icon) in the top-right corner of the inner panel, `aria-label="Close"`, `cursor-pointer`.

#### 3. Add an optional `titleId` prop to `IdentificationResult`

**File**: `src/components/identify/IdentificationResult.tsx`

**Intent**: Let the modal label itself via `aria-labelledby` by giving the rendered `<h2>` an id, without affecting existing callers.

**Contract**:

- Add `titleId?: string` to `IdentificationResultProps`.
- Apply it as `<h2 id={titleId}>`. When omitted, React renders no `id` attribute — so the 5 existing callers (`UploadFlow`, `PostIdentifyPanel`, `UnrecognizedPanel`, `IdentifyHarness`, and the unit test) are unaffected.

#### 4. Make the card image clickable

**File**: `src/components/archive/PhotoCard.tsx`

**Intent**: Add `onSelect` callback; clicking the photo image (not the card footer) triggers it.

**Contract**:

- Add `onSelect: (photo: PhotoCardData) => void` to the `Props` interface.
- Wrap the `<img>` (currently inside the `aspect-square` div) in a `<button type="button">` that calls `onSelect(photo)`. Alternatively, add `onClick` + `role="button"` + `cursor-pointer` directly on the image wrapper div — either is acceptable; `<button>` is preferred for accessibility.
- `aria-label` on the trigger: `"View details for ${photo.subjectName}"`.
- `cursor-pointer` on the clickable element (lessons.md).

#### 5. Thread `onSelect` through `PhotoGrid`

**File**: `src/components/archive/PhotoGrid.tsx`

**Intent**: Pass `onSelect` from `ArchiveView` down to each `PhotoCard`.

**Contract**:

- Add `onSelect: (photo: PhotoCardData) => void` to `Props`.
- Pass it to each `<PhotoCard onSelect={onSelect} ... />`.

#### 6. Extract the error banner to free line budget in `ArchiveView`

**File**: `src/components/archive/ErrorBanner.tsx` (new file) + `src/components/archive/ArchiveView.tsx`

**Intent**: `ArchiveView` is at the 249-line ceiling; the modal wiring (change #7) would push it over 250. Extract the inline error-banner JSX (current `ArchiveView.tsx:129-146`) into a small presentational component so the net line delta after wiring stays under the limit.

**Contract**:

- New `ErrorBanner` component with props `{ message: string; onDismiss: () => void }`. Returns `null` when `message` is empty/falsy. Move the existing banner markup verbatim (the `role="alert"` div, the `<span>{message}</span>`, and the `✕` dismiss button with `aria-label="Dismiss error"` and `cursor-pointer`).
- In `ArchiveView`, replace the inline `{error && (…)}` block with `<ErrorBanner message={error ?? ""} onDismiss={() => setError(null)} />` and import it from `./ErrorBanner`.
- Net effect: ~18 lines leave `ArchiveView`, comfortably offsetting the ~4 lines added in change #7.

#### 7. Wire modal state into `ArchiveView`

**File**: `src/components/archive/ArchiveView.tsx`

**Intent**: Own the `selectedPhoto` state and render `PhotoDetailModal` as a sibling to the existing `ConfirmDialog`s.

**Contract**:

- Add `const [selectedPhoto, setSelectedPhoto] = useState<PhotoCardData | null>(null)`.
- Pass `onSelect={setSelectedPhoto}` to `<PhotoGrid>`.
- Render `<PhotoDetailModal photo={selectedPhoto} onClose={() => setSelectedPhoto(null)} />` alongside the two existing `<ConfirmDialog>` renders (inside the fragment).
- Import `PhotoDetailModal` from `./PhotoDetailModal`.

### Success Criteria

#### Automated Verification

- TypeScript compiles with no errors: `npm run typecheck`
- Lint passes: `npm run lint`
- Build succeeds: `npm run build`

#### Manual Verification

- Clicking a photo card thumbnail in the archive opens the modal with the correct photo, subject name, and description.
- Pressing Escape closes the modal.
- Clicking the backdrop (outside the panel) closes the modal.
- Clicking the close button (✕) closes the modal.
- Clicking inside the panel does not close the modal.
- Modal does not appear when clicking the kebab menu or its items.
- No regressions: move-to-folder, delete photo, folder rename, folder delete all still work.
- The description is read-only (no edit affordance visible).
- `aria-modal="true"` and `role="dialog"` are present on the inner panel (verify in DevTools).

**Implementation Note**: After automated verification passes, pause here for manual confirmation before proceeding to archiving this change.

---

## Testing Strategy

### Manual Testing Steps

1. Open the gallery page with at least two photos in different folders.
2. Click a photo image → modal opens with the correct photo and description.
3. Press Escape → modal closes.
4. Click the backdrop → modal closes.
5. Click the close button → modal closes.
6. Open the modal → click inside the panel → modal stays open.
7. Open the kebab menu → no modal opens.
8. Move a photo to another folder → confirm move still works.
9. Delete a photo via the kebab menu → confirm delete still works.

## References

- `IdentificationResult` component: `src/components/identify/IdentificationResult.tsx`
- Modal pattern reference: `src/components/archive/ConfirmDialog.tsx`
- Data layer: `src/lib/archive/photos.ts`
- `ArchiveView` 250-line limit: `context/foundation/lessons.md`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Data layer + detail modal + wiring

#### Automated

- [x] 1.1 TypeScript compiles with no errors: `npm run typecheck` — c5ee0a1
- [x] 1.2 Lint passes: `npm run lint` — c5ee0a1
- [x] 1.3 Build succeeds: `npm run build` — c5ee0a1

#### Manual

- [x] 1.4 Clicking a photo card thumbnail opens the modal with the correct photo, subject name, and description — c5ee0a1
- [x] 1.5 Escape, backdrop click, and close button all close the modal — c5ee0a1
- [x] 1.6 Clicking inside the panel does not close the modal — c5ee0a1
- [x] 1.7 Kebab menu interactions do not open the modal — c5ee0a1
- [x] 1.8 Move, delete, folder rename, and folder delete still work (no regressions) — c5ee0a1
- [x] 1.9 Description is read-only; `aria-modal` and `role="dialog"` present in DevTools — c5ee0a1
