# Follow-up Questions (S-02) Implementation Plan

## Overview

Add an inline, in-browser follow-up chat to the identification result screen. After a photo is identified (recognized or not), the user can ask free-text questions about the subject and receive AI answers without leaving the screen. Each question re-sends the photo plus the full conversation history to a new text-chat AI function; answers are constrained to the subject's historical/cultural context. The **conversation thread** lives entirely in React state and is never persisted. However — for **recognized** photos — each follow-up also returns an **AI-synthesized enriched description** that the route writes **live** to the existing `identifications.description` row, so the user retains what they learned in the saved record (revision 2026-06-17; supersedes the earlier "no DB persistence / no change to identifications" decision). A separate daily cap (distinct from the image-identification quota) protects the OpenRouter budget.

This is roadmap slice **S-02** (`follow-up-questions`), PRD ref **FR-005**, prerequisite **S-01** (`first-identification-and-save`, done).

## Current State Analysis

S-01 shipped a complete upload → identify → save flow. The pieces this plan extends:

- **AI layer** — [`identifyImage(base64, apiKey)`](src/lib/ai/identification.ts) wraps the `openai` SDK against OpenRouter, requests a strict `json_schema` response, and falls back to `json_object` on a 400. Prompts are externalised in [`identify-prompts.yaml`](src/lib/ai/identify-prompts.yaml). Config (active model, base URL, max tokens, daily limit) is centralised in [`config.ts`](src/lib/ai/config.ts), sourced from runtime env.
- **API route** — [`api/identify.ts`](src/pages/api/identify.ts) composes shared helpers: `apiRoute()` (error→Response), `requireApiKey()`, `requireSupabaseClient()`, `requireAuthenticatedUser()` ([`auth.ts`](src/lib/api/auth.ts)), `HttpError` ([`http.ts`](src/lib/api/http.ts)), and a consume-on-attempt / refund-on-failure quota gate ([`quota.ts`](src/lib/identify/quota.ts)).
- **Quota infra** — [`image_usage`](supabase/migrations/20260611000001_create_image_usage.sql) table with RLS and two `security definer` functions (`try_consume_image_usage`, `refund_image_usage`). The anon client cannot write the table directly; all writes go through the locked-row functions.
- **UI** — [`UploadFlow.tsx`](src/components/identify/UploadFlow.tsx) holds the entire flow in a `FlowState` discriminated union (`idle | working | identified | unrecognized | saved | error`). It downscales the file client-side, posts to `/api/identify`, and renders [`IdentificationResult`](src/components/identify/IdentificationResult.tsx) inside [`PostIdentifyPanel`](src/components/identify/PostIdentifyPanel.tsx) (identified) or inline (unrecognized).
- **Tests** — MSW mocks the OpenRouter endpoint. Unit tests hit the AI function directly ([`identification.test.ts`](test/unit/identification.test.ts)); integration tests call the route's `POST` with a fabricated `APIContext` ([`identify-route.test.ts`](test/integration/identify-route.test.ts)) and a mocked Supabase client. Helpers: [`makeAPIContext`](test/helpers/route.ts), `makeCompletionResponse`, `test/msw/server`.

### Key Discoveries:

