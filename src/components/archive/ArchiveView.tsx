import { useState, useMemo, useRef } from "react";
import { Pencil, Trash2 } from "lucide-react";
import { DEFAULT_FOLDER_NAME, type FolderWithCount } from "@/lib/archive/folders";
import type { PhotoCardData } from "@/lib/archive/photos";
import { FolderSidebar } from "./FolderSidebar";
import { PhotoGrid } from "./PhotoGrid";
import { ConfirmDialog } from "./ConfirmDialog";

export const ALL = "all";
export type SelectedFolder = string; // ALL ("all") or a folderId

interface Props {
  initialFolders: FolderWithCount[];
  initialPhotos: PhotoCardData[];
}

export default function ArchiveView({ initialFolders, initialPhotos }: Props) {
  const [folders, setFolders] = useState<FolderWithCount[]>(initialFolders);
  const [allPhotos, setAllPhotos] = useState<PhotoCardData[]>(initialPhotos);
  const [selectedFolder, setSelectedFolder] = useState<SelectedFolder>(ALL);
  const [pendingDeleteFolder, setPendingDeleteFolder] = useState<string | null>(null);
  const [pendingDeletePhoto, setPendingDeletePhoto] = useState<string | null>(null);
  const [folderRenaming, setFolderRenaming] = useState(false);
  const [renameDraft, setRenameDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const renameCommitted = useRef(false);

  function selectFolder(id: SelectedFolder) {
    setSelectedFolder(id);
    setFolderRenaming(false);
  }

  const photos = useMemo(
    () => (selectedFolder === ALL ? allPhotos : allPhotos.filter((p) => p.folderId === selectedFolder)),
    [allPhotos, selectedFolder],
  );

  const activeFolder = selectedFolder !== ALL ? (folders.find((f) => f.id === selectedFolder) ?? null) : null;

  function onPhotoMoved(photoId: string, targetFolderId: string) {
    const photo = allPhotos.find((p) => p.id === photoId);
    if (!photo) return;
    const sourceFolderId = photo.folderId;
    setFolders((f) =>
      f.map((folder) => {
        if (folder.id === sourceFolderId) return { ...folder, photoCount: folder.photoCount - 1 };
        if (folder.id === targetFolderId) return { ...folder, photoCount: folder.photoCount + 1 };
        return folder;
      }),
    );
    setAllPhotos((prev) => prev.map((p) => (p.id === photoId ? { ...p, folderId: targetFolderId } : p)));
  }

  function onPhotoDeleted(photoId: string) {
    const photo = allPhotos.find((p) => p.id === photoId);
    if (!photo) return;
    const folderId = photo.folderId;
    setFolders((f) =>
      f.map((folder) => (folder.id === folderId ? { ...folder, photoCount: folder.photoCount - 1 } : folder)),
    );
    setAllPhotos((prev) => prev.filter((p) => p.id !== photoId));
  }

  function onFolderCreated(folder: FolderWithCount) {
    setFolders((prev) => [...prev, folder]);
  }

  function onFolderRenamed(folderId: string, newName: string) {
    setFolders((prev) => prev.map((f) => (f.id === folderId ? { ...f, name: newName } : f)));
  }

  async function commitRename() {
    if (renameCommitted.current) return;
    renameCommitted.current = true;
    setFolderRenaming(false);
    if (!activeFolder) return;
    const trimmed = renameDraft.trim();
    if (!trimmed || trimmed === activeFolder.name) return;
    try {
      const res = await fetch(`/api/archive/folders/${activeFolder.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });
      if (res.ok) onFolderRenamed(activeFolder.id, trimmed);
      else setError("Couldn't rename the folder. Please try again.");
    } catch {
      setError("Couldn't rename the folder. Please try again.");
    }
  }

  async function confirmDeleteFolder() {
    if (!pendingDeleteFolder) return;
    const id = pendingDeleteFolder;
    setPendingDeleteFolder(null);
    try {
      const res = await fetch(`/api/archive/folders/${id}`, { method: "DELETE" });
      if (res.ok) {
        setFolders((prev) => prev.filter((f) => f.id !== id));
        if (selectedFolder === id) setSelectedFolder(ALL);
      } else setError("Couldn't delete the folder. Please try again.");
    } catch {
      setError("Couldn't delete the folder. Please try again.");
    }
  }

  async function confirmDeletePhoto() {
    if (!pendingDeletePhoto) return;
    const id = pendingDeletePhoto;
    setPendingDeletePhoto(null);
    try {
      const res = await fetch(`/api/archive/photos/${id}`, { method: "DELETE" });
      if (res.ok) onPhotoDeleted(id);
      else setError("Couldn't delete the photo. Please try again.");
    } catch {
      setError("Couldn't delete the photo. Please try again.");
    }
  }

  const isProtected = activeFolder?.name === DEFAULT_FOLDER_NAME;
  const canDelete = (activeFolder?.photoCount ?? 0) === 0;
  const pendingFolderName = pendingDeleteFolder
    ? (folders.find((f) => f.id === pendingDeleteFolder)?.name ?? "this folder")
    : "";

  return (
    <>
      {error && (
        <div
          role="alert"
          className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm text-red-200"
        >
          <span>{error}</span>
          <button
            type="button"
            onClick={() => {
              setError(null);
            }}
            aria-label="Dismiss error"
            className="cursor-pointer rounded px-1 text-red-200/60 transition-colors hover:text-red-200"
          >
            ✕
          </button>
        </div>
      )}
      <div className="flex gap-6">
        <FolderSidebar
          folders={folders}
          selected={selectedFolder}
          onSelect={selectFolder}
          onFolderCreated={onFolderCreated}
          onError={setError}
        />
        <div className="flex-1">
          {activeFolder && (
            <div className="mb-4 flex items-center gap-2">
              {folderRenaming ? (
                <input
                  autoFocus
                  value={renameDraft}
                  onChange={(e) => {
                    setRenameDraft(e.target.value);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      void commitRename();
                    }
                    if (e.key === "Escape") setFolderRenaming(false);
                  }}
                  onBlur={() => {
                    void commitRename();
                  }}
                  className="rounded bg-white/10 px-2 py-1 text-sm font-medium text-white outline-none"
                />
              ) : (
                <h2 className="text-sm font-medium text-white">{activeFolder.name}</h2>
              )}
              {!isProtected && !folderRenaming && (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      renameCommitted.current = false;
                      setRenameDraft(activeFolder.name);
                      setFolderRenaming(true);
                    }}
                    aria-label={`Rename ${activeFolder.name}`}
                    className="cursor-pointer rounded p-1 text-white/30 transition-colors hover:text-white"
                  >
                    <Pencil className="size-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={
                      canDelete
                        ? () => {
                            setPendingDeleteFolder(activeFolder.id);
                          }
                        : undefined
                    }
                    aria-disabled={!canDelete}
                    aria-label={`Delete ${activeFolder.name}`}
                    className={`rounded p-1 text-white/30 transition-colors ${canDelete ? "cursor-pointer hover:text-red-400" : "cursor-not-allowed opacity-40"}`}
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </>
              )}
            </div>
          )}
          <PhotoGrid
            photos={photos}
            folders={folders}
            onMoved={onPhotoMoved}
            onDeleted={setPendingDeletePhoto}
            onError={setError}
          />
        </div>
      </div>

      <ConfirmDialog
        open={pendingDeleteFolder !== null}
        title="Delete folder"
        message={`Delete "${pendingFolderName}"? This cannot be undone.`}
        confirmLabel="Delete folder"
        onConfirm={() => {
          void confirmDeleteFolder();
        }}
        onCancel={() => {
          setPendingDeleteFolder(null);
        }}
      />

      <ConfirmDialog
        open={pendingDeletePhoto !== null}
        title="Delete photo"
        message="Permanently delete this photo and its identification? This cannot be undone."
        confirmLabel="Delete photo"
        onConfirm={() => {
          void confirmDeletePhoto();
        }}
        onCancel={() => {
          setPendingDeletePhoto(null);
        }}
      />
    </>
  );
}
