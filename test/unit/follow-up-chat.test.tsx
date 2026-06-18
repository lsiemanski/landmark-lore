// @vitest-environment happy-dom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse, delay } from "msw";
import { server } from "../msw/server";
import FollowUpChat from "@/components/identify/FollowUpChat";

const imageBlob = new Blob(["fake-image"], { type: "image/jpeg" });
const anchor = { subjectName: "Eiffel Tower", description: "A famous tower." };

function renderChat(props: Partial<React.ComponentProps<typeof FollowUpChat>> = {}) {
  return render(<FollowUpChat imageBlob={imageBlob} anchor={anchor} photoId="photo-1" {...props} />);
}

describe("FollowUpChat", () => {
  it("submitting a question renders the returned answer in the thread", async () => {
    server.use(http.post("*/api/follow-up", () => HttpResponse.json({ answer: "Gustave Eiffel designed it." })));
    const user = userEvent.setup();
    renderChat();

    await user.type(screen.getByRole("textbox", { name: /follow-up question/i }), "Who designed it?");
    await user.click(screen.getByRole("button", { name: /ask/i }));

    expect(await screen.findByText("Gustave Eiffel designed it.")).toBeInTheDocument();
    expect(screen.getByText("Who designed it?")).toBeInTheDocument();
  });

  it("a response carrying description fires onDescriptionUpdate with the enriched text", async () => {
    server.use(
      http.post("*/api/follow-up", () =>
        HttpResponse.json({
          answer: "Gustave Eiffel designed it.",
          description: "An iconic iron tower designed by Gustave Eiffel.",
        }),
      ),
    );
    const onDescriptionUpdate = vi.fn();
    const user = userEvent.setup();
    renderChat({ onDescriptionUpdate });

    await user.type(screen.getByRole("textbox", { name: /follow-up question/i }), "Who designed it?");
    await user.click(screen.getByRole("button", { name: /ask/i }));

    await screen.findByText("Gustave Eiffel designed it.");
    expect(onDescriptionUpdate).toHaveBeenCalledWith("An iconic iron tower designed by Gustave Eiffel.");
  });

  it("a response carrying subjectName fires onSubjectNameUpdate with the corrected name", async () => {
    server.use(
      http.post("*/api/follow-up", () =>
        HttpResponse.json({
          answer: "It's actually the Statue of Liberty.",
          subjectName: "Statue of Liberty",
        }),
      ),
    );
    const onSubjectNameUpdate = vi.fn();
    const user = userEvent.setup();
    renderChat({ onSubjectNameUpdate });

    await user.type(screen.getByRole("textbox", { name: /follow-up question/i }), "Is that the Eiffel Tower?");
    await user.click(screen.getByRole("button", { name: /ask/i }));

    await screen.findByText("It's actually the Statue of Liberty.");
    expect(onSubjectNameUpdate).toHaveBeenCalledWith("Statue of Liberty");
  });

  it("a failed call shows inline retry and preserves prior turns", async () => {
    server.use(http.post("*/api/follow-up", () => HttpResponse.json({ error: "AI error" }, { status: 500 })));
    const user = userEvent.setup();
    renderChat();

    await user.type(screen.getByRole("textbox", { name: /follow-up question/i }), "Who designed it?");
    await user.click(screen.getByRole("button", { name: /ask/i }));

    expect(await screen.findByText(/something went wrong/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
    expect(screen.getByText("Who designed it?")).toBeInTheDocument();
  });

  it("a 429 response shows a terminal limit-reached message with no retry button", async () => {
    server.use(
      http.post("*/api/follow-up", () =>
        HttpResponse.json({ error: "Daily limit", limit: 50, used: 50 }, { status: 429 }),
      ),
    );
    const user = userEvent.setup();
    renderChat();

    await user.type(screen.getByRole("textbox", { name: /follow-up question/i }), "Who designed it?");
    await user.click(screen.getByRole("button", { name: /ask/i }));

    expect(await screen.findByText(/daily follow-up limit reached/i)).toBeInTheDocument();
    expect(screen.getByText(/used 50 of 50/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /retry/i })).not.toBeInTheDocument();
  });

  it("the input is disabled while a call is pending", async () => {
    server.use(
      http.post("*/api/follow-up", async () => {
        await delay(100);
        return HttpResponse.json({ answer: "An answer." });
      }),
    );
    const user = userEvent.setup();
    renderChat();

    await user.type(screen.getByRole("textbox", { name: /follow-up question/i }), "Question?");
    await user.click(screen.getByRole("button", { name: /ask/i }));

    expect(screen.getByRole("textbox", { name: /follow-up question/i })).toBeDisabled();

    await screen.findByText("An answer.");
  });
});
