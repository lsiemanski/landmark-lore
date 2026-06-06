# F-02 AI Provider Spike — Implementation Plan

## Overview

Land the F-02 AI-provider spike: a Claude vision **identify** endpoint that accepts a
user photo, runs it through `claude-sonnet-4-6` with a structured
`{ recognised, subjectName, description }` contract, and returns the result. The photo is
**downsized client-side** before it ever reaches the Worker — the image is resized to a
configurable max edge (default 1024px) and re-encoded as JPEG — so
the Claude request carries a small payload and costs fewer vision tokens. The Worker validates
and relays only; it never decodes or persists the image.

This de-risks the AI provider integration (FR-004/FR-005) and proves the PRD's "not recognised"
guardrail end-to-end, while keeping the Worker bundle lean and within the free CPU tier.

## Current State Analysis

- **Secrets idiom is established.** [astro.config.mjs:17-22](../../../astro.config.mjs#L17-L22)
  declares `SUPABASE_URL`/`SUPABASE_KEY` via `envField.string({ context: "server", access: "secret", optional: true })`;
  consumed in [src/lib/supabase.ts:3](../../../src/lib/supabase.ts#L3) with an absence guard
  ([:7](../../../src/lib/supabase.ts#L7)). `ANTHROPIC_API_KEY` copies this pattern verbatim.
- **API route shape is established.** [src/pages/api/auth/signin.ts:4](../../../src/pages/api/auth/signin.ts#L4)
  is `export const POST: APIRoute = async (context) => { … }` reading `context.request.formData()`.
- **Workerd is ready.** `wrangler.jsonc` sets `compatibility_flags: ["nodejs_compat"]`
  (`compatibility_date: 2026-05-08`), so `Buffer` is available; `.dev.vars` is gitignored
  (`.gitignore:56`).
- **`@anthropic-ai/sdk` is not yet installed** — this spike is its first introduction.
  `src/pages/api/identify.ts` does not exist yet (`src/pages/api/` has only `auth/{signin,signout,signup}.ts`).
- **React + Tailwind are available** ([astro.config.mjs:12](../../../astro.config.mjs#L12)), so the
  test page can be a plain `.astro` page with a client `<script>` (no framework island required).
- **Two infra risks gate this stream** ([context/foundation/infrastructure.md](../../foundation/infrastructure.md)):
  Worker **bundle size** (≤1 MB compressed; free tier 3 MB) and the **10 ms free-tier CPU limit**.
  Both are *neutralised by the client-side-resize decision* — see Implementation Approach.

## Desired End State

A developer can open the test page, pick a phone-gallery photo (JPEG/PNG/WebP),
and watch it get downsized in the browser, sent to `/api/identify`, and rendered as a structured
identification (`recognised` / `subjectName` / `description`). An unrecognisable photo returns
`recognised: false` with an explanation, in-band (HTTP 200). Misconfiguration and bad input
return graceful status codes. `wrangler deploy --dry-run` confirms the Worker bundle is well under
the limit. The three executable F-02 success criteria from the roadmap are checked off.

### Key Discoveries:

- **Anthropic vision billing is `≈ (w×h)/750` tokens**, capped for Sonnet at ~1568 tokens /
  1568px long edge; images above that are auto-downscaled (latency, no token benefit). Downscaling
  **below** the cap (e.g. 1024px long edge) genuinely cuts tokens (~33%+ vs the cap); published
  pipelines report **40–70% cost cuts with no accuracy loss** on salient subjects like landmarks.
  (Source: Claude vision docs + production pipeline write-ups, 2026-06-05 research.)
- **`sharp`/ImageMagick cannot run on workerd** (native libs). Server-side resize would require a
  WASM codec (`@cf-wasm/photon`) plus the **paid CPU tier** (free 10 ms can't finish a WASM resize)
  and would add single-digit MB to the Worker bundle. The **client-side** decision sidesteps all of this.
- **Structured output is adopted now** (decision 2026-06-05, `change.md`): consume via
  `client.messages.parse({ … output_config: { format: { type: "json_schema", schema } } })`,
  which returns `message.parsed_output`. Requires a **recent** `@anthropic-ai/sdk` — pin a current
  version, don't accept a stale cached resolve.
- **Pass `apiKey` explicitly** — `new Anthropic({ apiKey: ANTHROPIC_API_KEY })`. The zero-arg
  constructor reads `process.env`, unreliable on workerd; the explicit arg wins.

## What We're NOT Doing

- **No image persistence.** The spike does not write to the Supabase storage bucket. Storing the
  full-res original is FR-003/S-01 work. (The intended product flow is: store original as-is, send
  only the transient downsized copy to Claude — but the storage half is out of scope here.)
- **No server-side image processing.** The Worker never decodes, resizes, or re-encodes the image.
- **No explicit token-cost measurement / instrumentation.** We trust the resize; no `count_tokens`
  pre-check, no usage logging.
- **No prompt caching** (short system prompt is below Sonnet's 2048-token min cacheable prefix —
  confirmed no-op).
- **No HEIC support.** The harness accepts JPEG/PNG/WebP only. HEIC decode (`heic2any`/libheif-wasm)
  is the iPhone-gallery concern of the real uploader and is deferred to **S-01** — it is orthogonal to
  the AI-provider risk this spike exists to retire, and is the heaviest/riskiest client-side piece.
  (The cheap `imageOrientation: "from-image"` EXIF-correctness flag is kept; comprehensive EXIF
  edge-cases are likewise S-01.)
- **No production UI.** The test page is a developer harness, not the real uploader.
- **No auth on the endpoint** for the spike (it mirrors the public route shape; access control is S-01+).

## Implementation Approach

Two halves, cleanly separated by the network boundary:

1. **Browser (test page)** owns all image work. File picked → load via
   `createImageBitmap(blob, { imageOrientation: "from-image" })` so EXIF rotation is honored → draw
   to a `<canvas>` scaled so the **long edge ≤ `MAX_EDGE`**
   (configurable, default 1024) preserving aspect ratio → `canvas.toBlob(..., "image/jpeg", QUALITY)`
   (configurable, default ~0.8) → append the Blob to `FormData` (`photo`) → `POST` to `/api/identify`.
2. **Worker (`/api/identify`)** owns the Claude call. Validate `media_type` ∈ {jpeg, png, webp} and
   a sane byte cap (defensive — the posted image is already small) → build the vision message
   (image block + text block) → `messages.parse` with the JSON schema → return `{ result }`.
   Graceful statuses for the failure modes.

Because all image work (decode + canvas resize) lives in the **client**, the **Worker bundle is
just `@anthropic-ai/sdk`** — the registered bundle-size risk is neutralised, and Worker CPU
(base64 relay + one fetch + JSON parse) stays comfortably inside the free-tier 10 ms budget. The
paid plan becomes optional headroom, not a prerequisite.

## Critical Implementation Details

- **EXIF orientation must be handled at resize time.** Phone JPEGs carry an orientation tag;
  `<canvas>` `drawImage` ignores it unless the bitmap is decoded with
  `createImageBitmap(blob, { imageOrientation: "from-image" })` (or an equivalent lib). Skipping this
  sends sideways/upside-down images to Claude. This is the one non-obvious step in the client resize.
- **SDK version pin.** `messages.parse` + `output_config` require a recent `@anthropic-ai/sdk`; install
  `@latest`, commit the resolved version, and assert `typeof client.messages.parse === "function"`
  before building. A stale resolve will lack `parse`.
- **`media_type` normalisation.** The Worker should send `image/jpeg` (what the client produces),
  not echo an arbitrary client-claimed type; validate against the allowlist and reject otherwise.

## Phase 1: Server — AI provider wiring & identify route

### Overview

Add the SDK and secret, build the identify endpoint with structured output and graceful error
handling, and confirm the Worker bundle stays within limits — verified independently of the test
page via `curl` with a known small JPEG.

### Changes Required:

#### 1. Dependency

**File**: `package.json`

**Intent**: Add `@anthropic-ai/sdk` as the first AI dependency, pinned to a current version that
includes `messages.parse` / `output_config`.

**Contract**: New entry under `dependencies`. Run `npm install @anthropic-ai/sdk@latest`, then commit
the resolved version that lands in `package.json` (so the pin is explicit and reproducible). Current
versions expose `messages.parse`, `output_config`, and the `jsonSchemaOutputFormat` helper — confirmed
via Context7 (`/anthropics/anthropic-sdk-typescript`, 2026-06-05). Before building the route, guard
with `typeof client.messages.parse === "function"` to fail fast if a stale resolve lacks it.

#### 2. Secret declaration

**File**: `astro.config.mjs`

**Intent**: Declare `ANTHROPIC_API_KEY` as a server secret alongside the Supabase keys.

**Contract**: Add to `env.schema`:
`ANTHROPIC_API_KEY: envField.string({ context: "server", access: "secret", optional: true })` —
identical shape to lines 19–20.

#### 3. Secret configuration (local + deployed)

**File**: `.dev.vars` (gitignored), Cloudflare Workers secret store

**Intent**: Make the key available to `wrangler dev` and to deployed Workers.

**Contract**: Append `ANTHROPIC_API_KEY=<value>` to `.dev.vars`; run
`echo "$ANTHROPIC_API_KEY" | npx wrangler secret put ANTHROPIC_API_KEY` for the deployed secret
(per [infrastructure.md:95](../../foundation/infrastructure.md#L95)). Requires a real key.

#### 4. Identify route

**File**: `src/pages/api/identify.ts` (new)

**Intent**: A `POST` route that reads the (already-downsized) image, validates it, calls Claude
vision with structured output, and returns the parsed result — mirroring the `auth/signin.ts`
route shape and the `supabase.ts` absence-guard idiom.

**Contract**:
- Reads the uploaded image from `context.request.formData()` as the `photo` File field (mirrors
  `auth/signin.ts`), then base64-encodes it server-side via `Buffer.from(await file.arrayBuffer()).toString("base64")`
  (as in `research.md:112-114`). The client always sends multipart FormData — never pre-base64'd JSON.
- `media_type` is derived from the File part (the client always re-encodes to `image/jpeg`); validate it
  against the allowlist below and reject otherwise. The `415` path is therefore exercised by posting a
  non-image part (see manual test).
- Guards: `503` when `ANTHROPIC_API_KEY` is absent (`{ error: "AI provider not configured" }`);
  `415` when `media_type` ∉ {`image/jpeg`,`image/png`,`image/webp`}; `413` when the payload exceeds
  the configurable byte cap; `502` when the Anthropic call throws.
- Client: `new Anthropic({ apiKey: ANTHROPIC_API_KEY })` (explicit key).
- Call: `client.messages.parse({ model: "claude-sonnet-4-6", max_tokens: 1024, system: <identify prompt>,
  messages: [{ role: "user", content: [ {type:"image", source:{type:"base64", media_type, data}}, {type:"text", text:…} ] }],
  output_config: { format: { type: "json_schema", schema: identificationSchema } } })`.
- `identificationSchema`: object with required `recognised: boolean`, `subjectName: string`,
  `description: string`, `additionalProperties: false` (as in `research.md` lines 87–105).
- Success: `200` `{ result: message.parsed_output }`. `recognised: false` is a normal `200` (in-band),
  not an error status.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run build` (or the project's typecheck script)
- Linting passes: project lint script
- Worker bundle is within limits: `npx wrangler deploy --dry-run` reports compressed size well under 1 MB
- Route returns `503` when `ANTHROPIC_API_KEY` is unset (curl against `wrangler dev` without the secret)

#### Manual Verification:

- With the secret set, `curl -F photo=@known-landmark.jpg http://localhost:<port>/api/identify` returns
  `{ result: { recognised, subjectName, description } }` for a known small JPEG
- An unrecognisable image returns `200` with `recognised: false` and a non-empty `description`
- A non-image / wrong `media_type` returns `415`; an oversized payload returns `413`

**Implementation Note**: After this phase and all automated verification passes, pause for manual
confirmation that the curl smoke tests succeeded before proceeding to Phase 2.

---

## Phase 2: Client — downsizing test page

### Overview

A minimal developer harness page that performs the client-side downsizing (JPEG/PNG/WebP) and posts to
the identify route, then renders the structured result.

### Changes Required:

#### 1. Test page

**File**: `src/pages/identify-test.astro` (new)

**Intent**: A single page with a file input and a result area, wired to a client `<script>` that
downsizes the chosen image and calls `/api/identify`.

**Contract**: Plain `.astro` page (server output is fine; logic lives in a client `<script>`).
Renders a file `<input accept="image/jpeg,image/png,image/webp">`, a "Identify" action, and a results panel
showing `recognised` / `subjectName` / `description` plus the downsized preview + final dimensions.

#### 2. Client downsizing module

**File**: `src/pages/identify-test.astro` client `<script>` (or `src/lib/client/downscale.ts` if extracted)

**Intent**: Decode, EXIF-correct, resize to the configurable max edge, re-encode JPEG, and append the
Blob to FormData for upload.

**Contract**:
- Config constants `MAX_EDGE` (default `1024`) and `JPEG_QUALITY` (default `0.8`), plus an input
  byte cap reflecting phone-gallery photos (default ~`5 MB` accepted before resize; reject larger
  client-side with a clear message).
- Decode via `createImageBitmap(blob, { imageOrientation: "from-image" })` for EXIF correctness.
- Scale so `max(width, height) ≤ MAX_EDGE` preserving aspect ratio (no upscaling); draw to `<canvas>`.
- `canvas.toBlob(..., "image/jpeg", JPEG_QUALITY)` → append the resulting Blob to a `FormData` under the
  `photo` field → `POST` to `/api/identify` (multipart; the server base64-encodes — the client does not).

### Success Criteria:

#### Automated Verification:

- Build passes with the new page: `npm run build`
- Linting passes
- Worker bundle unchanged / still within limits: `npx wrangler deploy --dry-run` (confirms the client
  resize/decode code did not leak into the Worker bundle)

#### Manual Verification:

- Uploading a large JPEG shows a downsized preview with long edge ≤ `MAX_EDGE` and a much smaller file
- The rendered result shows `subjectName` + `description` for a recognisable landmark
- Image orientation is correct (no sideways/upside-down photos reaching the result)

**Implementation Note**: After this phase and automated verification passes, pause for manual
confirmation that the page downsizes and identifies correctly before proceeding to Phase 3.

---

## Phase 3: End-to-end verification & F-02 close-out

### Overview

Exercise the full flow with real phone photos and map the roadmap's executable success criteria.

### Changes Required:

#### 1. End-to-end run + criteria mapping

**File**: `context/changes/ai-provider-spike/research.md` (update the success-criteria checklist) and
`context/foundation/roadmap.md` F-02 status if appropriate

**Intent**: Record that the executable F-02 criteria are met; capture any observed gaps as notes for
S-01 (incl. the deferred HEIC/iPhone-gallery path).

**Contract**: Tick the three open items in `research.md` (secret configured, live call returns
structured result end-to-end, bundle verified). Note free-tier CPU adequacy and flag HEIC/iPhone-gallery
support as S-01 follow-up.

### Success Criteria:

#### Automated Verification:

- `npx wrangler deploy --dry-run` passes and reports compressed Worker bundle well under 1 MB

#### Manual Verification:

- A real phone photo (JPEG/PNG/WebP) taken from a gallery is identified end-to-end through
  the test page, returning `{ recognised, subjectName, description }`
- The "not recognised" path is observed (a non-landmark photo returns `recognised: false` with a reason)
- Free-tier CPU is adequate for the relay (no CPU-limit errors during `wrangler dev` / dry-run);
  paid-tier need is documented only if observed
- F-02 success criteria in `research.md` are checked off

**Implementation Note**: This phase requires a real `ANTHROPIC_API_KEY`. After it passes, F-02 is
complete and unlocks S-01/S-02.

---

## Testing Strategy

### Unit Tests:

- Spike scope — no formal unit suite is required. If the downscale logic is extracted to
  `src/lib/client/downscale.ts`, a lightweight test asserting "long edge ≤ MAX_EDGE and aspect ratio
  preserved" for a synthetic large image is worthwhile but optional.

### Integration Tests:

- Manual curl-based integration for the route (Phase 1) and browser-based integration for the full
  flow (Phases 2–3). No automated browser harness for the spike.

### Manual Testing Steps:

1. Unset the secret, `curl` the route → expect `503`.
2. Set the secret, `curl -F photo=@known-landmark.jpg` → expect structured `200`.
3. `curl` a text file as `photo` → expect `415`.
4. Open the test page, upload a large JPEG → confirm downsized preview (long edge ≤ 1024) and result.
5. Upload a clearly non-landmark photo → confirm `recognised: false` with a reason.
6. Upload a photo with EXIF rotation → confirm correct orientation in the preview.

## Performance Considerations

- Vision token cost scales with `(w×h)/750`; resizing to a 1024px long edge keeps each call below the
  Sonnet token cap and well under the un-resized cost — the central goal of this change.
- Client-side resize keeps Worker CPU to a base64 relay + one fetch + JSON parse — within the free
  10 ms tier. Revisit only if real measurements show otherwise.
- Worker bundle stays at ~`@anthropic-ai/sdk` size (fetch-based pure JS, well under 1 MB compressed);
  the client-side decode/resize code must not be imported by the route.

## Migration Notes

- No data migration. First introduction of `@anthropic-ai/sdk` and the `ANTHROPIC_API_KEY` secret.
- `astro.config.mjs` env-schema change is additive and `optional: true`, so the build still succeeds
  without the secret (route degrades to `503`).

## References

- Verification research: `context/changes/ai-provider-spike/research.md`
- Original spike notes: `context/changes/ai-provider-spike/ai-connection-research.md`
- Secret idiom: `src/lib/supabase.ts:3,7`; env schema: `astro.config.mjs:17-22`
- Route shape: `src/pages/api/auth/signin.ts:4`
- Infra risks: `context/foundation/infrastructure.md` (bundle size, CPU limit)
- Roadmap item: `context/foundation/roadmap.md:76-84`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Server — AI provider wiring & identify route

#### Automated

- [ ] 1.1 Type checking passes (`npm run build` / typecheck)
- [ ] 1.2 Linting passes
- [ ] 1.3 Worker bundle within limits via `wrangler deploy --dry-run` (well under 1 MB)
- [ ] 1.4 Route returns `503` when `ANTHROPIC_API_KEY` is unset

#### Manual

- [ ] 1.5 `curl` with a known small JPEG returns `{ result: { recognised, subjectName, description } }`
- [ ] 1.6 Unrecognisable image returns `200` with `recognised: false` and a non-empty description
- [ ] 1.7 Non-image / wrong media_type returns `415`; oversized payload returns `413`

### Phase 2: Client — downsizing test page

#### Automated

- [ ] 2.1 Build passes with the new page
- [ ] 2.2 Linting passes
- [ ] 2.3 `wrangler deploy --dry-run` confirms client resize/decode code did not leak into the Worker bundle

#### Manual

- [ ] 2.4 Large JPEG shows downsized preview with long edge ≤ MAX_EDGE and smaller file
- [ ] 2.5 Rendered result shows subjectName + description for a recognisable landmark
- [ ] 2.6 Image orientation is correct (EXIF honored)

### Phase 3: End-to-end verification & F-02 close-out

#### Automated

- [ ] 3.1 `wrangler deploy --dry-run` passes, compressed Worker bundle well under 1 MB

#### Manual

- [ ] 3.2 Real phone photo (JPEG/PNG/WebP) identified end-to-end through the test page
- [ ] 3.3 "Not recognised" path observed on a non-landmark photo
- [ ] 3.4 Free-tier CPU adequate for the relay (no CPU-limit errors)
- [ ] 3.5 F-02 success criteria in `research.md` checked off
