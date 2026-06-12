export function makeCompletionResponse(content: string | null) {
  return {
    id: "chatcmpl-test",
    object: "chat.completion" as const,
    created: Math.floor(Date.now() / 1000),
    model: "google/gemini-2.5-flash",
    choices: [
      {
        index: 0,
        message: { role: "assistant" as const, content },
        finish_reason: "stop" as const,
      },
    ],
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
  };
}
