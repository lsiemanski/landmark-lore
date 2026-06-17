import type { APIRoute } from "astro";
import { apiRoute, HttpError } from "@/lib/api/http";
import { requireSupabaseClient, requireAuthenticatedUser } from "@/lib/api/auth";
import { getFolderById } from "@/lib/archive/folders";
import { movePhoto, deletePhotoRecord, deletePhotoFromStorage } from "@/lib/archive/photos";

export const PATCH: APIRoute = apiRoute(async (context) => {
  const supabase = requireSupabaseClient(context);
  const user = await requireAuthenticatedUser(supabase);
  const photoId = context.params.id ?? "";

  let body: Record<string, unknown>;
  try {
    body = (await context.request.json()) as Record<string, unknown>;
  } catch {
    throw new HttpError(400, { error: "Invalid JSON body" });
  }
  const { folderId } = body;
  if (typeof folderId !== "string" || !folderId) throw new HttpError(400, { error: "folderId is required" });

  const folder = await getFolderById(supabase, user.id, folderId);
  if (!folder) throw new HttpError(404, { error: "Folder not found" });

  await movePhoto(supabase, { userId: user.id, photoId, targetFolderId: folderId });
  return Response.json({});
});

export const DELETE: APIRoute = apiRoute(async (context) => {
  const supabase = requireSupabaseClient(context);
  const user = await requireAuthenticatedUser(supabase);
  const photoId = context.params.id ?? "";

  const { storagePath, thumbnailPath } = await deletePhotoRecord(supabase, { userId: user.id, photoId });
  const paths = thumbnailPath ? [storagePath, thumbnailPath] : [storagePath];

  try {
    await deletePhotoFromStorage(supabase, paths);
  } catch {
    console.error(`Orphaned storage object(s) after photo delete: ${paths.join(", ")}`);
  }

  return Response.json({});
});
