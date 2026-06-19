import { useState, useRef, useEffect } from "react";
import { MoreVertical } from "lucide-react";
import type { FolderWithCount } from "@/lib/archive/folders";
import type { PhotoCardData } from "@/lib/archive/photos";

interface Props {
  photo: PhotoCardData;
  folders: FolderWithCount[];
  onSelect: (photo: PhotoCardData) => void;
  onMoved: (photoId: string, targetFolderId: string) => void;
  onDeleted: (photoId: string) => void;
  onError: (message: string) => void;
}

export function PhotoCard({ photo, folders, onSelect, onMoved, onDeleted, onError }: Props) {
  const [loaded, setLoaded] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const date = new Date(photo.createdAt).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });

  useEffect(() => {
    if (!menuOpen) return;
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    function handleEscape(e: KeyboardEvent) {
      if (e.key === "Escape") setMenuOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [menuOpen]);

  const otherFolders = folders.filter((f) => f.id !== photo.folderId);

  async function moveToFolder(targetFolderId: string) {
    setMenuOpen(false);
    try {
      const res = await fetch(`/api/archive/photos/${photo.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ folderId: targetFolderId }),
      });
      if (res.ok) onMoved(photo.id, targetFolderId);
      else onError("Couldn't move the photo. Please try again.");
    } catch {
      onError("Couldn't move the photo. Please try again.");
    }
  }

  return (
    <div className="group relative rounded-xl border border-white/10 bg-white/5">
      <div className="relative aspect-square w-full overflow-hidden rounded-t-xl">
        {!loaded && <div className="absolute inset-0 animate-pulse bg-white/10" />}
        <button
          type="button"
          onClick={() => {
            onSelect(photo);
          }}
          aria-label={`View details for ${photo.subjectName}`}
          className="h-full w-full cursor-pointer"
        >
          <img
            src={photo.thumbnailUrl}
            alt={photo.subjectName}
            onLoad={() => {
              setLoaded(true);
            }}
            className={`h-full w-full object-cover transition-opacity duration-300 ${loaded ? "opacity-100" : "opacity-0"}`}
          />
        </button>
      </div>
      <div className="flex items-start justify-between p-2">
        <div className="min-w-0">
          <p className="text-sm font-medium break-words text-white">{photo.subjectName}</p>
          <p className="hidden text-xs text-white/40 sm:block">{date}</p>
        </div>
        <div ref={menuRef} className="relative ml-1 shrink-0">
          <button
            type="button"
            onClick={() => {
              setMenuOpen((v) => !v);
            }}
            aria-label="Photo actions"
            className="cursor-pointer rounded p-0.5 text-white/0 transition-colors group-hover:text-white/50 hover:text-white focus:text-white/50"
          >
            <MoreVertical className="size-4" />
          </button>
          {menuOpen && (
            <div className="absolute top-6 right-0 z-10 min-w-[140px] rounded-xl border border-white/10 bg-[#0f1117] py-1 shadow-xl">
              {otherFolders.length > 0 && (
                <>
                  <p className="px-3 py-1 text-xs text-white/30">Move to</p>
                  {otherFolders.map((folder) => (
                    <button
                      key={folder.id}
                      type="button"
                      onClick={() => {
                        void moveToFolder(folder.id);
                      }}
                      className="flex w-full cursor-pointer items-center px-3 py-1.5 text-sm text-white/70 transition-colors hover:bg-white/10 hover:text-white"
                    >
                      {folder.name}
                    </button>
                  ))}
                  <div className="my-1 border-t border-white/10" />
                </>
              )}
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  onDeleted(photo.id);
                }}
                className="flex w-full cursor-pointer items-center px-3 py-1.5 text-sm text-red-400/70 transition-colors hover:bg-white/10 hover:text-red-400"
              >
                Delete
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
