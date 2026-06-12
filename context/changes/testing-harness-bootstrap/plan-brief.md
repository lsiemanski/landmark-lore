# Testing Harness Bootstrap (F-03) — Plan Brief

> Full plan: `context/changes/testing-harness-bootstrap/plan.md`

## What & Why

F-03 bootstraps the Vitest + MSW test harness for Landmark Lore. No tests exist today; this
change establishes the runner, the OpenRouter HTTP mock layer, and the `astro:env/server`
virtual-module strategy that all subsequent test phases inherit. It is the explicit prerequisite
for S-01's integration tests and is the reason S-01 is currently blocked.

## Starting Point

Zero test infrastructure. The `identify.ts` API route (178 lines) contains the AI identification
logic as private, untestable helper functions. The route imports Astro virtual modules
(`astro:env/server`) at module load time — these don't resolve in plain Node.js without a Vitest
alias, which must be established before any test can import the route code.

## Desired End State

`npm test` runs 8 tests across 2 files — all green. The recognised/unrecognised contract and
provider-error guardrails (Risks #1 and #4) are verified. The `vi.mock('@/lib/supabase')` +
fake `APIContext` pattern is documented and usable for every future route integration test.
Shared helpers at `test/helpers/supabase-test.ts` and `test/helpers/route.ts` provide the
Supabase local client factory and `makeAPIContext` that S-01 and Phase 3 (RLS tests) will
inherit without further infrastructure work. `test:unit` and `test:integration` scripts let CI
run each suite independently.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
|---|---|---|---|
| Test runner | Vitest, Node pool | Natural fit for Astro + Vite; Workers pool adds complexity with no Phase 1 benefit | Research |
| HTTP mock | MSW v2 | Intercepts at the network level without mocking SDK internals — matches test-plan §4 constraint | test-plan.md |
| Virtual module handling | `test.alias` in `vitest.config.ts` → stub file | Module-level env reads require config-level aliasing before any module is loaded | Research |
| Code extraction | Move `identifyImage` + helpers to `src/lib/ai/identification.ts` | Makes the AI logic independently testable; aligns with the "split helpers" lesson | Plan |
| Test target | Logic-layer unit tests + route smoke test | Logic tests cover Risks #1/#4 cleanly; smoke test establishes the APIContext mock pattern for S-01 | Planning session |
| Test file location | Separate `test/unit/` and `test/integration/` directories | User preference | Planning session |
| Contract scope | Current route shape only (`{ result }`) | Decoupled from S-01's persistence changes; S-01 extends the tests when it adds `photoId` | Planning session |
| Developer harness | Excluded | test-plan.md §7: throwaway dev UI, not user-facing | test-plan.md |

## Scope

**In scope:** Vitest + MSW install and config; `astro:env/server` stub; YAML plugin wiring;
extraction of `identifyImage` from `identify.ts`; 6 identification-logic tests; 2 route smoke
tests; shared helpers (`test/helpers/supabase-test.ts`, `test/helpers/route.ts`) and
`test:unit` / `test:integration` scripts.

**Out of scope:** Auth and rate-limit tests (test-plan Phase 3); upload integrity (Phase 2/S-01);
developer harness page; `@cloudflare/vitest-pool-workers`; S-01 response shape (`photoId`).
Phase 5 creates the Supabase local *infrastructure* but writes no RLS or auth tests.

## Architecture / Approach

Standard Vitest with Node pool. MSW v2 in Node mode intercepts all HTTP calls to
`https://openrouter.ai/api/v1/chat/completions`. A single stub file at
`test/stubs/astro-env-server.ts` satisfies all `astro:env/server` imports at module load time.
Supabase is mocked via `vi.mock('@/lib/supabase')` in route integration tests only. The
`@rollup/plugin-yaml` plugin (already a devDep) is re-registered in `vitest.config.ts` so YAML
imports resolve independently of Astro's build pipeline.

## Phases at a Glance

| Phase | What it delivers | Key risk |
|---|---|---|
| 1. Infrastructure | Vitest + MSW wired; `npm test` exits clean with 0 tests | YAML plugin omission causes silent `.yaml` import failure at runtime |
| 2. Extraction | `identifyImage` in `src/lib/ai/identification.ts`; build still clean | Any missed reference in `identify.ts` breaks `astro check` |
| 3. Identification tests | 6 unit tests; Risks #1 and #4 covered | The 400-retry test depends on call-count tracking in the MSW handler |
| 4. Route smoke test | 2 integration tests; APIContext mock pattern established | `vi.mock` hoisting order with TypeScript can be surprising; verify tests are order-independent |
| 5. Integration helpers | `test/helpers/` + `test:unit`/`test:integration` scripts; S-01 unblocked | `@supabase/supabase-js` client target (local URL) must match `supabase start` default |

**Prerequisites:** F-01 and F-02 complete (both archived). S-01 is unblocked once all 5 phases land.
**Estimated effort:** ~1–2 sessions across 5 phases.

## Open Risks & Assumptions

- The `test.alias` approach for `astro:env/server` is confirmed by Vitest docs but not yet
  proven in this exact project setup — if it fails, a Vite plugin with a `resolveId` hook is
  the documented fallback
- MSW `onUnhandledRequest: 'error'` will fail any test that makes an unregistered HTTP call
  (including unexpected Supabase client HTTP calls not fully covered by `vi.mock`) — this is
  intentional; all outbound calls must be accounted for

## Success Criteria (Summary)

- `npm test` runs 8 tests, all green
- `npm run test:unit` and `npm run test:integration` each run their respective subset
- `test/helpers/supabase-test.ts` and `test/helpers/route.ts` exist and type-check clean
- No real HTTP calls to `openrouter.ai` during any test run
- `astro check` and `lint` remain clean after all five phases
