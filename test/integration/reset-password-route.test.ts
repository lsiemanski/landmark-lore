import { POST } from "@/pages/api/auth/reset-password";
import { makeAPIContext } from "../helpers/route";

const { mockGetUser, mockUpdateUser } = vi.hoisted(() => ({
  mockGetUser: vi.fn().mockResolvedValue({ data: { user: { id: "user-123" } } }),
  mockUpdateUser: vi.fn().mockResolvedValue({ error: null }),
}));

vi.mock("@/lib/supabase", () => ({
  createClient: vi.fn(() => ({
    auth: {
      getUser: mockGetUser,
      updateUser: mockUpdateUser,
    },
  })),
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockGetUser.mockResolvedValue({ data: { user: { id: "user-123" } } });
  mockUpdateUser.mockResolvedValue({ error: null });
});

function makeFormData(password: string, confirmPassword: string): FormData {
  const form = new FormData();
  form.append("password", password);
  form.append("confirmPassword", confirmPassword);
  return form;
}

describe("reset-password route — passwords mismatch", () => {
  it("redirects to ?error=passwords_mismatch and does not call updateUser", async () => {
    const response = await POST(makeAPIContext(makeFormData("abc123", "xyz789")));

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toContain("?error=passwords_mismatch");
    expect(mockUpdateUser).not.toHaveBeenCalled();
  });
});

describe("reset-password route — success", () => {
  it("calls updateUser with the new password and redirects to ?success=password_reset", async () => {
    const password = "new-secure-password-123";
    const response = await POST(makeAPIContext(makeFormData(password, password)));

    expect(mockUpdateUser).toHaveBeenCalledOnce();
    expect(mockUpdateUser).toHaveBeenCalledWith({ password });
    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toContain("?success=password_reset");
  });
});

describe("reset-password route — Supabase update error", () => {
  it("redirects to ?error=update_failed when updateUser returns an error", async () => {
    mockUpdateUser.mockResolvedValueOnce({ error: { message: "Password update failed" } });

    const password = "new-secure-password-123";
    const response = await POST(makeAPIContext(makeFormData(password, password)));

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toContain("?error=update_failed");
  });
});
