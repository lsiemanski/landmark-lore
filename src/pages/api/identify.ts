import type { APIRoute } from "astro";
import type { SupabaseClient } from "@/lib/supabase";
import { identifyImage } from "@/lib/ai/identification";
import { apiRoute, HttpError } from "@/lib/api/http";
import { requireApiKey, requireSupabaseClient, requireAuthenticatedUser } from "@/lib/api/auth";
import { currentPeriod, consumeSlot, refundSlot } from "@/lib/identify/quota";
import { parseUploadRequest, encodeForAI, hashPhoto } from "@/lib/identify/upload";
import { checkIdempotencyCache, lookupDefaultFolder, persistPhotoAndIdentification } from "@/lib/identify/persistence";

export const POST: APIRoute = apiRoute(async (context) => {
  const apiKey = requireApiKey();
  const supabase = requireSupabaseClient(context);
  const user = await requireAuthenticatedUser(supabase);

  const { photo, requestId } = await parseUploadRequest(context.request);
  const photoHash = await hashPhoto(photo);

  const cached = await resolveIdempotency(supabase, user.id, requestId, photoHash);
  if (cached) return cached;

  return await identify(supabase, user, { photo, requestId, photoHash, apiKey });
});

// --- Orchestration steps ------------------------------------------------------

async function resolveIdempotency(
  supabase: SupabaseClient,
  userId: string,
  requestId: string,
  photoHash: string,
): Promise<Response | null> {
  const cached = await checkIdempotencyCache(supabase, userId, requestId);
  if (!cached) return null;
  if (cached.photoHash !== photoHash) {
    throw new HttpError(409, { error: "request_id already used with a different photo" });
  }
  return Response.json({ result: cached.result, photoId: cached.photoId });
}

async function identify(
  supabase: SupabaseClient,
  user: { id: string },
  params: { photo: File; requestId: string; photoHash: string; apiKey: string },
): Promise<Response> {
  const period = currentPeriod();
  await consumeSlot(supabase, period);

  try {
    const base64 = await encodeForAI(params.photo);
    const result = await identifyImage(base64, params.apiKey);

    if (!result.recognised) return Response.json({ result });

    const photoId = crypto.randomUUID();
    const folderId = await lookupDefaultFolder(supabase, user.id);
    await persistPhotoAndIdentification(
      supabase,
      user,
      { photoId, requestId: params.requestId, photo: params.photo, folderId, photoHash: params.photoHash },
      result,
    );
    return Response.json({ result, photoId });
  } catch (err) {
    await refundSlot(supabase, period);
    if (err instanceof HttpError) throw err;
    throw new HttpError(502, { error: "AI provider error" });
  }
}
