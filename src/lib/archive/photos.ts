import type { SupabaseClient } from "@/lib/supabase";
import { HttpError } from "@/lib/api/http";
import { PHOTOS_BUCKET } from "@/lib/identify/storage";
import { PHOTO_STATUS_IDENTIFIED } from "@/lib/archive/constants";

export interface PhotoCardData {
  id: string;
  /** Full-resolution image, used by the detail modal. */
  signedUrl: string;
  /** Small gallery-grid thumbnail; falls back to the full image for pre-thumbnail rows. */
  thumbnailUrl: string;
  subjectName: string;
  description: string;
  folderId: string;
  createdAt: string;
}

export async function listPhotos(
  supabase: SupabaseClient,
  params: { userId: string; folderId?: string },
): Promise<PhotoCardData[]> {
  let query = supabase
    .from("photos")
    .select("id, folder_id, storage_path, thumbnail_path, created_at, identifications(subject_name, description)")
    .eq("user_id", params.userId)
    .eq("status", PHOTO_STATUS_IDENTIFIED)
    .order("created_at", { ascending: false });

  if (params.folderId) {
    query = query.eq("folder_id", params.folderId);
  }

  const { data, error } = await query;
  if (error) throw new HttpError(500, { error: "Failed to list photos" });
  if (data.length === 0) return [];

  // Sign the full image (for the detail modal) and the thumbnail (for the grid).
  // Pre-thumbnail rows fall back to the full image so the grid still renders.
  const fullPaths = data.map((row) => row.storage_path);
  const thumbPaths = data.map((row) => row.thumbnail_path ?? row.storage_path);

  const [fullRes, thumbRes] = await Promise.all([
    supabase.storage.from(PHOTOS_BUCKET).createSignedUrls(fullPaths, 3600),
    supabase.storage.from(PHOTOS_BUCKET).createSignedUrls(thumbPaths, 3600),
  ]);

  if (fullRes.error || thumbRes.error) throw new HttpError(500, { error: "Failed to generate signed URLs" });

  return data.map((row, i) => ({
    id: row.id,
    signedUrl: fullRes.data[i]?.signedUrl ?? "",
    thumbnailUrl: thumbRes.data[i]?.signedUrl ?? "",
    subjectName: row.identifications?.subject_name ?? "",
    description: row.identifications?.description ?? "",
    folderId: row.folder_id,
    createdAt: row.created_at,
  }));
}

export async function movePhoto(
  supabase: SupabaseClient,
  params: { userId: string; photoId: string; targetFolderId: string },
): Promise<void> {
  const { count, error } = await supabase
    .from("photos")
    .update({ folder_id: params.targetFolderId }, { count: "exact" })
    .eq("id", params.photoId)
    .eq("user_id", params.userId);

  if (error) throw new HttpError(500, { error: "Failed to move photo" });
  if (!count) throw new HttpError(404, { error: "Photo not found" });
}

export async function deletePhotoRecord(
  supabase: SupabaseClient,
  params: { userId: string; photoId: string },
): Promise<{ storagePath: string; thumbnailPath: string | null }> {
  const { data, error } = await supabase
    .from("photos")
    .select("storage_path, thumbnail_path")
    .eq("id", params.photoId)
    .eq("user_id", params.userId)
    .single();

  if (error) throw new HttpError(404, { error: "Photo not found" });

  const storagePath = data.storage_path;
  const thumbnailPath = data.thumbnail_path;

  const { error: deleteError } = await supabase
    .from("photos")
    .delete()
    .eq("id", params.photoId)
    .eq("user_id", params.userId);

  if (deleteError) throw new HttpError(500, { error: "Failed to delete photo" });

  return { storagePath, thumbnailPath };
}

export async function deletePhotoFromStorage(supabase: SupabaseClient, storagePaths: string[]): Promise<void> {
  const { error } = await supabase.storage.from(PHOTOS_BUCKET).remove(storagePaths);
  if (error) throw new HttpError(502, { error: "Failed to delete photo from storage" });
}

export async function updateIdentification(
  supabase: SupabaseClient,
  params: { photoId: string; description?: string; subjectName?: string },
): Promise<void> {
  const fields: { description?: string; subject_name?: string } = {};
  if (params.description !== undefined) fields.description = params.description;
  if (params.subjectName !== undefined) fields.subject_name = params.subjectName;
  if (Object.keys(fields).length === 0) return;

  // Ownership is enforced by the identifications `owner_all` RLS policy
  // (gates by photos.user_id); count detects a non-owned/missing row,
  // mirroring movePhoto's not-found signal.
  const { count, error } = await supabase
    .from("identifications")
    .update(fields, { count: "exact" })
    .eq("photo_id", params.photoId);

  if (error) throw new HttpError(500, { error: "Failed to update identification" });
  if (!count) throw new HttpError(404, { error: "Identification not found" });
}
