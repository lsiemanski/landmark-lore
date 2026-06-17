# Follow-up Questions (S-02) — Plan Brief

> Full plan: `context/changes/follow-up-questions/plan.md`

## What & Why

After identifying a photo, a user often has more questions — "when was it built?", "who designed it?". S-02 (PRD FR-005) lets them ask free-text follow-ups inline on the result screen and get AI answers, turning a one-shot identification into a short tour-guide conversation. Nothing is saved; the thread lives in the browser only.

## Starting Point

S-01 shipped the full upload → identify → save flow. The AI layer (`identifyImage`), the `/api/identify` route, the `image_usage` quota (table + `security definer` RPCs), and the `UploadFlow` result screen are all in place and tested with an MSW-based harness. S-02 is pure extension — every layer has an S-01 counterpart to mirror.

## Desired End State

Below the subject/description panel, a chat area lets the user type a question and see the answer appear inline (spinner → full answer). The conversation accumulates and is replayed so context-dependent follow-ups work. Answers stay on the subject's historical/cultural domain. Works for recognized and unrecognized photos. Failures retry inline without losing the thread. A separate daily cap protects the budget. New photo / refresh clears everything.

## Key Decisions Made

| Decision             | Choice                                         | Why (1 sentence)                                                                                          | Source                                  |
| -------------------- | ---------------------------------------------- | --------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| Conversation context | Replay full Q&A history each call              | Fixes the answer-quality risk the roadmap itself flagged; trivial since the client already holds messages | Plan (resolves Roadmap↔Memory conflict) |
| Persistence          | In-browser React state, no DB                  | Conversation feels like a continuation, not a stored feature; no DB complexity for v1                     | Memory                                  |
| Grounding            | Re-send the image with every follow-up         | One uniform path for recognized + unrecognized; enables visual questions                                  | Plan                                    |
| Quota                | Separate daily follow-up cap (new table + RPC) | Don't burn the 100/day image budget on cheap text calls                                                   | Plan                                    |
| Unrecognized photos  | Supported (image re-sent)                      | Matches stored decision; enables a "what is this?" refinement loop                                        | Memory                                  |
| Answer UX            | Non-streaming: spinner then full answer        | Mirrors S-01; no SSE plumbing on Workers                                                                  | Plan                                    |
| Errors               | Inline per-message retry, thread preserved     | A transient failure shouldn't cost the conversation                                                       | Plan                                    |
| Answer scope         | On-topic, off-topic deflected                  | Consistent with the identification prompt's guardrails; controls cost/abuse                               | Plan                                    |

## Scope

**In scope:** text-chat AI function with history replay; `/api/follow-up` route; separate daily follow-up quota (migration + RPCs); inline chat UI for recognized and unrecognized photos; on-topic answers; inline retry.

**Out of scope:** DB persistence of conversations; streaming answers; follow-ups after Save; idempotency/request_id; general-purpose chatbot behaviour; any change to the image quota.

## Architecture / Approach

Uniform request shape: client sends the downscaled image + optional identification anchor (subject/description, recognized only) + prior Q&A history + new question. Server builds a vision message array (system on-topic prompt → user turn with image + anchor → replayed history → new question) and returns plain-text. Three layers, each mirroring an S-01 counterpart: `answerFollowUp()` (← `identifyImage`), `/api/follow-up` + `followup_usage` quota (← `/api/identify` + `image_usage`), `FollowUpChat` in `UploadFlow` (← `PostIdentifyPanel`).

## Phases at a Glance

| Phase                    | What it delivers                                                       | Key risk                                                              |
| ------------------------ | ---------------------------------------------------------------------- | --------------------------------------------------------------------- |
| 1. AI function + prompts | `answerFollowUp()` + on-topic prompts, unit-tested                     | Prompt tuning so off-topic deflection isn't over-aggressive           |
| 2. Quota + route         | `followup_usage` migration/RPCs + `/api/follow-up`, integration-tested | Migration correctness; refund-on-failure ordering                     |
| 3. Chat UI               | Inline `FollowUpChat` for both photo states                            | Retaining the image blob in `FlowState`; not regressing identify/save |

**Prerequisites:** S-01 (`first-identification-and-save`) — done.
**Estimated effort:** ~2–3 sessions across the three phases.

## Open Risks & Assumptions

- Re-sending the image + full history every call grows token cost as threads lengthen — bounded by the separate cap, the on-topic prompt, and `followUpMaxTokens`; acceptable for v1.
- The plan supersedes the roadmap's "stateless, no context retained" note in favour of history replay (aligned with the project memory and the roadmap's own quality-risk caveat).
- Assumes the follow-up request format (multipart vs JSON+base64) is decided once in Phase 2 and matched by the Phase 3 client.

## Success Criteria (Summary)

- A user can ask a follow-up about an identified photo and get a relevant, on-topic answer inline, without leaving the screen.
- Context-dependent follow-ups work (history is honoured); unrecognized photos also support follow-ups.
- Follow-ups are capped separately from identifications; failures retry inline without losing the conversation.
