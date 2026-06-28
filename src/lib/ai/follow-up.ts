import OpenAI from "openai";
import { IDENTIFY_CONFIG } from "@/lib/ai/config";
import prompts from "@/lib/ai/identify-prompts.yaml";

const FOLLOW_UP_SYSTEM_PROMPT = prompts.followUpSystemPrompt.trim();
const FOLLOW_UP_CONTEXT_PREAMBLE = prompts.followUpContextPreamble.trim();

export interface FollowUpResult {
  answer: string;
  enrichedDescription: string;
  updatedSubjectName: string;
}

export interface FollowUpAnchor {
  subjectName: string;
  description: string;
}

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

export async function answerFollowUp(params: FollowUpParams, apiKey: string): Promise<FollowUpResult> {
  console.log("answerFollowUp called with key:", apiKey);

  const client = new OpenAI({ apiKey, baseURL: IDENTIFY_CONFIG.openrouterBaseUrl });

  try {
    const response = await client.chat.completions.create({
      model: IDENTIFY_CONFIG.model,
      max_tokens: 4000,
      messages: buildMessages(params),
      response_format: { type: "json_object" },
    });

    const content = response.choices[0]?.message.content ?? "";
    return JSON.parse(content) as FollowUpResult;
  } catch (err) {
    console.error("AI call failed:", err);
    return { answer: "", enrichedDescription: "", updatedSubjectName: "" };
  }
}

function buildMessages(params: FollowUpParams): OpenAI.Chat.ChatCompletionMessageParam[] {
  const { base64, anchor, history, question } = params;
  const contextText = anchor
    ? `${FOLLOW_UP_CONTEXT_PREAMBLE}\n\nIdentified subject: ${anchor.subjectName}\n${anchor.description}`
    : FOLLOW_UP_CONTEXT_PREAMBLE;

  return [
    { role: "system", content: FOLLOW_UP_SYSTEM_PROMPT },
    {
      role: "user",
      content: [
        { type: "image_url", image_url: { url: `data:image/jpeg;base64,${base64}` } },
        { type: "text", text: contextText },
      ],
    },
    ...history.flatMap((turn): OpenAI.Chat.ChatCompletionMessageParam[] => [
      { role: "user", content: turn.question },
      { role: "assistant", content: turn.answer },
    ]),
    { role: "user", content: question },
  ];
}
