import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL ?? "http://localhost:54321";
const SUPABASE_KEY = process.env.SUPABASE_KEY ?? "";

function newClient(): ReturnType<typeof createClient> {
  if (!SUPABASE_KEY) {
    throw new Error(
      "SUPABASE_KEY is not set — start the local Supabase stack and export SUPABASE_URL/SUPABASE_KEY (or set them in the test .env) before running integration tests.",
    );
  }
  return createClient(SUPABASE_URL, SUPABASE_KEY);
}

export async function createTestClient(accessToken?: string): Promise<ReturnType<typeof createClient>> {
  const client = newClient();
  if (accessToken) {
    await client.auth.setSession({ access_token: accessToken, refresh_token: "" });
  }
  return client;
}

export async function signUpTestUser(email: string, password: string): Promise<{ user: unknown; session: unknown }> {
  const client = newClient();
  const { data, error } = await client.auth.signUp({ email, password });
  if (error) throw error;
  return data;
}

export async function signInTestUser(email: string, password: string): Promise<{ user: unknown; session: unknown }> {
  const client = newClient();
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}
