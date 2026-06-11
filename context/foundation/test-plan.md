# Test Plan

> Phased test rollout for this project. Strategy is frozen at the top
> (§1–§5); cookbook patterns at the bottom (§6) fill in as phases ship.
> Read before writing any new test.
>
> Refresh: re-run `/10x-test-plan --refresh` when stale (see §8).
>
> Last updated: 2026-06-06 (Phase 1 change opened)

## 1. Strategy

Tests follow three non-negotiable principles for this project:

1. **Cost × signal.** The cheapest test that gives a real signal for the
   risk wins. Do not promote to e2e because e2e "feels safer." Do not put a
   vision model on top of a deterministic check that already catches the
   regression. The AI identification layer in particular must be tested
   against its *contract* (a mocked provider) at the cheap layer; the real
   model is exercised only in the selective AI-native phase.
2. **User concerns are first-class evidence.** Risks anchored in "the team
   is worried about X, and the failure would surface somewhere in <area>"
   carry the same weight as PRD lines. The top risk (#1) and the upload
   pipeline risk (#3) come straight from the Phase 2 interview.
3. **Risks are scenarios, not code locations.** This plan documents *what
   could fail* and *why we believe it's likely* — drawn from documents,
   interview, and codebase *signal* (structure, test base). It does NOT
   claim to know which line owns the failure. That knowledge is produced by
   `/10x-research` during each rollout phase. If the plan and research
   disagree about where the failure lives, research is the ground truth.

Hot-spot scope used for likelihood weighting: `src/`, `supabase/` — but the
scoped git history held only 4 commits in the last 30 days (insufficient
signal), so likelihood ratings below rely on the PRD, roadmap, and the
Phase 2 interview rather than churn.

## 2. Risk Map

The top failure scenarios this project must protect against, ordered by
risk = impact × likelihood. Risks are failure scenarios in user / business
terms, not test names. The Source column cites the *evidence that surfaced
this risk* — never a specific file as "where the failure lives" (that is
research's job, see §1 principle #3).

| # | Risk (failure scenario) | Impact | Likelihood | Source (evidence — not anchor) |
|---|--------------------------|--------|------------|--------------------------------|
| 1 | A wrong or low-confidence identification is presented as a verified fact, or the "not recognised" case renders a blank instead of the explicit state | High | High | PRD §Success Criteria/Guardrails + §NFR; US-01 acceptance criteria; interview Q1; roadmap F-02 |
| 2 | One traveler's photos, albums, or identifications become reachable by another user or an unauthenticated request | High | Medium | PRD §Guardrails ("privacy is the floor"), §Access Control, §NFR; roadmap F-01 (owner-only RLS + private bucket); abuse lens — authorization/IDOR |
| 3 | The traveler's original photo is corrupted, lost, or replaced by the downscaled copy on save | High | Medium | PRD §Guardrails ("upload never corrupts or loses the original"); interview Q3 (resize pipeline, low confidence); roadmap S-01 / F-02 |
| 4 | The AI provider returns a malformed/unexpected shape or throws, and the endpoint crashes or fabricates a result instead of failing in-band gracefully | High | Medium | PRD FR-004; roadmap F-02 (structured-output contract + error guards); interview Q1 |
| 5 | An unauthenticated or unauthorized request triggers a paid identification call — cost and resource abuse | High | Medium | roadmap F-02 (spike endpoint ships without auth; access control deferred to S-01); infrastructure.md risk register (CPU/cost); abuse lens — resource abuse |
| 6 | The server trusts client-supplied input (media type, size) instead of re-validating, so malformed or oversized payloads slip through | Medium | Medium | roadmap F-02 (415/413 guards, server-side allowlist); abuse lens — untrusted input / server-side validation parity |
| 7 | `ANTHROPIC_API_KEY` or Supabase keys leak into the client bundle, logs, or an error body | High | Low | roadmap F-02 (server/secret env declaration); infrastructure.md §Operational Story (secrets); abuse lens — secret/PII leakage |

**Impact × Likelihood rubric.** High impact = user loses access, data, or
money, or failure is publicly visible. Medium = feature degrades, a
workaround exists. Low impact = cosmetic. High likelihood = area changes
weekly or we have been burned here; Medium = touched occasionally; Low =
stable, rarely touched. With insufficient churn history, likelihood leans on
newness of the surface and interview weight.

Risk #7 is High-impact × Low-likelihood; it is kept because secret leakage
is cheap to assert deterministically (build-output + error-body shape), not
because churn raised it. The Cloudflare Workers deploy/runtime concern
raised in interview Q2 (CPU/bundle limits, Pages-vs-Workers drift) is
deliberately *not* a §2 risk — high-impact × low-likelihood infra limits
belong to a quality gate (bundle `--dry-run` + CI build) and observability,
not a unit test. It is routed to §3 Phase 5 / §5.

### Risk Response Guidance

| Risk | What would prove protection | Must challenge | Context `/10x-research` must ground | Likely cheapest layer | Anti-pattern to avoid |
|------|-----------------------------|----------------|--------------------------------------|-----------------------|-----------------------|
| #1 | `recognised:false` always surfaces the explicit unrecognised state; a recognised result never renders when the flag is false | "a non-empty `subjectName` means it's recognised" | where the `recognised` flag is honored in the route and the UI; the parsed-output shape | integration (route) + component test | oracle problem — asserting exact description prose lifted from the model |
| #2 | A user querying another user's rows or files gets zero rows / 403, not data | "logged-in implies authorized; an auth check is not an ownership check" | RLS policy enforcement path; storage path-prefix ownership rule | integration vs. Supabase local (two distinct users) | testing only the happy single-user path |
| #3 | The bytes saved as the original equal the bytes uploaded; the downscaled copy is only sent to the AI, never persisted as the original | "resize is harmless; client EXIF handling is correct everywhere" | which artifact is persisted vs. sent to the AI; the upload→storage boundary | integration around upload/storage | image snapshot without a byte/identity assertion |
| #4 | Provider throwing or returning junk yields an in-band graceful result (no crash, no fabricated success) | "a final 200 status means it worked" | error translation in the route; what the SDK can throw or mis-shape | unit/integration with a mocked provider client | over-mocking so the test mirrors the implementation |
| #5 | An unauthenticated identify request is rejected before any paid call is made | "the spike has no auth, so this is fine" — it is an S-01 gap to close | where auth is enforced on the identify route after S-01 | integration (route, no session) | deferring forever; asserting only the authed path |
| #6 | The server rejects a disallowed media type or oversized payload regardless of what the client claims | "the client already validated, so the server can trust it" | server-side guard order (415/413) independent of the client | unit/integration (route) | copying the client's validation as the server's oracle |
| #7 | The key never appears in the client bundle, logs, or error responses | "envField server/secret guarantees it forever" | the server-only boundary; the error-body shape | deterministic build-output assertion + error-shape test | asserting nothing observable; trusting config alone |

## 3. Phased Rollout

Each row is a discrete rollout phase that will open its own change folder
via `/10x-new`. Status moves left-to-right through the values below; the
orchestrator updates Status as artifacts appear on disk.

| # | Phase name | Goal (one line) | Risks covered | Test types | Status | Change folder |
|---|------------|-----------------|----------------|------------|--------|---------------|
| 1 | Harness bootstrap + identification contract | Stand up the test runner and prove the recognised/not-recognised guardrail and graceful provider-boundary behavior | #1, #4 | unit + integration (mocked provider) | change opened | context/changes/testing-harness-bootstrap/ |
| 2 | Upload integrity + input validation | Original bytes are preserved on save; server re-validates media type and size | #3, #6 | integration | not started | — |
| 3 | Authorization + data isolation | Cross-user denial (RLS + storage), auth required on identify, secret containment | #2, #5, #7 | integration + build-output assertion | not started | — |
| 4 | AI-native: identification accuracy eval | Catch real model/prompt regressions a mocked test cannot, on a small labeled image golden-set | #1 (deeper) | AI-native golden-set eval | not started | — |
| 5 | Quality-gates wiring | Lock the floor in CI: lint/typecheck/test + Workers bundle dry-run + e2e on the critical flow | cross-cutting (#1–#7); interview Q2 | gates + 1 e2e | not started | — |

**Status vocabulary** (fixed — parser literals): `not started` →
`change opened` → `researched` → `planned` → `implementing` → `complete`.

## 4. Stack

The classic test base for this project. AI-native tools carry a `checked:`
date so future readers can see which lines need re-verification.

| Layer | Tool | Version | Notes |
|-------|------|---------|-------|
| unit + integration | none yet — see §3 Phase 1 | — | No runner configured; 0 test files. Vitest is the natural fit for Astro + Vite (`overrides: vite ^7`); confirm setup via Context7 in Phase 1. |
| API / provider mocking | none yet — see §3 Phase 1 | — | Mock the Anthropic SDK / HTTP edge only, never internal modules. Candidate: MSW or the SDK's own mock surface; verify in Phase 1. |
| Worker route integration | none yet — see §3 Phase 1/2 | — | Astro API routes on workerd; integration via `wrangler`/`unstable_dev` or Astro's test container — to be grounded in Phase 1 research. |
| DB / RLS integration | Supabase CLI (local stack) | 2.104.0 (dev dep) | Already present; `supabase db reset` + two-user RLS checks are the basis for Phase 3. |
| e2e | none yet — see §3 Phase 5 | — | Playwright is the likely choice for the upload→identify→save critical flow; only one flow warrants e2e. |
| (optional) AI-native | golden-set eval (custom) — checked: 2026-06-06 | n/a | When NOT to use: never assert exact description prose; never CI-gate it (provider cost + non-determinism). |

**Stack grounding tools (current session):**
- Docs: Context7 — available; use in Phase 1 to confirm current Vitest + Astro setup and the `@anthropic-ai/sdk` mock surface; checked: 2026-06-06
- Search: Exa — available; use only to confirm current tool status, then prefer official docs; checked: 2026-06-06
- Runtime/browser: Playwright MCP — not available in current session; e2e tooling chosen in Phase 5 research
- Provider/platform: none exposed this session; Supabase CLI present locally as a dev dependency; Cloudflare `wrangler` present for bundle `--dry-run`; checked: 2026-06-06

## 5. Quality Gates

The full set of gates that must pass before a change reaches production.
"Required after §3 Phase <N>" means the gate is enforced once that rollout
phase lands; before that, the gate is `planned`.

| Gate | Where | Required? | Catches |
|------|-------|-----------|---------|
| lint (eslint) | local + CI | required | syntactic drift, style violations |
| typecheck (`astro check`) | local + CI | required | type drift, bad DB generics |
| unit + integration | local + CI | required after §3 Phase 1 | identification-contract and logic regressions |
| Workers bundle dry-run (`wrangler deploy --dry-run`) | CI on PR | required after §3 Phase 5 | bundle-size limit breach (interview Q2) |
| e2e on critical flow (upload→identify→save) | CI on PR | required after §3 Phase 5 | broken critical user path |
| post-edit hook | local (agent loop) | recommended after §3 Phase 1 | regressions at edit time |
| AI-native identification eval | manual / scheduled | optional (never CI-gated) | real model/prompt drift |
| pre-prod smoke | between merge + prod | optional | environment-specific (workerd/Supabase latency) failures |

## 6. Cookbook Patterns

How to add new tests in this project. Each sub-section is filled in once the
relevant rollout phase ships; before that, the sub-section reads "TBD."

### 6.1 Adding a unit test

- TBD — see §3 Phase 1 (test runner bootstrap; covers the identification-contract guardrail pattern, Risk #1/#4).

### 6.2 Adding an integration test (Worker API route)

- TBD — see §3 Phase 1/2 (route integration with a mocked provider; upload→storage integrity, Risk #3/#6).

### 6.3 Adding an RLS / data-isolation test

- TBD — see §3 Phase 3 (two-user cross-access denial against Supabase local, Risk #2; secret-containment assertion, Risk #7).

### 6.4 Adding an AI-native identification eval

- TBD — see §3 Phase 4 (golden-set eval of the `recognised` verdict; never assert exact prose, never CI-gate).

### 6.5 Adding an e2e test

- TBD — see §3 Phase 5 (the single upload→identify→save critical flow).

### 6.6 Per-rollout-phase notes

(Optional. After each phase lands, `/10x-implement` appends a 2–3 line note
here capturing anything surprising the rollout phase taught.)

## 7. What We Deliberately Don't Test

Exclusions agreed during the Phase 2 interview (Q5). Future contributors
should respect these unless the underlying assumption changes.

- **The developer test harness page** (`identify-test.astro` and similar) — a throwaway dev harness, not the real uploader. Re-evaluate only if it becomes user-facing. (Source: Phase 2 interview Q5.)
- **Generated Supabase types** (`src/types/supabase.ts`) — CLI-generated; the generator is the test. Re-evaluate if the file is ever hand-edited. (Source: Phase 2 interview Q5.)
- **Marketing / static pages** (landing, index, welcome) — low-risk static content; snapshot tests break constantly and catch nothing. Re-evaluate if dynamic logic is added. (Source: Phase 2 interview Q5.)
- **Exact AI description wording** — the literal prose the model returns is non-deterministic. Assert only the contract shape and the recognised / not-recognised distinction, never exact text. Re-evaluate never. (Source: Phase 2 interview Q5; reinforced by §2 Risk #1 anti-pattern.)

## 8. Freshness Ledger

- Strategy (§1–§5) last reviewed: 2026-06-06
- Stack versions last verified: 2026-06-06
- AI-native tool references last verified: 2026-06-06

Refresh (`/10x-test-plan --refresh`) when:

- a new top-3 risk surfaces from the roadmap or archive,
- a recommended tool's `checked:` date is older than three months,
- the project's tech stack changes (new framework, new test runner),
- §7 negative-space no longer matches what the team believes.
