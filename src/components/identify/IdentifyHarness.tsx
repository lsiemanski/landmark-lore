import { useEffect, useState, type ChangeEvent } from "react";
import { Sparkles } from "lucide-react";
import { downscale } from "@/lib/client/downscale";
import { ACCEPT_IMAGE_TYPES } from "@/lib/media-types";
import { Button } from "@/components/ui/button";

interface IdentifyResult {
  recognised: boolean;
  subjectName: string;
  description: string;
}

interface Preview {
  url: string;
  sizeKb: number;
}

/**
 * Development harness for the /api/identify flow.
 *
 * NOTE — deliberately kept as ONE component for the harness; do NOT over-split it here.
 * But when S-01 builds the real identify UI, the return below MUST be broken into smaller,
 * reusable pieces rather than copied wholesale. Split by reuse/domain boundary, not line
 * count (see context/foundation/lessons.md → "Build dev harnesses to production conventions").
 * Candidates, by reuse value:
 *   - <IdentificationResult result={...} />  — the recognised/subjectName/description panel is
 *     the core domain output S-01 will render. Extract this FIRST.
 *   - <DownsizedPreview ... />               — image + dimensions readout (if prod shows a preview).
 *   - error display                          — reuse the existing src/components/auth/ServerError,
 *     do not reinvent it.
 */
export default function IdentifyHarness() {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [dims, setDims] = useState("");
  const [result, setResult] = useState<IdentifyResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Revoke the object URL when it is replaced or the component unmounts.
  useEffect(() => {
    return () => {
      if (preview) URL.revokeObjectURL(preview.url);
    };
  }, [preview]);

  function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    setFile(e.target.files?.[0] ?? null);
    setResult(null);
    setError(null);
  }

  // In-flight guard: `busy` disables the button so the non-idempotent route can't be
  // double-submitted, and there is no auto-retry — the user re-initiates on failure.
  async function identify() {
    if (!file) return;
    setBusy(true);
    setResult(null);
    setError(null);

    try {
      const downsized = await downscale(file);
      setPreview({ url: URL.createObjectURL(downsized), sizeKb: Math.round(downsized.size / 1024) });

      const form = new FormData();
      form.append("photo", downsized, "photo.jpg");

      const res = await fetch("/api/identify", { method: "POST", body: form });
      const json = (await res.json()) as { result?: IdentifyResult; error?: string };

      if (!res.ok) {
        setError(`${res.status}: ${json.error ?? "Unknown error"}`);
        return;
      }
      setResult(json.result ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="space-y-4 rounded-xl border border-white/10 bg-white/5 p-6">
        <label className="block">
          <span className="mb-2 block text-sm font-medium text-gray-300">Photo</span>
          <input
            type="file"
            accept={ACCEPT_IMAGE_TYPES}
            onChange={handleFileChange}
            className="block w-full cursor-pointer rounded-lg border border-white/20 bg-white/10 px-3 py-2 text-sm text-white file:mr-3 file:rounded file:border-0 file:bg-white/20 file:px-3 file:py-1 file:text-sm file:text-white hover:file:bg-white/30"
          />
        </label>

        <Button
          type="button"
          disabled={!file || busy}
          onClick={() => void identify()}
          className="w-full rounded-lg bg-blue-600 px-4 py-2 font-semibold text-white transition-colors hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy ? (
            <span className="flex items-center gap-2">
              <span className="size-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
              Identifying…
            </span>
          ) : (
            <span className="flex items-center gap-2">
              <Sparkles className="size-4" />
              Identify
            </span>
          )}
        </Button>
      </div>

      {preview && (
        <div className="space-y-3 rounded-xl border border-white/10 bg-white/5 p-6">
          <h2 className="text-sm font-semibold tracking-wide text-gray-400 uppercase">Downsized Preview</h2>
          <img
            src={preview.url}
            alt="Downsized preview"
            className="max-w-full rounded-lg"
            onLoad={(e) => {
              const img = e.currentTarget;
              setDims(`${img.naturalWidth} × ${img.naturalHeight} px · ${preview.sizeKb} KB`);
            }}
          />
          <p className="text-xs text-gray-400">{dims}</p>
        </div>
      )}

      {result && (
        <div className="space-y-3 rounded-xl border border-white/10 bg-white/5 p-6">
          <h2 className="text-sm font-semibold tracking-wide text-gray-400 uppercase">Result</h2>
          <dl className="space-y-3">
            <div>
              <dt className="text-xs font-medium tracking-wide text-gray-500 uppercase">Recognised</dt>
              <dd className={`mt-1 text-sm font-semibold ${result.recognised ? "text-green-400" : "text-yellow-400"}`}>
                {result.recognised ? "Yes" : "No"}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium tracking-wide text-gray-500 uppercase">Subject</dt>
              <dd className="mt-1 text-sm font-medium">{result.subjectName}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium tracking-wide text-gray-500 uppercase">Description</dt>
              <dd className="mt-1 text-sm leading-relaxed text-gray-300">{result.description}</dd>
            </div>
          </dl>
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4">
          <p className="text-sm font-medium text-red-400">Error</p>
          <p className="mt-1 text-sm text-red-300">{error}</p>
        </div>
      )}
    </div>
  );
}
