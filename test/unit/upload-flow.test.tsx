// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse, delay } from "msw";
import { server } from "../msw/server";
import UploadFlow from "@/components/identify/UploadFlow";

// Canvas / createImageBitmap aren't implemented in happy-dom, so stub the
// downscale step out — its own scaling logic is covered in downscale.test.ts.
vi.mock("@/lib/client/downscale", () => ({
  downscaleWithThumbnail: vi.fn((blob: Blob) => Promise.resolve({ image: blob, thumbnail: blob })),
}));

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

let createObjectURL: ReturnType<typeof vi.fn>;
let revokeObjectURL: ReturnType<typeof vi.fn>;

function makeFile() {
  return new File(["fake-image-bytes"], "test.jpg", { type: "image/jpeg" });
}

function recognised(overrides?: Record<string, unknown>) {
  return {
    result: { recognised: true, subjectName: "Eiffel Tower", description: "An iron tower in Paris." },
    photoId: "photo-1",
    ...overrides,
  };
}

/** Drive idle → working: pick a file and click Identify. */
async function selectAndIdentify(user: ReturnType<typeof userEvent.setup>) {
  await user.upload(screen.getByLabelText("Choose a photo"), makeFile());
  await user.click(screen.getByRole("button", { name: /identify/i }));
}

beforeEach(() => {
  createObjectURL = vi.fn(() => "blob:preview");
  revokeObjectURL = vi.fn();
  URL.createObjectURL = createObjectURL as unknown as (obj: Blob | MediaSource) => string;
  URL.revokeObjectURL = revokeObjectURL as unknown as (url: string) => void;
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("UploadFlow — idle gate", () => {
  it("renders the file input and a disabled Identify button", () => {
    render(<UploadFlow />);
    expect(screen.getByLabelText("Choose a photo")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /identify/i })).toBeDisabled();
  });

  it("enables Identify once a file is selected", async () => {
    const user = userEvent.setup();
    render(<UploadFlow />);
    await user.upload(screen.getByLabelText("Choose a photo"), makeFile());
    expect(screen.getByRole("button", { name: /identify/i })).toBeEnabled();
  });
});

