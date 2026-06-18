import { useEffect } from "react";
import { createPortal } from "react-dom";

interface Props {
  message: string;
  onDismiss: () => void;
}

export function SuccessToast({ message, onDismiss }: Props) {
  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(onDismiss, 3000);
    return () => {
      clearTimeout(timer);
    };
  }, [message, onDismiss]);

  if (!message) return null;

  return createPortal(
    <div
      role="status"
      className="fixed bottom-6 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-sm text-emerald-200 shadow-xl backdrop-blur"
    >
      <span>{message}</span>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss notification"
        className="cursor-pointer rounded px-1 text-emerald-200/60 transition-colors hover:text-emerald-200"
      >
        ✕
      </button>
    </div>,
    document.body,
  );
}
