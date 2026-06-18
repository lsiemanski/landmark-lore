import type OpenAI from "openai";

/**
 * Disable the model's reasoning ("thinking") tokens on an OpenRouter chat
 * request. Gemini thinking models spend reasoning tokens out of the same
 * `max_tokens` budget as the visible output, so for a structured JSON
 * completion they can exhaust the budget and truncate the object before it is
 * closed. We never surface the reasoning, so turning it off is both safe and
 * removes the truncation entirely (and trims latency/cost).
 *
 * `reasoning` is an OpenRouter extension not present in the OpenAI SDK types;
 * the SDK forwards unknown body fields verbatim, so the assertion only quiets
 * the compiler — the field is sent.
 */
export function withoutReasoning(
  params: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming,
): OpenAI.Chat.ChatCompletionCreateParamsNonStreaming {
  return { ...params, reasoning: { enabled: false } } as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming;
}

/** A persistent upstream rate limit (HTTP 429) that survived our retries. */
export class UpstreamRateLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UpstreamRateLimitError";
  }
}

interface OpenRouterError {
  code?: number;
  message?: string;
}

/**
 * Extract an upstream-provider error from an OpenRouter completion. OpenRouter
 * returns HTTP 200 even when the provider fails *mid-stream*, attaching the
 * error at the top level or — once generation had already started — on the
 * choice itself. The SDK never throws in that case, so the body is left with a
 * truncated JSON fragment we must not try to parse.
 */
export function upstreamError(response: OpenAI.Chat.ChatCompletion): OpenRouterError | undefined {
  const choiceError = (response.choices[0] as { error?: OpenRouterError } | undefined)?.error;
  const topError = (response as { error?: OpenRouterError }).error;
  return choiceError ?? topError;
}

const MAX_RATE_LIMIT_ATTEMPTS = 3;
const RATE_LIMIT_BACKOFF_MS = 400;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Run an OpenRouter completion, transparently retrying a transient upstream
 * rate limit that arrives *embedded in a 200 response* (the provider throttled
 * part-way through the stream, truncating the JSON). Thrown 429s are already
 * retried by the SDK, so they pass straight through. A 429 that survives
 * `MAX_RATE_LIMIT_ATTEMPTS` surfaces as `UpstreamRateLimitError`; any other
 * embedded error becomes a plain `Error`.
 */
export async function withRateLimitRetry(
  run: () => Promise<OpenAI.Chat.ChatCompletion>,
): Promise<OpenAI.Chat.ChatCompletion> {
  for (let attempt = 1; ; attempt++) {
    const response = await run();
    const error = upstreamError(response);
    if (!error) return response;
    if (error.code === 429) {
      if (attempt >= MAX_RATE_LIMIT_ATTEMPTS) {
        throw new UpstreamRateLimitError(error.message ?? "Upstream rate limit exceeded");
      }
      await sleep(RATE_LIMIT_BACKOFF_MS * attempt);
      continue;
    }
    throw new Error(`Upstream provider error: ${error.message ?? "unknown"}`);
  }
}

/**
 * Run a completion against each model in order, advancing to the next only when
 * the current one stays rate-limited after {@link withRateLimitRetry}'s retries.
 * Lets a transient throttle on the primary model fall back to a cheaper/free
 * tier rather than failing the request. Duplicates are collapsed, so passing the
 * same model twice is a harmless no-op. A 429 on the *last* model surfaces as
 * `UpstreamRateLimitError`.
 */
export async function withModelFallback(
  models: readonly string[],
  run: (model: string) => Promise<OpenAI.Chat.ChatCompletion>,
): Promise<OpenAI.Chat.ChatCompletion> {
  const ordered = [...new Set(models)];
  for (let i = 0; i < ordered.length; i++) {
    try {
      return await withRateLimitRetry(() => run(ordered[i]));
    } catch (err) {
      if (err instanceof UpstreamRateLimitError && i < ordered.length - 1) continue;
      throw err;
    }
  }
  throw new Error("withModelFallback requires at least one model");
}