describe("UploadFlow — recognised result", () => {
  it("renders the subject, description and Save/Discard actions", async () => {
    server.use(
      http.post("*/api/identify", () => HttpResponse.json(recognised())),
      http.get("*/api/archive/folders", () =>
        HttpResponse.json({
          folders: [{ id: "unc-1", name: "Uncategorized", photoCount: 0, createdAt: "2026-01-01T00:00:00Z" }],
        }),
      ),
    );
    const user = userEvent.setup();
    render(<UploadFlow />);
    await selectAndIdentify(user);

    expect(await screen.findByRole("heading", { name: "Eiffel Tower" })).toBeInTheDocument();
    expect(screen.getByText("An iron tower in Paris.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /save to archive/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /discard/i })).toBeInTheDocument();
  });

  it("transitions to saved state and shows Identify another after Save", async () => {
    server.use(
      http.post("*/api/identify", () => HttpResponse.json(recognised())),
      http.get("*/api/archive/folders", () =>
        HttpResponse.json({
          folders: [{ id: "unc-1", name: "Uncategorized", photoCount: 0, createdAt: "2026-01-01T00:00:00Z" }],
        }),
      ),
    );
    const user = userEvent.setup();
    render(<UploadFlow />);
    await selectAndIdentify(user);
    await screen.findByRole("button", { name: /save to archive/i });

    await user.click(screen.getByRole("button", { name: /save to archive/i }));

    expect(await screen.findByText(/saved in/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /identify another/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /view in gallery/i })).toBeInTheDocument();
  });
});

describe("UploadFlow — unrecognized result", () => {
  it("shows the unrecognized panel with no Saved confirmation", async () => {
    server.use(
      http.post("*/api/identify", () =>
        HttpResponse.json({
          result: { recognised: false, subjectName: "", description: "Looks like a person, not a landmark." },
        }),
      ),
    );
    const user = userEvent.setup();
    render(<UploadFlow />);
    await selectAndIdentify(user);

    expect(await screen.findByRole("heading", { name: /couldn't identify this photo/i })).toBeInTheDocument();
    expect(screen.getByText("Looks like a person, not a landmark.")).toBeInTheDocument();
    expect(screen.queryByText("Saved to your archive")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /try another photo/i })).toBeInTheDocument();
  });
});

describe("UploadFlow — errors", () => {
  it("renders the quota panel with limit and used on 429", async () => {
    server.use(
      http.post("*/api/identify", () =>
        HttpResponse.json({ error: "Daily limit reached", limit: 100, used: 100 }, { status: 429 }),
      ),
    );
    const user = userEvent.setup();
    render(<UploadFlow />);
    await selectAndIdentify(user);

    expect(await screen.findByRole("heading", { name: /daily limit reached/i })).toBeInTheDocument();
    expect(screen.getByText(/used 100 of 100/i)).toBeInTheDocument();
  });

  it("renders the general error panel with the server message on 500", async () => {
    server.use(http.post("*/api/identify", () => HttpResponse.json({ error: "boom" }, { status: 500 })));
    const user = userEvent.setup();
    render(<UploadFlow />);
    await selectAndIdentify(user);

    expect(await screen.findByText("Something went wrong")).toBeInTheDocument();
    expect(screen.getByText("boom")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
  });

  it("falls back to the general error panel on a network failure", async () => {
    server.use(http.post("*/api/identify", () => HttpResponse.error()));
    const user = userEvent.setup();
    render(<UploadFlow />);
    await selectAndIdentify(user);

    expect(await screen.findByText("Something went wrong")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
  });
});

describe("UploadFlow — loading state", () => {
  it("shows the Identifying… spinner while the request is in flight", async () => {
    server.use(
      http.post("*/api/identify", async () => {
        await delay(50);
        return HttpResponse.json(recognised());
      }),
    );
    const user = userEvent.setup();
    render(<UploadFlow />);
    await selectAndIdentify(user);

    expect(await screen.findByText(/identifying/i)).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "Eiffel Tower" })).toBeInTheDocument();
  });
});

describe("UploadFlow — request contract", () => {
  it("posts the photo and a valid request_id", async () => {
    const captured: { form: FormData | null } = { form: null };
    server.use(
      http.post("*/api/identify", async ({ request }) => {
        captured.form = await request.formData();
        return HttpResponse.json(recognised());
      }),
    );
    const user = userEvent.setup();
    render(<UploadFlow />);
    await selectAndIdentify(user);
    await screen.findByRole("heading", { name: "Eiffel Tower" });

    const form = captured.form;
    if (!form) throw new Error("request was not captured");
    const photo = form.get("photo");
    expect(photo).toBeInstanceOf(File);
    expect((photo as File).name).toBe("photo.jpg");
    const thumbnail = form.get("thumbnail");
    expect(thumbnail).toBeInstanceOf(File);
    expect((thumbnail as File).name).toBe("thumbnail.jpg");
    expect(form.get("request_id")).toEqual(expect.stringMatching(UUID_RE));
  });

  it("generates a fresh request_id for each identify action", async () => {
    const ids: string[] = [];
    server.use(
      http.post("*/api/identify", async ({ request }) => {
        const form = await request.formData();
        const id = form.get("request_id");
        if (typeof id === "string") ids.push(id);
        return HttpResponse.json(recognised());
      }),
      http.get("*/api/archive/folders", () =>
        HttpResponse.json({
          folders: [{ id: "unc-1", name: "Uncategorized", photoCount: 0, createdAt: "2026-01-01T00:00:00Z" }],
        }),
      ),
    );
    const user = userEvent.setup();
    render(<UploadFlow />);

    await selectAndIdentify(user);
    await screen.findByRole("button", { name: /save to archive/i });
    await user.click(screen.getByRole("button", { name: /save to archive/i }));
    await user.click(await screen.findByRole("button", { name: /identify another/i }));

    await selectAndIdentify(user);
    await screen.findByRole("heading", { name: "Eiffel Tower" });

    expect(ids).toHaveLength(2);
    expect(ids[0]).not.toBe(ids[1]);
  });
});

describe("UploadFlow — reset", () => {
  it("returns to idle and revokes the preview URL on Identify another", async () => {
    server.use(
      http.post("*/api/identify", () => HttpResponse.json(recognised())),
      http.get("*/api/archive/folders", () =>
        HttpResponse.json({
          folders: [{ id: "unc-1", name: "Uncategorized", photoCount: 0, createdAt: "2026-01-01T00:00:00Z" }],
        }),
      ),
    );
    const user = userEvent.setup();
    render(<UploadFlow />);
    await selectAndIdentify(user);
    await screen.findByRole("button", { name: /save to archive/i });

    await user.click(screen.getByRole("button", { name: /save to archive/i }));
    await user.click(await screen.findByRole("button", { name: /identify another/i }));

    expect(screen.getByLabelText("Choose a photo")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /identify/i })).toBeDisabled();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:preview");
  });
});
