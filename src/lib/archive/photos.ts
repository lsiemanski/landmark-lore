import type { SupabaseClient } from "@/lib/supabase";
import { HttpError } from "@/lib/api/http";
import { PHOTOS_BUCKET } from "@/lib/identify/storage";
import { PHOTO_STATUS_IDENTIFIED } from "@/lib/archive/constants";

export interface PhotoCardData {
  id: string;
  signedUrl: string;
  subjectName: string;
  folderId: string;
  createdAt: string;
}

export async function listPhotos(
  supabase: SupabaseClient,
  params: { userId: string; folderId?: string },
): Promise<PhotoCardData[]> {
  let query = supabase
    .from("photos")
    .select("id, folder_id, storage_path, created_at, identifications(subject_name)")
    .eq("user_id", params.userId)
    .eq("status", PHOTO_STATUS_IDENTIFIED)
    .order("created_at", { ascending: false });

  if (params.folderId) {
    query = query.eq("folder_id", params.folderId);
  }

  const { data, error } = await query;
  if (error) throw new HttpError(500, { error: "Failed to list photos" });
  if (data.length === 0) return [];

  const paths = data.map((row) => row.storage_path);
  const { data: signedUrls, error: urlError } = await supabase.storage
    .from(PHOTOS_BUCKET)
    .createSignedUrls(paths, 3600);

  if (urlError) throw new HttpError(500, { error: "Failed to generate signed URLs" });

  return data.map((row, i) => ({
    id: row.id,
    signedUrl: signedUrls[i]?.signedUrl ?? "",
    subjectName: row.identifications?.subject_name ?? "",
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
): Promise<{ storagePath: string }> {
  const { data, error } = await supabase
    .from("photos")
    .select("storage_path")
    .eq("id", params.photoId)
    .eq("user_id", params.userId)
    .single();

  if (error) throw new HttpError(404, { error: "Photo not found" });

  const storagePath = data.storage_path;

  const { error: deleteError } = await supabase
    .from("photos")
    .delete()
    .eq("id", params.photoId)
    .eq("user_id", params.userId);

  if (deleteError) throw new HttpError(500, { error: "Failed to delete photo" });

  return { storagePath };
}

export async function deletePhotoFromStorage(supabase: SupabaseClient, storagePath: string): Promise<void> {
  const { error } = await supabase.storage.from(PHOTOS_BUCKET).remove([storagePath]);
  if (error) throw new HttpError(502, { error: "Failed to delete photo from storage" });
}

export async function updateIdentificationDescription(
  supabase: SupabaseClient,
  params: { userId: string; photoId: string; description: string },
): Promise<void> {
  // Ownership is enforced by the identifications `owner_all` RLS policy
  // (gates by photos.user_id); count detects a non-owned/missing row,
  // mirroring movePhoto's not-found signal.
  const { count, error } = await supabase
    .from("identifications")
    .update({ description: params.description }, { count: "exact" })
    .eq("photo_id", params.photoId);

  if (error) throw new HttpError(500, { error: "Failed to update description" });
  if (!count) throw new HttpError(404, { error: "Identification not found" });
}
