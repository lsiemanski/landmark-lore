import { describe, it, expect } from "vitest";
import { computeTargetDimensions, downscale, CLIENT_BYTE_CAP, MAX_EDGE } from "@/lib/client/downscale";

// Option C — the pure scaling math, tested directly (no canvas, no mocks).
describe("computeTargetDimensions", () => {
  it("scales a landscape image so its long (width) edge equals MAX_EDGE, aspect preserved", () => {
    expect(computeTargetDimensions(4096, 2048)).toEqual({ width: MAX_EDGE, height: MAX_EDGE / 2 });
  });

  it("scales a portrait image by its long (height) edge", () => {
    expect(computeTargetDimensions(2048, 4096)).toEqual({ width: MAX_EDGE / 2, height: MAX_EDGE });
  });

  it("never upscales an image already within MAX_EDGE", () => {
    expect(computeTargetDimensions(800, 600)).toEqual({ width: 800, height: 600 });
  });

  it("leaves an image whose long edge is exactly MAX_EDGE unchanged", () => {
    expect(computeTargetDimensions(MAX_EDGE, 1000)).toEqual({ width: MAX_EDGE, height: 1000 });
  });

  it("rounds fractional scaled dimensions to integers", () => {
    // long edge 3000 → scale 2048/3000; 2000 * scale = 1365.33 → 1365
    expect(computeTargetDimensions(3000, 2000)).toEqual({ width: 2048, height: 1365 });
  });

  it("honors a caller-supplied maxEdge", () => {
    expect(computeTargetDimensions(2000, 1000, 1000)).toEqual({ width: 1000, height: 500 });
  });
});

// Option A — the byte-cap guard runs before any canvas/createImageBitmap call,
// so it is reachable in the plain node test environment.
describe("downscale (byte-cap guard)", () => {
  it("rejects a blob larger than CLIENT_BYTE_CAP before decoding", async () => {
    const tooBig = new Blob([new Uint8Array(CLIENT_BYTE_CAP + 1)]);
    await expect(downscale(tooBig)).rejects.toThrow(/client cap/i);
  });
});
