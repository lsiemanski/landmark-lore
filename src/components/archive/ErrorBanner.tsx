interface Props {
  message: string;
  onDismiss: () => void;
}

export function ErrorBanner({ message, onDismiss }: Props) {
  if (!message) return null;

  return (
    <div
      role="alert"
      className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2 text-sm text-red-200"
    >
      <span>{message}</span>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss error"
        className="cursor-pointer rounded px-1 text-red-200/60 transition-colors hover:text-red-200"
      >
        ✕
      </button>
    </div>
  );
}
