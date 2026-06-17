import { z } from "zod";
import { IDENTIFY_CONFIG } from "@/lib/ai/config";
import { HttpError } from "@/lib/api/http";
import { encodeForAI } from "@/lib/identify/upload";
import type { FollowUpAnchor, FollowUpTurn } from "@/lib/ai/follow-up";

const PayloadSchema = z.object({
  anchor: z.object({ subjectName: z.string(), description: z.string() }).nullable(),
  photoId: z.string().optional(),
  history: z.array(z.object({ question: z.string(), answer: z.string() })),
  question: z.string(),
});

export interface FollowUpRequest {
  base64: string;
  anchor: FollowUpAnchor | null;
  photoId: string | undefined;
  history: FollowUpTurn[];
  question: string;
}

export async function parseFollowUpRequest(request: Request): Promise<FollowUpRequest> {
  const form = await request.formData();
  const photo = form.get("photo");
  if (!(photo instanceof File)) throw new HttpError(415, { error: "Unsupported media type" });
  if (!IDENTIFY_CONFIG.allowedTypes.includes(photo.type)) {
    throw new HttpError(415, { error: "Unsupported media type" });
  }
  if (photo.size > IDENTIFY_CONFIG.maxBytes) throw new HttpError(413, { error: "File too large" });

  const payloadRaw = form.get("payload");
  if (typeof payloadRaw !== "string") throw new HttpError(400, { error: "Missing payload" });

  let parsed: z.infer<typeof PayloadSchema>;
  try {
    parsed = PayloadSchema.parse(JSON.parse(payloadRaw));
  } catch {
    throw new HttpError(400, { error: "Invalid payload" });
  }

  if (!parsed.question.trim()) throw new HttpError(400, { error: "Missing question" });

  const base64 = await encodeForAI(photo);
  return {
    base64,
    anchor: parsed.anchor,
    photoId: parsed.photoId,
    history: parsed.history,
    question: parsed.question,
  };
}
