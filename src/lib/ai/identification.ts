import OpenAI from "openai";
import { IDENTIFY_CONFIG } from "@/lib/ai/config";
import prompts from "@/lib/ai/identify-prompts.yaml";

const SYSTEM_PROMPT = prompts.systemPrompt.trim();
const JSON_SHAPE_HINT = " " + prompts.jsonShapeHint.trim();
const USER_PROMPT = prompts.userPrompt.trim();

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

export type IdentificationResult = {
  recognised: boolean;
  subjectName: string;
  description: string;
};

export async function identifyImage(base64: string, apiKey: string): Promise<unknown> {
  const client = new OpenAI({ apiKey, baseURL: IDENTIFY_CONFIG.openrouterBaseUrl });
  const response = await requestIdentification(client, base64);

  const content = response.choices[0].message.content;
  if (!content) throw new Error("Empty response from AI provider");
  return JSON.parse(content);
}

async function requestIdentification(client: OpenAI, base64: string): Promise<OpenAI.Chat.ChatCompletion> {
  try {
    return await client.chat.completions.create({
      model: IDENTIFY_CONFIG.model,
      max_tokens: IDENTIFY_CONFIG.maxTokens,
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
        max_tokens: IDENTIFY_CONFIG.maxTokens,
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
        { type: "text", text: USER_PROMPT },
      ],
    },
  ];
}
