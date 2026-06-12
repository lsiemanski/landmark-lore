import { http, HttpResponse } from "msw";
import OpenAI from "openai";
import { identifyImage } from "@/lib/ai/identification";
import { server } from "../msw/server";
import { makeCompletionResponse } from "../helpers/openrouter";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

describe("Risk #1 — recognition contract", () => {
  it("resolves with recognised: true and identification fields", async () => {
    server.use(
      http.post(OPENROUTER_URL, () =>
        HttpResponse.json(
          makeCompletionResponse(
            '{"recognised":true,"subjectName":"Eiffel Tower","description":"A famous Parisian landmark"}',
          ),
        ),
      ),
    );
    const result = await identifyImage("base64data", "test-api-key");
    expect(result).toMatchObject({
      recognised: true,
      subjectName: "Eiffel Tower",
      description: expect.any(String),
    });
  });

  it("resolves with recognised: false without throwing", async () => {
    server.use(
      http.post(OPENROUTER_URL, () =>
        HttpResponse.json(makeCompletionResponse('{"recognised":false,"subjectName":"","description":""}')),
      ),
    );
    const result = await identifyImage("base64data", "test-api-key");
    expect((result as { recognised: boolean }).recognised).toBe(false);
  });
});

describe("Risk #4 — provider error handling", () => {
  it('rejects with "Empty response from AI provider" when content is null', async () => {
    server.use(http.post(OPENROUTER_URL, () => HttpResponse.json(makeCompletionResponse(null))));
    await expect(identifyImage("base64data", "test-api-key")).rejects.toThrow("Empty response from AI provider");
  });

  it("rejects when content is non-JSON", async () => {
    server.use(http.post(OPENROUTER_URL, () => HttpResponse.json(makeCompletionResponse("not valid json at all"))));
    await expect(identifyImage("base64data", "test-api-key")).rejects.toThrow();
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
    await expect(identifyImage("base64data", "test-api-key")).rejects.toBeInstanceOf(OpenAI.APIError);
  }, 15_000);

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
          makeCompletionResponse('{"recognised":true,"subjectName":"Test Landmark","description":"A test"}'),
        );
      }),
    );
    await identifyImage("base64data", "test-api-key");
    expect(calls).toBe(2);
  });
});
