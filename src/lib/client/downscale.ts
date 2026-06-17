/**
 * Client-side image downscaling for the identify flow.
 *
 * Runs in the browser only (uses `createImageBitmap`, `<canvas>`). Keeping it
 * out of the page `<script>` makes the logic reviewable and testable in
 * isolation, and guarantees it never gets pulled into the Worker bundle.
 */

/** Longest edge (px) of the stored/AI image. Larger images scale down to this; smaller ones are left as-is. */
export const MAX_EDGE = 1024;

/** JPEG quality for the main image re-encode. ~0.82 is visually lossless at this size but far smaller than 1.0. */
export const JPEG_QUALITY = 0.82;

/** Longest edge (px) of the gallery thumbnail. Sized for the grid cell, not the detail view. */
export const THUMB_EDGE = 400;

/** JPEG quality for the thumbnail re-encode — lower is fine for a small grid cell. */
export const THUMB_QUALITY = 0.7;

/** Reject blobs larger than this before decoding, so a huge file can't tie up the main thread. */
export const CLIENT_BYTE_CAP = 5 * 1024 * 1024;

/** A downsized image plus its gallery thumbnail, both produced from one decode. */
export interface DownscaledImage {
  image: Blob;
  thumbnail: Blob;
}

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

/** Decode `blob`, honoring its EXIF orientation. Enforces the byte cap before decoding. */
async function decode(blob: Blob): Promise<ImageBitmap> {
  if (blob.size > CLIENT_BYTE_CAP) {
    throw new Error(`File exceeds ${CLIENT_BYTE_CAP / 1024 / 1024} MB client cap.`);
  }
  return createImageBitmap(blob, { imageOrientation: "from-image" });
}

/**
 * Draw `bitmap` into a canvas scaled to a long edge ≤ `maxEdge` (high-quality
 * resampling) and re-encode as JPEG at `quality`.
 *
 * `imageSmoothingQuality: "high"` does a properly filtered downscale, which
 * avoids the aliasing/artifacts a default single-step `drawImage` produces when
 * shrinking a large source.
 */
async function encodeResized(bitmap: ImageBitmap, maxEdge: number, quality: number): Promise<Blob> {
  const { width, height } = computeTargetDimensions(bitmap.width, bitmap.height, maxEdge);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, 0, 0, width, height);

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => {
        if (b) resolve(b);
        else reject(new Error("Canvas toBlob failed"));
      },
      "image/jpeg",
      quality,
    );
  });
}

/**
 * Decode `blob`, honor its EXIF orientation, scale so the long edge ≤ {@link MAX_EDGE}
 * (aspect ratio preserved, never upscaled), and re-encode as JPEG.
 *
 * @throws if the blob exceeds {@link CLIENT_BYTE_CAP} or canvas encoding fails.
 */
export async function downscale(blob: Blob): Promise<Blob> {
  const bitmap = await decode(blob);
  try {
    return await encodeResized(bitmap, MAX_EDGE, JPEG_QUALITY);
  } finally {
    bitmap.close();
  }
}

/**
 * Like {@link downscale}, but also produces a {@link THUMB_EDGE}-sized thumbnail
 * for the gallery grid — both renditions from a single decode so the original
 * is only read once.
 *
 * @throws if the blob exceeds {@link CLIENT_BYTE_CAP} or canvas encoding fails.
 */
export async function downscaleWithThumbnail(blob: Blob): Promise<DownscaledImage> {
  const bitmap = await decode(blob);
  try {
    const image = await encodeResized(bitmap, MAX_EDGE, JPEG_QUALITY);
    const thumbnail = await encodeResized(bitmap, THUMB_EDGE, THUMB_QUALITY);
    return { image, thumbnail };
  } finally {
    bitmap.close();
  }
}