- The downscaled image blob is currently local to `handleIdentify()` ([UploadFlow.tsx:65](src/components/identify/UploadFlow.tsx#L65)) and discarded after upload — only `previewUrl` survives in `FlowState`. To re-send the image with each follow-up, the blob (or its base64) must be retained in the `identified`/`unrecognized` states.
- The quota counter is an **image** counter keyed on `try_consume_image_usage`; reusing it for text follow-ups would conflate cheap text with expensive vision calls. A parallel `followup_usage` table + functions mirrors the proven pattern with the lowest risk.
- `identifyImage` returns structured JSON; follow-up answers are free text, so `answerFollowUp` does **not** use `response_format` — it returns `response.choices[0].message.content` directly.
- The `json_object` 400-fallback in `identifyImage` exists only because of strict `json_schema`. Follow-up has no JSON schema, so no fallback path is needed — but the same `OpenAI.APIError` handling and "Empty response" guard apply.
- `unrecognized` photos have no DB record and no saved description; their only context is the image. Since the decision is to re-send the image for **all** follow-ups, recognized and unrecognized share one request shape (image always present; identification anchor present only when recognized).

## Desired End State

On the identification result screen, below the subject/description panel, a chat area lets the user type a question and get an answer inline. The thread accumulates in the browser; asking "and when was it built?" works because the full history is replayed. Answers stay on the subject's historical/cultural domain. For a **recognized** photo, each answer also refreshes the visible description: the route persists an AI-enriched description to the identification row and the panel updates in place, so the saved record retains what the user asked about. A failed question shows an inline retry without losing the thread. Follow-ups are capped per day separately from identifications. Refreshing the page or starting a new photo clears the **conversation thread** (the enriched description, already saved, persists in the archive). Verified by: unit tests on `answerFollowUp` (answer + enriched description, history replay, fallback), integration tests on `/api/follow-up` (auth, quota, history replay, image-required, on-topic prompt wiring, description persisted), a component test on the chat, and manual UI testing for both recognized and unrecognized photos.

## What We're NOT Doing

- **No DB persistence of the conversation thread** — no conversation tables, no new columns. The Q&A turns live only in React state. (We _do_ now update the existing `identifications.description` column for recognized photos — see Overview — but that is the single existing column, not a new schema.)
- **No enriched description for unrecognized photos** — they have no DB record to update; their follow-up info stays in-browser only.
- **No streaming** of answers — single response after a spinner (SSE deferred).
- **No navigation / new page** — chat is inline on the existing result screen.
- **No follow-up after Save** — the `saved` state replaces the result panel; follow-ups are available in the `identified` and `unrecognized` states only (before save / instead of save).
- **No idempotency / request_id** for follow-ups — they are not persisted, so replay-caching does not apply.
- **No general-purpose chatbot** — answers are scoped to the subject's domain.
- **No change to the image-identification quota** — the follow-up cap is additive.

## Implementation Approach

Build bottom-up in three phases, each independently verifiable: (1) the AI text-chat function + prompts, unit-tested in isolation; (2) the separate quota infra + the `/api/follow-up` route, integration-tested; (3) the inline chat UI wired into `UploadFlow`, with the image blob retained in state. Every layer mirrors an existing S-01 counterpart, so the work is pattern-application, not novel design.

The request shape is uniform across recognized/unrecognized: client sends the downscaled image, an optional identification anchor (`subjectName` + `description`, present only when recognized), an optional `photoId` (present only when recognized — the row to enrich), the prior Q&A history, and the new question. The server builds a vision message array — system prompt (on-topic) → a user turn carrying the image + anchor → replayed history turns → the new question — and asks for a **structured** completion of `{ answer, enrichedDescription }` (mirroring `identifyImage`'s `json_schema` request with a `json_object` 400-fallback). When a `photoId` is present, the route writes `enrichedDescription` to that identification row (best-effort) and returns `{ answer, description: enrichedDescription }`; otherwise it returns `{ answer }`.

## Critical Implementation Details

**State sequencing (quota):** follow the existing consume-on-attempt / refund-on-failure ordering — `consumeFollowUpSlot` before the AI call, `refundFollowUpSlot` in the catch. Refund must be best-effort (never throw over the original error), exactly as `refundSlot` does today.

**Description persistence (best-effort, after a successful answer):** the enriched-description write happens _after_ `answerFollowUp` returns successfully, only when a `photoId` is present (recognized). It must be best-effort — the answer is the already-paid primary deliverable, so a failed description write logs and is swallowed (return the answer anyway), never converting a good answer into an error and never triggering a quota refund. The write is RLS-gated by photo ownership (the `identifications` row is reachable only through the user's own photo); scope the update by `photo_id`.

**User experience spec:** the image blob must be retained in `FlowState` from the moment of identification so follow-ups can re-send it; the existing `previewUrl` (an object URL) is for display only and is not the bytes to upload. Encode the retained blob to base64 (or post it as multipart) at send time.

## Phase 1: Follow-up AI function + prompts

### Overview

Add a text-chat AI function that answers a follow-up question grounded in the photo image, the identification anchor, and the replayed conversation history — constrained to the subject's historical/cultural domain.

### Changes Required:

#### 1. Follow-up prompts

**File**: `src/lib/ai/identify-prompts.yaml`

**Intent**: Add an on-topic follow-up system prompt and the user-turn context template, alongside the existing identification prompts, so prompt copy stays externalised.

**Contract**: New top-level YAML keys (`followUpSystemPrompt`, a context preamble, and a `followUpJsonShapeHint` for the fallback). The system prompt instructs the model to (a) answer only about the depicted subject and its historical/cultural context, politely deflecting off-topic questions, and (b) produce an `enrichedDescription` — the prior description rewritten to integrate any new facts surfaced by this exchange, preserving its tone/length; if no prior description was provided (unrecognized), return an empty string. Mirror the tone/guardrail style of the existing `systemPrompt`. The `followUpJsonShapeHint` mirrors `jsonShapeHint`: states the exact `{ answer, enrichedDescription }` JSON shape for the `json_object` fallback path.

#### 2. `answerFollowUp` function

**File**: `src/lib/ai/follow-up.ts` (new)

**Intent**: A sibling to `identifyImage` that takes the image, the identification anchor, the prior Q&A turns, and the new question, and returns a structured `{ answer, enrichedDescription }`. Structured JSON (not free text) so a single inference yields both the reply and the rewritten description.

**Contract**: Exported `async function answerFollowUp(params: { base64: string; anchor: { subjectName: string; description: string } | null; history: { question: string; answer: string }[]; question: string }, apiKey: string): Promise<FollowUpResult>` where `FollowUpResult = { answer: string; enrichedDescription: string }`. Builds `ChatCompletionMessageParam[]`: system (follow-up prompt) → user turn with `image_url` (data URL, same `data:image/jpeg;base64,` shape as [identification.ts:63](src/lib/ai/identification.ts#L63)) + anchor text → for each history item a `user`/`assistant` pair → final `user` turn with the new question. Requests a strict `json_schema` completion for the `{ answer, enrichedDescription }` shape with the **same `json_object` 400-fallback** as [identification.ts:42-54](src/lib/ai/identification.ts#L42-L54) (append `followUpJsonShapeHint` on retry). Uses `IDENTIFY_CONFIG.model` and `IDENTIFY_CONFIG.followUpMaxTokens`. Guards empty `content` with `throw new Error("Empty response from AI provider")` and a failed Zod parse with `throw new Error("Malformed AI response")` (mirror `identifyImage`). Reuses the `OpenAI` client construction from `IDENTIFY_CONFIG.openrouterBaseUrl`.

#### 3. Follow-up max-tokens config

**File**: `src/lib/ai/config.ts`

**Intent**: Add a `followUpMaxTokens` field so the combined answer + rewritten description fit without truncation, tunable without touching the function.

**Contract**: New field on `IDENTIFY_CONFIG` (e.g. `followUpMaxTokens: 2048` — larger than the identify cap since the completion now carries both the answer and a full description rewrite). No env wiring required unless desired.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`
- Unit tests pass: `npm run test -- follow-up` (new `test/unit/follow-up.test.ts`)
- New unit test: resolves with `{ answer, enrichedDescription }` for a normal completion (MSW-mocked)
- New unit test: replays history — asserts the request body contains the prior Q&A turns and the new question (intercept via MSW request handler)
- New unit test: throws "Empty response from AI provider" when `content` is null
- New unit test: throws "Malformed AI response" for valid JSON missing required fields
- New unit test: retries with `json_object` format on a 400 (makes exactly 2 calls)
- New unit test: rejects with `OpenAI.APIError` on a non-400 provider error

#### Manual Verification:

- None required for this phase (pure function, fully covered by unit tests).

**Implementation Note**: After automated verification passes, proceed to Phase 2.

---

## Phase 2: Follow-up quota + `/api/follow-up` route

### Overview

Add a separate daily follow-up counter (table + RPCs mirroring `image_usage`) and the API route that authenticates, enforces the cap, parses the request, calls `answerFollowUp`, and refunds on failure.

### Changes Required:

#### 1. Follow-up usage migration

**File**: `supabase/migrations/<timestamp>_create_followup_usage.sql` (new)

**Intent**: A parallel daily counter for follow-up calls, isolated from the image quota.

**Contract**: `followup_usage(user_id, period, count)` table with RLS (select-own only, no client write policy) and two `security definer` functions `try_consume_followup_usage(p_period text, p_limit integer, out allowed boolean, out used integer)` and `refund_followup_usage(p_period text)`, with `grant execute ... to authenticated`. Structurally identical to [`20260611000001_create_image_usage.sql`](supabase/migrations/20260611000001_create_image_usage.sql) — copy and rename.

#### 2. Follow-up quota helpers

**File**: `src/lib/identify/quota.ts`

**Intent**: Add `consumeFollowUpSlot` / `refundFollowUpSlot` that call the new RPCs, mirroring the image-quota helpers including the 429 `HttpError` with `limit`/`used`.

**Contract**: Two new exported functions paralleling `consumeSlot`/`refundSlot`, reading a new `IDENTIFY_CONFIG.followUpDailyLimit`. Reuse `currentPeriod()`.

#### 3. Follow-up daily limit config

**File**: `src/lib/ai/config.ts`

**Intent**: Add the configurable per-user daily follow-up cap.

**Contract**: New `followUpDailyLimit` field on `IDENTIFY_CONFIG`, optionally backed by a new `FOLLOWUP_DAILY_LIMIT` env var (add to `astro.config` env schema as `server`/`secret`/`optional` if wired, matching `IDENTIFY_DAILY_LIMIT`).

#### 4. Request parsing for follow-up

**File**: `src/lib/identify/follow-up-request.ts` (new) — or colocate in the route

**Intent**: Parse the follow-up payload: the image, the optional identification anchor, the history array, and the question; validate the image type/size against `IDENTIFY_CONFIG` and reject a missing question.

**Contract**: A parse function returning `{ base64, anchor, photoId, history, question }`. **Wire format is multipart `FormData`** (photo blob under `photo` + a `payload` JSON field carrying `{ anchor, photoId, history, question }`) — chosen over JSON+base64 because it reuses the photo `File`/type/size validation and `encodeForAI` from [`upload.ts`](src/lib/identify/upload.ts#L6-L26) and matches the existing `/api/identify` client shape ([UploadFlow.tsx:68-71](src/components/identify/UploadFlow.tsx#L68-L71)). The Phase 3 client (§2) **must** send this same multipart shape. `photoId` is **optional** — present for recognized photos (the row to enrich), absent for unrecognized. Throw `HttpError(400)` on a missing/empty question, `HttpError(415)` on a bad image type.

#### 5. Identification description update helper

**File**: `src/lib/archive/photos.ts` (or `src/lib/identify/persistence.ts`)

**Intent**: A small helper that writes a new `description` to the `identifications` row of a user-owned photo, so the follow-up route can persist the enriched description.

**Contract**: Exported `async function updateIdentificationDescription(supabase, params: { userId: string; photoId: string; description: string }): Promise<void>`. Updates `identifications.description` scoped by `photo_id` (RLS gates by photo ownership; the `userId` is available for an explicit ownership guard mirroring `movePhoto`'s `count`-check pattern). Throws `HttpError(500)` on a DB error — the **caller** decides whether to swallow it (the route does, best-effort).

#### 6. `/api/follow-up` route

**File**: `src/pages/api/follow-up.ts` (new)

**Intent**: Compose the shared helpers into the follow-up flow: auth → consume follow-up slot → parse → `answerFollowUp` → persist enriched description (best-effort, recognized only) → return `{ answer, description? }`; refund on AI failure.

**Contract**: `export const POST = apiRoute(async (context) => { ... })`. Order: `requireApiKey()` → `requireSupabaseClient()` → `requireAuthenticatedUser()` → `consumeFollowUpSlot()` → parse → `answerFollowUp()` → (if `photoId` present) `updateIdentificationDescription()` wrapped in best-effort try/catch (log + swallow; never throw over a good answer, never refund) → `Response.json({ answer, description })` (omit `description` when no `photoId`). Note: `requireApiKey()` is currently a **private** function in [identify.ts:73-76](src/pages/api/identify.ts#L73-L76), not exported — extract it to a shared module (e.g. [`auth.ts`](src/lib/api/auth.ts) or [`http.ts`](src/lib/api/http.ts)) and import it into both routes rather than duplicating it. On any thrown error after consuming **but before/through the AI call**, `refundFollowUpSlot()` (best-effort) then rethrow `HttpError` as-is or wrap provider errors as `HttpError(502, { error: "AI provider error" })`. The description-persistence failure is explicitly **outside** this refund path. Mirror the structure of [`api/identify.ts`](src/pages/api/identify.ts).

#### 7. Middleware getUser hardening (addendum)

**File**: `src/middleware.ts`

**Intent**: Wrap `supabase.auth.getUser()` in a `try/catch` so a stale/invalid refresh token resolves to `context.locals.user = null` instead of throwing during page render (which would otherwise 500 the route). Added during Phase 2 implementation as a defensive hardening discovered while wiring the authenticated follow-up flow; documented here per impl-review F3 (2026-06-17).

### Success Criteria:

#### Automated Verification:

- Migration applies cleanly against a local Supabase (or `npm run` migration script if present)
- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`
- Integration tests pass: `npm run test -- follow-up-route` (new `test/integration/follow-up-route.test.ts`)
- New test: 200 with an `answer` string for an authenticated request (MSW-mocked completion)
- New test: 200 for a recognized request (`photoId` present) persists the enriched description and returns it as `description`
- New test: the answer is still returned (200) when the description-persist write fails (best-effort; no refund)
- New test: 401 for an unauthenticated request, before consuming a quota slot
- New test: 429 with `error`/`limit`/`used` when the follow-up cap is exhausted (mock RPC `allowed: false`)
- New test: 400 when the question is missing/empty
- New test: refund RPC is called when the AI call fails (mock provider 500), and the route returns 502
- New test: request body sent to OpenRouter includes the replayed history and the image

#### Manual Verification:

- `POST /api/follow-up` from the running app returns a coherent answer for a recognized photo.
- Exhausting the follow-up cap returns 429 without affecting the image quota counter.

**Implementation Note**: After automated verification passes, pause for manual confirmation before Phase 3.

---

## Phase 3: Inline follow-up chat UI in `UploadFlow`

### Overview

Render a follow-up chat below the identification result for both recognized and unrecognized photos. Retain the downscaled image in state, hold the conversation thread in React state, show a spinner then the full answer, and offer inline per-message retry on failure.

### Changes Required:

#### 1. Retain the image blob in `FlowState`

**File**: `src/components/identify/UploadFlow.tsx`

**Intent**: Keep the downscaled image (the bytes, not just the object URL) on the `identified` and `unrecognized` states so follow-ups can re-send it.

**Contract**: Extend the `identified` and `unrecognized` `FlowState` variants with the downscaled `Blob`/`File` (or its base64). Populate it in `handleIdentify()` from the `downsized` blob already created at [UploadFlow.tsx:65](src/components/identify/UploadFlow.tsx#L65).

#### 2. `FollowUpChat` component

**File**: `src/components/identify/FollowUpChat.tsx` (new)

**Intent**: A self-contained chat: a scrollable list of Q&A turns, a text input + send button, a thinking indicator while a call is in flight, and an inline error+retry for a failed turn — all without losing the thread.

**Contract**: Props include the image (blob/base64), the identification anchor (`{ subjectName, description } | null`), the optional `photoId` (recognized only), and an optional `onDescriptionUpdate(description: string)` callback so the parent can refresh the visible description live. Holds `messages` (the Q&A turns) and per-send pending/error state in local React state. On send: append the question optimistically, POST as multipart `FormData` (photo blob under `photo` + a `payload` JSON field `{ anchor, photoId, history, question }`, matching Phase 2 §4), render the returned `answer`, and — when the response carries a `description` — call `onDescriptionUpdate(description)`. Error handling **branches on `res.status`**: a `429` (follow-up cap exhausted) is terminal for the day — show a distinct "Daily follow-up limit reached" message (using the `limit`/`used` payload, mirroring the identify quota screen at [UploadFlow.tsx:217-233](src/components/identify/UploadFlow.tsx#L217-L233)) with **no Retry**; any other failure marks that turn errored with a Retry that re-issues the same question. Disable the input while a call is pending. Wait on response state (no timeouts). Reuse `Button` and the existing panel styling (Tailwind classes consistent with `PostIdentifyPanel`).

#### 3. Wire chat into the result screens

**File**: `src/components/identify/PostIdentifyPanel.tsx`, `src/components/identify/UnrecognizedPanel.tsx` (new), and `src/components/identify/UploadFlow.tsx`

**Intent**: Render `FollowUpChat` below `IdentificationResult` in the `identified` panel (passing the recognized anchor) and below the unrecognized result block (passing `anchor: null`), per the project memory's "same screen, inline" decision.

**Contract**: Add `FollowUpChat` to `PostIdentifyPanel`'s identified branch ([PostIdentifyPanel.tsx:70-99](src/components/identify/PostIdentifyPanel.tsx#L70-L99)), passing the recognized anchor, the `photoId`, and an `onDescriptionUpdate` callback. The live description update is owned by `UploadFlow`: it holds the `identified` `FlowState` (which carries `result.description`), so `onDescriptionUpdate` sets `flowState.result.description` to the returned enriched text and the panel re-renders with it. **Extract the inline `unrecognized` block ([UploadFlow.tsx:197-215](src/components/identify/UploadFlow.tsx#L197-L215)) into a new `UnrecognizedPanel.tsx`** (mirroring `PostIdentifyPanel`) and mount `FollowUpChat` (with `anchor: null`, no `photoId`, no `onDescriptionUpdate`) there — `UploadFlow.tsx` is already at the 250-line lesson ceiling, so the chat and its branch must live in a sibling panel rather than inline. `UploadFlow` keeps only state + routing and renders `<UnrecognizedPanel … onReset={resetToIdle} />`. The `saved` branch is unchanged (no follow-up after save). Conversation resets naturally on `resetToIdle()` since the chat state is scoped to the mounted result; the enriched description, already persisted, remains in the archive.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `npm run typecheck`
- Linting passes: `npm run lint`
- Component tests pass: `npm run test -- FollowUpChat` (new `test/unit/follow-up-chat.test.tsx`)
- New test: submitting a question renders the returned answer in the thread (fetch mocked)
- New test: a response carrying `description` fires `onDescriptionUpdate` with the enriched text
- New test: a failed call shows an inline retry and preserves prior turns
- New test: a 429 response shows a terminal "limit reached" message with no retry
- New test: the input is disabled while a call is pending

#### Manual Verification:

- Recognized photo: ask a follow-up, get an on-topic answer inline; ask a context-dependent follow-up ("and when was that built?") and confirm the history is honoured.
- Recognized photo: after a follow-up, the visible description updates to the enriched text, and re-opening the photo from the archive shows the persisted enriched description.
- Unrecognized photo: the chat appears and answers using the image (no description persisted).
- Off-topic question is politely deflected.
- A simulated network failure shows inline retry without clearing the thread; retry succeeds.
- Starting a new photo (`resetToIdle`) clears the conversation.
- No regression in the existing identify/save/discard flows.

**Implementation Note**: After automated verification passes, pause for manual confirmation. This is the final phase.

---

## Testing Strategy

### Unit Tests:

- `answerFollowUp`: normal answer, history replay (assert request body), empty-content guard, provider-error propagation.
- `FollowUpChat`: render answer, inline retry on failure, input disabled while pending.

### Integration Tests:

- `/api/follow-up`: 200 happy path, 401 unauth (before quota), 429 cap exhausted, 400 missing question, 502 + refund on provider failure, history+image present in outbound request.

### Manual Testing Steps:

1. Identify a recognized landmark, ask a factual follow-up, confirm an on-topic answer.
2. Ask a context-dependent follow-up and confirm the thread is honoured.
3. Ask an off-topic question, confirm a polite deflection.
4. Identify an unrecognized photo, confirm the chat works using the image.
5. Trigger a network failure mid-question, confirm inline retry preserves the thread.
6. Exhaust the follow-up cap, confirm 429 messaging and that the image quota is untouched.
7. Start a new photo, confirm the conversation is cleared.

## Performance Considerations

Re-sending the image plus the full history on every follow-up grows the payload and token cost as the thread lengthens. This is bounded by three guardrails: the separate daily follow-up cap, the on-topic system prompt (discourages long off-domain threads), and `followUpMaxTokens`. Gemini 2.5 Flash is inexpensive for text+vision; acceptable for v1. Workers CPU/time limits are not a concern for a single forwarded completion (same shape as the identify path already in production).

## Migration Notes

One new migration adds the `followup_usage` table and its two functions; it is additive and independent of existing tables. No data backfill. No change to `image_usage`.

## References

- Roadmap slice: `context/foundation/roadmap.md` (S-02)
- Project memory: S-02 follow-up architecture (in-browser, no DB, same screen, both photo states)
- Identification function (pattern for `answerFollowUp`): `src/lib/ai/identification.ts`
- Identify route (pattern for `/api/follow-up`): `src/pages/api/identify.ts`
- Image-usage quota (pattern for follow-up quota): `supabase/migrations/20260611000001_create_image_usage.sql`, `src/lib/identify/quota.ts`
- Test harness: `test/integration/identify-route.test.ts`, `test/unit/identification.test.ts`, `test/helpers/route.ts`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Follow-up AI function + prompts

#### Automated

- [x] 1.1 Type checking passes: `npm run typecheck` — feccca9
- [x] 1.2 Linting passes: `npm run lint` — feccca9
- [x] 1.3 Unit tests pass: `npm run test -- follow-up` — feccca9
- [x] 1.4 Unit test: resolves with `{ answer, enrichedDescription }` for a normal completion — feccca9
- [x] 1.5 Unit test: replays history in the request body — feccca9
- [x] 1.6 Unit test: throws "Empty response from AI provider" on null content — feccca9
- [x] 1.7 Unit test: throws "Malformed AI response" on valid JSON missing fields — feccca9
- [x] 1.8 Unit test: retries with `json_object` on a 400 (exactly 2 calls) — feccca9
- [x] 1.9 Unit test: rejects with `OpenAI.APIError` on a non-400 provider error — feccca9

### Phase 2: Follow-up quota + `/api/follow-up` route

#### Automated

- [x] 2.1 Migration applies cleanly
- [x] 2.2 Type checking passes: `npm run typecheck`
- [x] 2.3 Linting passes: `npm run lint`
- [x] 2.4 Integration tests pass: `npm run test -- follow-up-route`
- [x] 2.5 Test: 200 with an `answer` string for an authenticated request
- [x] 2.6 Test: recognized request (`photoId`) persists the enriched description and returns it as `description`
- [x] 2.7 Test: answer still returned (200) when the description-persist write fails (no refund)
- [x] 2.8 Test: 401 unauthenticated, before consuming a quota slot
- [x] 2.9 Test: 429 with `error`/`limit`/`used` when the cap is exhausted
- [x] 2.10 Test: 400 when the question is missing/empty
- [x] 2.11 Test: refund called and 502 returned on AI failure
- [x] 2.12 Test: outbound request includes replayed history and the image

#### Manual

- [ ] 2.13 `POST /api/follow-up` returns a coherent answer for a recognized photo
- [ ] 2.14 Exhausting the follow-up cap returns 429 without touching the image quota
- [ ] 2.15 A recognized follow-up persists the enriched description (verify the `identifications` row)

### Phase 3: Inline follow-up chat UI in `UploadFlow`

#### Automated

- [ ] 3.1 Type checking passes: `npm run typecheck`
- [ ] 3.2 Linting passes: `npm run lint`
- [ ] 3.3 Component tests pass: `npm run test -- FollowUpChat`
- [ ] 3.4 Test: submitting a question renders the returned answer
- [ ] 3.5 Test: a response carrying `description` fires `onDescriptionUpdate` with the enriched text
- [ ] 3.6 Test: a failed call shows inline retry and preserves prior turns
- [ ] 3.7 Test: a 429 response shows a terminal "limit reached" message with no retry
- [ ] 3.8 Test: input disabled while a call is pending

#### Manual

- [ ] 3.9 Recognized photo: on-topic answer inline; context-dependent follow-up honours history
- [ ] 3.10 Recognized photo: the visible description updates live and persists in the archive
- [ ] 3.11 Unrecognized photo: chat answers using the image (no description persisted)
- [ ] 3.12 Off-topic question is politely deflected
- [ ] 3.13 Network failure shows inline retry without clearing the thread; retry succeeds
- [ ] 3.14 Starting a new photo clears the conversation
- [ ] 3.15 No regression in existing identify/save/discard flows
