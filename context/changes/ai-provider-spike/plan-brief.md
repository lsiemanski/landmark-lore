# F-02 AI Provider Spike — Plan Brief

> Full plan: `context/changes/ai-provider-spike/plan.md`
> Research: `context/changes/ai-provider-spike/research.md`, `context/changes/ai-provider-spike/ai-connection-research.md`

## What & Why

De-risk the Claude vision integration (FR-004/FR-005): a `/api/identify` endpoint that takes a user
photo, identifies the landmark/artwork/subject via `claude-sonnet-4-6` with a structured
`{ recognised, subjectName, description }` contract, and proves the PRD's "not recognised" guardrail.
The photo is **downsized in the browser before upload** so the Claude request carries a small payload
and costs fewer vision tokens — Anthropic bills `≈ (w×h)/750`, so a 1024px long edge cuts tokens
~40–70% with no accuracy loss on salient subjects.

## Starting Point

The repo already has the secrets idiom (`astro:env/server` + absence guard, `astro.config.mjs:17-22`,
`src/lib/supabase.ts`), the `APIRoute` POST shape (`auth/signin.ts`), `nodejs_compat`, and React +
Tailwind. `@anthropic-ai/sdk` is not yet installed and `src/pages/api/identify.ts` does not exist —
this spike introduces both. Internal/external research has already verified every integration claim.

## Desired End State

A developer opens a test page, picks a phone photo (JPEG/PNG/WebP), and sees it downsized in-browser,
sent to `/api/identify`, and rendered as a structured identification — with `recognised: false` +
reason for non-landmarks, graceful status codes for bad input, and a Worker bundle confirmed well
under the 1 MB limit.

## Key Decisions Made

| Decision | Choice | Why | Source |
| --- | --- | --- | --- |
| Where to downsize | Client-side (browser canvas) + minimal test page | Keeps Worker bundle/CPU tiny; mirrors eventual app flow | Plan |
| Resize target | Configurable, default 1024px long edge, JPEG q~0.8 | Below Sonnet's 1568 cap → real token savings | Plan |
| HEIC handling | **Deferred to S-01** (harness is JPEG/PNG/WebP only) | Heaviest/riskiest client piece, orthogonal to the AI-provider risk the spike retires | Plan review (2026-06-05) |
| Input guard | Reject early at ~5 MB + media_type allowlist | Sized to phone-gallery photos; defensive on Worker | Plan |
| Persistence | Pure identify, no storage write | Storage is FR-003/S-01; isolates the AI concern | Plan |
| Output contract | Structured `messages.parse` + json_schema | Cheap now; exercises "not recognised" guardrail | Research |
| Plan/CPU tier | Free tier viable (client resize), paid optional | No server-side WASM → CPU stays in 10 ms budget | Plan |
| Cost measurement | None explicit | Trust the resize; keep spike minimal | Plan |

## Scope

**In scope:** `@anthropic-ai/sdk` + `ANTHROPIC_API_KEY` wiring; `/api/identify` with structured
output + graceful statuses (503/415/413/502, in-band `recognised:false`); client-side downsizing test
page (JPEG/PNG/WebP) with EXIF-aware resize + JPEG re-encode; bundle dry-run + end-to-end verification.

**Out of scope:** HEIC decode (S-01, real uploader); image persistence/storage; server-side image
processing; token instrumentation; prompt caching; production UI; endpoint auth.

## Architecture / Approach

Two halves split by the network boundary. **Browser:** `createImageBitmap` with
`imageOrientation:"from-image"`→canvas resize (long edge ≤ MAX_EDGE)→JPEG Blob→multipart `FormData`→POST.
**Worker `/api/identify`:** read `photo` File + base64-encode server-side→validate media_type + byte
cap→`messages.parse` vision call→return `{ result }`. All image work lives in the client, so the
Worker bundle is just the SDK — bundle and CPU risks neutralised.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Server | SDK + secret + `/api/identify` (structured output, graceful statuses), bundle dry-run, curl smoke test | SDK version too old for `messages.parse` |
| 2. Client | Test page: EXIF-aware resize (JPEG/PNG/WebP) + post + render | EXIF orientation correctness |
| 3. E2E | Real phone-photo run; F-02 criteria mapped | Free-tier CPU adequacy under live load |

**Prerequisites:** a real `ANTHROPIC_API_KEY` (for live calls in Phases 1 & 3); a current
`@anthropic-ai/sdk` version that includes `messages.parse`.
**Estimated effort:** ~2 sessions across 3 phases.

## Open Risks & Assumptions

- EXIF orientation must be handled at resize, or rotated photos reach Claude.
- HEIC support is deferred to S-01; its decode reliability across browsers stays unproven until then.
- Assumes the recent `@anthropic-ai/sdk` exposes `messages.parse` + `output_config`; pin explicitly.
- Free-tier CPU assumed adequate for the relay — confirm in Phase 3; paid plan is cheap headroom.

## Success Criteria (Summary)

- A phone photo (JPEG/PNG/WebP) is downsized in-browser and identified end-to-end with a structured
  `{ recognised, subjectName, description }` result.
- A non-landmark returns `recognised: false` with a reason; bad input returns graceful status codes.
- Worker bundle confirmed well under 1 MB via `wrangler deploy --dry-run`.
