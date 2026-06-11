# S-01 Research (seed) — rate limiting, refunds & idempotency

> **Carryover note.** This is pre-research seed material, not a completed `/10x-research` pass.
> It captures decisions and analysis from the **F-02 spike** (`ai-provider-spike`) discussion on
> 2026-06-11 so they are not lost before S-01 starts. Future `/10x-research` should build on this.

## Where F-02 left the rate-limit story (don't redo this in S-01)

F-02 built the `/api/identify` endpoint with a per-user daily cap (100) backed by `image_usage`.
The enforcement is **already hardened** in the spike — S-01 inherits it, it does not rebuild it:

- **Atomic enforcement (no overshoot).** `try_consume_image_usage(p_period, p_limit)` does an
  `INSERT … ON CONFLICT DO NOTHING` then `SELECT … FOR UPDATE`, so concurrent requests serialise
  on the user's row and the cap can never be exceeded. Returns a single record `(allowed, used)`
  (OUT params — see [lessons.md] "Use OUT params for single-row RPCs").
- **No reset bypass.** `image_usage` has a SELECT-only RLS policy; the anon-key client cannot
  write it. All writes go through two `security definer` functions.
- **Success-only counting.** `refund_image_usage(p_period)` decrements (floored at 0) when the AI
  call fails. Net: **consume-on-attempt, refund-on-failure** — only successful identifications
  ultimately count.
- Source: `supabase/migrations/20260611000001_create_image_usage.sql`, `src/pages/api/identify.ts`,
  and the F-02 plan §"Implementation Approach" / "Parked".

## What S-01 owns (carried over from the discussion)

### 1. Idempotency — the headline S-01 item

The endpoint is **not idempotent**. A retried/duplicated request consumes a fresh slot and makes
a fresh paid AI call. This matters more once S-01 **persists** identifications (FR-006): a retry
would create a **duplicate, possibly *conflicting*** identification row, because LLM output is
non-deterministic — two calls for the same photo can disagree.

**Design to implement in S-01:**
- Client generates a `request_id` (UUID) per logical identify action.
- Store it as a **unique key** on the usage/identification write.
- On a retry with the same `request_id`, **return the prior stored result** instead of
  re-consuming a slot or re-calling the model.
- Open questions: idempotency window / TTL; whether the key lives on the identification row, a
  dedicated idempotency-keys table, or both; how it composes with the `(user_id, period)` usage row.

### 2. Why refund does NOT substitute for idempotency

Analysis from the discussion (3 for / 3 against using refund as the retry guard):

**Refund *does* help:**
1. It neutralises the **failure path**, which is what triggers most retries — a failed-then-retried
   request nets to one consumption, so quota isn't eroded by the errors that provoke retries.
2. It's what makes a bounded "retry on failure" policy safe at all (raw consume-on-attempt would
   permanently burn a slot per retry).
3. It self-heals transient over-counts near the boundary, so a momentary spike at count≈100
   corrects itself instead of locking the user out for the day.

**Refund is *not* a real guard:**
1. It only fires on **failure**; the worst double-spend is when **both** duplicates **succeed**
   (double-tap, or lost-response retry of an already-successful call) — refund never fires there.
2. It's reactive bookkeeping: even when it fires, the paid AI call already executed (tokens +
   latency spent). It can't un-send or un-charge — real dedup prevents the second call entirely.
3. It has **no request identity** — it blindly `-1`s on failure, can't tell a retry from a distinct
   call, can interleave/drift under races, and a *failed* refund leaks a slot a retry can't reclaim.

**Verdict:** refund = *failure-path counter accuracy*, not duplicate suppression. The three
concerns map to three different jobs:
- **In-flight guard (F-02 Phase 2 client):** prevents the double-*send* at the source.
- **Idempotency / `request_id` (S-01):** neutralises retries that slip through, incl. success-success.
- **Refund (built in F-02):** keeps failure accounting honest so consume-on-attempt stays success-only.

