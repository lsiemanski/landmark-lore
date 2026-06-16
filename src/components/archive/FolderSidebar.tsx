import type { FolderWithCount } from "@/lib/archive/folders";
import { ALL, type SelectedFolder } from "./ArchiveView";

interface Props {
  folders: FolderWithCount[];
  selected: SelectedFolder;
  onSelect: (id: SelectedFolder) => void;
}

export function FolderSidebar({ folders, selected, onSelect }: Props) {
  const totalCount = folders.reduce((sum, f) => sum + f.photoCount, 0);

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
        {folders.map((folder) => (
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
    </aside>
  );
}
