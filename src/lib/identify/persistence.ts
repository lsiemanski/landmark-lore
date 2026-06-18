import { type SupabaseClient } from "@/lib/supabase";
import type { IdentificationResult } from "@/lib/ai/identification";
import { HttpError } from "@/lib/api/http";
import { PHOTOS_BUCKET } from "@/lib/identify/storage";
import { DEFAULT_FOLDER_NAME, PHOTO_STATUS_IDENTIFIED } from "@/lib/archive/constants";

const MIME_TO_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

/** Everything the handler has assembled to persist one recognised photo. */
export interface PhotoUploadCommand {
  photoId: string;
  requestId: string;
  photo: File;
  /** Gallery thumbnail, or null when the client didn't supply one. */
  thumbnail: File | null;
  folderId: string;
  photoHash: string;
}

export async function lookupDefaultFolder(supabase: SupabaseClient, userId: string): Promise<string> {
  const { data, error } = await supabase
    .from("folders")
    .select("id")
    .eq("user_id", userId)
    .eq("name", DEFAULT_FOLDER_NAME)
    .limit(1)
    .maybeSingle();

  if (error || !data) throw new HttpError(500, { error: "Default folder not found" });
  return data.id;
}

async function uploadPhotoToStorage(
  supabase: SupabaseClient,
  userId: string,
  photoId: string,
  photo: File,
): Promise<string> {
  const ext = MIME_TO_EXT[photo.type] ?? "jpg";
  const storagePath = `${userId}/${photoId}.${ext}`;
  const arrayBuffer = await photo.arrayBuffer();
  const { error } = await supabase.storage
    .from(PHOTOS_BUCKET)
    .upload(storagePath, arrayBuffer, { contentType: photo.type });
  if (error) throw new HttpError(502, { error: "Storage upload failed" });
  return storagePath;
}

/** Upload the (always-JPEG) gallery thumbnail to a sibling path. */
async function uploadThumbnailToStorage(
  supabase: SupabaseClient,
  userId: string,
  photoId: string,
  thumbnail: File,
): Promise<string> {
  const storagePath = `${userId}/${photoId}_thumb.jpg`;
  const arrayBuffer = await thumbnail.arrayBuffer();
  const { error } = await supabase.storage
    .from(PHOTOS_BUCKET)
    .upload(storagePath, arrayBuffer, { contentType: "image/jpeg" });
  if (error) throw new HttpError(502, { error: "Thumbnail upload failed" });
  return storagePath;
}

export async function persistPhotoAndIdentification(
  supabase: SupabaseClient,
  user: { id: string },
  upload: PhotoUploadCommand,
  result: IdentificationResult,
): Promise<void> {
  // Storage upload that succeeds before a DB failure leaves an orphan object — accepted MVP risk.
  const storagePath = await uploadPhotoToStorage(supabase, user.id, upload.photoId, upload.photo);
  // A thumbnail is a cosmetic grid asset the gallery can live without (nullable column +
  // full-image fallback), so a thumbnail-upload failure must not sink the whole request.
  let thumbnailPath: string | null = null;
  if (upload.thumbnail) {
    try {
      thumbnailPath = await uploadThumbnailToStorage(supabase, user.id, upload.photoId, upload.thumbnail);
    } catch {
      console.error(`Thumbnail upload failed for photo ${upload.photoId}; storing without thumbnail.`);
    }
  }

  const { error: photoError } = await supabase.from("photos").insert({
    id: upload.photoId,
    user_id: user.id,
    folder_id: upload.folderId,
    storage_path: storagePath,
    thumbnail_path: thumbnailPath,
    mime_type: upload.photo.type,
    original_filename: upload.photo.name,
    file_size: upload.photo.size,
    photo_hash: upload.photoHash,
    request_id: upload.requestId,
    status: PHOTO_STATUS_IDENTIFIED,
  });
  if (photoError) throw new HttpError(500, { error: "Failed to save photo" });

  const { error: idError } = await supabase.from("identifications").insert({
    photo_id: upload.photoId,
    subject_name: result.subjectName,
    description: result.description,
  });
  if (idError) throw new HttpError(500, { error: "Failed to save identification" });
}
