import { IDENTIFY_CONFIG } from "@/lib/ai/config";
import { HttpError } from "@/lib/api/http";

const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Validate the photo (and optional thumbnail) on an already-parsed multipart
 * form. Shared by the identify route (photo only) and the save route (photo +
 * thumbnail), so a form is only read once by the caller.
 */
export function validatePhotoFields(form: FormData): { photo: File; thumbnail: File | null } {
  const photo = form.get("photo");
  if (!(photo instanceof File)) throw new HttpError(415, { error: "Unsupported media type" });
  if (!IDENTIFY_CONFIG.allowedTypes.includes(photo.type)) {
    throw new HttpError(415, { error: "Unsupported media type" });
  }
  if (photo.size > IDENTIFY_CONFIG.maxBytes) throw new HttpError(413, { error: "File too large" });

  // Client-generated gallery thumbnail (optional — old/foreign clients may omit it).
  const thumbnailField = form.get("thumbnail");
  const thumbnail =
    thumbnailField instanceof File && thumbnailField.size <= IDENTIFY_CONFIG.maxBytes ? thumbnailField : null;

  return { photo, thumbnail };
}

/** Identify only needs the image itself — nothing is persisted at this stage. */
export async function parseUploadRequest(request: Request): Promise<{ photo: File }> {
  const form = await request.formData();
  const { photo } = validatePhotoFields(form);
  return { photo };
}

export function isValidRequestId(value: unknown): value is string {
  return typeof value === "string" && UUID_V4_RE.test(value);
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
