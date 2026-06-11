import type { APIContext, APIRoute } from "astro";
import OpenAI from "openai";
import { OPENROUTER_API_KEY } from "astro:env/server";
import { createClient } from "@/lib/supabase";
import { IDENTIFY_CONFIG } from "@/lib/ai/config";

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

const SYSTEM_PROMPT =
  "Identify the primary landmark, artwork, monument, or notable subject in the photo. " +
  "Provide a substantive historical/cultural description, not just a label. " +
  "If you cannot confidently identify it, set recognised=false and explain why.";

const JSON_SHAPE_HINT =
  " Respond with a JSON object matching exactly: { recognised: boolean, subjectName: string, description: string }";

const identificationSchema = {
  type: "object",
  properties: {
    recognised: { type: "boolean" },
    subjectName: { type: "string" },
    description: { type: "string" },
  },
  required: ["recognised", "subjectName", "description"],
  additionalProperties: false,
};

type Supabase = NonNullable<ReturnType<typeof createClient>>;

export const POST: APIRoute = async (context) => {
  try {
    const apiKey = requireApiKey();
    const supabase = requireSupabaseClient(context);
    await requireAuthenticatedUser(supabase);

    const base64 = await readImageAsBase64(context.request);
    const period = currentPeriod();
    await consumeSlot(supabase, period);

    try {
      const result = await identifyImage(base64, apiKey);
      return jsonResponse({ result });
    } catch {
      // The identification did not complete — refund the reserved slot so it does not count.
      await refundSlot(supabase, period);
      throw new HttpError(502, { error: "AI provider error" });
    }
  } catch (err) {
    if (err instanceof HttpError) return err.toResponse();
    throw err;
  }
};

// --- Request pipeline ---------------------------------------------------------

function requireApiKey(): string {
  if (!OPENROUTER_API_KEY) throw new HttpError(503, { error: "AI provider not configured" });
  return OPENROUTER_API_KEY;
}

function requireSupabaseClient(context: APIContext): Supabase {
  const supabase = createClient(context.request.headers, context.cookies);
  if (!supabase) throw new HttpError(503, { error: "Supabase not configured" });
  return supabase;
}

async function requireAuthenticatedUser(supabase: Supabase) {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new HttpError(401, { error: "Unauthorised" });
  return user;
}

async function readImageAsBase64(request: Request): Promise<string> {
  const form = await request.formData();
  const file = form.get("photo");
  if (!(file instanceof File)) throw new HttpError(415, { error: "Unsupported media type" });
  if (!IDENTIFY_CONFIG.allowedTypes.includes(file.type)) {
    throw new HttpError(415, { error: "Unsupported media type" });
  }
  if (file.size > IDENTIFY_CONFIG.maxBytes) throw new HttpError(413, { error: "File too large" });

  const buffer = await file.arrayBuffer();
  return Buffer.from(buffer).toString("base64");
}

function currentPeriod(): string {
  return new Date().toISOString().slice(0, 10);
}

// --- Rate limiting ------------------------------------------------------------

async function consumeSlot(supabase: Supabase, period: string): Promise<void> {
  const { data: consumed, error } = await supabase.rpc("try_consume_image_usage", {
    p_period: period,
    p_limit: IDENTIFY_CONFIG.dailyImageLimit,
  });
  if (error) throw new HttpError(503, { error: "Usage check failed" });
  if (!consumed.allowed) {
    throw new HttpError(429, {
      error: "Daily limit reached",
      limit: IDENTIFY_CONFIG.dailyImageLimit,
      used: consumed.used,
    });
  }
}

async function refundSlot(supabase: Supabase, period: string): Promise<void> {
  // Best-effort: a failed refund only costs the user one slot.
  await supabase.rpc("refund_image_usage", { p_period: period });
}

// --- AI identification --------------------------------------------------------

async function identifyImage(base64: string, apiKey: string): Promise<unknown> {
  const client = new OpenAI({ apiKey, baseURL: OPENROUTER_BASE_URL });
  const response = await requestIdentification(client, base64);

  const content = response.choices[0].message.content;
  if (!content) throw new Error("Empty response from AI provider");
  return JSON.parse(content);
}

async function requestIdentification(client: OpenAI, base64: string): Promise<OpenAI.Chat.ChatCompletion> {
  try {
    return await client.chat.completions.create({
      model: IDENTIFY_CONFIG.model,
      max_tokens: 1024,
      messages: visionMessages(base64, SYSTEM_PROMPT),
      response_format: {
        type: "json_schema",
        json_schema: { name: "identification", strict: true, schema: identificationSchema },
      },
    });
  } catch (err) {
    // Fallback: some models reject strict json_schema with a 400 — retry with
    // json_object and the expected shape appended to the prompt.
    if (err instanceof OpenAI.APIError && err.status === 400) {
      return await client.chat.completions.create({
        model: IDENTIFY_CONFIG.model,
        max_tokens: 1024,
        messages: visionMessages(base64, SYSTEM_PROMPT + JSON_SHAPE_HINT),
        response_format: { type: "json_object" },
      });
    }
    throw err;
  }
}

function visionMessages(base64: string, systemPrompt: string): OpenAI.Chat.ChatCompletionMessageParam[] {
  return [
    { role: "system", content: systemPrompt },
    {
      role: "user",
      content: [
        { type: "image_url", image_url: { url: `data:image/jpeg;base64,${base64}` } },
        { type: "text", text: "Identify the main subject of this photo." },
      ],
    },
  ];
}

// --- HTTP helpers -------------------------------------------------------------

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly body: Record<string, unknown>,
  ) {
    super(typeof body.error === "string" ? body.error : `HTTP ${status}`);
  }

  toResponse(): Response {
    return jsonResponse(this.body, this.status);
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
