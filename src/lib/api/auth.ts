import type { APIContext } from "astro";
import { OPENROUTER_API_KEY } from "astro:env/server";
import { createClient, type SupabaseClient } from "@/lib/supabase";
import { HttpError } from "@/lib/api/http";
import type { User } from "@supabase/supabase-js";

export function requireApiKey(): string {
  if (!OPENROUTER_API_KEY) throw new HttpError(503, { error: "AI provider not configured" });
  return OPENROUTER_API_KEY;
}

export function requireSupabaseClient(context: APIContext): SupabaseClient {
  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) throw new HttpError(503, { error: "Supabase not configured" });
  return supabase;
}

export async function requireAuthenticatedUser(supabase: SupabaseClient): Promise<User> {
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user) throw new HttpError(401, { error: "Unauthorised" });
  return user;
}
