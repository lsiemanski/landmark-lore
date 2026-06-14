import { useEffect, useRef, useState } from "react";
import { CheckCircle2, Sparkles } from "lucide-react";
import { downscale } from "@/lib/client/downscale";
import { Button } from "@/components/ui/button";
import type { IdentificationResult } from "@/lib/ai/identification";

type FlowState =
  | { status: "idle" }
  | { status: "working"; previewUrl: string }
  | { status: "identified"; previewUrl: string; result: IdentificationResult; photoId: string }
  | { status: "unrecognized"; previewUrl: string; result: IdentificationResult }
  | { status: "error"; kind: "quota"; limit: number; used: number }
  | { status: "error"; kind: "general"; message: string };

export default function UploadFlow() {
  const [file, setFile] = useState<File | null>(null);
  const [flowState, setFlowState] = useState<FlowState>({ status: "idle" });
  const fileInputRef = useRef<HTMLInputElement>(null);
  const inFlight = useRef(false);

  const previewUrl = "previewUrl" in flowState ? flowState.previewUrl : null;

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  function resetToIdle() {
    setFile(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
    setFlowState({ status: "idle" });
  }

  async function handleIdentify() {
    if (!file || inFlight.current) return;
    inFlight.current = true;

    try {
      const requestId = crypto.randomUUID();
      const downsized = await downscale(file);
      const url = URL.createObjectURL(downsized);
      setFlowState({ status: "working", previewUrl: url });

      const form = new FormData();
      form.append("photo", downsized, "photo.jpg");
      form.append("request_id", requestId);

      const res = await fetch("/api/identify", { method: "POST", body: form });
      const json = (await res.json()) as {
        result?: IdentificationResult;
        photoId?: string;
        error?: string;
        limit?: number;
        used?: number;
      };

      if (!res.ok) {
        if (res.status === 429) {
          setFlowState({ status: "error", kind: "quota", limit: json.limit ?? 0, used: json.used ?? 0 });
        } else {
          setFlowState({ status: "error", kind: "general", message: json.error ?? "Something went wrong" });
        }
        return;
      }

      if (json.photoId && json.result) {
        setFlowState({ status: "identified", previewUrl: url, result: json.result, photoId: json.photoId });
      } else if (json.result) {
        setFlowState({ status: "unrecognized", previewUrl: url, result: json.result });
      } else {
        setFlowState({ status: "error", kind: "general", message: "Unexpected response from server" });
      }
    } catch (err) {
      setFlowState({
        status: "error",
        kind: "general",
        message: err instanceof Error ? err.message : "Something went wrong",
      });
    } finally {
      inFlight.current = false;
    }
  }

  if (flowState.status === "idle") {
    return (
      <div className="space-y-4">
        <label className="block">
          <span className="mb-2 block text-sm font-medium text-gray-300">Choose a photo</span>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null);
            }}
            className="block w-full cursor-pointer rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-sm text-white file:mr-3 file:rounded file:border-0 file:bg-white/20 file:px-3 file:py-1 file:text-sm file:text-white hover:file:bg-white/30"
          />
        </label>
        <Button
          type="button"
          disabled={!file}
          onClick={() => {
            void handleIdentify();
          }}
          className="w-full cursor-pointer rounded-lg bg-blue-600 px-4 py-2 font-semibold text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Sparkles className="size-4" />
          Identify
        </Button>
      </div>
    );
  }

  if (flowState.status === "working") {
    return (
      <div className="flex items-center gap-3 text-sm text-blue-100/80">
        <span className="size-5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
        Identifying&hellip;
      </div>
    );
  }

  if (flowState.status === "identified") {
    return (
      <div className="space-y-6">
        <img
          src={flowState.previewUrl}
          alt={flowState.result.subjectName}
          className="mx-auto block w-full max-w-sm rounded-xl object-contain"
        />
        <div>
          <h2 className="text-xl font-bold text-white">{flowState.result.subjectName}</h2>
          <p className="mt-2 text-justify text-sm leading-relaxed text-blue-100/80">{flowState.result.description}</p>
        </div>
        <div className="flex items-center gap-2 text-sm text-green-400">
          <CheckCircle2 className="size-4" />
          Saved to your archive
        </div>
        <Button
          type="button"
          onClick={resetToIdle}
          className="w-full cursor-pointer rounded-lg border border-white/20 bg-white/10 px-4 py-2 font-semibold text-white hover:bg-white/20"
        >
          Identify another
        </Button>
      </div>
    );
  }

  if (flowState.status === "unrecognized") {
    return (
      <div className="space-y-6">
        <img
          src={flowState.previewUrl}
          alt="Unidentified photo"
          className="mx-auto block w-full max-w-sm rounded-xl object-contain"
        />
        <div>
          <h2 className="text-xl font-bold text-white">Couldn&apos;t identify this photo</h2>
          <p className="mt-2 text-justify text-sm leading-relaxed text-blue-100/80">{flowState.result.description}</p>
        </div>
        <Button
          type="button"
          onClick={resetToIdle}
          className="w-full cursor-pointer rounded-lg border border-white/20 bg-white/10 px-4 py-2 font-semibold text-white hover:bg-white/20"
        >
          Try another photo
        </Button>
      </div>
    );
  }

  // flowState.status === "error"
  if (flowState.kind === "quota") {
    return (
      <div className="space-y-4">
        <h2 className="text-xl font-bold text-white">Daily limit reached</h2>
        <p className="text-sm text-blue-100/80">
          You&apos;ve used {flowState.used} of {flowState.limit} identifications today. Come back tomorrow.
        </p>
        <Button
          type="button"
          onClick={resetToIdle}
          className="w-full cursor-pointer rounded-lg border border-white/20 bg-white/10 px-4 py-2 font-semibold text-white hover:bg-white/20"
        >
          Dismiss
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4">
        <p className="text-sm font-medium text-red-400">Something went wrong</p>
        <p className="mt-1 text-sm text-red-300">{flowState.message}</p>
      </div>
      <Button
        type="button"
        onClick={resetToIdle}
        className="w-full cursor-pointer rounded-lg border border-white/20 bg-white/10 px-4 py-2 font-semibold text-white hover:bg-white/20"
      >
        Try again
      </Button>
    </div>
  );
}
