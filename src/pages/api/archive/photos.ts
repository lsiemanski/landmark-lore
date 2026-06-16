import type { APIRoute } from "astro";
import { apiRoute } from "@/lib/api/http";
import { requireSupabaseClient, requireAuthenticatedUser } from "@/lib/api/auth";
import { listPhotos } from "@/lib/archive/photos";

export const GET: APIRoute = apiRoute(async (context) => {
  const supabase = requireSupabaseClient(context);
  const user = await requireAuthenticatedUser(supabase);
  const folderId = context.url.searchParams.get("folderId") ?? undefined;
  const photos = await listPhotos(supabase, { userId: user.id, folderId });
  return Response.json({ photos });
});
