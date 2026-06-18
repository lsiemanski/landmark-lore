import type { APIRoute } from "astro";
import { apiRoute, HttpError } from "@/lib/api/http";
import { requireSupabaseClient, requireAuthenticatedUser } from "@/lib/api/auth";
import { listFolders, createFolder } from "@/lib/archive/folders";
import { DEFAULT_FOLDER_NAME } from "@/lib/archive/constants";

export const GET: APIRoute = apiRoute(async (context) => {
  const supabase = requireSupabaseClient(context);
  const user = await requireAuthenticatedUser(supabase);
  const folders = await listFolders(supabase, user.id);
  return Response.json({ folders }, { headers: { "Cache-Control": "private, no-store" } });
});

export const POST: APIRoute = apiRoute(async (context) => {
  const supabase = requireSupabaseClient(context);
  const user = await requireAuthenticatedUser(supabase);

  let body: Record<string, unknown>;
  try {
    body = (await context.request.json()) as Record<string, unknown>;
  } catch {
    throw new HttpError(400, { error: "Invalid JSON body" });
  }
  const { name } = body;
  if (typeof name !== "string" || !name.trim()) throw new HttpError(400, { error: "name is required" });
  if (name === DEFAULT_FOLDER_NAME) throw new HttpError(400, { error: `Cannot use name '${DEFAULT_FOLDER_NAME}'` });

  const result = await createFolder(supabase, user.id, name.trim());
  return Response.json({ id: result.id }, { status: 201 });
});
