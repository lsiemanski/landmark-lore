import { useState, useMemo, useCallback } from "react";
import { Menu, X } from "lucide-react";
import type { FolderWithCount } from "@/lib/archive/folders";
import type { PhotoCardData } from "@/lib/archive/photos";
import { FolderSidebar } from "./FolderSidebar";
import { PhotoGrid } from "./PhotoGrid";
import { ConfirmDialog } from "./ConfirmDialog";
import { ErrorBanner } from "./ErrorBanner";
import { SuccessToast } from "./SuccessToast";
import { PhotoDetailModal } from "./PhotoDetailModal";

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
  const [selectedPhoto, setSelectedPhoto] = useState<PhotoCardData | null>(null);
  const [pendingDeleteFolder, setPendingDeleteFolder] = useState<string | null>(null);
  const [pendingDeletePhoto, setPendingDeletePhoto] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Stable identity so SuccessToast's auto-dismiss timer isn't reset by an
  // unrelated re-render of this view during the toast's lifetime.
  const dismissNotice = useCallback(() => {
    setNotice(null);
  }, []);

  function selectFolder(id: SelectedFolder) {
    setSelectedFolder(id);
    setSidebarOpen(false);
  }

  const photos = useMemo(
    () => (selectedFolder === ALL ? allPhotos : allPhotos.filter((p) => p.folderId === selectedFolder)),
    [allPhotos, selectedFolder],
  );

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
    const targetName = folders.find((f) => f.id === targetFolderId)?.name ?? "folder";
    setNotice(`Moved to "${targetName}"`);
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

  const pendingFolderName = pendingDeleteFolder
    ? (folders.find((f) => f.id === pendingDeleteFolder)?.name ?? "this folder")
    : "";
  const currentFolderLabel =
    selectedFolder === ALL ? "All photos" : (folders.find((f) => f.id === selectedFolder)?.name ?? "All photos");

  return (
    <>
      <ErrorBanner
        message={error ?? ""}
        onDismiss={() => {
          setError(null);
        }}
      />
      <div className="flex flex-col gap-4 md:flex-row md:gap-6">
        {/* Mobile: a hamburger reveals the folder menu as a drawer; on md+ the
            sidebar is a static column and these mobile-only pieces are hidden. */}
        <div className="flex items-center gap-3 md:hidden">
          <button
            type="button"
            onClick={() => {
              setSidebarOpen(true);
            }}
            aria-label="Open folder menu"
            aria-expanded={sidebarOpen}
            className="cursor-pointer rounded-lg border border-white/10 bg-white/5 p-2 text-white transition-colors hover:bg-white/10"
          >
            <Menu className="size-5" />
          </button>
          <span className="truncate text-sm font-medium text-white">{currentFolderLabel}</span>
        </div>

        {sidebarOpen && (
          <div
            className="fixed inset-0 z-30 bg-black/60 md:hidden"
            onClick={() => {
              setSidebarOpen(false);
            }}
            aria-hidden="true"
          />
        )}

        <div
          className={`fixed inset-y-0 left-0 z-40 w-64 overflow-y-auto bg-[#0f1117] p-4 transition-transform duration-200 md:static md:z-auto md:w-auto md:shrink-0 md:overflow-visible md:bg-transparent md:p-0 md:transition-none ${
            sidebarOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"
          }`}
        >
          <div className="mb-2 flex justify-end md:hidden">
            <button
              type="button"
              onClick={() => {
                setSidebarOpen(false);
              }}
              aria-label="Close folder menu"
              className="cursor-pointer rounded p-1 text-white/50 transition-colors hover:text-white"
            >
              <X className="size-5" />
            </button>
          </div>
          <FolderSidebar
            folders={folders}
            selected={selectedFolder}
            onSelect={selectFolder}
            onFolderCreated={onFolderCreated}
            onFolderRenamed={onFolderRenamed}
            onRequestDelete={setPendingDeleteFolder}
            onError={setError}
          />
        </div>

        <div className="min-w-0 flex-1">
          <PhotoGrid
            photos={photos}
            folders={folders}
            onSelect={setSelectedPhoto}
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

      <PhotoDetailModal
        photo={selectedPhoto}
        onClose={() => {
          setSelectedPhoto(null);
        }}
      />

      <SuccessToast message={notice ?? ""} onDismiss={dismissNotice} />
    </>
  );
}
