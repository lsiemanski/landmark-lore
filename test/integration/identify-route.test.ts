import { http, HttpResponse } from "msw";
import type { APIContext } from "astro";
import { POST } from "@/pages/api/identify";
import { server } from "../msw/server";
import { makeCompletionResponse } from "../helpers/openrouter";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

vi.mock("@/lib/supabase", () => ({
  createClient: vi.fn(() => ({
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-123" } }, error: null }),
    },
    rpc: vi.fn().mockResolvedValue({ data: { allowed: true, used: 1 }, error: null }),
  })),
}));

function makeFormData(): FormData {
  const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
  const file = new File([bytes], "photo.jpg", { type: "image/jpeg" });
  const form = new FormData();
  form.append("photo", file);
  return form;
}

function makeContext(formData: FormData): APIContext {
  return {
    request: new Request("http://localhost/api/identify", {
      method: "POST",
      body: formData,
    }),
    cookies: {},
  } as unknown as APIContext;
}

describe("Risk #1 — HTTP layer (route smoke test)", () => {
  it("returns 200 with recognised: true", async () => {
    server.use(
      http.post(OPENROUTER_URL, () =>
        HttpResponse.json(
          makeCompletionResponse(
            '{"recognised":true,"subjectName":"Eiffel Tower","description":"A famous Parisian landmark"}',
          ),
        ),
      ),
    );
    const response = await POST(makeContext(makeFormData()));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.result.recognised).toBe(true);
  });

  it("returns 200 with recognised: false", async () => {
    server.use(
      http.post(OPENROUTER_URL, () =>
        HttpResponse.json(makeCompletionResponse('{"recognised":false,"subjectName":"","description":""}')),
      ),
    );
    const response = await POST(makeContext(makeFormData()));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.result.recognised).toBe(false);
  });
});
