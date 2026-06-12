import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL ?? "http://localhost:54321";
const SUPABASE_KEY = process.env.SUPABASE_KEY ?? "";

export function createTestClient(accessToken?: string): SupabaseClient {
  const client = createClient(SUPABASE_URL, SUPABASE_KEY);
  if (accessToken) {
    void client.auth.setSession({ access_token: accessToken, refresh_token: "" });
  }
  return client;
}

export async function signUpTestUser(
  email: string,
  password: string,
): Promise<{ user: unknown; session: unknown }> {
  const client = createClient(SUPABASE_URL, SUPABASE_KEY);
  const { data, error } = await client.auth.signUp({ email, password });
  if (error) throw error;
  return data as { user: unknown; session: unknown };
}

export async function signInTestUser(
  email: string,
  password: string,
): Promise<{ user: unknown; session: unknown }> {
  const client = createClient(SUPABASE_URL, SUPABASE_KEY);
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data as { user: unknown; session: unknown };
}
