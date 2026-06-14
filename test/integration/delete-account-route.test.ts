import { POST } from "@/pages/api/auth/delete-account";
import { makeAPIContext } from "../helpers/route";

const { mockGetUser, mockSignInWithPassword, mockSignOut } = vi.hoisted(() => ({
  mockGetUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-123", email: "test@example.com" } } }),
  mockSignInWithPassword: vi.fn().mockResolvedValue({ error: null }),
  mockSignOut: vi.fn().mockResolvedValue({ error: null }),
}));

const { mockStorageList, mockStorageRemove, mockDeleteUser } = vi.hoisted(() => ({
  mockStorageList: vi.fn().mockResolvedValue({ data: [], error: null }),
  mockStorageRemove: vi.fn().mockResolvedValue({ data: [], error: null }),
  mockDeleteUser: vi.fn().mockResolvedValue({ error: null }),
}));

vi.mock("@/lib/supabase", () => ({
  createClient: vi.fn(() => ({
    auth: {
      getUser: mockGetUser,
      signInWithPassword: mockSignInWithPassword,
      signOut: mockSignOut,
    },
  })),
}));

vi.mock("@/lib/supabase-admin", () => ({
  createAdminClient: vi.fn(() => ({
    storage: {
      from: vi.fn().mockReturnValue({
        list: mockStorageList,
        remove: mockStorageRemove,
      }),
    },
    auth: {
      admin: {
        deleteUser: mockDeleteUser,
      },
    },
  })),
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockGetUser.mockResolvedValue({ data: { user: { id: "user-123", email: "test@example.com" } } });
  mockSignInWithPassword.mockResolvedValue({ error: null });
  mockSignOut.mockResolvedValue({ error: null });
  mockStorageList.mockResolvedValue({ data: [], error: null });
  mockStorageRemove.mockResolvedValue({ data: [], error: null });
  mockDeleteUser.mockResolvedValue({ error: null });
});

function makeJSONBody(password: string): string {
  return JSON.stringify({ password });
}

describe("delete-account route — wrong password", () => {
  it("returns 401 JSON and does not delete storage or user", async () => {
    mockSignInWithPassword.mockResolvedValueOnce({ error: { message: "Invalid credentials" } });

    const response = await POST(makeAPIContext(makeJSONBody("wrong-password")));

    expect(response.status).toBe(401);
    const body = await response.json();
    expect(body.error).toBe("Wrong password");
    expect(mockStorageList).not.toHaveBeenCalled();
    expect(mockStorageRemove).not.toHaveBeenCalled();
    expect(mockDeleteUser).not.toHaveBeenCalled();
  });
});

describe("delete-account route — success with files", () => {
  it("verifies password, deletes storage, deletes user, signs out, and returns { success: true }", async () => {
    mockStorageList
      .mockResolvedValueOnce({ data: [{ name: "photo.jpg" }], error: null })
      .mockResolvedValueOnce({ data: [], error: null });

    const response = await POST(makeAPIContext(makeJSONBody("correct-password")));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);

    expect(mockSignInWithPassword).toHaveBeenCalledOnce();
    expect(mockStorageList).toHaveBeenCalled();
    expect(mockStorageRemove).toHaveBeenCalledOnce();
    expect(mockDeleteUser).toHaveBeenCalledWith("user-123");
    expect(mockSignOut).toHaveBeenCalledOnce();
  });
});

describe("delete-account route — no storage files", () => {
  it("skips remove and still deletes user when list returns empty", async () => {
    mockStorageList.mockResolvedValueOnce({ data: [], error: null });

    const response = await POST(makeAPIContext(makeJSONBody("correct-password")));

    expect(response.status).toBe(200);
    expect(mockStorageRemove).not.toHaveBeenCalled();
    expect(mockDeleteUser).toHaveBeenCalledWith("user-123");
  });
});

describe("delete-account route — storage pagination", () => {
  it("pages through list until empty and removes all files across pages", async () => {
    const PAGE_SIZE = 100;
    const fullPage = Array.from({ length: PAGE_SIZE }, (_, i) => ({ name: `photo-${i}.jpg` }));

    // First call returns full page; second returns empty (files have been removed)
    mockStorageList
      .mockResolvedValueOnce({ data: fullPage, error: null })
      .mockResolvedValueOnce({ data: [], error: null });

    const response = await POST(makeAPIContext(makeJSONBody("correct-password")));

    expect(response.status).toBe(200);
    expect(mockStorageList.mock.calls.length).toBeGreaterThan(1);
    expect(mockStorageRemove).toHaveBeenCalledOnce();

    const [paths] = mockStorageRemove.mock.calls[0] as [string[]];
    expect(paths).toHaveLength(PAGE_SIZE);
    expect(paths[0]).toBe("user-123/photo-0.jpg");
    expect(paths[PAGE_SIZE - 1]).toBe(`user-123/photo-${PAGE_SIZE - 1}.jpg`);
  });
});
