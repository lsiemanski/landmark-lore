import { useRef, useState } from "react";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { DEFAULT_FOLDER_NAME } from "@/lib/archive/constants";
import { type FolderWithCount, sortFoldersDefaultLast } from "@/lib/archive/folders";
import { ALL, type SelectedFolder } from "./ArchiveView";

interface Props {
  folders: FolderWithCount[];
  selected: SelectedFolder;
  onSelect: (id: SelectedFolder) => void;
  onFolderCreated: (folder: FolderWithCount) => void;
  onFolderRenamed: (folderId: string, newName: string) => void;
  onRequestDelete: (folderId: string) => void;
  onError: (message: string) => void;
}

export function FolderSidebar({
  folders,
  selected,
  onSelect,
  onFolderCreated,
  onFolderRenamed,
  onRequestDelete,
  onError,
}: Props) {
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const committed = useRef(false);
  const [renaming, setRenaming] = useState(false);
  const [renameDraft, setRenameDraft] = useState("");
  const renameCommitted = useRef(false);
  const totalCount = folders.reduce((sum, f) => sum + f.photoCount, 0);
  const sortedFolders = sortFoldersDefaultLast(folders);

  const activeFolder = selected !== ALL ? (folders.find((f) => f.id === selected) ?? null) : null;
  const isProtected = activeFolder?.name === DEFAULT_FOLDER_NAME;
  const canDelete = (activeFolder?.photoCount ?? 0) === 0;

  function select(id: SelectedFolder) {
    setRenaming(false);
    onSelect(id);
  }

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

  function startRename() {
    if (!activeFolder) return;
    renameCommitted.current = false;
    setRenameDraft(activeFolder.name);
    setRenaming(true);
  }

  async function commitRename() {
    if (renameCommitted.current) return;
    renameCommitted.current = true;
    setRenaming(false);
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
      else onError("Couldn't rename the folder. Please try again.");
    } catch {
      onError("Couldn't rename the folder. Please try again.");
    }
  }

  return (
    <aside className="w-48 shrink-0">
      <ul className="space-y-1">
        <li>
          <button
            type="button"
            onClick={() => {
              select(ALL);
            }}
            className={`flex w-full cursor-pointer items-center justify-between rounded-lg px-3 py-2 text-sm transition-colors ${
              selected === ALL ? "bg-white/20 text-white" : "text-white/70 hover:bg-white/10 hover:text-white"
            }`}
          >
            <span>All photos</span>
            <span className="rounded-full bg-white/10 px-2 py-0.5 text-xs">{totalCount}</span>
          </button>
        </li>
        {sortedFolders.map((folder) =>
          renaming && folder.id === selected ? (
            <li key={folder.id} className="px-1 py-0.5">
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
                  if (e.key === "Escape") setRenaming(false);
                }}
                onBlur={() => {
                  void commitRename();
                }}
                aria-label={`Rename ${folder.name}`}
                className="w-full rounded bg-white/10 px-2 py-1 text-sm text-white outline-none"
              />
            </li>
          ) : (
            <li key={folder.id}>
              <button
                type="button"
                onClick={() => {
                  select(folder.id);
                }}
                className={`flex w-full cursor-pointer items-center justify-between rounded-lg px-3 py-2 text-sm transition-colors ${
                  selected === folder.id ? "bg-white/20 text-white" : "text-white/70 hover:bg-white/10 hover:text-white"
                }`}
              >
                <span className="truncate">{folder.name}</span>
                <span className="ml-2 shrink-0 rounded-full bg-white/10 px-2 py-0.5 text-xs">{folder.photoCount}</span>
              </button>
            </li>
          ),
        )}
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

      {activeFolder && !isProtected && !renaming && (
        <div className="mt-1 space-y-1 border-t border-white/10 pt-2">
          <button
            type="button"
            onClick={startRename}
            aria-label={`Rename ${activeFolder.name}`}
            className="flex w-full cursor-pointer items-center gap-1.5 rounded-lg px-3 py-2 text-sm text-white/40 transition-colors hover:bg-white/10 hover:text-white"
          >
            <Pencil className="size-3.5" />
            Rename folder
          </button>
          <button
            type="button"
            onClick={
              canDelete
                ? () => {
                    onRequestDelete(activeFolder.id);
                  }
                : undefined
            }
            aria-disabled={!canDelete}
            aria-label={`Delete ${activeFolder.name}`}
            className={`flex w-full items-center gap-1.5 rounded-lg px-3 py-2 text-sm transition-colors ${
              canDelete
                ? "cursor-pointer text-white/40 hover:bg-white/10 hover:text-red-400"
                : "cursor-not-allowed text-white/20"
            }`}
          >
            <Trash2 className="size-3.5" />
            Delete folder
          </button>
        </div>
      )}
    </aside>
  );
}
