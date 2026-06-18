import type OpenAI from "openai";

export function makeCompletionResponse(content: string | null): OpenAI.Chat.ChatCompletion {
  return {
    id: "chatcmpl-test",
    object: "chat.completion" as const,
    created: Math.floor(Date.now() / 1000),
    model: "google/gemini-2.5-flash",
    choices: [
      {
        index: 0,
        message: { role: "assistant" as const, content, refusal: null },
        finish_reason: "stop" as const,
        logprobs: null,
      },
    ],
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
  };
}

/**
 * An OpenRouter completion carrying an upstream error embedded on the choice —
 * the HTTP-200 shape OpenRouter returns when the provider throttles or fails
 * part-way through the stream, leaving the JSON body truncated.
 */
export function makeEmbeddedErrorResponse(code: number, content = "{\n  "): OpenAI.Chat.ChatCompletion {
  const response = makeCompletionResponse(content);
  (response.choices[0] as { error?: { code: number; message: string } }).error = {
    code,
    message: "JSON error injected into SSE stream",
  };
  return response;
}
