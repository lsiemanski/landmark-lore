/**
 * Client-side image downscaling for the identify flow.
 *
 * Runs in the browser only (uses `createImageBitmap`, `<canvas>`). Keeping it
 * out of the page `<script>` makes the logic reviewable and testable in
 * isolation, and guarantees it never gets pulled into the Worker bundle.
 */

/** Longest edge (px) of the downsized image. Larger images scale down to this; smaller ones are left as-is. */
export const MAX_EDGE = 2048;

/** JPEG quality for the `canvas.toBlob` re-encode. */
export const JPEG_QUALITY = 1.0;

/** Reject blobs larger than this before decoding, so a huge file can't tie up the main thread. */
export const CLIENT_BYTE_CAP = 5 * 1024 * 1024;

/**
 * Target dimensions for a downscale: scale so the long edge ≤ {@link maxEdge},
 * preserving aspect ratio and never upscaling. Pure (no canvas) so the scaling
 * math is testable in isolation.
 */
export function computeTargetDimensions(
  srcW: number,
  srcH: number,
  maxEdge: number = MAX_EDGE,
): { width: number; height: number } {
  const long = Math.max(srcW, srcH);
  if (long <= maxEdge) return { width: srcW, height: srcH };
  const scale = maxEdge / long;
  return { width: Math.round(srcW * scale), height: Math.round(srcH * scale) };
}

/**
 * Decode `blob`, honor its EXIF orientation, scale so the long edge ≤ {@link MAX_EDGE}
 * (aspect ratio preserved, never upscaled), and re-encode as JPEG.
 *
 * @throws if the blob exceeds {@link CLIENT_BYTE_CAP} or canvas encoding fails.
 */
export async function downscale(blob: Blob): Promise<Blob> {
  if (blob.size > CLIENT_BYTE_CAP) {
    throw new Error(`File exceeds ${CLIENT_BYTE_CAP / 1024 / 1024} MB client cap.`);
  }

  const bitmap = await createImageBitmap(blob, { imageOrientation: "from-image" });
  const { width: dstW, height: dstH } = computeTargetDimensions(bitmap.width, bitmap.height);

  const canvas = document.createElement("canvas");
  canvas.width = dstW;
  canvas.height = dstH;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    bitmap.close();
    throw new Error("Canvas 2D context unavailable");
  }
  ctx.drawImage(bitmap, 0, 0, dstW, dstH);
  bitmap.close();

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => {
        if (b) resolve(b);
        else reject(new Error("Canvas toBlob failed"));
      },
      "image/jpeg",
      JPEG_QUALITY,
    );
  });
}
