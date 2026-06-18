import { useEffect, useRef, useState } from "react";
import { downscaleWithThumbnail } from "@/lib/client/downscale";
import { Button } from "@/components/ui/button";
import IdleUploader from "@/components/identify/IdleUploader";
import PostIdentifyPanel from "@/components/identify/PostIdentifyPanel";
import UnrecognizedPanel from "@/components/identify/UnrecognizedPanel";
import type { IdentificationResult as IdentificationResultData } from "@/lib/ai/identification";
import { DEFAULT_FOLDER_NAME } from "@/lib/archive/constants";
import type { FolderWithCount } from "@/lib/archive/folders";

type FlowState =
  | { status: "idle" }
  | { status: "working"; previewUrl: string }
  | {
      status: "identified";
      previewUrl: string;
      result: IdentificationResultData;
      imageBlob: Blob;
      thumbnailBlob: Blob;
      requestId: string;
    }
  | { status: "unrecognized"; previewUrl: string; result: IdentificationResultData; imageBlob: Blob }
  | { status: "saved"; subjectName: string; folderName: string }
  | { status: "error"; kind: "quota"; limit: number; used: number }
  | { status: "error"; kind: "general"; message: string };

export default function UploadFlow() {
  const [file, setFile] = useState<File | null>(null);
  const [flowState, setFlowState] = useState<FlowState>({ status: "idle" });
  const [folders, setFolders] = useState<FolderWithCount[] | null>(null);
  const [selectedFolderId, setSelectedFolderId] = useState("");
  const [saving, setSaving] = useState(false);
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
    fetch("/api/archive/folders", { cache: "no-store" })
      .then((r) => r.json() as Promise<{ folders: FolderWithCount[] }>)
      .then(({ folders: f }) => {
        setFolders(f);
        setSelectedFolderId(f.find((x) => x.name === DEFAULT_FOLDER_NAME)?.id ?? (f.length > 0 ? f[0].id : ""));
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
      const { image: downsized, thumbnail } = await downscaleWithThumbnail(file);
      const url = URL.createObjectURL(downsized);
      setFlowState({ status: "working", previewUrl: url });
      const form = new FormData();
      form.append("photo", downsized, "photo.jpg");
      const res = await fetch("/api/identify", { method: "POST", body: form });
      const json = (await res.json()) as {
        result?: IdentificationResultData;
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
      if (json.result?.recognised) {
        setFlowState({
          status: "identified",
          previewUrl: url,
          result: json.result,
          imageBlob: downsized,
          thumbnailBlob: thumbnail,
          requestId,
        });
      } else if (json.result) {
        setFlowState({
          status: "unrecognized",
          previewUrl: url,
          result: json.result,
          imageBlob: downsized,
        });
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
    const { result, imageBlob, thumbnailBlob, requestId } = flowState;
    const folderName = folders?.find((f) => f.id === selectedFolderId)?.name ?? DEFAULT_FOLDER_NAME;
    try {
      // Persistence happens here, not at identify time: the photo enters the
      // archive only on an explicit Save, carrying any follow-up enrichments.
      const form = new FormData();
      form.append("photo", imageBlob, "photo.jpg");
      form.append("thumbnail", thumbnailBlob, "thumbnail.jpg");
      form.append(
        "payload",
        JSON.stringify({
          subjectName: result.subjectName,
          description: result.description,
          folderId: selectedFolderId || undefined,
          requestId,
        }),
      );
      const res = await fetch("/api/archive/photos", { method: "POST", body: form });
      if (!res.ok) throw new Error("Save failed");
      setFlowState({ status: "saved", subjectName: result.subjectName, folderName });
    } catch {
      setFlowState({ status: "error", kind: "general", message: "Couldn't save the photo. Please try again." });
    } finally {
      setSaving(false);
    }
  }

  // Nothing is persisted before Save, so discarding is purely client-side.
  function handleDiscard() {
    if (flowState.status !== "identified") return;
    resetToIdle();
  }

  function handleDescriptionUpdate(description: string) {
    setFlowState((prev) =>
      prev.status === "identified" ? { ...prev, result: { ...prev.result, description } } : prev,
    );
  }

  function handleSubjectNameUpdate(subjectName: string) {
    setFlowState((prev) =>
      prev.status === "identified" ? { ...prev, result: { ...prev.result, subjectName } } : prev,
    );
  }

  if (flowState.status === "idle") {
    return (
      <IdleUploader
        fileInputRef={fileInputRef}
        hasFile={!!file}
        onFileChange={setFile}
        onIdentify={() => {
          void handleIdentify();
        }}
      />
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
        onSave={handleSave}
        onDiscard={handleDiscard}
        onFolderChange={setSelectedFolderId}
        onReset={resetToIdle}
        onDescriptionUpdate={handleDescriptionUpdate}
        onSubjectNameUpdate={handleSubjectNameUpdate}
      />
    );
  }

  if (flowState.status === "unrecognized") {
    return (
      <UnrecognizedPanel
        previewUrl={flowState.previewUrl}
        result={flowState.result}
        imageBlob={flowState.imageBlob}
        onReset={resetToIdle}
      />
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
