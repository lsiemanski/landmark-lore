# Testing Harness Bootstrap (F-03) Implementation Plan

## Overview

Install Vitest and MSW, configure the test environment to handle Astro's virtual modules
(`astro:env/server`) and the Cloudflare Workers project conventions, extract the identification
logic into a testable module, and write integration tests that prove the recognised/not-recognised
contract (Risk #1) and graceful provider-error handling (Risk #4). This is a prerequisite for
S-01 integration tests.

## Current State Analysis

Zero test infrastructure: no Vitest, no MSW, no test files, no `test` script in `package.json`.
The `openai` SDK (v6.42.0) and `wrangler` (v4.90.0) are already present.

The identify endpoint (`src/pages/api/identify.ts`, 178 lines) contains the AI identification
logic as private helper functions. `identifyImage` and `requestIdentification` are not exported
and cannot be tested without extracting them. The route imports `OPENROUTER_API_KEY` directly
from `astro:env/server` at module load time — a Vite virtual module that does not resolve in a
plain Node.js Vitest run without an alias.

The route makes HTTP POST calls to `https://openrouter.ai/api/v1/chat/completions` via the
`openai` SDK with a custom `baseURL`. MSW v2 (Node mode) can intercept this call at the
network level without mocking SDK internals.

### Key Discoveries

- `astro:env/server` is a Vite virtual module; Vitest's `test.alias` redirects it to a stub
  file — the standard pattern confirmed by Vitest docs for non-existent/virtual modules
- `@rollup/plugin-yaml` must be listed in `vitest.config.ts` plugins (same as `astro.config.mjs`)
  for `.yaml` imports in `identification.ts` to resolve; Vitest does not inherit Astro's config
- `identifyImage` only takes `base64: string` and `apiKey: string` — no Supabase, no Workers
  env — making it directly testable once extracted
- The route's catch block around `identifyImage` is bare (`catch {}`), so any throw safely maps
  to the 502-refund path; the error boundary is at the route level, not inside the helper
- `IDENTIFY_CONFIG.openrouterBaseUrl` is a hardcoded constant (`"https://openrouter.ai/api/v1"`),
  not sourced from env — MSW's intercept target is stable across test runs
- `recognised: false` returns HTTP 200 with a valid identification object (not an HTTP error) —
  this is the key Risk #1 assertion that the route must not misrepresent

## Desired End State

`npm test` runs 8 tests across 2 files, all passing:
- 6 unit tests in `test/unit/identification.test.ts` covering the identification contract and
  provider error paths
- 2 integration tests in `test/integration/identify-route.test.ts` proving the POST handler
  returns 200 for both recognised and unrecognised results

`npm run test:unit` and `npm run test:integration` each run their respective subset independently.
`npm run test:coverage` produces a V8 coverage report. `astro check` and lint remain clean.

Shared test helpers exist at `test/helpers/openrouter.ts` (the OpenRouter completion-shape
builder, created in Phase 3), `test/helpers/supabase-test.ts`, and `test/helpers/route.ts`,
providing the completion builder, the Supabase local client factory, and the `makeAPIContext`
pattern that S-01 and Phase 3 (RLS tests) will inherit without any further infrastructure work.

## What We're NOT Doing

- **Developer harness page** (`identify-test.astro`) — explicitly excluded per test-plan.md §7;
  throwaway dev UI, not user-facing; not retested unless it becomes user-facing
- **Auth and rate-limit tests** (Risks #2, #5, #7) — Phase 3 of the test plan; a separate change
- **Upload integrity tests** (Risk #3, #6) — Phase 2; lives in S-01
- **S-01 response shape** (`{ result, photoId? }`) — F-03 tests the current route contract only;
  S-01 extends the tests when it adds persistence and `photoId`
- **`@cloudflare/vitest-pool-workers`** — the identification helpers use no Workers-specific APIs;
  Node pool is sufficient for Phases 1–3 of the test plan
- **`wrangler dev` integration tests** — deferred to Phase 5 quality gates
- **Actual RLS/auth tests** — Phase 5 creates the *infrastructure* (Supabase local helpers) but
  does not write any auth or RLS tests; those belong to a dedicated future change

## Implementation Approach

Four sequential phases: (1) install and wire Vitest + MSW with proper virtual-module handling;
(2) extract the identification logic from the route into a standalone testable module; (3) write
unit tests against the extracted module; (4) write a route-level smoke test via direct POST
handler invocation with mocked Supabase.

Phases 1–2 are pure infrastructure — no tests are written yet. Phase 3 tests the identification
logic in isolation (no Supabase, no APIContext). Phase 4 tests the full HTTP handler via
`vi.mock` for Supabase and MSW for OpenRouter.

## Critical Implementation Details

**MSW version**: Use MSW v2 (`http`, `HttpResponse` from `msw`; `setupServer` from `msw/node`).
MSW v1 uses a different API (`rest`, inline handlers in `setupServer`). The two are incompatible.
Install the current stable v2 release.

**YAML plugin in Vitest**: `identification.ts` (after extraction) imports
`@/lib/ai/identify-prompts.yaml`. Vitest does not share the `astro.config.mjs` plugin
configuration — `yaml()` from `@rollup/plugin-yaml` must be listed in `vitest.config.ts`
`plugins` or the import fails at test runtime with "Unknown file extension '.yaml'."

**Vitest globals and `astro check`**: `tsconfig.json` includes `**/*` (only `dist` excluded), so
`astro check` type-checks the `test/` tree. With `test.globals: true`, the global test APIs need a
type declaration — add `test/vitest-env.d.ts` containing `/// <reference types="vitest/globals" />`.
Do not use `compilerOptions.types` for this (it would suppress astro's auto-included ambient types).

**Module-level env reads**: `config.ts` reads `IDENTIFY_MODEL` and `IDENTIFY_DAILY_LIMIT` from
`astro:env/server` at module load time (not lazily). The alias must live in `vitest.config.ts`
`test.alias` — not in `vi.mock` inside individual test files — so it resolves before any module
is loaded.

---

## Phase 1: Test infrastructure

### Overview

Install Vitest and MSW; create the test directory skeleton, `astro:env/server` stub, MSW server
singleton, global setup file, and the `vitest/globals` type-reference file; add `test`,
`test:watch`, and `test:coverage` scripts to `package.json`. No tests are written in this phase —
the goal is `npm test` exits 0 cleanly and `astro check` stays clean over the new `test/` files.

### Changes Required

#### 1. New dev dependencies

**File**: `package.json` (and `package-lock.json`)

**Intent**: Add the Vitest runner, V8 coverage provider, and MSW HTTP mock library as
devDependencies.

**Contract**: Install `vitest`, `@vitest/coverage-v8`, and `msw` (current stable v2) as
devDependencies. No other packages.

#### 2. `vitest.config.ts`

**File**: `vitest.config.ts` (root, new file)

**Intent**: Configure Vitest with a Node pool, register the YAML plugin and `@/` path alias
matching `tsconfig.json`, redirect `astro:env/server` to the test stub, point to the global
setup file, and restrict test discovery to `test/**`.

**Contract**: The config must include `plugins: [yaml()]` (from `@rollup/plugin-yaml`),
`resolve.alias: { "@": resolve(..., "./src") }`, `test.alias: { "astro:env/server": resolve(..., "./test/stubs/astro-env-server.ts") }`,
`test.globals: true`, `test.environment: "node"`, `test.setupFiles: ["./test/setup.ts"]`,
`test.passWithNoTests: true` (so `vitest run` exits 0 before any test file exists — the
default is to exit 1 with "No test files found"), and `test.include: ["test/**/*.test.ts"]`.
Use `resolve` from `node:path` and `import.meta.dirname` (Node 20.11+) for path resolution.

#### 3. `test/stubs/astro-env-server.ts`

**File**: `test/stubs/astro-env-server.ts` (new file)

**Intent**: Provide test-time values for the `astro:env/server` virtual module so that
module-level imports in `config.ts` and `identify.ts` resolve without errors during Vitest runs.

**Contract**: Export all five variables declared in `astro.config.mjs`'s `env.schema`:
`OPENROUTER_API_KEY` as a non-empty string literal (so `requireApiKey()` does not throw 503 in
route-level tests); `SUPABASE_URL`, `SUPABASE_KEY`, `IDENTIFY_MODEL`, and `IDENTIFY_DAILY_LIMIT`
as `undefined` (so `IDENTIFY_CONFIG` falls back to its hardcoded defaults).

#### 4. `test/msw/server.ts`

**File**: `test/msw/server.ts` (new file)

**Intent**: Export the shared MSW Node server instance. Individual tests register per-test
handlers via `server.use(...)`; the global setup file owns the lifecycle.

**Contract**: `export const server = setupServer()` with no default handlers. Import
`setupServer` from `msw/node`.

#### 5. `test/setup.ts`

**File**: `test/setup.ts` (new file)

**Intent**: Wire MSW server lifecycle into Vitest's global hooks so every test starts with a
clean handler state and unhandled HTTP calls fail loudly.

**Contract**: `beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))` — passing
`'error'` causes any HTTP call not matched by a handler to throw, preventing silent test
pass-throughs. `afterEach(() => server.resetHandlers())`. `afterAll(() => server.close())`.

#### 6. `test/vitest-env.d.ts`

**File**: `test/vitest-env.d.ts` (new file)

**Intent**: Declare Vitest's global APIs to TypeScript. Because `tsconfig.json` has
`include: ["**/*"]` (excludes only `dist`), `astro check` type-checks every file under `test/`.
With `test.globals: true`, `describe`/`it`/`expect`/`vi` and the lifecycle hooks
(`beforeAll`/`afterEach`/`afterAll`) are used unqualified — without this declaration TypeScript
treats them as undefined and `astro check` fails (as early as Phase 1's check over `setup.ts`).

**Contract**: A single line — `/// <reference types="vitest/globals" />`. Do NOT add
`"types": ["vitest/globals"]` to `tsconfig.json` `compilerOptions`: a `types` array overrides
the default auto-inclusion of `@types/*` and would drop ambient types `astro/tsconfigs/strict`
relies on. The reference file is the non-destructive way to add the globals.

#### 7. `package.json` — test scripts

**File**: `package.json`

**Intent**: Add runnable test scripts.

**Contract**: Add to `scripts`: `"test": "vitest run"`, `"test:watch": "vitest"`,
`"test:coverage": "vitest run --coverage"`. The `test:unit` and `test:integration` split scripts
are added in Phase 5 once both directories exist.

#### 8. `eslint.config.js` — test-file override

**File**: `eslint.config.js`

**Intent**: Relax the type-aware safety rules for test files. The repo applies
`tseslint.configs.strictTypeChecked` with `projectService: true` to every `.ts` file, and the
test patterns this plan uses — `{ ... } as unknown as APIContext`, member access off
`await response.json()` (typed `any`), and `vi.mock` factories returning loosely-typed mocks —
trip `@typescript-eslint/no-unsafe-*`. Without an override, `npm run lint` (gate 4.3) fails on
the test files even though the production code is clean.

**Contract**: Append a flat-config override block (after `baseConfig`, before
`eslintPluginPrettier`) scoped to `files: ["test/**/*.ts"]` that turns off
`@typescript-eslint/no-unsafe-assignment`, `no-unsafe-member-access`, `no-unsafe-call`,
`no-unsafe-argument`, and `no-unsafe-return` (add `no-explicit-any` to the off list only if a
test genuinely needs it). Keep the override minimal — relax only what the mock/cast patterns
require, not the whole rule set.

### Success Criteria

#### Automated Verification

- `npm test` exits 0 (no test files yet; passes via `passWithNoTests`; no module resolution errors)
- `npm run build` passes (no regressions from new devDependencies)
- `npx astro check` exits clean

#### Manual Verification

- `vitest.config.ts` opens without TypeScript errors in the IDE
- Stub file at `test/stubs/astro-env-server.ts` exports all five env variables

**Implementation Note**: After completing this phase and all automated verification passes, pause
here for manual confirmation from the human that the manual testing was successful before
proceeding to the next phase. Phase blocks use plain bullets — the corresponding `- [ ]`
checkboxes for these items live in the `## Progress` section at the bottom of the plan.

---

## Phase 2: Extract identification logic

### Overview

Move `identifyImage`, `requestIdentification`, `visionMessages`, `identificationSchema`, and the
YAML prompt constants from `identify.ts` into a new `src/lib/ai/identification.ts` module. Export
`identifyImage` and an `IdentificationResult` type. Update `identify.ts` to import
`identifyImage` from the new module and remove the extracted code. Build must stay clean.

### Changes Required

#### 1. `src/lib/ai/identification.ts` (new file)

**File**: `src/lib/ai/identification.ts`

**Intent**: House the AI identification logic (HTTP call, structured-output fallback, JSON parsing)
as an independently-testable module. Takes only `base64: string` and `apiKey: string` — no
Supabase, no Workers env, no Astro context.

**Contract**: Export `IdentificationResult` type (`{ recognised: boolean; subjectName: string;
description: string }`) and `identifyImage(base64: string, apiKey: string): Promise<unknown>`.
Contain the YAML prompt import, `identificationSchema`, and the private `requestIdentification` +
`visionMessages` helpers. All behaviour identical to the current private functions in
`identify.ts` — this is a pure move, no logic changes.

#### 2. `src/pages/api/identify.ts` (update)

**File**: `src/pages/api/identify.ts`

**Intent**: Remove the four extracted functions plus the YAML import, prompt constants, and
schema constant. Import `identifyImage` from `@/lib/ai/identification`. All route-level behaviour
(auth, rate-limit slot, error wrapping, HTTP response shaping) is unchanged.

**Contract**: File shrinks from ~178 to ~100 lines. After the update, `identify.ts` imports are:
`astro` types, `astro:env/server`, `@/lib/supabase`, `@/lib/ai/config`,
`@/lib/ai/identification`. The `openai` import is removed entirely — the route no longer
references `OpenAI` or `OpenAI.APIError` directly.

### Success Criteria

#### Automated Verification

- `npm run build` passes (confirms no import breakage from the extraction)
- `npx astro check` exits clean (confirms TypeScript is satisfied with the new module boundary)
- `npm test` still exits 0 with no test files (passWithNoTests; confirms no silent regressions from the refactor)

#### Manual Verification

- `src/pages/api/identify.ts` no longer contains `identifyImage`, `requestIdentification`,
  `visionMessages`, or `identificationSchema`
- `src/lib/ai/identification.ts` exists and contains all four

**Implementation Note**: After completing this phase and all automated verification passes, pause
here for manual confirmation from the human that the manual testing was successful before
proceeding to the next phase.

---

## Phase 3: Identification-contract tests (Risk #1, Risk #4)

### Overview

Write 6 unit tests in `test/unit/identification.test.ts` that exercise `identifyImage` directly
via MSW-mocked HTTP responses. Covers the recognition contract (Risk #1) and all graceful
provider-error paths (Risk #4).

### Changes Required

#### 1. `test/unit/identification.test.ts` (new file)

**File**: `test/unit/identification.test.ts`

**Intent**: Prove that `identifyImage` returns the parsed identification object for both
recognised and unrecognised results (Risk #1), and that it throws cleanly for each provider
failure mode — empty response, malformed JSON, non-400 APIError, and the 400-to-json_object
retry path (Risk #4).

**Contract**: Six `it(...)` blocks grouped under two `describe` labels matching the risk numbers.
Each test registers one MSW handler via `server.use(http.post(OPENROUTER_URL, ...))` for
`https://openrouter.ai/api/v1/chat/completions`. The `makeCompletionResponse(content)` helper —
which returns a minimal OpenAI `ChatCompletion` shape (`id`, `choices[0].message.content`,
`usage`) — lives in a **shared** module `test/helpers/openrouter.ts` (new file, created in this
phase) so Phase 4's route test reuses the same builder rather than duplicating the shape. Import
it via a relative path (`../helpers/openrouter`). The 400-retry test uses a call counter inside
the handler to assert exactly 2 requests were made. Test cases:

1. `recognised: true` result — `identifyImage` resolves with `{ recognised: true, subjectName, description }`
2. `recognised: false` result — `identifyImage` resolves (does NOT throw); result has `recognised: false`
3. Empty `message.content` — rejects with `"Empty response from AI provider"`
4. Non-JSON `message.content` — rejects (JSON.parse throws)
5. Non-400 HTTP error (e.g. 500) — rejects with an `OpenAI.APIError`
6. 400 on first call → retry succeeds with `json_object` format; call count equals 2

**SDK auto-retry note**: `identifyImage` constructs `new OpenAI(...)` with no `maxRetries`, so the
SDK default (2 retries) applies. The 500 test (case 5) will therefore hit the MSW handler 3 times
with backoff, not once — it still rejects correctly, so the assertion holds, but do not assert a
call count on that path. **As implemented**, the 500 handler returns a null body with a
`Retry-After: 0` header (collapsing the backoff sleep to ~0) under a 15s test timeout, so all 3
SDK attempts finish in ~20ms instead of ~1.5s. The 400-retry test (case 6) is unaffected: the SDK does not
retry 400s, so the only second call is the explicit `json_object` fallback (count == 2). If a
deterministic count is ever needed on a retryable status, the test must pass `maxRetries: 0` —
which would require parameterising the client construction in `identification.ts`.

### Success Criteria

#### Automated Verification

- `npm test` runs 6 tests in `test/unit/identification.test.ts`, all green
- `onUnhandledRequest: 'error'` in MSW causes any unregistered outbound HTTP call to fail the
  test (confirms no accidental real network calls)

#### Manual Verification

- Test output labels the two `describe` groups as Risk #1 and Risk #4
- The 400-retry test explicitly asserts `expect(calls).toBe(2)`

**Implementation Note**: After completing this phase and all automated verification passes, pause
here for manual confirmation from the human that the manual testing was successful before
proceeding to the next phase.

---

## Phase 4: Route smoke test (Risk #1 — HTTP layer)

### Overview

Write 2 integration tests in `test/integration/identify-route.test.ts` that call the exported
`POST` handler directly with a constructed `APIContext`. Mock Supabase via `vi.mock` and
OpenRouter via MSW. Prove that both recognised and unrecognised results return HTTP 200 with the
correct body shape at the route level — and establish the `vi.mock + fake APIContext` pattern
for S-01 route tests.

### Changes Required

#### 1. `test/integration/identify-route.test.ts` (new file)

**File**: `test/integration/identify-route.test.ts`

**Intent**: Exercise the full `POST` handler — auth check, rate-limit slot consume,
`identifyImage` call, and response wrapping — for the recognised and unrecognised cases. The
mock pattern here (fake `APIContext`, `vi.mock('@/lib/supabase')`) is the template all future
route integration tests will copy.

**Contract**:
- `vi.mock('@/lib/supabase', factory)` — factory returns `createClient` as a `vi.fn()` that
  returns a mock Supabase: `auth.getUser()` resolves to `{ data: { user: { id: 'user-123' } }, error: null }`;
  `rpc(...)` resolves to `{ data: { allowed: true, used: 1 }, error: null }` (satisfies both
  `try_consume_image_usage` and the best-effort `refund_image_usage`)
- Helper `makeFormData()` — builds a `FormData` with a `image/jpeg` `File` containing small
  fake bytes (passes MIME and size checks in `readImageAsBase64`)
- Helper `makeContext(formData)` — constructs `{ request: new Request('http://localhost/api/identify', { method: 'POST', body: formData }), cookies: {} } as unknown as APIContext`
- Two tests: assert `response.status === 200` and `body.result.recognised === true` (test 1) /
  `body.result.recognised === false` (test 2)
- Registers its OpenRouter MSW handler using `makeCompletionResponse` imported from the shared
  `test/helpers/openrouter.ts` (created in Phase 3) — no local copy of the completion shape

### Success Criteria

#### Automated Verification

- `npm test` runs 8 total tests (6 unit + 2 integration), all green
- `npx astro check` exits clean
- `npm run lint` exits clean

#### Manual Verification

- `npm test -- --reporter=verbose` shows tests grouped under describe labels referencing Risk #1
- No real HTTP calls to `openrouter.ai` are made during any test run (MSW `onUnhandledRequest: 'error'` guarantees this)

**Implementation Note**: After completing this phase and all automated verification passes, pause
here for manual confirmation from the human that the manual testing was successful before
proceeding to the next phase.

### Addendum (applied during Phase 4)

To get gate 4.3 (`npm run lint`) green on Windows, Phase 4 also applied these unplanned
infra unblockers — recorded here so later reviews don't re-flag them as drift:

- `.prettierrc.json`: add `"endOfLine": "auto"` (`core.autocrlf=true` caused CRLF checkout →
  ~1196 false prettier errors across the repo).
- `eslint.config.js`: add `{ ignores: ["src/types/supabase.ts"] }` for the auto-generated
  Supabase types; `.prettierignore` mirrors this (impl-review F1) so regeneration doesn't
  fight the formatter.
- Lint/prettier autofix swept `src/lib/ai/identification.ts` (`type` → `interface`),
  `test/setup.ts`, and `test/unit/identification.test.ts` (re-wrapping) — behaviour unchanged.

---

## Phase 5: Integration test helpers (Supabase local)

### Overview

Create the shared test helpers that S-01 and Phase 3 (RLS/auth tests) will depend on:
a Supabase local client factory, a test-user lifecycle helper, a shared `makeAPIContext` helper,
and `test:unit` / `test:integration` npm scripts so the two suites can be run independently
(important for CI, where unit tests run without Supabase started).

This phase writes no new tests — it is infrastructure only.

### Changes Required

#### 1. `test/helpers/supabase-test.ts` (new file)

**File**: `test/helpers/supabase-test.ts`

**Intent**: Provide a Supabase client pointed at the local dev stack and utilities for creating
and signing in test users. All tests that need a real Supabase connection (Phase 3 RLS tests,
S-01 persistence tests) import from here rather than constructing clients inline.

**Contract**: Export three functions:
- `createTestClient(accessToken?: string): SupabaseClient` — calls `createClient` from
  `@supabase/supabase-js` with `SUPABASE_URL ?? 'http://localhost:54321'` and
  `SUPABASE_KEY ?? ''` (both resolved from `process.env` so the test `.env` file can override
  the local defaults). If `accessToken` is provided, sets the session via
  `client.auth.setSession({ access_token: accessToken, refresh_token: '' })` before returning.
- `signUpTestUser(email: string, password: string): Promise<{ user, session }>` — creates a new
  user via `auth.signUp`; throws if Supabase returns an error. Returns the `data` object
  (`{ user, session }`).
- `signInTestUser(email: string, password: string): Promise<{ user, session }>` — signs in via
  `auth.signInWithPassword`; throws on error. Returns `data`.

**Note**: This file does NOT call `supabase start`. Tests that import it require the local stack
to be running already (`supabase start` or a `globalSetup` hook). If Supabase is unreachable,
the test will fail with a network error — this is intentional: silent skip would hide broken
tests in local dev.

#### 2. `test/helpers/route.ts` (new file)

**File**: `test/helpers/route.ts`

**Intent**: Centralize the fake-`APIContext` construction pattern introduced in Phase 4 so
every future route integration test imports a single shared helper rather than duplicating the
`new Request(...) as unknown as APIContext` boilerplate.

**Contract**: Export one function:
- `makeAPIContext(body: BodyInit, options?: { url?: string; method?: string }): APIContext` —
  returns `{ request: new Request(options?.url ?? 'http://localhost/api/identify', { method: options?.method ?? 'POST', body }), cookies: {} } as unknown as APIContext`.

Also update `test/integration/identify-route.test.ts` (from Phase 4) to import `makeAPIContext`
from `@/helpers/route` (using the `@/` alias pointing to `test/`, or a relative import) and
delete the local inline version.

**Alias note**: The `@/` alias in `vitest.config.ts` points to `./src`. For test helpers,
use a relative import (`../../helpers/route`) or add a second alias `test: resolve(..., './test')`
in `vitest.config.ts`. Prefer relative import to avoid alias proliferation.

#### 3. `package.json` — split scripts

**File**: `package.json`

**Intent**: Allow CI and local dev to run unit tests (no Supabase needed) and integration tests
(Supabase required) as independent commands.

**Contract**: Add to `scripts`:
- `"test:unit": "vitest run test/unit"` — runs only `test/unit/**/*.test.ts`
- `"test:integration": "vitest run test/integration"` — runs only `test/integration/**/*.test.ts`

The existing `"test": "vitest run"` (all tests) remains unchanged.

### Success Criteria

#### Automated Verification

- `npm run test:unit` runs only the 6 unit tests (no integration tests)
- `npm run test:integration` runs only the 2 integration tests (no unit tests)
- `npm run build` passes (new helper files have no Astro impact)
- `npx astro check` exits clean (new files are in `test/`, excluded from Astro's type check)
- `npm run lint` exits clean (the new `test/helpers/**` files are covered by `eslint .`; this
  gate was missing in the original Phase 5 criteria — see addendum)

#### Manual Verification

- `test/helpers/supabase-test.ts` and `test/helpers/route.ts` exist and open without TS errors
- `test/integration/identify-route.test.ts` imports `makeAPIContext` from the helper (no local
  duplicate)

**Implementation Note**: After completing this phase and all automated verification passes,
pause here for manual confirmation from the human that the manual testing was successful. F-03
is complete once this phase passes — S-01 may proceed.

### Addendum (applied during Phase 5 impl-review)

- **Missing lint gate**: Phase 5's original automated criteria omitted `npm run lint`, so the two
  new helper files shipped in `eb1341a` were never linted — `eslint .` was actually red on master
  (prettier formatting in `route.ts`, unsafe-return/assertions in `supabase-test.ts`). The gate is
  now added above; both files were brought to lint-clean.
- **F1 (createTestClient race)**: `createTestClient` was `void`-ing `auth.setSession(...)` inside a
  synchronous factory — fire-and-forget, swallowing rejections and racing the token write for any
  authed consumer. Made it `async` and `await` the session before returning so the seeded pattern
  S-01/RLS tests inherit is correct.
- **F2 (empty-key throw)**: `SUPABASE_KEY ?? ""` made `createClient` throw an opaque
  "supabaseKey is required" when the env was unset. All three helpers now route through a guarded
  `newClient()` that throws an explicit "SUPABASE_KEY is not set…" message instead.

---

## Testing Strategy

### Unit Tests

- Risk #1 contract: `recognised: true` and `recognised: false` both resolve from `identifyImage`
  (not an error); result shape matches `{ recognised, subjectName, description }`
- Risk #4 provider failures: empty content, malformed JSON, non-400 APIError each reject
- Risk #4 fallback path: 400 response triggers retry with `json_object` format; exactly 2 calls made

### Integration Tests (Route-Level)

- Risk #1 at the HTTP layer: both recognised and unrecognised cases return `200` with `{ result: { ... } }`

### Manual Testing Steps

1. Run `npm test -- --reporter=verbose` and confirm all 8 tests pass with correct describe labels
2. Temporarily remove the MSW handler from one test and confirm the test fails with "Unhandled
   request to https://openrouter.ai/..." (proves MSW is blocking real HTTP)
3. Run `npm run build` and confirm no regressions to the production bundle

## Performance Considerations

None — tests run entirely in-process with MSW; no real HTTP calls, no Supabase round-trips.

## Migration Notes

None — this change adds new infrastructure and a new module. The route extraction (Phase 2) is a
pure refactor with no behaviour change. Existing runtime behaviour is unchanged.

## References

- Test plan scope: `context/foundation/test-plan.md` — §3 Phase 1, §2 Risk #1 and #4
- Roadmap entry: `context/foundation/roadmap.md` — F-03
- S-01 plan (blocked on this): `context/changes/first-identification-and-save/plan.md`

---

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Test infrastructure

#### Automated

- [x] 1.1 `npm test` exits 0 (no test files; via `passWithNoTests`) — 030880f
- [x] 1.2 `npm run build` passes — 030880f
- [x] 1.3 `npx astro check` exits clean (Phase 1) — 030880f

#### Manual

- [x] 1.4 `vitest.config.ts` opens without TypeScript errors in the IDE — 030880f
- [x] 1.5 Stub at `test/stubs/astro-env-server.ts` exports all five env variables — 030880f
- [x] 1.6 `test/vitest-env.d.ts` exists with `/// <reference types="vitest/globals" />` — 030880f

### Phase 2: Extract identification logic

#### Automated

- [x] 2.1 `npm run build` passes (no import breakage from extraction) — 7b82f3c
- [x] 2.2 `npx astro check` exits clean (Phase 2) — 7b82f3c
- [x] 2.3 `npm test` still exits 0 with no test files (passWithNoTests) — 7b82f3c

#### Manual

- [x] 2.4 `identify.ts` no longer contains `identifyImage`, `requestIdentification`, `visionMessages`, or `identificationSchema` — 7b82f3c
- [x] 2.5 `src/lib/ai/identification.ts` exists and contains all four — 7b82f3c

### Phase 3: Identification-contract tests

#### Automated

- [x] 3.1 `npm test` runs 6 tests in `test/unit/identification.test.ts`, all green — 1f416d6
- [x] 3.2 An unregistered outbound HTTP call fails the test (`onUnhandledRequest: 'error'`) — 1f416d6

#### Manual

- [x] 3.3 Test output labels the two describe groups as Risk #1 and Risk #4 — a4dddc7
- [x] 3.4 The 400-retry test asserts `expect(calls).toBe(2)` — a4dddc7

### Phase 4: Route smoke test

#### Automated

- [x] 4.1 `npm test` runs 8 total tests (6 unit + 2 integration), all green — a4dddc7
- [x] 4.2 `npx astro check` exits clean (Phase 4) — a4dddc7
- [x] 4.3 `npm run lint` exits clean — a4dddc7

#### Manual

- [x] 4.4 `npm test -- --reporter=verbose` shows tests grouped under Risk #1 describe labels — a4dddc7
- [x] 4.5 Removing an MSW handler from one test causes it to fail with "Unhandled request" — a4dddc7

### Phase 5: Integration test helpers (Supabase local)

#### Automated

- [x] 5.1 `npm run test:unit` runs exactly 6 tests (unit only) — eb1341a
- [x] 5.2 `npm run test:integration` runs exactly 2 tests (integration only) — eb1341a
- [x] 5.3 `npm run build` passes — eb1341a
- [x] 5.4 `npx astro check` exits clean (Phase 5) — eb1341a
- [x] 5.7 `npm run lint` exits clean (gate added in impl-review addendum) — a4fa868

#### Manual

- [x] 5.5 `test/helpers/supabase-test.ts` and `test/helpers/route.ts` open without TS errors — eb1341a
- [x] 5.6 `test/integration/identify-route.test.ts` imports `makeAPIContext` from `../helpers/route` — eb1341a
