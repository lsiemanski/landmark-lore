import { IDENTIFY_CONFIG } from "@/lib/ai/config";
import { HttpError } from "@/lib/api/http";

const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function parseUploadRequest(request: Request): Promise<{ photo: File; requestId: string }> {
  const form = await request.formData();
  const photo = form.get("photo");
  if (!(photo instanceof File)) throw new HttpError(415, { error: "Unsupported media type" });
  if (!IDENTIFY_CONFIG.allowedTypes.includes(photo.type)) {
    throw new HttpError(415, { error: "Unsupported media type" });
  }
  if (photo.size > IDENTIFY_CONFIG.maxBytes) throw new HttpError(413, { error: "File too large" });

  const requestId = form.get("request_id");
  if (typeof requestId !== "string" || !UUID_V4_RE.test(requestId)) {
    throw new HttpError(400, { error: "Missing request_id" });
  }

  return { photo, requestId };
}

export async function encodeForAI(photo: File): Promise<string> {
  const buffer = await photo.arrayBuffer();
  return Buffer.from(buffer).toString("base64");
}

export async function hashPhoto(photo: File): Promise<string> {
  const buffer = await photo.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
