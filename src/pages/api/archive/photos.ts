import type { APIRoute } from "astro";
import type { SupabaseClient } from "@/lib/supabase";
import { apiRoute, HttpError } from "@/lib/api/http";
import { requireSupabaseClient, requireAuthenticatedUser } from "@/lib/api/auth";
import { listPhotos } from "@/lib/archive/photos";
import { getFolderById } from "@/lib/archive/folders";
import { parseSaveRequest } from "@/lib/identify/save-request";
import { hashPhoto } from "@/lib/identify/upload";
import { lookupDefaultFolder, persistPhotoAndIdentification } from "@/lib/identify/persistence";

export const GET: APIRoute = apiRoute(async (context) => {
  const supabase = requireSupabaseClient(context);
  const user = await requireAuthenticatedUser(supabase);
  const folderId = context.url.searchParams.get("folderId") ?? undefined;
  const photos = await listPhotos(supabase, { userId: user.id, folderId });
  return Response.json({ photos });
});

// Commits an identification to the archive. Identification (POST /api/identify)
// persists nothing; the image and its details only become a stored photo here,
// when the user explicitly saves. Carries any follow-up enrichments the user
// accepted, and the original requestId so a double-save is deduped by the
// `(user_id, request_id)` unique index.
export const POST: APIRoute = apiRoute(async (context) => {
  const supabase = requireSupabaseClient(context);
  const user = await requireAuthenticatedUser(supabase);

  const { photo, thumbnail, subjectName, description, folderId, requestId } = await parseSaveRequest(context.request);

  const targetFolderId = await resolveFolder(supabase, user.id, folderId);
  const photoId = crypto.randomUUID();
  const photoHash = await hashPhoto(photo);

  await persistPhotoAndIdentification(
    supabase,
    user,
    { photoId, requestId, photo, thumbnail, folderId: targetFolderId, photoHash },
    { recognised: true, subjectName, description },
  );

  return Response.json({ photoId }, { status: 201 });
});

async function resolveFolder(supabase: SupabaseClient, userId: string, folderId: string | undefined): Promise<string> {
  if (!folderId) return await lookupDefaultFolder(supabase, userId);
  const folder = await getFolderById(supabase, userId, folderId);
  if (!folder) throw new HttpError(404, { error: "Folder not found" });
  return folder.id;
}
