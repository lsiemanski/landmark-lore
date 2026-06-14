import type { APIRoute } from "astro";
import { createClient } from "@/lib/supabase";

export const POST: APIRoute = async (context) => {
  const form = await context.request.formData();
  const password = form.get("password") as string;
  const confirmPassword = form.get("confirmPassword") as string;

  if (!password || !confirmPassword || password !== confirmPassword) {
    return context.redirect("/auth/reset-password?error=passwords_mismatch");
  }

  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) {
    return context.redirect("/auth/forgot-password?error=session_expired");
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return context.redirect("/auth/forgot-password?error=session_expired");
  }

  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    return context.redirect("/auth/reset-password?error=update_failed");
  }

  return context.redirect("/auth/signin?success=password_reset");
};
