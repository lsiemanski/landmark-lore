import { http, HttpResponse } from "msw";
import { POST } from "@/pages/api/identify";
import { server } from "../msw/server";
import { makeCompletionResponse } from "../helpers/openrouter";
import { makeAPIContext } from "../helpers/route";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

// Identification is read-only: it runs the AI and returns the result but
// persists nothing. A photo only enters the archive on an explicit save
// (POST /api/archive/photos), covered in save-photo-route.test.ts.
const { mockGetUser, mockRpc, mockStorageUpload, mockPhotoInsert, mockIdentificationInsert } = vi.hoisted(() => ({
  mockGetUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-123" } }, error: null }),
  mockRpc: vi.fn().mockResolvedValue({ data: { allowed: true, used: 1 }, error: null }),
  mockStorageUpload: vi.fn().mockResolvedValue({ data: {}, error: null }),
  mockPhotoInsert: vi.fn().mockResolvedValue({ data: null, error: null }),
  mockIdentificationInsert: vi.fn().mockResolvedValue({ data: null, error: null }),
}));

vi.mock("@/lib/supabase", () => ({
  createClient: vi.fn(() => ({
    auth: { getUser: mockGetUser },
    rpc: mockRpc,
    from: vi.fn().mockImplementation((table: string) => {
      if (table === "photos") return { insert: mockPhotoInsert };
      if (table === "identifications") return { insert: mockIdentificationInsert };
      return {};
    }),
    storage: { from: vi.fn().mockReturnValue({ upload: mockStorageUpload }) },
  })),
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockGetUser.mockResolvedValue({ data: { user: { id: "user-123" } }, error: null });
  mockRpc.mockResolvedValue({ data: { allowed: true, used: 1 }, error: null });
  mockStorageUpload.mockResolvedValue({ data: {}, error: null });
  mockPhotoInsert.mockResolvedValue({ data: null, error: null });
  mockIdentificationInsert.mockResolvedValue({ data: null, error: null });
});

function makeFormData(): FormData {
  const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
  const file = new File([bytes], "photo.jpg", { type: "image/jpeg" });
  const form = new FormData();
  form.append("photo", file);
  return form;
}

describe("Risk #1 — HTTP layer (route smoke test)", () => {
  it("returns 200 with the recognised result but persists nothing", async () => {
    server.use(
      http.post(OPENROUTER_URL, () =>
        HttpResponse.json(
          makeCompletionResponse(
            '{"recognised":true,"subjectName":"Eiffel Tower","description":"A famous Parisian landmark"}',
          ),
        ),
      ),
    );
    const response = await POST(makeAPIContext(makeFormData()));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.result.recognised).toBe(true);
    expect(body.result.subjectName).toBe("Eiffel Tower");
    // No photoId, and no storage or DB writes — saving is a separate, explicit step.
    expect(body.photoId).toBeUndefined();
    expect(mockStorageUpload).not.toHaveBeenCalled();
    expect(mockPhotoInsert).not.toHaveBeenCalled();
    expect(mockIdentificationInsert).not.toHaveBeenCalled();
  });

  it("returns 200 with recognised: false and no writes", async () => {
    server.use(
      http.post(OPENROUTER_URL, () =>
        HttpResponse.json(makeCompletionResponse('{"recognised":false,"subjectName":"","description":""}')),
      ),
    );
    const response = await POST(makeAPIContext(makeFormData()));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.result.recognised).toBe(false);
    expect(body.photoId).toBeUndefined();
    expect(mockStorageUpload).not.toHaveBeenCalled();
    expect(mockPhotoInsert).not.toHaveBeenCalled();
    expect(mockIdentificationInsert).not.toHaveBeenCalled();
  });
});

describe("Risk #5 — unauthenticated request rejected before quota consumed", () => {
  it("returns 401 without consuming a quota slot", async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: null }, error: null });
    const response = await POST(makeAPIContext(makeFormData()));
    expect(response.status).toBe(401);
    expect(mockRpc).not.toHaveBeenCalled();
  });
});

describe("Risk #6 — server-side upload validation", () => {
  it("returns 415 for a disallowed MIME type", async () => {
    const form = new FormData();
    form.append("photo", new File([new Uint8Array([0])], "file.gif", { type: "image/gif" }));
    const response = await POST(makeAPIContext(form));
    expect(response.status).toBe(415);
  });

  it("returns 415 when no photo is supplied", async () => {
    const response = await POST(makeAPIContext(new FormData()));
    expect(response.status).toBe(415);
  });
});

describe("Quota — daily limit enforcement (2.8)", () => {
  it("returns 429 with error, limit, and used when daily cap is exhausted", async () => {
    mockRpc.mockResolvedValueOnce({ data: { allowed: false, used: 100 }, error: null });
    const response = await POST(makeAPIContext(makeFormData()));
    expect(response.status).toBe(429);
    const body = await response.json();
    expect(body.error).toBe("Daily limit reached");
    expect(typeof body.limit).toBe("number");
    expect(body.used).toBe(100);
  });
});
