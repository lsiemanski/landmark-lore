import type { APIRoute } from "astro";
import type { SupabaseClient } from "@/lib/supabase";
import { apiRoute, HttpError } from "@/lib/api/http";
import { requireApiKey, requireSupabaseClient, requireAuthenticatedUser } from "@/lib/api/auth";
import { currentPeriod, consumeFollowUpSlot, refundFollowUpSlot } from "@/lib/identify/quota";
import { parseFollowUpRequest } from "@/lib/identify/follow-up-request";
import { answerFollowUp } from "@/lib/ai/follow-up";
import { updateIdentificationDescription } from "@/lib/archive/photos";

export const POST: APIRoute = apiRoute(async (context) => {
  const apiKey = requireApiKey();
  const supabase = requireSupabaseClient(context);
  const user = await requireAuthenticatedUser(supabase);
  return await followUp(supabase, user.id, context.request, apiKey);
});

async function followUp(supabase: SupabaseClient, userId: string, request: Request, apiKey: string): Promise<Response> {
  const period = currentPeriod();
  await consumeFollowUpSlot(supabase, period);

  const parsed = await parseSafe(request, supabase, period);
  const aiResult = await answerSafe(parsed, apiKey, supabase, period);

  const { photoId } = parsed;
  const { answer, enrichedDescription } = aiResult;

  if (photoId && enrichedDescription) {
    try {
      await updateIdentificationDescription(supabase, { userId, photoId, description: enrichedDescription });
    } catch (err) {
      console.error("Failed to persist enriched description:", err);
    }
  }

  const body: Record<string, unknown> = { answer };
  if (photoId && enrichedDescription) body.description = enrichedDescription;
  return Response.json(body);
}

async function parseSafe(
  request: Request,
  supabase: SupabaseClient,
  period: string,
): Promise<Awaited<ReturnType<typeof parseFollowUpRequest>>> {
  try {
    return await parseFollowUpRequest(request);
  } catch (err) {
    await refundFollowUpSlot(supabase, period);
    if (err instanceof HttpError) throw err;
    throw new HttpError(400, { error: "Invalid request" });
  }
}

async function answerSafe(
  params: Awaited<ReturnType<typeof parseFollowUpRequest>>,
  apiKey: string,
  supabase: SupabaseClient,
  period: string,
): Promise<Awaited<ReturnType<typeof answerFollowUp>>> {
  try {
    return await answerFollowUp(params, apiKey);
  } catch (err) {
    await refundFollowUpSlot(supabase, period);
    if (err instanceof HttpError) throw err;
    throw new HttpError(502, { error: "AI provider error" });
  }
}
