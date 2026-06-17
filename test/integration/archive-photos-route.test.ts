import { GET } from "@/pages/api/archive/photos";
import { PATCH, DELETE } from "@/pages/api/archive/photos/[id]";
import { HttpError } from "@/lib/api/http";
import { makeAPIContext } from "../helpers/route";

const { mockRequireSupabaseClient, mockRequireAuthenticatedUser } = vi.hoisted(() => ({
  mockRequireSupabaseClient: vi.fn().mockReturnValue({}),
  mockRequireAuthenticatedUser: vi.fn().mockResolvedValue({ id: "user-123" }),
}));

vi.mock("@/lib/api/auth", () => ({
  requireSupabaseClient: mockRequireSupabaseClient,
  requireAuthenticatedUser: mockRequireAuthenticatedUser,
}));

const { mockListPhotos, mockMovePhoto, mockDeletePhotoRecord, mockDeletePhotoFromStorage } = vi.hoisted(() => ({
  mockListPhotos: vi.fn().mockResolvedValue([]),
  mockMovePhoto: vi.fn().mockResolvedValue(undefined),
  mockDeletePhotoRecord: vi
    .fn()
    .mockResolvedValue({ storagePath: "user-123/photo-1.jpg", thumbnailPath: "user-123/photo-1_thumb.jpg" }),
  mockDeletePhotoFromStorage: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/archive/photos", () => ({
  listPhotos: mockListPhotos,
  movePhoto: mockMovePhoto,
  deletePhotoRecord: mockDeletePhotoRecord,
  deletePhotoFromStorage: mockDeletePhotoFromStorage,
}));

const { mockGetFolderById } = vi.hoisted(() => ({
  mockGetFolderById: vi.fn().mockResolvedValue({ id: "folder-2", name: "Travels" }),
}));

vi.mock("@/lib/archive/folders", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/archive/folders")>();
  return {
    ...actual,
    getFolderById: mockGetFolderById,
  };
});

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireSupabaseClient.mockReturnValue({});
  mockRequireAuthenticatedUser.mockResolvedValue({ id: "user-123" });
  mockListPhotos.mockResolvedValue([]);
  mockMovePhoto.mockResolvedValue(undefined);
  mockDeletePhotoRecord.mockResolvedValue({
    storagePath: "user-123/photo-1.jpg",
    thumbnailPath: "user-123/photo-1_thumb.jpg",
  });
  mockDeletePhotoFromStorage.mockResolvedValue(undefined);
  mockGetFolderById.mockResolvedValue({ id: "folder-2", name: "Travels" });
});

describe("GET /api/archive/photos", () => {
  it("returns 401 when unauthenticated", async () => {
    mockRequireAuthenticatedUser.mockRejectedValueOnce(new HttpError(401, { error: "Unauthorised" }));
    const response = await GET(makeAPIContext(null, { method: "GET" }));
    expect(response.status).toBe(401);
  });

  it("returns 200 with identified photos including non-empty signedUrl fields", async () => {
    const photos = [
      {
        id: "photo-1",
        signedUrl: "https://cdn.example.com/signed/photo.jpg",
        subjectName: "Eiffel Tower",
        folderId: "folder-1",
        createdAt: "2024-01-01",
      },
    ];
    mockListPhotos.mockResolvedValueOnce(photos);

    const response = await GET(makeAPIContext(null, { method: "GET", url: "http://localhost/api/archive/photos" }));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { photos: typeof photos };
    expect(body.photos).toHaveLength(1);
    expect(body.photos[0].signedUrl).toBeTruthy();
  });
});

describe("PATCH /api/archive/photos/[id]", () => {
  it("moves a photo to a target folder and returns 200", async () => {
    const response = await PATCH(
      makeAPIContext(JSON.stringify({ folderId: "folder-2" }), {
        method: "PATCH",
        params: { id: "photo-1" },
      }),
    );
    expect(response.status).toBe(200);
    expect(mockMovePhoto).toHaveBeenCalledWith(
      {},
      {
        userId: "user-123",
        photoId: "photo-1",
        targetFolderId: "folder-2",
      },
    );
  });

  it("returns 404 when target folder does not belong to user", async () => {
    mockGetFolderById.mockResolvedValueOnce(null);
    const response = await PATCH(
      makeAPIContext(JSON.stringify({ folderId: "folder-other" }), {
        method: "PATCH",
        params: { id: "photo-1" },
      }),
    );
    expect(response.status).toBe(404);
    expect(mockMovePhoto).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/archive/photos/[id]", () => {
  it("deletes the photo row and storage object, returns 200", async () => {
    const response = await DELETE(makeAPIContext(null, { method: "DELETE", params: { id: "photo-1" } }));
    expect(response.status).toBe(200);
    expect(mockDeletePhotoRecord).toHaveBeenCalledWith({}, { userId: "user-123", photoId: "photo-1" });
    expect(mockDeletePhotoFromStorage).toHaveBeenCalledWith({}, ["user-123/photo-1.jpg", "user-123/photo-1_thumb.jpg"]);
  });

  it("still returns 200 when storage deletion fails (orphan accepted risk)", async () => {
    mockDeletePhotoFromStorage.mockRejectedValueOnce(new HttpError(502, { error: "Storage error" }));
    const response = await DELETE(makeAPIContext(null, { method: "DELETE", params: { id: "photo-1" } }));
    expect(response.status).toBe(200);
  });

  it("returns 404 when photo does not exist", async () => {
    mockDeletePhotoRecord.mockRejectedValueOnce(new HttpError(404, { error: "Photo not found" }));
    const response = await DELETE(makeAPIContext(null, { method: "DELETE", params: { id: "photo-missing" } }));
    expect(response.status).toBe(404);
  });
});
