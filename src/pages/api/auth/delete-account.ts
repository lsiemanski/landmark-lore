import type { APIRoute } from "astro";
import type { SupabaseClient } from "@/lib/supabase";
import { createAdminClient, type AdminSupabaseClient } from "@/lib/supabase-admin";
import { apiRoute, HttpError } from "@/lib/api/http";
import { requireSupabaseClient, requireAuthenticatedUser } from "@/lib/api/auth";
import { PHOTOS_BUCKET } from "@/lib/identify/storage";
import type { User } from "@supabase/supabase-js";

export const POST: APIRoute = apiRoute(async (context) => {
  const supabase = requireSupabaseClient(context);
  const user = await requireAuthenticatedUser(supabase);

  const { password } = await parseBody(context.request);

  await verifyPassword(supabase, user, password);

  const adminClient = requireAdminClient();
  await deleteUserStorage(adminClient, user.id);
  await deleteAuthUser(adminClient, user.id);
  await supabase.auth.signOut();

  return Response.json({ success: true });
});

// --- Request pipeline ---------------------------------------------------------

function requireAdminClient(): AdminSupabaseClient {
  const adminClient = createAdminClient();
  if (!adminClient) throw new HttpError(503, { error: "Admin client not configured" });
  return adminClient;
}

async function parseBody(request: Request): Promise<{ password: string }> {
  const body = (await request.json()) as Record<string, unknown>;
  const { password } = body;
  if (typeof password !== "string" || !password) throw new HttpError(400, { error: "Password is required" });
  return { password };
}

// --- Extraction helpers -------------------------------------------------------

async function verifyPassword(supabase: SupabaseClient, user: User, password: string): Promise<void> {
  const email = user.email;
  if (!email) throw new HttpError(400, { error: "No email on account" });
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw new HttpError(401, { error: "Wrong password" });
}

async function deleteUserStorage(adminClient: AdminSupabaseClient, userId: string): Promise<void> {
  const PAGE_SIZE = 100;

  // Deleting shrinks the list, so always re-list from offset 0 until a page
  // comes back empty — advancing offset here would skip files that shifted down.
  for (;;) {
    const { data, error } = await adminClient.storage.from(PHOTOS_BUCKET).list(userId, { limit: PAGE_SIZE, offset: 0 });

    if (error) throw new HttpError(502, { error: "Failed to list account storage" });
    if (data.length === 0) break;

    const paths = data.map((obj) => `${userId}/${obj.name}`);
    const { error: removeError } = await adminClient.storage.from(PHOTOS_BUCKET).remove(paths);
    if (removeError) throw new HttpError(502, { error: "Failed to delete account storage" });
  }
}

async function deleteAuthUser(adminClient: AdminSupabaseClient, userId: string): Promise<void> {
  const { error } = await adminClient.auth.admin.deleteUser(userId);
  if (error) throw new HttpError(500, { error: "Failed to delete account" });
}
