import { POST } from "@/pages/api/auth/forgot-password";
import { makeAPIContext } from "../helpers/route";

const { mockResetPasswordForEmail } = vi.hoisted(() => ({
  mockResetPasswordForEmail: vi.fn().mockResolvedValue({ error: null }),
}));

vi.mock("@/lib/supabase", () => ({
  createClient: vi.fn(() => ({
    auth: { resetPasswordForEmail: mockResetPasswordForEmail },
  })),
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockResetPasswordForEmail.mockResolvedValue({ error: null });
});

function makeFormData(email = "user@example.com"): FormData {
  const form = new FormData();
  form.append("email", email);
  return form;
}

describe("forgot-password route — happy path", () => {
  it("calls resetPasswordForEmail with a redirectTo containing /auth/callback?next= and redirects to ?sent=true", async () => {
    const response = await POST(makeAPIContext(makeFormData()));

    expect(mockResetPasswordForEmail).toHaveBeenCalledOnce();
    const [, options] = mockResetPasswordForEmail.mock.calls[0] as [string, { redirectTo: string }];
    expect(options.redirectTo).toContain("/auth/callback?next=");

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toContain("?sent=true");
  });
});

describe("forgot-password route — Supabase error (no email enumeration)", () => {
  it("still redirects to ?sent=true even when Supabase returns an error", async () => {
    mockResetPasswordForEmail.mockResolvedValueOnce({ error: { message: "Email not found" } });

    const response = await POST(makeAPIContext(makeFormData("unknown@example.com")));

    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toContain("?sent=true");
  });
});
