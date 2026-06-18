import type { APIRoute } from "astro";
import type { SupabaseClient } from "@/lib/supabase";
import { identifyImage } from "@/lib/ai/identification";
import { UpstreamRateLimitError } from "@/lib/ai/openrouter";
import { apiRoute, HttpError } from "@/lib/api/http";
import { requireApiKey, requireSupabaseClient, requireAuthenticatedUser } from "@/lib/api/auth";
import { currentPeriod, consumeSlot, refundSlot } from "@/lib/identify/quota";
import { parseUploadRequest, encodeForAI } from "@/lib/identify/upload";

// Identification is read-only: it runs the AI and returns the result, but
// persists nothing. A photo only enters the archive when the user explicitly
// saves it (POST /api/archive/photos), so an un-saved identification leaves no
// storage object or DB row behind.
export const POST: APIRoute = apiRoute(async (context) => {
  const apiKey = requireApiKey();
  const supabase = requireSupabaseClient(context);
  await requireAuthenticatedUser(supabase);

  const { photo } = await parseUploadRequest(context.request);
  return await identify(supabase, photo, apiKey);
});

async function identify(supabase: SupabaseClient, photo: File, apiKey: string): Promise<Response> {
  const period = currentPeriod();
  await consumeSlot(supabase, period);

  try {
    const base64 = await encodeForAI(photo);
    const result = await identifyImage(base64, apiKey);
    return Response.json({ result });
  } catch (err) {
    await refundSlot(supabase, period);
    if (err instanceof HttpError) throw err;
    if (err instanceof UpstreamRateLimitError) {
      throw new HttpError(429, { error: "The AI provider is busy. Please try again in a moment." });
    }
    console.error("identify failed", err);
    throw new HttpError(502, { error: "AI provider error" });
  }
}
