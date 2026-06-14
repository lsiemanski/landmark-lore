// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { IdentificationResult } from "@/components/identify/IdentificationResult";

describe("IdentificationResult", () => {
  it("renders the title as a heading", () => {
    render(<IdentificationResult title="Eiffel Tower" description="A wrought-iron lattice tower in Paris." />);
    expect(screen.getByRole("heading", { name: "Eiffel Tower" })).toBeInTheDocument();
  });

  it("renders the description body text", () => {
    render(<IdentificationResult title="Eiffel Tower" description="A wrought-iron lattice tower in Paris." />);
    expect(screen.getByText("A wrought-iron lattice tower in Paris.")).toBeInTheDocument();
  });

  it("renders a title containing an apostrophe verbatim", () => {
    render(<IdentificationResult title="Couldn't identify this photo" description="Try a clearer shot." />);
    expect(screen.getByRole("heading", { name: "Couldn't identify this photo" })).toBeInTheDocument();
  });
});
