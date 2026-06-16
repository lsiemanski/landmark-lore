import { useState, useMemo } from "react";
import type { FolderWithCount } from "@/lib/archive/folders";
import type { PhotoCardData } from "@/lib/archive/photos";
import { FolderSidebar } from "./FolderSidebar";
import { PhotoGrid } from "./PhotoGrid";

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

  return (
    <div className="flex gap-6">
      <FolderSidebar folders={folders} selected={selectedFolder} onSelect={setSelectedFolder} />
      <div className="flex-1">
        <PhotoGrid photos={photos} folders={folders} onMoved={onPhotoMoved} onDeleted={onPhotoDeleted} />
      </div>
    </div>
  );
}
