import { GET, POST } from "@/pages/api/archive/folders";
import { PATCH, DELETE } from "@/pages/api/archive/folders/[id]";
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

const { mockListFolders, mockGetFolderById, mockCreateFolder, mockRenameFolder, mockDeleteFolder } = vi.hoisted(() => ({
  mockListFolders: vi.fn().mockResolvedValue([]),
  mockGetFolderById: vi.fn().mockResolvedValue({ id: "folder-1", name: "TestFolder" }),
  mockCreateFolder: vi.fn().mockResolvedValue({ id: "folder-new" }),
  mockRenameFolder: vi.fn().mockResolvedValue(undefined),
  mockDeleteFolder: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/archive/folders", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/archive/folders")>();
  return {
    ...actual,
    listFolders: mockListFolders,
    getFolderById: mockGetFolderById,
    createFolder: mockCreateFolder,
    renameFolder: mockRenameFolder,
    deleteFolder: mockDeleteFolder,
  };
});

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireSupabaseClient.mockReturnValue({});
  mockRequireAuthenticatedUser.mockResolvedValue({ id: "user-123" });
  mockListFolders.mockResolvedValue([]);
  mockGetFolderById.mockResolvedValue({ id: "folder-1", name: "TestFolder" });
  mockCreateFolder.mockResolvedValue({ id: "folder-new" });
  mockRenameFolder.mockResolvedValue(undefined);
  mockDeleteFolder.mockResolvedValue(undefined);
});

describe("GET /api/archive/folders", () => {
  it("returns 401 when unauthenticated", async () => {
    mockRequireAuthenticatedUser.mockRejectedValueOnce(new HttpError(401, { error: "Unauthorised" }));
    const response = await GET(makeAPIContext(null, { method: "GET" }));
    expect(response.status).toBe(401);
    const body = await response.json();
    expect((body as Record<string, unknown>).error).toBe("Unauthorised");
  });

  it("returns 200 with folder list when authenticated", async () => {
    const folders = [
      { id: "folder-1", name: "Uncategorized", photoCount: 0, createdAt: "2024-01-01" },
      { id: "folder-2", name: "Travels", photoCount: 3, createdAt: "2024-01-02" },
    ];
    mockListFolders.mockResolvedValueOnce(folders);

    const response = await GET(makeAPIContext(null, { method: "GET" }));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { folders: typeof folders };
    expect(body.folders).toEqual(folders);
  });
});

describe("POST /api/archive/folders", () => {
  it("creates a folder and returns 201 with the new id", async () => {
    const response = await POST(makeAPIContext(JSON.stringify({ name: "New Folder" })));
    expect(response.status).toBe(201);
    const body = (await response.json()) as { id: string };
    expect(body.id).toBe("folder-new");
    expect(mockCreateFolder).toHaveBeenCalledWith({}, "user-123", "New Folder");
  });

  it("returns 400 when name is 'Uncategorized'", async () => {
    const response = await POST(makeAPIContext(JSON.stringify({ name: "Uncategorized" })));
    expect(response.status).toBe(400);
    expect(mockCreateFolder).not.toHaveBeenCalled();
  });

  it("returns 400 when name is missing", async () => {
    const response = await POST(makeAPIContext(JSON.stringify({})));
    expect(response.status).toBe(400);
  });
});

describe("PATCH /api/archive/folders/[id]", () => {
  it("renames a folder and returns 200", async () => {
    const response = await PATCH(
      makeAPIContext(JSON.stringify({ name: "Renamed" }), { method: "PATCH", params: { id: "folder-1" } }),
    );
    expect(response.status).toBe(200);
    expect(mockRenameFolder).toHaveBeenCalledWith({}, "user-123", "folder-1", "Renamed");
  });

  it("returns 403 when renaming the Uncategorized folder", async () => {
    mockGetFolderById.mockResolvedValueOnce({ id: "folder-1", name: "Uncategorized" });
    const response = await PATCH(
      makeAPIContext(JSON.stringify({ name: "Something Else" }), { method: "PATCH", params: { id: "folder-1" } }),
    );
    expect(response.status).toBe(403);
    expect(mockRenameFolder).not.toHaveBeenCalled();
  });

  it("returns 400 when trying to set name to 'Uncategorized'", async () => {
    const response = await PATCH(
      makeAPIContext(JSON.stringify({ name: "Uncategorized" }), { method: "PATCH", params: { id: "folder-1" } }),
    );
    expect(response.status).toBe(400);
    expect(mockRenameFolder).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/archive/folders/[id]", () => {
  it("deletes an empty folder and returns 200", async () => {
    const response = await DELETE(makeAPIContext(null, { method: "DELETE", params: { id: "folder-1" } }));
    expect(response.status).toBe(200);
    expect(mockDeleteFolder).toHaveBeenCalledWith({}, "user-123", "folder-1");
  });

  it("returns 409 when folder is not empty", async () => {
    mockDeleteFolder.mockRejectedValueOnce(new HttpError(409, { error: "Folder is not empty" }));
    const response = await DELETE(makeAPIContext(null, { method: "DELETE", params: { id: "folder-1" } }));
    expect(response.status).toBe(409);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe("Folder is not empty");
  });

  it("returns 403 when deleting the Uncategorized folder", async () => {
    mockGetFolderById.mockResolvedValueOnce({ id: "folder-1", name: "Uncategorized" });
    const response = await DELETE(makeAPIContext(null, { method: "DELETE", params: { id: "folder-1" } }));
    expect(response.status).toBe(403);
    expect(mockDeleteFolder).not.toHaveBeenCalled();
  });
});
