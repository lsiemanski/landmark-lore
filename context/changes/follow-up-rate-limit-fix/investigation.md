---
change_id: follow-up-rate-limit-fix
title: Follow-up "Malformed AI response" — upstream rate-limit investigation & fix
status: complete
created: 2026-06-18
updated: 2026-06-18
---

## Symptom

Every follow-up question failed in the dev server with:

```
[ERROR] follow-up failed Error: Malformed AI response: {
  "answer":
    at parseModelJson (src/lib/ai/parse-json.ts:22:11)
    at answerFollowUp (src/lib/ai/follow-up.ts)
```

The model appeared to return a truncated JSON fragment (`{"answer":`, later `{\n  `)
that `parseModelJson` could not parse. `finish_reason` was `stop` (not `length`),
`completion_tokens` was ~3–6, and the cut landed at the same place each time.

## False leads (ruled out)

1. **Reasoning tokens exhausting `max_tokens`.** The follow-up call originally ran
   through `withoutReasoning` (Gemini thinking tokens share the output budget).
   Hypothesis: disabling reasoning was breaking structured output. **Disproved** —
   re-enabling reasoning produced the _byte-for-byte identical_ cut, and
   `reasoning_tokens` was already `0`. The deterministic-looking truncation point
   was a red herring (just where generation happened to stop).

2. **`max_tokens` truncation.** Ruled out directly: `finish_reason` was `stop`, not
   `length`, and the budget (8192) was nowhere near consumed.

3. **Strict `json_schema` incompatibility with the model.** Plausible (and the
   reason the 400→`json_object` fallback exists), but not the cause here — the
   request returned HTTP 200 with content, not a 400.

The probe script (`probe.mjs`) that would have tested the four request shapes
empirically could not run: the agent's Bash sandbox has no network route to
OpenRouter (the dev server does). Diagnosis proceeded by instrumenting the real
code path instead.

## Root cause

Temporary diagnostic logging of the full raw response revealed the truth — the
error was **embedded in an otherwise-200 response**:

```json
{
  "choices": [
    {
      "finish_reason": "stop",
      "native_finish_reason": "STOP",
      "error": {
        "code": 429,
        "message": "JSON error injected into SSE stream",
        "metadata": { "error_type": "rate_limit_exceeded" }
      },
      "message": { "content": "{\n  " }
    }
  ]
}
```

OpenRouter returns **HTTP 200** even when the upstream provider (Google) throttles
the request **mid-stream**. The 429 is attached as an `error` on the choice (or at
the top level), and the partially-generated body is left truncated. Because the
HTTP status is 200, the OpenAI SDK never throws — so our code took the truncated
fragment straight to `parseModelJson` and surfaced the misleading
"Malformed AI response". Every earlier failure was this same mid-stream 429, cut
at a slightly different byte.

## Resolution

Detect the embedded error, retry transient throttles, fall back to the free model,
and surface a clean 429 when it persists.

- **`src/lib/ai/openrouter.ts`**
  - `upstreamError(response)` — reads the provider error off `choices[0].error`
    or the top-level `error`.
  - `withRateLimitRetry(run)` — retries an _embedded_ 429 (3 attempts, 400 ms ×
    attempt backoff), then throws `UpstreamRateLimitError`; any other embedded
    error becomes a plain `Error`. (Thrown 429s are already retried by the SDK and
    pass through untouched.)
  - `withModelFallback(models, run)` — runs each model through
    `withRateLimitRetry`, advancing to the next only when the current one stays
    rate-limited. Duplicates collapse, so an active model equal to the fallback is
    a no-op.
  - `UpstreamRateLimitError` — typed marker for a persistent 429.

- **`src/lib/ai/config.ts`** — added `fallbackModel: MODELS.free`
  (`google/gemini-2.0-flash-lite:free`).

- **`src/lib/ai/follow-up.ts` / `src/lib/ai/identification.ts`** — request builders
  now take a `model` param and run through
  `withModelFallback([IDENTIFY_CONFIG.model, IDENTIFY_CONFIG.fallbackModel], …)`.
  The per-attempt 400→`json_object` fallback is preserved.

- **`src/pages/api/follow-up.ts` / `src/pages/api/identify.ts`** — map
  `UpstreamRateLimitError` to a clean **429** ("The AI provider is busy. Please try
  again in a moment.") with the quota slot refunded, instead of a misleading 502 /
  parse error.

**Escalation order:** active model (3× w/ backoff) → free model (3×) → 429 to client.

- **Removed** `probe.mjs` (unusable in this environment; diagnosis complete).

### Tests

`test/helpers/openrouter.ts` gained `makeEmbeddedErrorResponse(code)`. Added:
retry-clears-then-succeeds, free-model-fallback-succeeds, persistent-429 →
`UpstreamRateLimitError` (6 calls), and a route-level persistent-429 → HTTP 429.

## Caveat

Retry + fallback fix the **transient** case (e.g. an identify call immediately
followed by a follow-up tripping Google's per-second/burst limit). A **sustained**
quota ceiling will exhaust both models and return the clean 429 — the real remedy
is account-side: check the OpenRouter activity/limits dashboard, add credits, or
configure provider routing. If 429s persist after this change, that's the next
place to look.
