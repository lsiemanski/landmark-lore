import { http, HttpResponse } from "msw";
import OpenAI from "openai";
import { answerFollowUp, type FollowUpParams } from "@/lib/ai/follow-up";
import { server } from "../msw/server";
import { makeCompletionResponse } from "../helpers/openrouter";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

const baseParams: FollowUpParams = {
  base64: "base64data",
  anchor: { subjectName: "Eiffel Tower", description: "A famous Parisian landmark" },
  history: [],
  question: "Who designed it?",
};

describe("answerFollowUp", () => {
  it("resolves with { answer, enrichedDescription } for a normal completion", async () => {
    server.use(
      http.post(OPENROUTER_URL, () =>
        HttpResponse.json(
          makeCompletionResponse(
            JSON.stringify({
              answer: "Gustave Eiffel's company designed it.",
              enrichedDescription: "A famous Parisian landmark, designed by Gustave Eiffel's company.",
            }),
          ),
        ),
      ),
    );
    const result = await answerFollowUp(baseParams, "test-api-key");
    expect(result).toEqual({
      answer: "Gustave Eiffel's company designed it.",
      enrichedDescription: "A famous Parisian landmark, designed by Gustave Eiffel's company.",
    });
  });

  it("replays the prior Q&A history and the new question in the request body", async () => {
    let messages: { role: string; content: unknown }[] = [];
    server.use(
      http.post(OPENROUTER_URL, async ({ request }) => {
        const body = (await request.json()) as { messages: typeof messages };
        messages = body.messages;
        return HttpResponse.json(
          makeCompletionResponse(JSON.stringify({ answer: "It was completed in 1889.", enrichedDescription: "" })),
        );
      }),
    );

    await answerFollowUp(
      {
        ...baseParams,
        history: [{ question: "What is it?", answer: "The Eiffel Tower." }],
        question: "And when was it built?",
      },
      "test-api-key",
    );

    const textContents = messages.map((m) => (typeof m.content === "string" ? m.content : JSON.stringify(m.content)));
    expect(textContents.some((t) => t.includes("What is it?"))).toBe(true);
    expect(textContents.some((t) => t.includes("The Eiffel Tower."))).toBe(true);
    expect(textContents.some((t) => t.includes("And when was it built?"))).toBe(true);
    // The image is re-sent on every follow-up.
    expect(textContents.some((t) => t.includes("data:image/jpeg;base64,base64data"))).toBe(true);
  });

  it('throws "Empty response from AI provider" when content is null', async () => {
    server.use(http.post(OPENROUTER_URL, () => HttpResponse.json(makeCompletionResponse(null))));
    await expect(answerFollowUp(baseParams, "test-api-key")).rejects.toThrow("Empty response from AI provider");
  });

  it('throws "Malformed AI response" for valid JSON missing required fields', async () => {
    server.use(http.post(OPENROUTER_URL, () => HttpResponse.json(makeCompletionResponse('{"answer":"hi"}'))));
    await expect(answerFollowUp(baseParams, "test-api-key")).rejects.toThrow("Malformed AI response");
  });

  it("retries with json_object format on 400; makes exactly 2 calls", async () => {
    let calls = 0;
    server.use(
      http.post(OPENROUTER_URL, () => {
        calls++;
        if (calls === 1) {
          return HttpResponse.json(
            { error: { message: "json_schema not supported", type: "invalid_request_error" } },
            { status: 400 },
          );
        }
        return HttpResponse.json(
          makeCompletionResponse(JSON.stringify({ answer: "An answer.", enrichedDescription: "Updated." })),
        );
      }),
    );
    await answerFollowUp(baseParams, "test-api-key");
    expect(calls).toBe(2);
  });

  it("rejects with OpenAI.APIError for a non-400 HTTP error", async () => {
    server.use(
      http.post(
        OPENROUTER_URL,
        () =>
          // Null body: avoids CancelReadableStream hang (SDK cancels body before retry).
          // Retry-After: 0: eliminates backoff sleep so all 3 SDK attempts finish fast.
          new HttpResponse(null, { status: 500, headers: { "Retry-After": "0" } }),
      ),
    );
    await expect(answerFollowUp(baseParams, "test-api-key")).rejects.toBeInstanceOf(OpenAI.APIError);
  }, 15_000);
});
