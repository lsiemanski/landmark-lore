import { type FolderWithCount, sortFoldersDefaultLast } from "@/lib/archive/folders";

interface Props {
  folders: FolderWithCount[];
  selectedFolderId: string;
  onChange: (folderId: string) => void;
  disabled?: boolean;
}

export default function FolderPicker({ folders, selectedFolderId, onChange, disabled }: Props) {
  const sortedFolders = sortFoldersDefaultLast(folders);

  return (
    <div className="space-y-1">
      <label className="block text-sm font-medium text-gray-300">Save to folder</label>
      <select
        value={selectedFolderId}
        onChange={(e) => {
          onChange(e.target.value);
        }}
        disabled={disabled}
        className="w-full cursor-pointer rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-sm text-white disabled:cursor-not-allowed disabled:opacity-50"
      >
        {sortedFolders.map((f) => (
          <option key={f.id} value={f.id} className="bg-gray-900 text-white">
            {f.name}
          </option>
        ))}
      </select>
    </div>
  );
}
