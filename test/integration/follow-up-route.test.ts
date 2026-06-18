import { http, HttpResponse } from "msw";
import { POST } from "@/pages/api/follow-up";
import { server } from "../msw/server";
import { makeCompletionResponse, makeEmbeddedErrorResponse } from "../helpers/openrouter";
import { makeAPIContext } from "../helpers/route";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

const FOLLOW_UP_CONTENT = JSON.stringify({
  answer: "It was built in 1889.",
  enrichedDescription: "The Eiffel Tower, completed in 1889, stands 330 metres tall.",
  updatedSubjectName: "",
});

const { mockGetUser, mockRpc, mockIdentificationsUpdateEq, mockIdentificationsUpdate } = vi.hoisted(() => {
  const mockIdentificationsUpdateEq = vi.fn().mockResolvedValue({ error: null, count: 1 });
  const mockIdentificationsUpdate = vi.fn().mockReturnValue({ eq: mockIdentificationsUpdateEq });
  return {
    mockGetUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-123" } }, error: null }),
    mockRpc: vi.fn().mockResolvedValue({ data: { allowed: true, used: 1 }, error: null }),
    mockIdentificationsUpdateEq,
    mockIdentificationsUpdate,
  };
});

vi.mock("@/lib/supabase", () => ({
  createClient: vi.fn(() => ({
    auth: { getUser: mockGetUser },
    rpc: mockRpc,
    from: vi.fn().mockImplementation((table: string) => {
      if (table === "identifications") return { update: mockIdentificationsUpdate };
      return {};
    }),
  })),
}));

function makeFormData(payload: {
  anchor: { subjectName: string; description: string } | null;
  photoId?: string;
  history: { question: string; answer: string }[];
  question: string;
}): FormData {
  const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
  const file = new File([bytes], "photo.jpg", { type: "image/jpeg" });
  const form = new FormData();
  form.append("photo", file);
  form.append("payload", JSON.stringify(payload));
  return form;
}

function makeBasicPayload() {
  return {
    anchor: { subjectName: "Eiffel Tower", description: "A famous Parisian landmark." },
    history: [],
    question: "When was it built?",
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetUser.mockResolvedValue({ data: { user: { id: "user-123" } }, error: null });
  mockRpc.mockResolvedValue({ data: { allowed: true, used: 1 }, error: null });
  mockIdentificationsUpdateEq.mockResolvedValue({ error: null, count: 1 });
  mockIdentificationsUpdate.mockReturnValue({ eq: mockIdentificationsUpdateEq });
  server.use(http.post(OPENROUTER_URL, () => HttpResponse.json(makeCompletionResponse(FOLLOW_UP_CONTENT))));
});

// Risk 2.5 — happy path: 200 with answer
describe("Risk 2.5 — authenticated request returns 200 with answer", () => {
  it("returns 200 with an answer string", async () => {
    const response = await POST(makeAPIContext(makeFormData(makeBasicPayload())));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(typeof body.answer).toBe("string");
    expect(body.answer).toBe("It was built in 1889.");
  });
});

// Risk 2.6 — recognized: enriched description persisted and returned
describe("Risk 2.6 — recognized request persists and returns enriched description", () => {
  it("persists enriched description and returns it as description field", async () => {
    const payload = { ...makeBasicPayload(), photoId: "photo-abc" };
    const response = await POST(makeAPIContext(makeFormData(payload)));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.answer).toBe("It was built in 1889.");
    expect(body.description).toBe("The Eiffel Tower, completed in 1889, stands 330 metres tall.");
    expect(mockIdentificationsUpdate).toHaveBeenCalledWith({ description: body.description }, { count: "exact" });
    expect(mockIdentificationsUpdateEq).toHaveBeenCalledWith("photo_id", "photo-abc");
  });
});

// Risk 2.6b — recognized: a corrected subject name is persisted and returned
describe("Risk 2.6b — recognized request persists and returns a corrected subject name", () => {
  it("persists subject_name and returns it as subjectName when the model renames the subject", async () => {
    server.use(
      http.post(OPENROUTER_URL, () =>
        HttpResponse.json(
          makeCompletionResponse(
            JSON.stringify({
              answer: "It's actually the Statue of Liberty.",
              enrichedDescription: "The Statue of Liberty, a neoclassical sculpture in New York Harbor.",
              updatedSubjectName: "Statue of Liberty",
            }),
          ),
        ),
      ),
    );
    const payload = { ...makeBasicPayload(), photoId: "photo-abc" };
    const response = await POST(makeAPIContext(makeFormData(payload)));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.subjectName).toBe("Statue of Liberty");
    expect(mockIdentificationsUpdate).toHaveBeenCalledWith(
      {
        description: "The Statue of Liberty, a neoclassical sculpture in New York Harbor.",
        subject_name: "Statue of Liberty",
      },
      { count: "exact" },
    );
    expect(mockIdentificationsUpdateEq).toHaveBeenCalledWith("photo_id", "photo-abc");
  });

  it("does not persist or return a subject name when the model leaves it unchanged", async () => {
    const payload = { ...makeBasicPayload(), photoId: "photo-abc" };
    const response = await POST(makeAPIContext(makeFormData(payload)));
    const body = await response.json();
    expect(body.subjectName).toBeUndefined();
    expect(mockIdentificationsUpdate).toHaveBeenCalledWith({ description: body.description }, { count: "exact" });
  });
});

