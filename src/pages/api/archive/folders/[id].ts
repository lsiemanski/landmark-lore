import type { APIRoute } from "astro";
import { apiRoute, HttpError } from "@/lib/api/http";
import { requireSupabaseClient, requireAuthenticatedUser } from "@/lib/api/auth";
import { getFolderById, renameFolder, deleteFolder } from "@/lib/archive/folders";
import { DEFAULT_FOLDER_NAME } from "@/lib/archive/constants";

export const PATCH: APIRoute = apiRoute(async (context) => {
  const supabase = requireSupabaseClient(context);
  const user = await requireAuthenticatedUser(supabase);
  const folderId = context.params.id ?? "";

  let body: Record<string, unknown>;
  try {
    body = (await context.request.json()) as Record<string, unknown>;
  } catch {
    throw new HttpError(400, { error: "Invalid JSON body" });
  }
  const { name } = body;
  if (typeof name !== "string" || !name.trim()) throw new HttpError(400, { error: "name is required" });
  if (name === DEFAULT_FOLDER_NAME) throw new HttpError(400, { error: `Cannot use name '${DEFAULT_FOLDER_NAME}'` });

  const folder = await getFolderById(supabase, user.id, folderId);
  if (!folder) throw new HttpError(404, { error: "Folder not found" });
  if (folder.name === DEFAULT_FOLDER_NAME)
    throw new HttpError(403, { error: `Cannot rename the ${DEFAULT_FOLDER_NAME} folder` });

  await renameFolder(supabase, user.id, folderId, name.trim());
  return Response.json({});
});

export const DELETE: APIRoute = apiRoute(async (context) => {
  const supabase = requireSupabaseClient(context);
  const user = await requireAuthenticatedUser(supabase);
  const folderId = context.params.id ?? "";

  const folder = await getFolderById(supabase, user.id, folderId);
  if (!folder) throw new HttpError(404, { error: "Folder not found" });
  if (folder.name === DEFAULT_FOLDER_NAME)
    throw new HttpError(403, { error: `Cannot delete the ${DEFAULT_FOLDER_NAME} folder` });

  await deleteFolder(supabase, user.id, folderId);
  return Response.json({});
});
