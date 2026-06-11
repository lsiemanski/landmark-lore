# F-02 AI Provider Spike — Implementation Plan

## Overview

Land the F-02 AI-provider spike: a **Gemini 2.5 Flash identify** endpoint that accepts a
user photo, runs it through `google/gemini-2.5-flash` via **OpenRouter** with a structured
`{ recognised, subjectName, description }` contract, and returns the result. The photo is
**downsized client-side** before it ever reaches the Worker — the image is resized to a
configurable max edge (default 1024px) and re-encoded as JPEG — so the request carries a small
payload. The Worker validates, rate-checks, and relays only; it never decodes or persists the image.

**Model configuration is centralised in `src/lib/ai/models.ts`** so the active model can be
swapped by changing one constant. The paid model (`google/gemini-2.5-flash`) is the default;
the free model (`google/gemini-2.0-flash-lite:free`) is defined alongside it for easy switching.

A **per-user daily rate limit of 100 image requests** is enforced via a Supabase
`image_usage` table. When the limit is reached the endpoint returns `429`. Auto-fallback
to the free model on limit hit and BYOK (user-supplied API key) are **deferred to S-01**.

This de-risks the AI provider integration (FR-004/FR-005) and proves the PRD's
"not recognised" guardrail end-to-end, while keeping the Worker bundle lean and
within the free CPU tier.

## Current State Analysis

