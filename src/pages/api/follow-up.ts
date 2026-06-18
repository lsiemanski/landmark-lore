import type { APIRoute } from "astro";
import type { SupabaseClient } from "@/lib/supabase";
import { apiRoute, HttpError } from "@/lib/api/http";
import { requireApiKey, requireSupabaseClient, requireAuthenticatedUser } from "@/lib/api/auth";
import { currentPeriod, consumeFollowUpSlot, refundFollowUpSlot } from "@/lib/identify/quota";
import { parseFollowUpRequest } from "@/lib/identify/follow-up-request";
import { answerFollowUp } from "@/lib/ai/follow-up";
import { UpstreamRateLimitError } from "@/lib/ai/openrouter";
import { updateIdentification } from "@/lib/archive/photos";

export const POST: APIRoute = apiRoute(async (context) => {
  const apiKey = requireApiKey();
  const supabase = requireSupabaseClient(context);
  await requireAuthenticatedUser(supabase);
  return await followUp(supabase, context.request, apiKey);
});

async function followUp(supabase: SupabaseClient, request: Request, apiKey: string): Promise<Response> {
  const period = currentPeriod();
  await consumeFollowUpSlot(supabase, period);

  const parsed = await parseSafe(request, supabase, period);
  const aiResult = await answerSafe(parsed, apiKey, supabase, period);

  const { photoId, anchor } = parsed;
  const { answer, enrichedDescription, updatedSubjectName } = aiResult;

  // Persist enrichments only for recognized photos (those carrying a photoId).
  // The description is rewritten every turn; the subject name only when this
  // exchange corrected it, so guard against an empty or unchanged value.
  const description = enrichedDescription || undefined;
  const trimmedName = updatedSubjectName.trim();
  const subjectName = trimmedName && trimmedName !== anchor?.subjectName ? trimmedName : undefined;

  if (photoId && (description || subjectName)) {
    try {
      await updateIdentification(supabase, { photoId, description, subjectName });
    } catch (err) {
      console.error("Failed to persist identification enrichment:", err);
    }
  }

  const body: Record<string, unknown> = { answer };
  if (photoId && description) body.description = description;
  if (photoId && subjectName) body.subjectName = subjectName;
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
    if (err instanceof UpstreamRateLimitError) {
      throw new HttpError(429, { error: "The AI provider is busy. Please try again in a moment." });
    }
    console.error("follow-up failed", err);
    throw new HttpError(502, { error: "AI provider error" });
  }
}
