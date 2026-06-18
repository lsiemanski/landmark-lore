import { POST } from "@/pages/api/archive/photos";
import { makeAPIContext } from "../helpers/route";

const REQUEST_ID = "a1b2c3d4-e5f6-4789-a012-b34c56d78e90";

// POST /api/archive/photos is the explicit "save to archive" step: identify
// persists nothing, so this is the only place a photo + identification row is
// written and the image is uploaded to storage.
const {
  mockGetUser,
  mockStorageUpload,
  mockPhotoInsert,
  mockPhotoMaybeSingle,
  mockIdentificationInsert,
  mockFolderSingle,
  mockFolderMaybeSingle,
} = vi.hoisted(() => ({
  mockGetUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-123" } }, error: null }),
  mockStorageUpload: vi.fn().mockResolvedValue({ data: {}, error: null }),
  mockPhotoInsert: vi.fn().mockResolvedValue({ data: null, error: null }),
  mockPhotoMaybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
  mockIdentificationInsert: vi.fn().mockResolvedValue({ data: null, error: null }),
  mockFolderSingle: vi.fn().mockResolvedValue({ data: { id: "folder-123", name: "Trips" }, error: null }),
  mockFolderMaybeSingle: vi.fn().mockResolvedValue({ data: { id: "unc-1" }, error: null }),
}));

vi.mock("@/lib/supabase", () => ({
  createClient: vi.fn(() => ({
    auth: { getUser: mockGetUser },
    from: vi.fn().mockImplementation((table: string) => {
      if (table === "folders") {
        const chain = {
          select: vi.fn(),
          eq: vi.fn(),
          limit: vi.fn(),
          single: mockFolderSingle,
          maybeSingle: mockFolderMaybeSingle,
        };
        chain.select.mockReturnValue(chain);
        chain.eq.mockReturnValue(chain);
        chain.limit.mockReturnValue(chain);
        return chain;
      }
      if (table === "photos") {
        const chain = {
          insert: mockPhotoInsert,
          select: vi.fn(),
          eq: vi.fn(),
          maybeSingle: mockPhotoMaybeSingle,
        };
        chain.select.mockReturnValue(chain);
        chain.eq.mockReturnValue(chain);
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
  mockStorageUpload.mockResolvedValue({ data: {}, error: null });
  mockPhotoInsert.mockResolvedValue({ data: null, error: null });
  mockPhotoMaybeSingle.mockResolvedValue({ data: null, error: null });
  mockIdentificationInsert.mockResolvedValue({ data: null, error: null });
  mockFolderSingle.mockResolvedValue({ data: { id: "folder-123", name: "Trips" }, error: null });
  mockFolderMaybeSingle.mockResolvedValue({ data: { id: "unc-1" }, error: null });
});

interface Payload {
  subjectName: string;
  description: string;
  folderId?: string;
  requestId: string;
}

function makeFormData(payload: Partial<Payload> = {}, opts: { withThumbnail?: boolean; omitPayload?: boolean } = {}) {
  const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
  const form = new FormData();
  form.append("photo", new File([bytes], "photo.jpg", { type: "image/jpeg" }));
  if (opts.withThumbnail) form.append("thumbnail", new File([bytes], "thumbnail.jpg", { type: "image/jpeg" }));
  if (!opts.omitPayload) {
    const body: Payload = {
      subjectName: "Eiffel Tower",
      description: "A famous Parisian landmark.",
      requestId: REQUEST_ID,
      ...payload,
    };
    form.append("payload", JSON.stringify(body));
  }
  return form;
}

describe("POST /api/archive/photos — save to archive", () => {
  it("persists the photo + identification and returns 201 with a photoId", async () => {
    const response = await POST(makeAPIContext(makeFormData({ folderId: "folder-123" }, { withThumbnail: true })));
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(typeof body.photoId).toBe("string");
    expect(body.photoId).toBeTruthy();
    // Photo + thumbnail uploaded; both rows written.
    expect(mockStorageUpload).toHaveBeenCalledTimes(2);
    expect(mockPhotoInsert).toHaveBeenCalledOnce();
    expect(mockIdentificationInsert).toHaveBeenCalledOnce();
    expect(mockIdentificationInsert).toHaveBeenCalledWith(
      expect.objectContaining({ subject_name: "Eiffel Tower", description: "A famous Parisian landmark." }),
    );
  });

  it("commits any follow-up enrichments carried in the payload", async () => {
    const response = await POST(
      makeAPIContext(
        makeFormData({
          folderId: "folder-123",
          subjectName: "Statue of Liberty",
          description: "A neoclassical sculpture in New York Harbor.",
        }),
      ),
    );
    expect(response.status).toBe(201);
    expect(mockIdentificationInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        subject_name: "Statue of Liberty",
        description: "A neoclassical sculpture in New York Harbor.",
      }),
    );
  });

  it("dedupes a replayed save: a unique-violation returns the existing photoId with 200", async () => {
    // Same requestId saved twice — the (user_id, request_id) index rejects the
    // second insert; the route must return the original photo, not a 500.
    mockPhotoInsert.mockResolvedValueOnce({ data: null, error: { code: "23505" } });
    mockPhotoMaybeSingle.mockResolvedValueOnce({ data: { id: "existing-photo-1" }, error: null });

    const response = await POST(makeAPIContext(makeFormData({ folderId: "folder-123" })));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.photoId).toBe("existing-photo-1");
    // No identification row is written on a replay.
    expect(mockIdentificationInsert).not.toHaveBeenCalled();
  });

  it("falls back to the default folder when none is supplied", async () => {
    const response = await POST(makeAPIContext(makeFormData()));
    expect(response.status).toBe(201);
    expect(mockFolderMaybeSingle).toHaveBeenCalled(); // lookupDefaultFolder
    expect(mockFolderSingle).not.toHaveBeenCalled();
  });

  it("returns 404 when the supplied folder is not owned by the user", async () => {
    mockFolderSingle.mockResolvedValueOnce({ data: null, error: new Error("not found") });
    const response = await POST(makeAPIContext(makeFormData({ folderId: "someone-elses" })));
    expect(response.status).toBe(404);
    expect(mockPhotoInsert).not.toHaveBeenCalled();
  });

  it("returns 401 when unauthenticated", async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: null }, error: null });
    const response = await POST(makeAPIContext(makeFormData()));
    expect(response.status).toBe(401);
    expect(mockPhotoInsert).not.toHaveBeenCalled();
  });

  it("returns 400 when the payload is missing", async () => {
    const response = await POST(makeAPIContext(makeFormData({}, { omitPayload: true })));
    expect(response.status).toBe(400);
  });

  it("returns 400 when the request_id is not a valid UUID", async () => {
    const response = await POST(makeAPIContext(makeFormData({ requestId: "not-a-uuid" })));
    expect(response.status).toBe(400);
  });

  it("returns 415 when no photo is supplied", async () => {
    const form = new FormData();
    form.append("payload", JSON.stringify({ subjectName: "x", description: "y", requestId: REQUEST_ID }));
    const response = await POST(makeAPIContext(form));
    expect(response.status).toBe(415);
  });
});
