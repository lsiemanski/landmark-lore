import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";

export const POST: APIRoute = async (context) => {
  const form = await context.request.formData();
  const email = form.get("email") as string;

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return context.redirect("/auth/forgot-password?sent=true");
  }

  const redirectTo = `${context.url.origin}/auth/callback?next=/auth/reset-password`;
  await supabase.auth.resetPasswordForEmail(email, { redirectTo });

  return context.redirect("/auth/forgot-password?sent=true");
};
