import { z } from "zod";
import { HttpError } from "@/lib/api/http";
import { validatePhotoFields, isValidRequestId } from "@/lib/identify/upload";

const PayloadSchema = z.object({
  subjectName: z.string().trim().min(1),
  description: z.string().trim().min(1),
  folderId: z.string().optional(),
  requestId: z.string(),
});

export interface SaveRequest {
  photo: File;
  thumbnail: File | null;
  subjectName: string;
  description: string;
  folderId: string | undefined;
  requestId: string;
}

/**
 * Parses a "save to archive" upload: the (re-sent) image and thumbnail plus a
 * JSON payload carrying the identification the user is committing — including
 * any follow-up enrichments and the original `requestId`, which dedupes a
 * double-save via the `(user_id, request_id)` unique index.
 */
export async function parseSaveRequest(request: Request): Promise<SaveRequest> {
  const form = await request.formData();
  const { photo, thumbnail } = validatePhotoFields(form);

  const payloadRaw = form.get("payload");
  if (typeof payloadRaw !== "string") throw new HttpError(400, { error: "Missing payload" });

  let parsed: z.infer<typeof PayloadSchema>;
  try {
    parsed = PayloadSchema.parse(JSON.parse(payloadRaw));
  } catch {
    throw new HttpError(400, { error: "Invalid payload" });
  }

  if (!isValidRequestId(parsed.requestId)) throw new HttpError(400, { error: "Missing request_id" });

  return {
    photo,
    thumbnail,
    subjectName: parsed.subjectName,
    description: parsed.description,
    folderId: parsed.folderId,
    requestId: parsed.requestId,
  };
}
