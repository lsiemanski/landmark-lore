import { IDENTIFY_MODEL, IDENTIFY_DAILY_LIMIT, FOLLOWUP_DAILY_LIMIT } from "astro:env/server";
import { MODELS } from "./models";
import { ALLOWED_IMAGE_TYPES } from "@/lib/media-types";

/**
 * Operational configuration for the identify endpoint. Centralised here so the
 * active model, the daily cap, and accepted uploads can change without touching
 * route logic. `models.ts` is the registry of available models; this picks the
 * active one and sets the request limits.
 *
 * `model` and `dailyImageLimit` are sourced from runtime env (`astro:env/server`,
 * `access: "secret"` → read at runtime, not bundled), so they can be changed in
 * the Cloudflare dashboard **without a rebuild**. The values below are the
 * defaults applied when the env vars are unset.
 */
export const IDENTIFY_CONFIG = {
  /** Active model. Override with IDENTIFY_MODEL; defaults to the registry's paid tier. */
  model: IDENTIFY_MODEL ?? MODELS.paid,
  /**
   * Model tried when the active one stays rate-limited (HTTP 429) after our
   * retries. The free tier is slower/less capable but keeps the feature working
   * through a transient throttle on the paid model.
   */
  fallbackModel: MODELS.free,
  /** Per-user daily image-identification cap. Override with IDENTIFY_DAILY_LIMIT. */
  dailyImageLimit: IDENTIFY_DAILY_LIMIT ?? 100,
  /** Per-user daily follow-up cap. Override with FOLLOWUP_DAILY_LIMIT. */
  followUpDailyLimit: FOLLOWUP_DAILY_LIMIT ?? 200,
  /** Max tokens requested per identification completion. A ceiling, not a target. */
  maxTokens: 2048,
  /**
   * Max tokens per follow-up completion. A ceiling, not a target: the model only
   * generates what it needs, so a generous cap costs nothing extra but leaves
   * room for a long answer plus a full description rewrite in the same response.
   */
  followUpMaxTokens: 8192,
  /** Max accepted upload size in bytes (after client-side downscale). */
  maxBytes: 5 * 1024 * 1024,
  /** Accepted upload media types. */
  allowedTypes: ALLOWED_IMAGE_TYPES as readonly string[],
  /** OpenRouter API base URL (OpenAI-compatible). */
  openrouterBaseUrl: "https://openrouter.ai/api/v1",
} as const;
