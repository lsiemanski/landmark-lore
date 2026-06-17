import { Sparkles } from "lucide-react";
import { ACCEPT_IMAGE_TYPES } from "@/lib/media-types";
import { Button } from "@/components/ui/button";

interface Props {
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  hasFile: boolean;
  onFileChange: (file: File | null) => void;
  onIdentify: () => void;
}

export default function IdleUploader({ fileInputRef, hasFile, onFileChange, onIdentify }: Props) {
  return (
    <div className="space-y-4">
      <label className="block">
        <span className="mb-2 block text-sm font-medium text-gray-300">Choose a photo</span>
        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPT_IMAGE_TYPES}
          onChange={(e) => {
            onFileChange(e.target.files?.[0] ?? null);
          }}
          className="block w-full cursor-pointer rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-sm text-white file:mr-3 file:rounded file:border-0 file:bg-white/20 file:px-3 file:py-1 file:text-sm file:text-white hover:file:bg-white/30"
        />
      </label>
      <Button
        type="button"
        disabled={!hasFile}
        onClick={onIdentify}
        className="w-full cursor-pointer rounded-lg bg-blue-600 px-4 py-2 font-semibold text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-40"
      >
        <Sparkles className="size-4" />
        Identify
      </Button>
    </div>
  );
}
