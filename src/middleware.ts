import { defineMiddleware } from "astro:middleware";
import { createClient } from "@/lib/supabase";

const PROTECTED_ROUTES = ["/gallery"];

export const onRequest = defineMiddleware(async (context, next) => {
  const supabase = createClient(context.request.headers, context.cookies);

  if (supabase) {
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      context.locals.user = user ?? null;
    } catch {
      context.locals.user = null;
    }
  } else {
    context.locals.user = null;
  }

  const isProtected = PROTECTED_ROUTES.some((route) =>
    route === "/" ? context.url.pathname === "/" : context.url.pathname.startsWith(route),
  );

  if (isProtected) {
    if (!context.locals.user) {
      return context.redirect("/auth/signin");
    }
  }

  return next();
});
