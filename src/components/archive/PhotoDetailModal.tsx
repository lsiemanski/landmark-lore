import { createPortal } from "react-dom";
import { X } from "lucide-react";
import type { PhotoCardData } from "@/lib/archive/photos";
import { IdentificationResult } from "@/components/identify/IdentificationResult";
import { useDialogFocus } from "./useDialogFocus";

interface Props {
  photo: PhotoCardData | null;
  onClose: () => void;
}

export function PhotoDetailModal({ photo, onClose }: Props) {
  const panelRef = useDialogFocus(photo !== null, onClose);

  if (!photo) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="detail-modal-title"
        className="relative max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-white/10 bg-[#0f1117] p-6 shadow-2xl"
      >
        <div className="mb-4 flex items-center justify-end">
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="cursor-pointer rounded p-1 text-white/40 transition-colors hover:text-white"
          >
            <X className="size-5" />
          </button>
        </div>
        <img
          src={photo.signedUrl}
          alt={photo.subjectName}
          className="mb-4 max-h-[60vh] w-full rounded-xl object-contain"
        />
        <IdentificationResult title={photo.subjectName} description={photo.description} titleId="detail-modal-title" />
      </div>
    </div>,
    document.body,
  );
}
