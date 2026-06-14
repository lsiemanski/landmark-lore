import { http, HttpResponse } from "msw";
import { POST } from "@/pages/api/identify";
import { server } from "../msw/server";
import { makeCompletionResponse } from "../helpers/openrouter";
import { makeAPIContext } from "../helpers/route";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

const REQUEST_ID = "a1b2c3d4-e5f6-4789-a012-b34c56d78e90";

// SHA-256 hex digest of the test photo bytes — computed once so cache-hit tests
// can supply the exact hash that hashPhoto() will derive from makeFormData().
let PHOTO_HASH = "";
beforeAll(async () => {
  const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  PHOTO_HASH = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
});

const { mockGetUser, mockRpc, mockStorageUpload, mockPhotoInsert, mockIdentificationInsert, mockPhotoMaybySingle } =
  vi.hoisted(() => ({
    mockGetUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-123" } }, error: null }),
    mockRpc: vi.fn().mockResolvedValue({ data: { allowed: true, used: 1 }, error: null }),
    mockStorageUpload: vi.fn().mockResolvedValue({ data: {}, error: null }),
    mockPhotoInsert: vi.fn().mockResolvedValue({ data: null, error: null }),
    mockIdentificationInsert: vi.fn().mockResolvedValue({ data: null, error: null }),
    mockPhotoMaybySingle: vi.fn().mockResolvedValue({ data: null, error: null }),
  }));

vi.mock("@/lib/supabase", () => ({
  createClient: vi.fn(() => ({
    auth: { getUser: mockGetUser },
    rpc: mockRpc,
    from: vi.fn().mockImplementation((table: string) => {
      if (table === "photos") {
        const chain = {
          select: vi.fn(),
          eq: vi.fn(),
          limit: vi.fn(),
          maybeSingle: mockPhotoMaybySingle,
          insert: mockPhotoInsert,
        };
        chain.select.mockReturnValue(chain);
        chain.eq.mockReturnValue(chain);
        chain.limit.mockReturnValue(chain);
        return chain;
      }
      if (table === "folders") {
        const chain = { select: vi.fn(), eq: vi.fn(), limit: vi.fn(), maybeSingle: vi.fn() };
        chain.select.mockReturnValue(chain);
        chain.eq.mockReturnValue(chain);
        chain.limit.mockReturnValue(chain);
        chain.maybeSingle.mockResolvedValue({ data: { id: "folder-123" }, error: null });
        return chain;
      }
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
  mockPhotoMaybySingle.mockResolvedValue({ data: null, error: null }); // cache miss by default
});

function makeFormData(): FormData {
  const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
  const file = new File([bytes], "photo.jpg", { type: "image/jpeg" });
  const form = new FormData();
  form.append("photo", file);
  form.append("request_id", REQUEST_ID);
  return form;
}

describe("Risk #1 — HTTP layer (route smoke test)", () => {
  it("returns 200 with recognised: true, a photoId, and persists to storage and DB", async () => {
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
    expect(typeof body.photoId).toBe("string");
    expect(body.photoId).toBeTruthy();
    expect(mockStorageUpload).toHaveBeenCalledOnce();
    expect(mockPhotoInsert).toHaveBeenCalledOnce();
    expect(mockIdentificationInsert).toHaveBeenCalledOnce();
  });

  it("returns 200 with recognised: false and no photoId; no storage or DB writes", async () => {
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
    form.append("request_id", REQUEST_ID);
    const response = await POST(makeAPIContext(form));
    expect(response.status).toBe(415);
  });

  it("returns 400 when request_id is missing", async () => {
    const form = new FormData();
    form.append("photo", new File([new Uint8Array([0xff, 0xd8])], "photo.jpg", { type: "image/jpeg" }));
    const response = await POST(makeAPIContext(form));
    expect(response.status).toBe(400);
  });
});

describe("Idempotency — request_id reuse (2.5 / 2.5b)", () => {
  const CACHED_PHOTO_ID = "photo-cached-uuid";
  const CACHED_RESULT = { subjectName: "Eiffel Tower", description: "A Parisian landmark" };

  it("2.5 — returns cached result without calling AI or consuming quota when photo matches", async () => {
    mockPhotoMaybySingle.mockResolvedValueOnce({
      data: {
        id: CACHED_PHOTO_ID,
        photo_hash: PHOTO_HASH, // same bytes → same hash → cache hit
        identifications: { subject_name: CACHED_RESULT.subjectName, description: CACHED_RESULT.description },
      },
      error: null,
    });

    const response = await POST(makeAPIContext(makeFormData()));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.photoId).toBe(CACHED_PHOTO_ID);
    expect(body.result.subjectName).toBe(CACHED_RESULT.subjectName);
    expect(mockRpc).not.toHaveBeenCalled(); // no quota slot consumed
    expect(mockPhotoInsert).not.toHaveBeenCalled(); // no duplicate row
  });

  it("2.5b — returns 409 when request_id was used with a different photo", async () => {
    mockPhotoMaybySingle.mockResolvedValueOnce({
      data: {
        id: CACHED_PHOTO_ID,
        photo_hash: "0000000000000000000000000000000000000000000000000000000000000000",
        identifications: { subject_name: "Other", description: "Other" },
      },
      error: null,
    });

    const response = await POST(makeAPIContext(makeFormData()));
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.error).toBe("request_id already used with a different photo");
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
