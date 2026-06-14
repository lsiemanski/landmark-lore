/**
 * Accepted upload media types — the single source of truth shared by the
 * server-side validation gate (`IDENTIFY_CONFIG.allowedTypes` in
 * `src/lib/ai/config.ts`, read by `src/lib/identify/upload.ts`) and the
 * client-side file-picker `accept` hint (UploadFlow, IdentifyHarness).
 *
 * This module is dependency-free and client-safe — it does NOT import
 * `astro:env/server`, so React islands can import it without pulling server
 * config into the client bundle.
 */
export const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

/** Comma-joined string for an `<input type="file" accept>` attribute. */
export const ACCEPT_IMAGE_TYPES = ALLOWED_IMAGE_TYPES.join(",");
