# F-02 AI Provider Spike — Plan Brief

> Full plan: `context/changes/ai-provider-spike/plan.md`
> Research: `context/changes/ai-provider-spike/research.md`, `context/changes/ai-provider-spike/ai-connection-research.md`

## What & Why

De-risk the AI vision integration (FR-004/FR-005): a `/api/identify` endpoint that takes a
user photo, identifies the landmark/artwork/subject via `google/gemini-2.5-flash` through
**OpenRouter** with a structured `{ recognised, subjectName, description }` contract, and proves
the PRD's "not recognised" guardrail. The photo is **downsized in the browser before upload** to
keep the request payload small. A **per-user daily cap of 100 image requests** is enforced
server-side. Model selection is centralised in `src/lib/ai/models.ts` so paid ↔ free swaps
are a one-line change.

## Starting Point

The repo already has the secrets idiom (`astro:env/server` + absence guard), the `APIRoute`
POST shape (`auth/signin.ts`), `nodejs_compat`, Supabase auth, and React + Tailwind.
`openai` SDK is not yet installed and `src/pages/api/identify.ts` does not exist —
this spike introduces both, plus `src/lib/ai/models.ts` and the `image_usage` table.

## Desired End State

A developer opens a test page (logged in), picks a phone photo (JPEG/PNG/WebP), and sees it
downsized in-browser, sent to `/api/identify`, and rendered as a structured identification —
with `recognised: false` + reason for non-landmarks, graceful status codes for bad input,
`429` when the daily limit is reached, and a Worker bundle confirmed well under 1 MB.

## Key Decisions

| Decision | Choice | Why | Source |
| --- | --- | --- | --- |
| AI provider | **OpenRouter** (not Anthropic directly) | No Anthropic free tier; OpenRouter gives model flexibility via one key | Research 2026-06-11 |
| Primary model | `google/gemini-2.5-flash` | Best quality/cost ratio for vision (~$0.00008/image); no Chinese-origin concerns | Research 2026-06-11 |
| Free model | `google/gemini-2.0-flash-lite:free` | Zero-cost fallback; same provider, same API shape | Research 2026-06-11 |
| Model config | Centralised `src/lib/ai/models.ts` `MODELS` const | One place to swap; no model strings in route code | Plan 2026-06-11 |
| SDK | `openai` with `baseURL: "https://openrouter.ai/api/v1"` | OpenRouter is OpenAI-compatible; `openai` runs on workerd | Research 2026-06-11 |
| Rate limit | 100 image requests / user / calendar day → `429` | Owner funds the API key; prevents cost abuse | Decision 2026-06-11 |
| Rate limit storage | Supabase `image_usage (user_id, period, count)` | Already in the stack; simple upsert | Plan 2026-06-11 |
| BYOK | **Parked — out of scope for MVP** | Adds settings UI + encrypted key storage; not planned | Decision 2026-06-11 |
| Auto-fallback on limit | **Parked — out of scope for MVP** | Limit hit returns 429; free-model fallback not planned for MVP | Decision 2026-06-11 |
| Where to downsize | Client-side (browser canvas) | Keeps Worker bundle/CPU tiny; mirrors eventual app flow | Plan original |
| Resize target | Configurable, default 1024px long edge, JPEG q~0.8 | Minimises token cost with no accuracy loss on salient subjects | Plan original |
| HEIC handling | **Deferred to S-01** | Heaviest/riskiest client piece, orthogonal to the AI risk | Plan original |
| Persistence | Pure identify, no storage write | Storage is FR-003/S-01; isolates the AI concern | Plan original |
| Output contract | Structured JSON schema | Exercises "not recognised" guardrail; cheap to adopt | Research original |
| Auth on endpoint | **Required** (session check → `401`) | Rate limiting is per-user; needs authenticated identity | Plan 2026-06-11 |

## Scope

**In scope:** `openai` SDK + `OPENROUTER_API_KEY` wiring; `src/lib/ai/models.ts` with `MODELS`
const; Supabase `image_usage` migration; `/api/identify` with session check, rate limiting,
structured output, graceful statuses (503/401/429/415/413/502, in-band `recognised:false`);
client-side downsizing test page (JPEG/PNG/WebP) with EXIF-aware resize + JPEG re-encode;
bundle dry-run + end-to-end verification.

**Out of scope (MVP):** BYOK; auto-fallback to free model on limit; atomic rate-limit RPC; HEIC decode;
image persistence; server-side image processing; token instrumentation; production UI.

## Architecture / Approach

Three concerns split by boundary. **Browser:** EXIF-aware decode → canvas resize (long edge ≤
`MAX_EDGE`) → JPEG Blob → multipart `FormData` → POST. **Worker `/api/identify`:** session check
→ rate limit check (Supabase `image_usage`) → media_type + byte-cap validation → base64-encode
→ `chat.completions.create` with `image_url` content block + `response_format: json_schema` →
upsert usage count → return `{ result }`. **Database:** `image_usage` table tracks
`(user_id, period, count)`.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Server | SDK + secret + model config + usage table + `/api/identify` (auth, rate limit, structured output, graceful statuses), bundle dry-run, curl smoke test | `image_url` format vs Anthropic's `source` block |
| 2. Client | Test page: EXIF-aware resize (JPEG/PNG/WebP) + post + render | EXIF orientation correctness |
| 3. E2E | Real phone-photo run; rate-limit 429 observed; F-02 criteria mapped | Free-tier CPU adequacy under live load |

**Prerequisites:** a real `OPENROUTER_API_KEY`; a Supabase instance with the `image_usage`
migration applied; a logged-in test user.
**Estimated effort:** ~2 sessions across 3 phases.

## Open Risks & Assumptions

- `response_format: json_schema` support confirmed for Gemini 2.5 Flash via OpenRouter — verify
  at implementation time; fallback is `json_object` + manual parse with `JSON.parse`.
- EXIF orientation must be handled at resize, or rotated photos reach the model.
- HEIC support deferred to S-01; iPhone-gallery reliability unproven until then.
- Rate-limit check is read-then-upsert (not atomic) — race window acceptable for MVP scale.
- Free-tier CPU assumed adequate for the relay — confirm in Phase 3.

## Success Criteria (Summary)

- A phone photo (JPEG/PNG/WebP) is downsized in-browser and identified end-to-end with a
  structured `{ recognised, subjectName, description }` result.
- A non-landmark returns `recognised: false` with a reason; bad input returns graceful status codes.
- A user at 100 requests/day receives `429` with usage context.
- Worker bundle confirmed well under 1 MB via `wrangler deploy --dry-run`.
