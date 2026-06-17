import { CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { IdentificationResult } from "@/components/identify/IdentificationResult";
import FolderPicker from "@/components/identify/FolderPicker";
import FollowUpChat from "@/components/identify/FollowUpChat";
import type { IdentificationResult as IdentificationResultData } from "@/lib/ai/identification";
import type { FolderWithCount } from "@/lib/archive/folders";

interface IdentifiedState {
  status: "identified";
  previewUrl: string;
  result: IdentificationResultData;
  photoId: string;
  imageBlob: Blob;
}
interface SavedState {
  status: "saved";
  subjectName: string;
  folderName: string;
}

interface Props {
  flowState: IdentifiedState | SavedState;
  folders: FolderWithCount[] | null;
  selectedFolderId: string;
  saving: boolean;
  discarding: boolean;
  onSave: () => void;
  onDiscard: () => void;
  onFolderChange: (id: string) => void;
  onReset: () => void;
  onDescriptionUpdate: (description: string) => void;
}

export default function PostIdentifyPanel({
  flowState,
  folders,
  selectedFolderId,
  saving,
  discarding,
  onSave,
  onDiscard,
  onFolderChange,
  onReset,
  onDescriptionUpdate,
}: Props) {
  if (flowState.status === "saved") {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-2 text-sm text-green-400">
          <CheckCircle2 className="size-4" />
          Saved in {flowState.folderName}
        </div>
        <div className="flex flex-col gap-3">
          <Button
            type="button"
            onClick={onReset}
            className="w-full cursor-pointer rounded-lg border border-white/20 bg-white/10 px-4 py-2 font-semibold text-white hover:bg-white/20"
          >
            Identify another
          </Button>
          <a
            href="/gallery"
            className="block w-full cursor-pointer rounded-lg border border-white/20 bg-white/10 px-4 py-2 text-center font-semibold text-white hover:bg-white/20"
          >
            View in gallery →
          </a>
        </div>
      </div>
    );
  }

  const busy = saving || discarding;
  return (
    <div className="space-y-6">
      <img
        src={flowState.previewUrl}
        alt={flowState.result.subjectName}
        className="mx-auto block w-full max-w-sm rounded-xl object-contain"
      />
      <IdentificationResult title={flowState.result.subjectName} description={flowState.result.description} />
      <FollowUpChat
        imageBlob={flowState.imageBlob}
        anchor={{ subjectName: flowState.result.subjectName, description: flowState.result.description }}
        photoId={flowState.photoId}
        onDescriptionUpdate={onDescriptionUpdate}
      />
      {folders && (
        <FolderPicker folders={folders} selectedFolderId={selectedFolderId} onChange={onFolderChange} disabled={busy} />
      )}
      <div className="flex flex-col gap-3">
        <Button
          type="button"
          disabled={busy}
          onClick={onSave}
          className="w-full cursor-pointer rounded-lg bg-blue-600 px-4 py-2 font-semibold text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Save to archive
        </Button>
        <Button
          type="button"
          disabled={busy}
          onClick={onDiscard}
          className="w-full cursor-pointer rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2 font-semibold text-red-400 hover:bg-red-500/20 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Discard
        </Button>
      </div>
    </div>
  );
}
