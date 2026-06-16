import { useState } from "react";
import type { FolderWithCount } from "@/lib/archive/folders";
import type { PhotoCardData } from "@/lib/archive/photos";

interface Props {
  photo: PhotoCardData;
  folders: FolderWithCount[];
  onMoved: (photoId: string, targetFolderId: string) => void;
  onDeleted: (photoId: string) => void;
}

export function PhotoCard({ photo, folders: _folders, onMoved: _onMoved, onDeleted: _onDeleted }: Props) {
  const [loaded, setLoaded] = useState(false);

  const date = new Date(photo.createdAt).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });

  return (
    <div className="group relative overflow-hidden rounded-xl border border-white/10 bg-white/5">
      <div className="relative aspect-square w-full">
        {!loaded && <div className="absolute inset-0 animate-pulse bg-white/10" />}
        <img
          src={photo.signedUrl}
          alt={photo.subjectName}
          onLoad={() => {
            setLoaded(true);
          }}
          className={`h-full w-full object-cover transition-opacity duration-300 ${loaded ? "opacity-100" : "opacity-0"}`}
        />
      </div>
      <div className="p-2">
        <p className="truncate text-sm font-medium text-white">{photo.subjectName}</p>
        <p className="text-xs text-white/40">{date}</p>
      </div>
    </div>
  );
}
