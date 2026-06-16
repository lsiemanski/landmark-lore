import { useEffect, useRef, useState } from "react";
import { Sparkles } from "lucide-react";
import { downscale } from "@/lib/client/downscale";
import { ACCEPT_IMAGE_TYPES } from "@/lib/media-types";
import { Button } from "@/components/ui/button";
import { IdentificationResult } from "@/components/identify/IdentificationResult";
import PostIdentifyPanel from "@/components/identify/PostIdentifyPanel";
import type { IdentificationResult as IdentificationResultData } from "@/lib/ai/identification";
import { DEFAULT_FOLDER_NAME } from "@/lib/archive/folders";
import type { FolderWithCount } from "@/lib/archive/folders";

type FlowState =
  | { status: "idle" }
  | { status: "working"; previewUrl: string }
  | { status: "identified"; previewUrl: string; result: IdentificationResultData; photoId: string }
  | { status: "unrecognized"; previewUrl: string; result: IdentificationResultData }
  | { status: "saved"; subjectName: string; folderName: string }
  | { status: "error"; kind: "quota"; limit: number; used: number }
  | { status: "error"; kind: "general"; message: string };

export default function UploadFlow() {
  const [file, setFile] = useState<File | null>(null);
  const [flowState, setFlowState] = useState<FlowState>({ status: "idle" });
  const [folders, setFolders] = useState<FolderWithCount[] | null>(null);
  const [selectedFolderId, setSelectedFolderId] = useState("");
  const [saving, setSaving] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const inFlight = useRef(false);

  const previewUrl = "previewUrl" in flowState ? flowState.previewUrl : null;

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  useEffect(() => {
    if (flowState.status !== "identified") return;
    fetch("/api/archive/folders")
      .then((r) => r.json() as Promise<{ folders: FolderWithCount[] }>)
      .then(({ folders: f }) => {
        setFolders(f);
        setSelectedFolderId(f.find((x) => x.name === DEFAULT_FOLDER_NAME)?.id ?? f[0].id);
      })
      .catch(() => {
        setFolders(null);
      });
  }, [flowState.status]);

  function resetToIdle() {
    setFile(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
    setFlowState({ status: "idle" });
    setFolders(null);
    setSelectedFolderId("");
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
        result?: IdentificationResultData;
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

  async function handleSave() {
    if (flowState.status !== "identified" || saving) return;
    setSaving(true);
    const { photoId, result } = flowState;
    const uncatId = folders?.find((f) => f.name === DEFAULT_FOLDER_NAME)?.id;
    const folderName = folders?.find((f) => f.id === selectedFolderId)?.name ?? DEFAULT_FOLDER_NAME;
    try {
      if (selectedFolderId && selectedFolderId !== uncatId) {
        const res = await fetch(`/api/archive/photos/${photoId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ folderId: selectedFolderId }),
        });
        if (!res.ok) throw new Error("Move failed");
      }
      setFlowState({ status: "saved", subjectName: result.subjectName, folderName });
    } catch {
      setFlowState({ status: "saved", subjectName: result.subjectName, folderName: DEFAULT_FOLDER_NAME });
    } finally {
      setSaving(false);
    }
  }

  async function handleDiscard() {
    if (flowState.status !== "identified" || discarding) return;
    setDiscarding(true);
    try {
      const res = await fetch(`/api/archive/photos/${flowState.photoId}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Discard failed");
      resetToIdle();
    } catch {
      setFlowState({ status: "error", kind: "general", message: "Couldn't discard the photo. Please try again." });
    } finally {
      setDiscarding(false);
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
            accept={ACCEPT_IMAGE_TYPES}
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

  if (flowState.status === "identified" || flowState.status === "saved") {
    return (
      <PostIdentifyPanel
        flowState={flowState}
        folders={folders}
        selectedFolderId={selectedFolderId}
        saving={saving}
        discarding={discarding}
        onSave={handleSave}
        onDiscard={handleDiscard}
        onFolderChange={setSelectedFolderId}
        onReset={resetToIdle}
      />
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
        <IdentificationResult title="Couldn't identify this photo" description={flowState.result.description} />
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