### 3. Cap semantics to correct

Until idempotency lands, the 100/day cap bounds **attempts**, not guaranteed-distinct successful
identifications. S-01's `request_id` dedup is what converts it back to "100 successes". Reflect this
in any "X of 100 used" UI copy.

### 4. Refund robustness (lower priority)

Refund is currently **best-effort** (its `{ error }` is not inspected). A failed refund leaks one
slot. S-01 can decide: accept the leak, or add a small retry/outbox/ledger. Tie this to the
idempotency ledger if one is introduced.

### 5. Wire the cap into real app usage/UX

F-02's endpoint is a developer harness. S-01 integrates the cap into the real upload→identify→save
flow: surface remaining quota, render the `429` state for users, and connect to the persisted
archive (FR-006). Coordinate with the `data-schema` change for the photos/identifications tables.

## Parked items inherited from F-02 (not S-01-core, but adjacent)

- **BYOK** (user-supplied `OPENROUTER_API_KEY`): encrypted key storage + settings UI. Still parked.
- **Auto-fallback to free model on limit hit**: still parked; `429` is the MVP behaviour.

## Open design questions for S-01 kickoff

1. Where does `request_id` live, and what is its dedup window?
2. Does persistence change the consume model (e.g., reserve→write→commit) or keep
   consume-on-attempt + refund as-is?
3. How do the `image_usage` row and the identification/idempotency records relate transactionally?
4. Does the idempotency record also cache the **result payload** (to replay it on retry), or just
   guard against re-execution?

## Runtime config tunability (model / limit) — env now, KV later

F-02 made `model` and `dailyImageLimit` **runtime-tunable without a rebuild**:

- They are sourced from `astro:env/server` (`IDENTIFY_MODEL`, `IDENTIFY_DAILY_LIMIT`, both
  `access: "secret"` → read at runtime, *not* bundled), with the values in `src/lib/ai/config.ts`
  as defaults. The route reads only `IDENTIFY_CONFIG`. `maxBytes`/`allowedTypes` stay code
  defaults for now — promote on the same pattern if needed.
- **Change procedure (no rebuild):** set the value as a Cloudflare Worker **plaintext Variable**
  (dashboard or `wrangler`) — next request picks it up. Use plaintext Variables, not encrypted
  Secrets (only the former are dashboard-editable); don't pin them in `wrangler.jsonc [vars]` if
  you want dashboard edits to persist. Local dev: `.dev.vars`.
- **Why a plain properties file was rejected:** workerd has no runtime filesystem; a bundled file
  is build-time → would need a rebuild. Runtime env is the only no-rebuild lever on Workers.

**The boundary, and the KV upgrade path (S-01+ if/when needed):**

- Env-var changes are *config updates* (dashboard / `wrangler`) — near-instant but still a deploy
  action, not editing-a-value-in-place.
- For **truly live, zero-deploy** tuning, move the config blob to **Cloudflare KV** (a KV namespace
  is already bound — `env.SESSION`). Store JSON, read per request with a short in-memory cache,
  update via API / dashboard / `wrangler kv`. Heavier (KV read + caching + missing/garbage
  handling), so adopt only when env-var ergonomics actually pinch — e.g. frequent live limit/model
  tuning, per-tenant overrides, or an admin UI that flips config without touching Cloudflare.

## References

- F-02 plan: `context/changes/ai-provider-spike/plan.md` (§"Parked", §"Implementation Approach")
- F-02 impl review F1: `context/changes/ai-provider-spike/reviews/impl-review-phase-1.md`
- Migration: `supabase/migrations/20260611000001_create_image_usage.sql`
- Route: `src/pages/api/identify.ts`
- Lesson: `context/foundation/lessons.md` — "Use OUT params for single-row RPCs; enforce one row"
- Roadmap: `context/foundation/roadmap.md` §"S-01"
