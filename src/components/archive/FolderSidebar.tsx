import { useRef, useState } from "react";
import { Plus } from "lucide-react";
import type { FolderWithCount } from "@/lib/archive/folders";
import { DEFAULT_FOLDER_NAME } from "@/lib/archive/constants";
import { ALL, type SelectedFolder } from "./ArchiveView";

interface Props {
  folders: FolderWithCount[];
  selected: SelectedFolder;
  onSelect: (id: SelectedFolder) => void;
  onFolderCreated: (folder: FolderWithCount) => void;
  onError: (message: string) => void;
}

export function FolderSidebar({ folders, selected, onSelect, onFolderCreated, onError }: Props) {
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const committed = useRef(false);
  const totalCount = folders.reduce((sum, f) => sum + f.photoCount, 0);
  const sortedFolders = [...folders].sort((a, b) => {
    const aDefault = a.name === DEFAULT_FOLDER_NAME ? 1 : 0;
    const bDefault = b.name === DEFAULT_FOLDER_NAME ? 1 : 0;
    return aDefault - bDefault;
  });

  async function commitCreate() {
    if (committed.current) return;
    committed.current = true;
    setCreating(false);
    const trimmed = newName.trim();
    setNewName("");
    if (!trimmed) return;
    try {
      const res = await fetch("/api/archive/folders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });
      if (!res.ok) {
        onError("Couldn't create the folder. Please try again.");
        return;
      }
      const json = (await res.json()) as { id: string };
      onFolderCreated({ id: json.id, name: trimmed, photoCount: 0, createdAt: new Date().toISOString() });
    } catch {
      onError("Couldn't create the folder. Please try again.");
    }
  }

  return (
    <aside className="w-48 shrink-0">
      <ul className="space-y-1">
        <li>
          <button
            type="button"
            onClick={() => {
              onSelect(ALL);
            }}
            className={`flex w-full cursor-pointer items-center justify-between rounded-lg px-3 py-2 text-sm transition-colors ${
              selected === ALL ? "bg-white/20 text-white" : "text-white/70 hover:bg-white/10 hover:text-white"
            }`}
          >
            <span>All photos</span>
            <span className="rounded-full bg-white/10 px-2 py-0.5 text-xs">{totalCount}</span>
          </button>
        </li>
        {sortedFolders.map((folder) => (
          <li key={folder.id}>
            <button
              type="button"
              onClick={() => {
                onSelect(folder.id);
              }}
              className={`flex w-full cursor-pointer items-center justify-between rounded-lg px-3 py-2 text-sm transition-colors ${
                selected === folder.id ? "bg-white/20 text-white" : "text-white/70 hover:bg-white/10 hover:text-white"
              }`}
            >
              <span className="truncate">{folder.name}</span>
              <span className="ml-2 shrink-0 rounded-full bg-white/10 px-2 py-0.5 text-xs">{folder.photoCount}</span>
            </button>
          </li>
        ))}
      </ul>

      {creating && (
        <div className="mt-1 px-1 py-0.5">
          <input
            autoFocus
            value={newName}
            onChange={(e) => {
              setNewName(e.target.value);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                void commitCreate();
              }
              if (e.key === "Escape") {
                setCreating(false);
                setNewName("");
              }
            }}
            onBlur={() => {
              void commitCreate();
            }}
            placeholder="Folder name"
            className="w-full rounded bg-white/10 px-2 py-1 text-sm text-white placeholder-white/30 outline-none"
          />
        </div>
      )}

      <button
        type="button"
        onClick={() => {
          committed.current = false;
          setCreating(true);
        }}
        className="mt-2 flex w-full cursor-pointer items-center gap-1.5 rounded-lg px-3 py-2 text-sm text-white/40 transition-colors hover:bg-white/10 hover:text-white"
      >
        <Plus className="size-3.5" />
        New folder
      </button>
    </aside>
  );
}
