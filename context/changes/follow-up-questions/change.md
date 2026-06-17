---
change_id: follow-up-questions
title: Follow-up questions
status: implemented
created: 2026-06-17
updated: 2026-06-17
archived_at: null
---

## Notes

Roadmap: S-02 (`context/foundation/roadmap.md`). PRD ref: FR-005.

Settled framing (roadmap + project memory): in-browser only, no DB persistence,
same screen as the identification result, works for both recognized and
unrecognized photos.

Planning decisions (2026-06-17):

- Conversation context: **replay full Q&A history** each call (supersedes the
  roadmap's "stateless, no context retained" note; aligns with project memory).
- Grounding: **re-send the photo image** with every follow-up (uniform path for
  recognized + unrecognized).
- Quota: **separate daily follow-up cap** (new counter + RPC, distinct from the
  image quota).
- Unrecognized photos: **supported** via image re-send.
- Answer UX: **non-streaming** — spinner then full answer.
- Errors: **inline per-message retry**, conversation thread preserved.
- Answer scope: **on-topic** — constrained to the subject's historical/cultural
  context, off-topic asks politely deflected.

Revision (2026-06-17, mid-implement):

- **Persist an enriched description.** Reverses the earlier "no DB persistence /
  no change to identifications" decision. Each follow-up now also returns an
  **AI-synthesized enriched description** that integrates the new facts, and the
  route writes it **live** to the existing `identifications.description` of the
  recognized photo (the row already exists from identify time). The user retains
  what they asked about in the saved record.
- Scope: **recognized photos only** — unrecognized photos have no DB record, so
  their follow-up info stays in-browser as before.
- One AI call returns both `answer` + `enrichedDescription` (structured JSON,
  mirroring `identifyImage`), not two calls.
- Persistence is **best-effort**: a failed description write never discards the
  already-paid answer.
