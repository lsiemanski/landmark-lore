import OpenAI from "openai";
import { z } from "zod";
import { IDENTIFY_CONFIG } from "@/lib/ai/config";
import { parseModelJson } from "@/lib/ai/parse-json";
import { withModelFallback } from "@/lib/ai/openrouter";
import prompts from "@/lib/ai/identify-prompts.yaml";

const FOLLOW_UP_SYSTEM_PROMPT = prompts.followUpSystemPrompt.trim();
const FOLLOW_UP_JSON_SHAPE_HINT = " " + prompts.followUpJsonShapeHint.trim();
const FOLLOW_UP_CONTEXT_PREAMBLE = prompts.followUpContextPreamble.trim();

const FollowUpResultSchema = z.object({
  answer: z.string(),
  enrichedDescription: z.string(),
  updatedSubjectName: z.string(),
});

const followUpSchema = z.toJSONSchema(FollowUpResultSchema);

export type FollowUpResult = z.infer<typeof FollowUpResultSchema>;

/** Identification result a recognized photo carries as context for follow-ups. */
export interface FollowUpAnchor {
  subjectName: string;
  description: string;
}

/** A prior question/answer exchange, replayed so context-dependent asks work. */
export interface FollowUpTurn {
  question: string;
  answer: string;
}

export interface FollowUpParams {
  base64: string;
  anchor: FollowUpAnchor | null;
  history: FollowUpTurn[];
  question: string;
}

/**
 * Answers a free-text follow-up question grounded in the photo image, the
 * identification anchor (recognized photos only), and the replayed conversation
 * history. Sibling to `identifyImage`: one structured completion yields both the
 * plain-text `answer` and an `enrichedDescription` that integrates any new facts
 * (empty when no anchor was supplied). Constrained to the subject's domain.
 */
export async function answerFollowUp(params: FollowUpParams, apiKey: string): Promise<FollowUpResult> {
  const client = new OpenAI({ apiKey, baseURL: IDENTIFY_CONFIG.openrouterBaseUrl });
  const response = await requestFollowUp(client, params);

  const choice = response.choices[0];
  const content = choice.message.content;
  if (!content) throw new Error("Empty response from AI provider");
  if (choice.finish_reason === "length") {
    throw new Error(`AI response truncated at max_tokens (${IDENTIFY_CONFIG.followUpMaxTokens})`);
  }
  const parsed = FollowUpResultSchema.safeParse(parseModelJson(content));
  if (!parsed.success) throw new Error("Malformed AI response");
  return parsed.data;
}

/**
 * One follow-up completion. Retries a transient upstream rate limit embedded in
 * an otherwise-200 response, and falls back from the active model to the free
 * tier when the active one stays rate-limited.
 */
async function requestFollowUp(client: OpenAI, params: FollowUpParams): Promise<OpenAI.Chat.ChatCompletion> {
  return withModelFallback([IDENTIFY_CONFIG.model, IDENTIFY_CONFIG.fallbackModel], (model) =>
    createFollowUpCompletion(client, params, model),
  );
}

async function createFollowUpCompletion(
  client: OpenAI,
  params: FollowUpParams,
  model: string,
): Promise<OpenAI.Chat.ChatCompletion> {
  // Unlike identification, this path intentionally leaves the model's reasoning
  // enabled. Disabling it was investigated as a truncation cause and ruled out
  // (re-enabling reproduced the cut byte-for-byte; reasoning_tokens was 0), and
  // the generous followUpMaxTokens budget plus the finish_reason==="length"
  // guard cover the truncation risk. See context/changes/follow-up-rate-limit-fix.
  try {
    return await client.chat.completions.create({
      model,
      max_tokens: IDENTIFY_CONFIG.followUpMaxTokens,
      messages: followUpMessages(params, FOLLOW_UP_SYSTEM_PROMPT),
      response_format: {
        type: "json_schema",
        json_schema: { name: "follow_up", strict: true, schema: followUpSchema },
      },
    });
  } catch (err) {
    // Fallback: some models reject strict json_schema with a 400 — retry with
    // json_object and the expected shape appended to the prompt.
    if (err instanceof OpenAI.APIError && err.status === 400) {
      return await client.chat.completions.create({
        model,
        max_tokens: IDENTIFY_CONFIG.followUpMaxTokens,
        messages: followUpMessages(params, FOLLOW_UP_SYSTEM_PROMPT + FOLLOW_UP_JSON_SHAPE_HINT),
        response_format: { type: "json_object" },
      });
    }
    throw err;
  }
}

function followUpMessages(params: FollowUpParams, systemPrompt: string): OpenAI.Chat.ChatCompletionMessageParam[] {
  const { base64, anchor, history, question } = params;
  return [
    { role: "system", content: systemPrompt },
    {
      role: "user",
      content: [
        { type: "image_url", image_url: { url: `data:image/jpeg;base64,${base64}` } },
        { type: "text", text: contextText(anchor) },
      ],
    },
    ...history.flatMap((turn): OpenAI.Chat.ChatCompletionMessageParam[] => [
      { role: "user", content: turn.question },
      { role: "assistant", content: turn.answer },
    ]),
    { role: "user", content: question },
  ];
}

function contextText(anchor: FollowUpAnchor | null): string {
  if (!anchor) return FOLLOW_UP_CONTEXT_PREAMBLE;
  return `${FOLLOW_UP_CONTEXT_PREAMBLE}\n\nIdentified subject: ${anchor.subjectName}\n${anchor.description}`;
}
