import { useState } from "react";
import { Button } from "@/components/ui/button";

interface CompletedTurn {
  status: "done";
  question: string;
  answer: string;
}

interface PendingTurn {
  status: "pending";
  question: string;
}

interface FailedTurn {
  status: "failed";
  question: string;
}

type Turn = CompletedTurn | PendingTurn | FailedTurn;

interface HistoryEntry {
  question: string;
  answer: string;
}

interface LimitState {
  limit: number;
  used: number;
}

interface Props {
  imageBlob: Blob;
  anchor: { subjectName: string; description: string } | null;
  photoId?: string;
  onDescriptionUpdate?: (description: string) => void;
}

export default function FollowUpChat({ imageBlob, anchor, photoId, onDescriptionUpdate }: Props) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [limitReached, setLimitReached] = useState<LimitState | null>(null);

  const isPending = turns.some((t) => t.status === "pending");

  async function doSend(question: string, turnIndex: number, history: HistoryEntry[]) {
    try {
      const form = new FormData();
      form.append("photo", imageBlob, "photo.jpg");
      form.append("payload", JSON.stringify({ anchor, photoId, history, question }));

      const res = await fetch("/api/follow-up", { method: "POST", body: form });
      const json = (await res.json()) as {
        answer?: string;
        description?: string;
        error?: string;
        limit?: number;
        used?: number;
      };

      if (!res.ok) {
        if (res.status === 429) {
          setLimitReached({ limit: json.limit ?? 0, used: json.used ?? 0 });
          setTurns((prev) => prev.filter((_, i) => i !== turnIndex));
        } else {
          setTurns((prev) => prev.map((t, i): Turn => (i === turnIndex ? { status: "failed", question } : t)));
        }
        return;
      }

      setTurns((prev) =>
        prev.map((t, i): Turn => (i === turnIndex ? { status: "done", question, answer: json.answer ?? "" } : t)),
      );
      if (json.description && onDescriptionUpdate) {
        onDescriptionUpdate(json.description);
      }
    } catch {
      setTurns((prev) => prev.map((t, i): Turn => (i === turnIndex ? { status: "failed", question } : t)));
    }
  }

  function handleSubmit(e: React.SyntheticEvent) {
    e.preventDefault();
    const question = inputValue.trim();
    if (!question || isPending || limitReached) return;

    const history = turns
      .filter((t): t is CompletedTurn => t.status === "done")
      .map((t) => ({ question: t.question, answer: t.answer }));

    const turnIndex = turns.length;
    setTurns((prev) => [...prev, { status: "pending", question }]);
    setInputValue("");
    void doSend(question, turnIndex, history);
  }

  function handleRetry(index: number) {
    const turn = turns[index];
    if (turn.status !== "failed" || isPending) return;
    const { question } = turn;

    const history = turns
      .slice(0, index)
      .filter((t): t is CompletedTurn => t.status === "done")
      .map((t) => ({ question: t.question, answer: t.answer }));

    setTurns((prev) => prev.map((t, i): Turn => (i === index ? { status: "pending", question: t.question } : t)));
    void doSend(question, index, history);
  }

  return (
    <div className="space-y-4 border-t border-white/10 pt-4">
      <h3 className="text-sm font-semibold text-blue-100/60">Ask a follow-up</h3>

      {turns.length > 0 && (
        <div className="space-y-4">
          {turns.map((turn, i) => (
            <div key={i} className="space-y-1">
              <p className="text-sm font-medium text-white">{turn.question}</p>
              {turn.status === "pending" && (
                <div className="flex items-center gap-2 text-sm text-blue-100/60">
                  <span className="size-4 animate-spin rounded-full border-2 border-white/20 border-t-white" />
                  Thinking&hellip;
                </div>
              )}
              {turn.status === "done" && (
                <p className="text-justify text-sm leading-relaxed text-blue-100/80">{turn.answer}</p>
              )}
              {turn.status === "failed" && (
                <div className="flex items-center gap-3">
                  <p className="text-sm text-red-400">Something went wrong.</p>
                  <Button
                    type="button"
                    onClick={() => {
                      handleRetry(i);
                    }}
                    className="cursor-pointer rounded border border-white/20 bg-white/10 px-3 py-1 text-xs text-white hover:bg-white/20"
                  >
                    Retry
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {limitReached ? (
        <div className="rounded-xl border border-yellow-500/30 bg-yellow-500/10 p-4">
          <p className="text-sm font-medium text-yellow-300">Daily follow-up limit reached</p>
          <p className="mt-1 text-justify text-sm text-yellow-200/80">
            You&apos;ve used {limitReached.used} of {limitReached.limit} follow-ups today. Come back tomorrow.
          </p>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="flex gap-2">
          <input
            type="text"
            value={inputValue}
            onChange={(e) => {
              setInputValue(e.target.value);
            }}
            disabled={isPending}
            placeholder="Ask a question&hellip;"
            aria-label="Follow-up question"
            className="flex-1 rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-sm text-white placeholder-white/40 ring-1 focus:ring-blue-500 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
          />
          <Button
            type="submit"
            disabled={!inputValue.trim() || isPending}
            className="cursor-pointer rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Ask
          </Button>
        </form>
      )}
    </div>
  );
}
