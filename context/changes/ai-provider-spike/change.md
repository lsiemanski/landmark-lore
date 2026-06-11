---
change_id: ai-provider-spike
title: AI provider spike
status: impl_reviewed
created: 2026-06-05
updated: 2026-06-11
re_reviewed: 2026-06-11
archived_at: null
---

## Notes

<!-- Free-form notes for this change: links, ad-hoc context, decisions that don't belong in research/frame/plan. -->

- Roadmap item **F-02** (PRD refs FR-004, FR-005). Unlocks S-01, S-02.
- Spike research: `ai-connection-research.md` (original hand-authored spike notes).
- Verification + open-question resolution: `research.md` (2026-06-05).
- Decision (2026-06-05): adopt **structured output** in the spike contract rather than deferring to S-01.
- Decision (2026-06-11): **switch provider from Anthropic to OpenRouter**. Anthropic API has no free tier and requires a paid account from call one. OpenRouter provides an OpenAI-compatible gateway with model flexibility under a single key.
- Decision (2026-06-11): **primary model is `google/gemini-2.5-flash`** via OpenRouter. Best quality/cost ratio for vision (~$0.00008/image). Free model `google/gemini-2.0-flash-lite:free` defined alongside in `MODEL_CONFIG` for easy switching.
- Decision (2026-06-11): **SDK is `openai`** (not `@anthropic-ai/sdk`) with `baseURL: "https://openrouter.ai/api/v1"`. OpenRouter is OpenAI-compatible; the `openai` package runs on workerd unchanged.
- Decision (2026-06-11): **per-user daily rate limit of 100 image requests**. Owner funds the API key; cap prevents cost abuse. Enforced via Supabase `image_usage (user_id, period, count)` table. Returns `429` with usage context when exceeded.
- Decision (2026-06-11): **BYOK parked — out of scope for MVP**. User-supplied keys require encrypted storage in Supabase profiles and a settings UI; not planned.
- Decision (2026-06-11): **auto-fallback to free model on limit hit parked — out of scope for MVP**. Limit hit returns `429`; free-model routing not planned for MVP.
- Decision (2026-06-11): **atomic rate-limit RPC parked — out of scope for MVP**. Read-then-upsert race condition accepted at MVP scale.
