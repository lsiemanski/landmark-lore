import OpenAI from "openai";
import { z } from "zod";
import { IDENTIFY_CONFIG } from "@/lib/ai/config";
import { parseModelJson } from "@/lib/ai/parse-json";
import { withoutReasoning, withModelFallback } from "@/lib/ai/openrouter";
import prompts from "@/lib/ai/identify-prompts.yaml";

const SYSTEM_PROMPT = prompts.systemPrompt.trim();
const JSON_SHAPE_HINT = " " + prompts.jsonShapeHint.trim();
const USER_PROMPT = prompts.userPrompt.trim();

const IdentificationResultSchema = z.object({
  recognised: z.boolean(),
  subjectName: z.string(),
  description: z.string(),
});

const identificationSchema = z.toJSONSchema(IdentificationResultSchema);

export type IdentificationResult = z.infer<typeof IdentificationResultSchema>;

export async function identifyImage(base64: string, apiKey: string): Promise<IdentificationResult> {
  const client = new OpenAI({ apiKey, baseURL: IDENTIFY_CONFIG.openrouterBaseUrl });
  const response = await requestIdentification(client, base64);

  const choice = response.choices[0];
  const content = choice.message.content;
  if (!content) throw new Error("Empty response from AI provider");
  if (choice.finish_reason === "length") {
    throw new Error(`AI response truncated at max_tokens (${IDENTIFY_CONFIG.maxTokens})`);
  }
  const parsed = IdentificationResultSchema.safeParse(parseModelJson(content));
  if (!parsed.success) throw new Error("Malformed AI response");
  return parsed.data;
}

async function requestIdentification(client: OpenAI, base64: string): Promise<OpenAI.Chat.ChatCompletion> {
  return withModelFallback([IDENTIFY_CONFIG.model, IDENTIFY_CONFIG.fallbackModel], (model) =>
    createIdentificationCompletion(client, base64, model),
  );
}

async function createIdentificationCompletion(
  client: OpenAI,
  base64: string,
  model: string,
): Promise<OpenAI.Chat.ChatCompletion> {
  try {
    return await client.chat.completions.create(
      withoutReasoning({
        model,
        max_tokens: IDENTIFY_CONFIG.maxTokens,
        messages: visionMessages(base64, SYSTEM_PROMPT),
        response_format: {
          type: "json_schema",
          json_schema: { name: "identification", strict: true, schema: identificationSchema },
        },
      }),
    );
  } catch (err) {
    // Fallback: some models reject strict json_schema with a 400 — retry with
    // json_object and the expected shape appended to the prompt.
    if (err instanceof OpenAI.APIError && err.status === 400) {
      return await client.chat.completions.create(
        withoutReasoning({
          model,
          max_tokens: IDENTIFY_CONFIG.maxTokens,
          messages: visionMessages(base64, SYSTEM_PROMPT + JSON_SHAPE_HINT),
          response_format: { type: "json_object" },
        }),
      );
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
        { type: "text", text: USER_PROMPT },
      ],
    },
  ];
}