- **Secrets idiom is established.** [astro.config.mjs:17-22](../../../astro.config.mjs#L17-L22)
  declares `SUPABASE_URL`/`SUPABASE_KEY` via `envField.string({ context: "server", access: "secret", optional: true })`;
  consumed in [src/lib/supabase.ts:3](../../../src/lib/supabase.ts#L3) with an absence guard
  ([:7](../../../src/lib/supabase.ts#L7)). `OPENROUTER_API_KEY` copies this pattern verbatim.
- **API route shape is established.** [src/pages/api/auth/signin.ts:4](../../../src/pages/api/auth/signin.ts#L4)
  is `export const POST: APIRoute = async (context) => { … }` reading `context.request.formData()`.
- **Auth is established.** Supabase session is readable in a route via
  `createServerClient` + `context.cookies` (mirrors the auth routes). Required here because
  rate limiting is per authenticated user.
- **Workerd is ready.** `wrangler.jsonc` sets `compatibility_flags: ["nodejs_compat"]`
  (`compatibility_date: 2026-05-08`). `.dev.vars` is gitignored (`.gitignore:56`).
- **`openai` SDK is not yet installed** — this spike is its first introduction.
  `src/pages/api/identify.ts` does not exist yet.
- **React + Tailwind are available** ([astro.config.mjs:12](../../../astro.config.mjs#L12)).
- **Two infra risks gate this stream** ([context/foundation/infrastructure.md](../../foundation/infrastructure.md)):
  Worker **bundle size** (≤1 MB compressed; free tier 3 MB) and the **10 ms free-tier CPU limit**.
  Both are *neutralised by the client-side-resize decision*.

## Desired End State

A developer can open the test page, pick a phone-gallery photo (JPEG/PNG/WebP),
and watch it get downsized in the browser, sent to `/api/identify`, and rendered as a structured
identification (`recognised` / `subjectName` / `description`). An unrecognisable photo returns
`recognised: false` with an explanation, in-band (HTTP 200). A user who has exceeded 100
image requests on the current day receives `429`. Misconfiguration and bad input return graceful
status codes. `wrangler deploy --dry-run` confirms the Worker bundle is well under the limit.
The three executable F-02 success criteria from the roadmap are checked off.

### Key Discoveries

- **OpenRouter** provides an OpenAI-compatible API (`https://openrouter.ai/api/v1`) routing to
  300+ models. The `openai` npm SDK works by setting `baseURL` to the OpenRouter endpoint — no
  new API shape to learn. (Research, 2026-06-11.)
- **`google/gemini-2.5-flash`** is the primary model. At ~$0.30/M input and $2.50/M output tokens
  it costs ~$0.00008 per image — negligible at personal-use scale. Quality benchmarks place it
  above GPT-4o mini for visual recognition at lower cost. GDPR: Google has EU data processing
  agreements and does not train on paid API calls.
- **`google/gemini-2.0-flash-lite:free`** is the free alternative — same OpenRouter provider,
  zero cost, lower quality. Changing active model = one constant in `MODEL_CONFIG`.
- **Structured output** is supported on Gemini models via OpenRouter's
  `response_format: { type: "json_schema", json_schema: { name, strict, schema } }`. The parsed
  JSON is at `response.choices[0].message.content`.
- **Image input** uses the OpenAI vision format: a `content` array with an `image_url` block
  using a `data:image/jpeg;base64,…` URL. No separate `source.type: "base64"` block as with
  the Anthropic SDK.
- **Rate limiting** requires the user to be authenticated. The spike endpoint therefore does
  require a valid session (unlike originally planned). The Supabase client + session check mirrors
  the existing auth routes.
- **`openai` bundle** is fetch-based pure JS, similar size to `@anthropic-ai/sdk`. The bundle-size
  risk remains low; dry-run confirms before S-01.

## What We're NOT Doing

- **No BYOK.** The owner's `OPENROUTER_API_KEY` is the only key. User-supplied keys are out of
  scope for MVP.
- **No auto-fallback to free model on limit hit.** When a user exceeds 100 requests/day, the
  endpoint returns `429`. Routing to the free model instead is out of scope for MVP.
- **No image persistence.** The spike does not write to Supabase Storage.
- **No server-side image processing.** The Worker never decodes, resizes, or re-encodes the image.
- **No HEIC support.** Out of scope for MVP.
- **No token-cost measurement / instrumentation.** Trust the resize.
- **No production UI.** The test page is a developer harness.

## Implementation Approach

Three concerns, cleanly separated:

1. **Browser (test page)** owns all image work: decode via
   `createImageBitmap(blob, { imageOrientation: "from-image" })` → canvas resize (long edge ≤
   `MAX_EDGE`, default 1024) → `canvas.toBlob("image/jpeg", QUALITY)` → `FormData` → `POST`.
2. **Worker (`/api/identify`)** owns the session check, rate limit, and OpenRouter call:
   verify auth → check+increment `image_usage` → validate media_type + byte cap → build
   vision message → call `chat.completions.create` → parse and return `{ result }`.
3. **Database** owns usage state and enforcement: `image_usage (user_id, period, count)` plus two
   `security definer` RPCs. `try_consume_image_usage` does an atomic check-and-consume under
   `SELECT … FOR UPDATE` (concurrent callers serialise on the row — the cap can't be overshot);
   `refund_image_usage` decrements on AI failure. Net effect: **consume-on-attempt, refund-on-failure**,
   so only successful identifications count. The table has no client write policy, so the cap
   cannot be reset/bypassed.

The Worker bundle is `openai` + the Supabase client (already in the project). The client-side
resize/decode must never be imported by the route.

## Critical Implementation Details

- **Model + operational config must be centralised.** `src/lib/ai/models.ts` is the model
  *registry* (`MODELS`, `ModelTier`). `src/lib/ai/config.ts` exports `IDENTIFY_CONFIG` — the
  *active* model plus the tunable limits (`dailyImageLimit`, `maxBytes`, `allowedTypes`). The
  route reads everything from `IDENTIFY_CONFIG`; never hardcode a model string, limit, byte cap,
  or media-type list in the route itself.
- **`model` + `dailyImageLimit` are runtime-tunable without a rebuild.** They are sourced from
  `astro:env/server` (`IDENTIFY_MODEL`, `IDENTIFY_DAILY_LIMIT`, both `access: "secret"` → read at
  runtime, not bundled), with the values in `config.ts` as defaults when unset. Change them via a
  Cloudflare Worker variable (dashboard / `wrangler`) — no `astro build`. `maxBytes`/`allowedTypes`
  stay code defaults for now (promote to env on the same pattern if needed).
- **Image input format differs from Anthropic.** OpenRouter/OpenAI uses
  `{ type: "image_url", image_url: { url: "data:image/jpeg;base64,…" } }` inside the `content`
  array, not a separate `source` object. Getting this wrong produces a 400 from OpenRouter.
- **`baseURL` must be set explicitly.** `new OpenAI({ apiKey, baseURL: "https://openrouter.ai/api/v1" })`.
  The zero-arg constructor points at OpenAI's endpoint — wrong provider entirely.
- **Session check before DB and AI.** If the user is not authenticated, return `401` immediately.
  Do not check usage or call the model for unauthenticated requests.
- **Rate period is calendar day (`YYYY-MM-DD`).** Derive with
  `new Date().toISOString().slice(0, 10)`. The primary key is `(user_id, period)`.
- **EXIF orientation must be handled at resize time.** Use
  `createImageBitmap(blob, { imageOrientation: "from-image" })` — see Phase 2.

---

## Phase 1: Server — AI provider wiring, model config, rate limiting & identify route

### Overview

Install the SDK, wire the secret, create the model config module, create the usage table,
build the identify endpoint, and confirm the Worker bundle stays within limits — verified
independently via `curl` with a known small JPEG and a test session token.

### Changes Required

#### 1. Dependency

**File**: `package.json`

**Intent**: Add `openai` as the AI SDK. It is OpenAI-compatible and works with OpenRouter by
setting `baseURL`; it runs on workerd without modification.

**Contract**: Run `npm install openai@latest`, commit the resolved version. No other AI SDK
is needed. Before building the route, assert `typeof OpenAI === "function"` to catch a bad install.

#### 2. Secret declaration

**File**: `astro.config.mjs`

**Intent**: Declare `OPENROUTER_API_KEY` as a server secret alongside the Supabase keys.

**Contract**: Add to `env.schema`:
```js
OPENROUTER_API_KEY: envField.string({ context: "server", access: "secret", optional: true })
```
Identical shape to the existing Supabase keys on lines 19–20.

#### 3. Secret configuration (local + deployed)

**File**: `.dev.vars` (gitignored), Cloudflare Workers secret store

**Contract**: Append `OPENROUTER_API_KEY=<value>` to `.dev.vars`. For deployed Workers:
```bash
echo "$OPENROUTER_API_KEY" | npx wrangler secret put OPENROUTER_API_KEY
```

#### 4. Model config module

**File**: `src/lib/ai/models.ts` (new)

**Intent**: Single source of truth for model IDs and tier type. All routes import from here;
no model string is hardcoded elsewhere.

**Contract**:
```ts
export const MODELS = {
  paid: "google/gemini-2.5-flash",
  free: "google/gemini-2.0-flash-lite:free",
} as const;

export type ModelTier = keyof typeof MODELS;
```

#### 5. Supabase migration — usage table

**File**: `supabase/migrations/<timestamp>_create_image_usage.sql` (new)

**Intent**: Track per-user daily image identification requests for rate limiting.

**Contract**:
```sql
create table public.image_usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  period  text not null,   -- 'YYYY-MM-DD', e.g. '2026-06-11'
  count   integer not null default 0,
  primary key (user_id, period)
);

alter table public.image_usage enable row level security;

-- Users can read their own usage (for future "X of 100 used" UI)
create policy "users can view own usage"
  on public.image_usage for select
  using (auth.uid() = user_id);

-- NO insert/update/delete policy: the anon-key client cannot write directly, so
-- a user cannot reset their count to bypass the cap. Writes go exclusively
-- through two security-definer functions, each scoped to the calling user:
--   try_consume_image_usage(period, limit) → (allowed, used)
--     atomic check-and-consume under SELECT … FOR UPDATE (serialises bursts)
--   refund_image_usage(period) → used
--     decrement (floored at 0) when a reserved identification fails
```
The existing `createClient()` uses the anon key. Because the table is read-only to clients and
the functions are `security definer`, the cap is enforced atomically and cannot be reset by a
user — no service-role key or second Supabase client needed. See the migration for the full
function bodies.

#### 6. Identify route

**File**: `src/pages/api/identify.ts` (new)

**Intent**: Authenticated POST route that checks rate limit, calls Gemini 2.5 Flash via
OpenRouter with structured output, and returns the parsed result.

**Contract**:

```
Config (from `src/lib/ai/config.ts` → `IDENTIFY_CONFIG`, not in-route constants):
  model           = MODELS.paid  (active model)
  dailyImageLimit = 100          (daily cap per user)
  maxBytes        = 5 * 1024 * 1024
  allowedTypes    = ['image/jpeg', 'image/png', 'image/webp']

Per request (not a module constant — avoids a stale period across a day boundary):
  const period = new Date().toISOString().slice(0, 10)   // 'YYYY-MM-DD'

identificationSchema = {
  type: "object",
  properties: {
    recognised:  { type: "boolean" },
    subjectName: { type: "string" },
    description: { type: "string" },
  },
  required: ["recognised", "subjectName", "description"],
  additionalProperties: false,
}
```

Reading the request (before the flow table):
- **Auth/session**: `const supabase = createClient(context.request.headers, context.cookies)`
  (the existing helper in `src/lib/supabase.ts`, which wraps `createServerClient`). If it returns
  `null` (Supabase unconfigured) → `503`. Then `const { data: { user } } = await supabase.auth.getUser()`;
  no `user` → `401`.
- **Image**: `const file = form.get("photo")` (same field name the Phase 2 page posts). Not a
  `File` → `415`. Derive `media_type = file.type` and size from `file.size`. Encode to base64 from
  `await file.arrayBuffer()` — on workerd use the `nodejs_compat` `Buffer.from(buf).toString("base64")`
  (avoid `btoa` over a binary string). The base64 string feeds the `image_url` data URL below.

Request flow (in order — return early on first failure):

| Check | Status | Body |
|---|---|---|
| `OPENROUTER_API_KEY` absent | `503` | `{ error: "AI provider not configured" }` |
| Supabase client `null` (unconfigured) | `503` | `{ error: "Supabase not configured" }` |
| No valid session | `401` | `{ error: "Unauthorised" }` |
| `media_type` ∉ allowed list | `415` | `{ error: "Unsupported media type" }` |
| Payload > `MAX_BYTES` | `413` | `{ error: "File too large" }` |
| `try_consume_image_usage` errors | `503` | `{ error: "Usage check failed" }` |
| Consume returns `allowed=false` (limit) | `429` | `{ error: "Daily limit reached", limit: 100, used: N }` |
| OpenRouter call throws (slot refunded) | `502` | `{ error: "AI provider error" }` |
| Success | `200` | `{ result: { recognised, subjectName, description } }` |

Cheap input validation (415/413) runs **before** consuming a slot, so bad requests never count.
The slot is consumed up-front via `try_consume_image_usage` (atomic, enforces the cap); on AI
failure the `catch` calls `refund_image_usage`, so only successful identifications count.

OpenRouter call shape:
```ts
const client = new OpenAI({
  apiKey: OPENROUTER_API_KEY,
  baseURL: "https://openrouter.ai/api/v1",
});

const response = await client.chat.completions.create({
  model: MODELS.paid,
  max_tokens: 1024,
  messages: [
    {
      role: "system",
      content:
        "Identify the primary landmark, artwork, monument, or notable subject in the photo. " +
        "Provide a substantive historical/cultural description, not just a label. " +
        "If you cannot confidently identify it, set recognised=false and explain why.",
    },
    {
      role: "user",
      content: [
        { type: "image_url", image_url: { url: `data:image/jpeg;base64,${base64}` } },
        { type: "text", text: "Identify the main subject of this photo." },
      ],
    },
  ],
  response_format: {
    type: "json_schema",
    json_schema: { name: "identification", strict: true, schema: identificationSchema },
  },
});

const result = JSON.parse(response.choices[0].message.content!);
return new Response(JSON.stringify({ result }), { headers: { "content-type": "application/json" } });
```

**Fallback if `strict` json_schema is rejected.** Structured-output support for
`google/gemini-2.5-flash` via OpenRouter is assumed, not yet verified. If the call returns a
`400`, fall back to `response_format: { type: "json_object" }`, append the expected shape
(`{ recognised, subjectName, description }`) to the system prompt, and keep the same
`JSON.parse(...content)` parse. The route's response contract is unchanged either way.

### Success Criteria

#### Automated Verification

- [ ] 1.1 Type checking passes (`npm run build` / typecheck)
- [ ] 1.2 Linting passes
- [ ] 1.3 Worker bundle within limits: `npx wrangler deploy --dry-run` (well under 1 MB)
- [ ] 1.4 Route returns `503` when `OPENROUTER_API_KEY` is unset
- [ ] 1.5 Route returns `401` for unauthenticated requests

#### Manual Verification

- [ ] 1.6 With key set and a valid session, `curl` a known small JPEG → `{ result: { recognised, subjectName, description } }`
- [ ] 1.7 Unrecognisable image returns `200` with `recognised: false` and a non-empty description
- [ ] 1.8 Non-image / wrong media_type returns `415`; oversized payload returns `413`
- [ ] 1.9 After 100 requests (or by manually inserting a row with `count = 100`), returns `429` with usage info

**Implementation Note**: After this phase and all automated verification passes, pause for manual
confirmation that the curl smoke tests succeeded before proceeding to Phase 2.

---

## Phase 2: Client — downsizing test page

### Overview

A minimal developer harness page that performs the client-side downsizing (JPEG/PNG/WebP) and
posts to the identify route, then renders the structured result. Unchanged from the original
plan except the test page must send a valid session cookie (user must be logged in).

### Changes Required

#### 1. Test page

**File**: `src/pages/identify-test.astro` (new)

**Intent**: A single page with a file input and a result area, wired to a client `<script>` that
downsizes the chosen image and calls `/api/identify`.

**Contract**: Plain `.astro` page. Renders a file `<input accept="image/jpeg,image/png,image/webp">`,
an "Identify" action, and a results panel showing `recognised` / `subjectName` / `description`
plus the downsized preview and final dimensions. Requires the user to be signed in (the session
cookie is sent automatically with the fetch).

**In-flight guard (required).** Because the route is **not idempotent** (idempotency keys are
parked for S-01), the page must prevent duplicate submissions of the same logical request:
disable the "Identify" action while a request is outstanding (re-enable in a `finally`), and
**do not auto-retry on timeout/error** — surface the error and let the user re-initiate manually.
This kills the common double-tap / proxy-retry double-spend without server-side idempotency.

#### 2. Client downsizing module

**File**: `src/pages/identify-test.astro` client `<script>` (or `src/lib/client/downscale.ts`)

**Contract**:
- Constants: `MAX_EDGE = 1024`, `JPEG_QUALITY = 0.8`, client-side byte cap ~5 MB.
- Decode via `createImageBitmap(blob, { imageOrientation: "from-image" })` for EXIF correctness.
- Scale so `max(width, height) ≤ MAX_EDGE` preserving aspect ratio (no upscaling); draw to `<canvas>`.
- `canvas.toBlob("image/jpeg", JPEG_QUALITY)` → `FormData` under `photo` field → `POST /api/identify`.

### Success Criteria

#### Automated Verification

- [ ] 2.1 Build passes with the new page: `npm run build`
- [ ] 2.2 Linting passes
- [ ] 2.3 `wrangler deploy --dry-run` confirms client resize/decode code did not leak into Worker bundle

#### Manual Verification

- [ ] 2.4 Large JPEG shows downsized preview with long edge ≤ `MAX_EDGE` and smaller file size
- [ ] 2.5 Rendered result shows `subjectName` + `description` for a recognisable landmark
- [ ] 2.6 Image orientation is correct (EXIF honored — no sideways/upside-down photos)
- [ ] 2.7 In-flight guard works: "Identify" is disabled while a request is outstanding and a
      failed request does not auto-retry (no duplicate `/api/identify` calls in DevTools Network)

**Implementation Note**: After this phase and automated verification passes, pause for manual
confirmation that the page downsizes and identifies correctly before proceeding to Phase 3.

---

## Phase 3: End-to-end verification & F-02 close-out

### Overview

Exercise the full flow with real phone photos and map the roadmap's executable success criteria.

### Changes Required

#### 1. End-to-end run + criteria mapping

**File**: `context/changes/ai-provider-spike/research.md` (update success-criteria checklist)
and `context/foundation/roadmap.md` F-02 status.

**Contract**: Tick the open items in `research.md`. Note free-tier CPU adequacy. Flag deferred
items (BYOK, auto-fallback, HEIC) as S-01 follow-up.

### Success Criteria

#### Automated Verification

- [ ] 3.1 `npx wrangler deploy --dry-run` passes, compressed Worker bundle well under 1 MB

#### Manual Verification

- [ ] 3.2 A real phone photo (JPEG/PNG/WebP) identified end-to-end through the test page
- [ ] 3.3 "Not recognised" path observed (a non-landmark photo returns `recognised: false` with a reason)
- [ ] 3.4 Rate limit reached state produces a clear `429` response visible in the browser DevTools
- [ ] 3.5 Free-tier CPU adequate (no CPU-limit errors during `wrangler dev` / dry-run)
- [ ] 3.6 F-02 success criteria in `research.md` checked off

**Implementation Note**: Requires a real `OPENROUTER_API_KEY`. After Phase 3 passes, F-02 is
complete and unlocks S-01/S-02.

---

## Testing Strategy

### Unit Tests

- Spike scope — no formal unit suite required. If `downscale.ts` is extracted, a lightweight test
  asserting "long edge ≤ MAX_EDGE and aspect ratio preserved" is worthwhile but optional.

### Integration Tests

- Manual curl-based integration for the route (Phase 1) and browser-based for the full flow
  (Phases 2–3). No automated browser harness for the spike.

### Manual Testing Steps

1. Unset the secret → `curl` the route → expect `503`.
2. `curl` without auth → expect `401`.
3. Insert `image_usage` row with `count = 100` for current period → `curl` → expect `429`.
4. Set secret + valid session → `curl -F photo=@known-landmark.jpg` → expect structured `200`.
5. `curl` a text file as `photo` → expect `415`.
6. Open test page → upload a large JPEG → confirm downsized preview (long edge ≤ 1024) + result.
7. Upload a clearly non-landmark photo → confirm `recognised: false` with a reason.
8. Upload a photo with EXIF rotation → confirm correct orientation in the preview.

## Performance Considerations

- Gemini 2.5 Flash uses far fewer tokens per image than Anthropic's Sonnet (~258 vs ~1,334
  estimated tokens per image). Client-side resize to 1024px cuts costs further.
- Worker CPU: session check + Supabase read + base64 relay + one OpenRouter fetch + JSON parse.
  The Supabase call is the one new addition; at ~2 ms round-trip it stays within the free 10 ms
  budget. Revisit only if measurements show otherwise.
- Worker bundle: `openai` (pure JS) + existing Supabase client — well under 1 MB compressed.

## Parked (out of scope for MVP)

- **BYOK**: user supplies their own `OPENROUTER_API_KEY`. Requires encrypted key storage in
  Supabase profiles and a settings UI. Not planned for MVP.
- **Auto-fallback on limit**: when `count >= IMAGE_LIMIT`, route to `MODELS.free` instead of
  returning `429`. Not planned for MVP — limit hit returns `429` and the user is informed.
- ~~**Atomic rate-limit increment**~~: **Done in this spike** — `try_consume_image_usage`
  (`SELECT … FOR UPDATE`) + `refund_image_usage` implement consume-on-attempt / refund-on-failure,
  closing the overshoot race. Remaining for S-01: wiring the cap into real app usage/UX.
- **Idempotency keys**: the route is not idempotent — a retried/duplicated request consumes a
  fresh slot and makes a fresh paid AI call (and, once S-01/S-02 persist data, would create a
  duplicate, possibly *conflicting* identification, since LLM output is non-deterministic).
  Parked for S-01: add a client-generated `request_id` (UUID) as a unique key on the
  usage/identification write so a retry returns the prior result instead of re-consuming.
  **Spike mitigation**: the Phase 2 in-flight guard (no double-submit, no auto-retry) removes the
  common double-spend cause. Consequence until S-01: the 100/day cap bounds *attempts*, not
  guaranteed-distinct successful identifications.
- **HEIC / iPhone-gallery support**: `heic2any` or `libheif-wasm` in the client. Not planned for MVP.

## Migration Notes

- No data migration. First introduction of `openai` SDK, `OPENROUTER_API_KEY`, `image_usage`
  table, and `src/lib/ai/models.ts`.
- `astro.config.mjs` env-schema change is additive and `optional: true` — build still succeeds
  without the secret (route degrades to `503`).

## References

- Verification research: `context/changes/ai-provider-spike/research.md`
- Original spike notes: `context/changes/ai-provider-spike/ai-connection-research.md`
- Secret idiom: `src/lib/supabase.ts:3,7`; env schema: `astro.config.mjs:17-22`
- Route shape: `src/pages/api/auth/signin.ts:4`
- Infra risks: `context/foundation/infrastructure.md` (bundle size, CPU limit)
- Roadmap item: `context/foundation/roadmap.md:76-84`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands.

### Phase 1: Server — AI provider wiring, model config, rate limiting & identify route

#### Automated

- [x] 1.1 Type checking passes (`npm run build` / typecheck)
- [x] 1.2 Linting passes
- [x] 1.3 Worker bundle within limits via `wrangler deploy --dry-run` (well under 1 MB)
- [x] 1.4 Route returns `503` when `OPENROUTER_API_KEY` is unset
- [x] 1.5 Route returns `401` for unauthenticated requests

#### Manual

- [x] 1.6 `curl` with a known small JPEG + valid session returns `{ result: { recognised, subjectName, description } }`
- [x] 1.7 Unrecognisable image returns `200` with `recognised: false` and a non-empty description
- [x] 1.8 Non-image / wrong media_type returns `415`; oversized payload returns `413`
- [x] 1.9 Row with `count = 100` in `image_usage` → returns `429` with usage info

### Phase 2: Client — downsizing test page

#### Automated

- [x] 2.1 Build passes with the new page
- [x] 2.2 Linting passes
- [x] 2.3 `wrangler deploy --dry-run` confirms client resize/decode code did not leak into Worker bundle

#### Manual

- [x] 2.4 Large JPEG shows downsized preview with long edge ≤ MAX_EDGE and smaller file
- [x] 2.5 Rendered result shows subjectName + description for a recognisable landmark
- [x] 2.6 Image orientation is correct (EXIF honored)
- [x] 2.7 In-flight guard works: "Identify" disabled while a request is outstanding, no auto-retry on failure (no duplicate `/api/identify` calls)

### Phase 3: End-to-end verification & F-02 close-out

#### Automated

- [ ] 3.1 `wrangler deploy --dry-run` passes, compressed Worker bundle well under 1 MB

#### Manual

- [ ] 3.2 Real phone photo (JPEG/PNG/WebP) identified end-to-end through the test page
- [ ] 3.3 "Not recognised" path observed on a non-landmark photo
- [ ] 3.4 Rate limit `429` observed at count = 100
- [ ] 3.5 Free-tier CPU adequate for the relay (no CPU-limit errors)
- [ ] 3.6 F-02 success criteria in `research.md` checked off
