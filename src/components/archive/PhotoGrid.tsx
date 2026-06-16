import type { FolderWithCount } from "@/lib/archive/folders";
import type { PhotoCardData } from "@/lib/archive/photos";
import { PhotoCard } from "./PhotoCard";

interface Props {
  photos: PhotoCardData[];
  folders: FolderWithCount[];
  onMoved: (photoId: string, targetFolderId: string) => void;
  onDeleted: (photoId: string) => void;
}

export function PhotoGrid({ photos, folders, onMoved, onDeleted }: Props) {
  if (photos.length === 0) {
    return <p className="text-sm text-white/40">No photos yet — identify a landmark to get started.</p>;
  }

  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
      {photos.map((photo) => (
        <PhotoCard key={photo.id} photo={photo} folders={folders} onMoved={onMoved} onDeleted={onDeleted} />
      ))}
    </div>
  );
}