// Risk 2.7 — description persist fails: answer still returned, no refund
describe("Risk 2.7 — description persist failure does not affect the answer", () => {
  it("returns 200 with answer even when the description write fails", async () => {
    mockIdentificationsUpdateEq.mockResolvedValueOnce({ error: new Error("DB error") });
    const payload = { ...makeBasicPayload(), photoId: "photo-abc" };
    const response = await POST(makeAPIContext(makeFormData(payload)));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.answer).toBe("It was built in 1889.");
    // No refund on description failure
    expect(mockRpc).not.toHaveBeenCalledWith("refund_followup_usage", expect.anything());
  });
});

// Risk 2.8 — unauthenticated: 401 before quota consumed
describe("Risk 2.8 — unauthenticated request rejected before quota", () => {
  it("returns 401 without consuming a quota slot", async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: null }, error: null });
    const response = await POST(makeAPIContext(makeFormData(makeBasicPayload())));
    expect(response.status).toBe(401);
    expect(mockRpc).not.toHaveBeenCalled();
  });
});

// Risk 2.9 — quota exhausted: 429 with error/limit/used
describe("Risk 2.9 — daily cap exhausted returns 429", () => {
  it("returns 429 with error, limit, and used when the cap is exhausted", async () => {
    mockRpc.mockResolvedValueOnce({ data: { allowed: false, used: 200 }, error: null });
    const response = await POST(makeAPIContext(makeFormData(makeBasicPayload())));
    expect(response.status).toBe(429);
    const body = await response.json();
    expect(body.error).toBe("Daily limit reached");
    expect(typeof body.limit).toBe("number");
    expect(body.used).toBe(200);
  });
});

// Risk 2.10 — missing question: 400
describe("Risk 2.10 — missing question returns 400", () => {
  it("returns 400 when the question field is empty", async () => {
    const payload = { ...makeBasicPayload(), question: "" };
    const response = await POST(makeAPIContext(makeFormData(payload)));
    expect(response.status).toBe(400);
  });
});

// Risk 2.11 — AI failure: refund called and 502 returned
describe("Risk 2.11 — AI failure triggers refund and returns 502", () => {
  it("calls the refund RPC and returns 502 when the AI provider errors", async () => {
    server.use(http.post(OPENROUTER_URL, () => HttpResponse.error()));
    const response = await POST(makeAPIContext(makeFormData(makeBasicPayload())));
    expect(response.status).toBe(502);
    expect(mockRpc).toHaveBeenCalledWith("refund_followup_usage", { p_period: expect.any(String) });
  });
});

// Risk 2.11b — persistent upstream rate limit: refund called and 429 returned
describe("Risk 2.11b — persistent upstream rate limit returns 429", () => {
  it("refunds the slot and returns 429 when OpenRouter reports a sustained rate limit", async () => {
    server.use(http.post(OPENROUTER_URL, () => HttpResponse.json(makeEmbeddedErrorResponse(429))));
    const response = await POST(makeAPIContext(makeFormData(makeBasicPayload())));
    expect(response.status).toBe(429);
    const body = await response.json();
    expect(body.error).toMatch(/try again/i);
    expect(mockRpc).toHaveBeenCalledWith("refund_followup_usage", { p_period: expect.any(String) });
  });
});

// Risk 2.12 — outbound request includes history and image
describe("Risk 2.12 — outbound OpenRouter request includes history and image", () => {
  it("sends the replayed history turns and the base64 image to OpenRouter", async () => {
    let capturedBody: unknown;
    server.use(
      http.post(OPENROUTER_URL, async ({ request }) => {
        capturedBody = await request.json();
        return HttpResponse.json(makeCompletionResponse(FOLLOW_UP_CONTENT));
      }),
    );

    const payload = {
      anchor: { subjectName: "Eiffel Tower", description: "A famous landmark." },
      history: [{ question: "Where is it?", answer: "Paris, France." }],
      question: "When was it built?",
    };
    await POST(makeAPIContext(makeFormData(payload)));

    const body = capturedBody as { messages: { role: string; content: unknown }[] };
    const messages = body.messages;

    // System prompt first
    expect(messages[0].role).toBe("system");

    // Image present in the first user turn
    const firstUserTurn = messages[1];
    expect(firstUserTurn.role).toBe("user");
    const content = firstUserTurn.content as { type: string; image_url?: { url: string } }[];
    const imageBlock = content.find((c) => c.type === "image_url");
    expect(imageBlock?.image_url?.url).toMatch(/^data:image\/jpeg;base64,/);

    // History replayed: prior user question then assistant answer
    const historyUserTurn = messages.find((m) => m.role === "user" && m.content === "Where is it?");
    expect(historyUserTurn).toBeDefined();
    const historyAssistantTurn = messages.find((m) => m.role === "assistant" && m.content === "Paris, France.");
    expect(historyAssistantTurn).toBeDefined();

    // Final user turn is the new question
    const lastMessage = messages[messages.length - 1];
    expect(lastMessage.role).toBe("user");
    expect(lastMessage.content).toBe("When was it built?");
  });
});
