import type { FolderWithCount } from "@/lib/archive/folders";
import type { PhotoCardData } from "@/lib/archive/photos";
import { PhotoCard } from "./PhotoCard";

interface Props {
  photos: PhotoCardData[];
  folders: FolderWithCount[];
  onSelect: (photo: PhotoCardData) => void;
  onMoved: (photoId: string, targetFolderId: string) => void;
  onDeleted: (photoId: string) => void;
  onError: (message: string) => void;
}

export function PhotoGrid({ photos, folders, onSelect, onMoved, onDeleted, onError }: Props) {
  if (photos.length === 0) {
    return <p className="text-sm text-white/40">No photos yet — identify a landmark to get started.</p>;
  }

  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
      {photos.map((photo) => (
        <PhotoCard
          key={photo.id}
          photo={photo}
          folders={folders}
          onSelect={onSelect}
          onMoved={onMoved}
          onDeleted={onDeleted}
          onError={onError}
        />
      ))}
    </div>
  );
}
