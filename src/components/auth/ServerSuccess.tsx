import { CircleCheck } from "lucide-react";

interface ServerSuccessProps {
  message: string;
}

export function ServerSuccess({ message }: ServerSuccessProps) {
  return (
    <p className="flex items-center gap-2 rounded-lg border border-green-500/30 bg-green-900/30 px-3 py-2 text-sm text-green-300">
      <CircleCheck className="size-4 shrink-0" />
      {message}
    </p>
  );
}
