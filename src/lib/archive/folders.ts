import type { SupabaseClient } from "@/lib/supabase";
import { HttpError } from "@/lib/api/http";
import { DEFAULT_FOLDER_NAME } from "@/lib/archive/constants";

export interface FolderWithCount {
  id: string;
  name: string;
  photoCount: number;
  createdAt: string;
}

/** Order folders for display: user folders first, the default ("Uncategorized") last. */
export function sortFoldersDefaultLast<T extends { name: string }>(folders: readonly T[]): T[] {
  return [...folders].sort((a, b) => {
    const aDefault = a.name === DEFAULT_FOLDER_NAME ? 1 : 0;
    const bDefault = b.name === DEFAULT_FOLDER_NAME ? 1 : 0;
    return aDefault - bDefault;
  });
}

export async function listFolders(supabase: SupabaseClient, userId: string): Promise<FolderWithCount[]> {
  const { data, error } = await supabase
    .from("folders")
    .select("id, name, created_at, photos(count)")
    .eq("user_id", userId)
    .order("created_at", { ascending: true });

  if (error) throw new HttpError(500, { error: "Failed to list folders" });

  return data.map((row) => ({
    id: row.id,
    name: row.name,
    photoCount: (row.photos as unknown as { count: number }[] | null)?.[0]?.count ?? 0,
    createdAt: row.created_at,
  }));
}

export async function getFolderById(
  supabase: SupabaseClient,
  userId: string,
  folderId: string,
): Promise<{ id: string; name: string } | null> {
  const { data, error } = await supabase
    .from("folders")
    .select("id, name")
    .eq("id", folderId)
    .eq("user_id", userId)
    .single();

  if (error) return null;
  return data;
}

export async function createFolder(supabase: SupabaseClient, userId: string, name: string): Promise<{ id: string }> {
  const { data, error } = await supabase.from("folders").insert({ user_id: userId, name }).select("id").single();

  if (error) throw new HttpError(500, { error: "Failed to create folder" });
  return { id: data.id };
}

export async function renameFolder(
  supabase: SupabaseClient,
  userId: string,
  folderId: string,
  name: string,
): Promise<void> {
  const { error } = await supabase.from("folders").update({ name }).eq("id", folderId).eq("user_id", userId);

  if (error) throw new HttpError(500, { error: "Failed to rename folder" });
}

export async function deleteFolder(supabase: SupabaseClient, userId: string, folderId: string): Promise<void> {
  const { count, error: countError } = await supabase
    .from("photos")
    .select("*", { count: "exact", head: true })
    .eq("folder_id", folderId)
    .eq("user_id", userId);

  if (countError) throw new HttpError(500, { error: "Failed to check folder contents" });
  if (count && count > 0) throw new HttpError(409, { error: "Folder is not empty" });

  const { error } = await supabase.from("folders").delete().eq("id", folderId).eq("user_id", userId);

  if (error) throw new HttpError(500, { error: "Failed to delete folder" });
}
