# Code Reviewer ToolLoopAgent — Implementation Plan

## Overview

Build a code review schema and prompt as a standalone npm workspace package (`packages/code-reviewer`) on the Vercel AI SDK's `ToolLoopAgent`, using `Output.object({ schema })` for structured output. The schema and prompt are **authored in this change** (see Phase 2) — there is no prior code-review script in the repo to extract from. The package exports both the agent instance (for type inference) and a `reviewCode(diff)` function (for promptfoo evals), with no changes to the eval environment itself.

## Current State Analysis

There is **no existing code-review script** in the repo — the review schema and system prompt are authored fresh in this change (Phase 2 §1–§2 below give their concrete content). There is no `packages/` workspace yet. The closest existing structured-output patterns to model on:

- `src/index.ts` (untracked) — `generateText` + `Output.object({ schema })` via OpenRouter; the new package follows this exact call shape (with `ToolLoopAgent` wrapping it)
- `src/lib/ai/identification.ts` and `follow-up.ts` — use `z.toJSONSchema(Schema)` for the OpenAI-compatible path; the new package does **not** need this — `Output.object({ schema })` handles schema conversion internally

The root project uses:

- Vercel AI SDK `ai@6.0.214` with `Output.object()` for structured output
- `@openrouter/ai-sdk-provider` with `createOpenRouter()`
- Zod v4 (`zod@^4.4.3`)
- `"type": "module"` + `tsx` for Node.js entrypoints
- Root `tsconfig.json` extends `astro/tsconfigs/strict` — **not suitable for a standalone package**
- `@anthropic-ai/claude-agent-sdk` installed at root — **not used** here (and not removed; see "What We're NOT Doing")

## Desired End State

`packages/code-reviewer/` is a linked npm workspace (`@landmark-lore/code-reviewer`) that:

1. Exports `reviewerAgent` (ToolLoopAgent instance) and `reviewCode(diff: string): Promise<Review>`
2. Keeps schema and prompts in separate modules (`schemas.ts`, `prompts.ts`)
3. Passes `tsc --noEmit` type check with its own tsconfig
4. Is importable from a future promptfoo eval as `import { reviewCode } from '@landmark-lore/code-reviewer'`

### Key Discoveries

- `REVIEW_SCHEMA` (authored here — see Phase 2 §1 for exact fields): 5 numeric scores + `verdict: z.enum(["pass", "fail"])` + `summary: z.string()`, each with `.describe()`. **Do not add `.min()/.max()`** on the number fields — Anthropic's structured output rejects integer range constraints; the 1–10 range is enforced by the prompt, not the schema
- No `z.toJSONSchema` call is needed in this package — `Output.object({ schema: REVIEW_SCHEMA })` handles schema conversion internally. (The repo's `identification.ts`/`follow-up.ts` use `z.toJSONSchema` only because they target the OpenAI-compatible path, not the AI SDK `output` option.)
- `SYSTEM_PROMPT`: Polish-language reviewer instructions — authored here (see Phase 2 §2 for the exact text)
- Model: `anthropic/claude-sonnet-4.5` via OpenRouter
- Root `tsconfig.json` extends Astro — the new package needs a fully standalone tsconfig

## What We're NOT Doing

- Not setting up promptfoo config or eval test cases
- Not deleting or modifying `src/index.ts` at the project root
- Not building a UI consumer or streaming endpoint
- Not adding tools to the agent (pure structured-output)
- Not removing `@anthropic-ai/claude-agent-sdk` from root `package.json`

## Implementation Approach

Three phases: wire the npm workspace, write the four source modules, then verify with a typecheck and a smoke test. The schema and prompt are authored in this change (Phase 2 gives their exact content). The model call is a single-shot `ToolLoopAgent` + `Output.object()` structured output — no tools, no loop.

## Critical Implementation Details

**Zod number fields**: Use `.describe()` without `.min()`/`.max()` — this is load-bearing. The range 1–10 is enforced by the prompt, not the schema. Adding runtime range validation to the number fields would cause Anthropic's structured output to reject the schema.

**Import extensions**: With `"moduleResolution": "bundler"` in the package tsconfig, import paths in source files can omit the `.js` extension. Stay consistent with that convention throughout the package.

---

## Phase 1: Monorepo Workspace Wiring

### Overview

Register `packages/*` as npm workspaces and scaffold `packages/code-reviewer/` with its own `package.json` and `tsconfig.json`. After `npm install`, the package is resolvable by name.

### Changes Required

#### 1. Root package.json — add workspaces field

**File**: `package.json`

**Intent**: Tell npm that `packages/*` are local workspaces so `@landmark-lore/code-reviewer` resolves via symlink.

**Contract**: Add `"workspaces": ["packages/*"]` as a top-level field alongside `"name"`, `"version"`, etc. No other root changes.

#### 2. New package manifest

**File**: `packages/code-reviewer/package.json`

**Intent**: Define the workspace package identity, ES module type, and dependency declarations. Using `"*"` for shared deps lets npm hoist from root `node_modules`. `exports` points at the raw `./src/index.ts` (no build step), so consumers must be TS-aware (tsx, the Astro bundler, promptfoo via tsx). At impl time, confirm promptfoo loads the `.ts` export and that `"*"` resolves to the hoisted root versions rather than triggering a registry fetch.

**Contract**:

```json
{
  "name": "@landmark-lore/code-reviewer",
  "version": "0.1.0",
  "type": "module",
  "exports": {
    ".": "./src/index.ts"
  },
  "dependencies": {
    "@openrouter/ai-sdk-provider": "*",
    "ai": "*",
    "zod": "*"
  },
  "devDependencies": {
    "typescript": "*",
    "tsx": "*"
  }
}
```

#### 3. Package-local tsconfig

**File**: `packages/code-reviewer/tsconfig.json`

**Intent**: Standalone TypeScript config — must not extend the root Astro tsconfig (which has Astro-specific globals and jsx settings irrelevant to a Node.js module).

**Contract**:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "skipLibCheck": true
  },
  "include": ["src"]
}
```

#### 4. npm install to link workspace

**File**: n/a (shell command)

**Intent**: Register the new workspace and create the symlink at `node_modules/@landmark-lore/code-reviewer`.

**Contract**: Run `npm install` from the repo root after creating the files above.

### Success Criteria

#### Automated Verification

- `npm install` exits 0
- `npm ls @landmark-lore/code-reviewer` shows the package linked (line ending in `->packages/code-reviewer`)

#### Manual Verification

- `node_modules/@landmark-lore/code-reviewer` symlink exists and resolves to `packages/code-reviewer`

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation before proceeding to Phase 2.

---

## Phase 2: Module Files

### Overview

Write the four source files. Schema and prompt are authored here (§1–§2 give the concrete content). The agent file wires `ToolLoopAgent` + `Output.object()`. The index defines the public API surface.

### Changes Required

#### 1. Schema module

**File**: `packages/code-reviewer/src/schemas.ts`

**Intent**: Single source of truth for the review output shape — authored in this change.

**Contract**: Exports `REVIEW_SCHEMA` (Zod object) and `Review` type (`z.infer<typeof REVIEW_SCHEMA>`). No `z.toJSONSchema` / `REVIEW_JSON_SCHEMA` export — `Output.object({ schema })` handles conversion. The five score fields are 1–10 (range enforced by the prompt, not `.min()/.max()`). Concrete shape (Zod v4):

```ts
export const REVIEW_SCHEMA = z.object({
  correctness: z.number().describe("Poprawność i brak błędów logicznych (1–10)."),
  securitySafety: z.number().describe("Bezpieczeństwo: walidacja wejścia, brak podatności i wycieku sekretów (1–10)."),
  readability: z.number().describe("Czytelność, nazewnictwo i spójność ze stylem projektu (1–10)."),
  performance: z.number().describe("Wydajność i brak oczywistych nieefektywności (1–10)."),
  testCoverage: z.number().describe("Pokrycie testami i testowalność zmiany (1–10)."),
  verdict: z.enum(["pass", "fail"]).describe("Ogólny werdykt recenzji."),
  summary: z.string().describe("Podsumowanie recenzji w formacie Markdown."),
});

export type Review = z.infer<typeof REVIEW_SCHEMA>;
```

> These field names and `.describe()` strings are authored defaults — adjust the wording before implementing if the lesson specifies different dimensions, but keep exactly five numeric scores plus `verdict` and `summary`, and keep `securitySafety` (the Testing Strategy references it by name).

#### 2. Prompt module

**File**: `packages/code-reviewer/src/prompts.ts`

**Intent**: Isolate the system prompt so it can be versioned or swapped independently of agent setup.

**Contract**: Exports `SYSTEM_PROMPT` as a `const string` — authored Polish-language reviewer instructions. Concrete starting text:

```
Jesteś doświadczonym recenzentem kodu. Otrzymasz diff w formacie unified.
Oceń zmianę w pięciu wymiarach w skali 1–10 (1 = krytyczne problemy, 10 = wzorowo):
correctness, securitySafety, readability, performance, testCoverage.

Zasady:
- Skala 1–10 jest wymuszana przez ten prompt, nie przez schemat — nie zwracaj wartości spoza zakresu.
- Ustaw "verdict" na "fail", jeśli którakolwiek ocena jest poniżej 5 lub występuje istotny problem bezpieczeństwa; w przeciwnym razie "pass".
- W polu "summary" podaj zwięzłe uzasadnienie po polsku, w formacie Markdown, z listą najważniejszych uwag.

Odpowiadaj wyłącznie zgodnie z wymaganym schematem wyjściowym.
```

> Authored default — refine the wording to match the lesson if needed, but keep the five dimension names aligned with `REVIEW_SCHEMA` and keep the explicit 1–10 scale and pass/fail rule (the schema does not enforce them).

#### 3. Agent module

**File**: `packages/code-reviewer/src/agent.ts`

**Intent**: Instantiate the ToolLoopAgent with the review schema and system prompt, and expose the type for downstream type-safe UI use.

**Contract**:

- Creates `openrouter` via `createOpenRouter({ apiKey: process.env.OPENROUTER_API_KEY })`
- `DEFAULT_REVIEWER_MODEL` constant defaults to `'anthropic/claude-sonnet-4.5'` — **verify this slug against the OpenRouter model list at implementation time** (do not trust from memory); adjust if the live id differs. Note: each smoke test (2.3/2.5) is a real, billed OpenRouter call.
- `reviewerAgent` is `new ToolLoopAgent({ model: openrouter(DEFAULT_REVIEWER_MODEL), instructions: SYSTEM_PROMPT, output: Output.object({ schema: REVIEW_SCHEMA }) })`

No `ReviewerAgentUIMessage` / `InferAgentUIMessage` export — the package has no tools and builds no streaming UI (out of scope), so the inferred UI-message type would carry no tool parts and has no consumer. Add it only when a streaming UI is actually built.

#### 4. Public index

**File**: `packages/code-reviewer/src/index.ts`

**Intent**: Define the package's public API — agent instance for type inference, `reviewCode` function for evals and CLI.

**Contract**:

- Re-exports `reviewerAgent` from `./agent`
- Re-exports `Review` type and `REVIEW_SCHEMA` from `./schemas`
- Exports `async function reviewCode(diff: string): Promise<Review>` — calls `reviewerAgent.generate({ prompt: diff })` and returns `output`

### Success Criteria

#### Automated Verification

- `npx tsc --noEmit -p packages/code-reviewer/tsconfig.json` passes with zero errors
- `npm run lint` (from root) passes for files under `packages/`

#### Manual Verification

- Run `tsx --env-file=.env packages/code-reviewer/src/index.ts` with a hardcoded test diff (add a `main()` to index.ts temporarily, or create a scratch script); confirm a `Review` object is printed with `verdict` as `"pass"` or `"fail"` and all five score fields as numbers
- `output.summary` is non-empty Markdown text
- Bad diff (e.g. `eval(userInput)`): `securitySafety` drops noticeably and `verdict` is `"fail"` vs. a clean diff

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation before archiving the change.

---

## Testing Strategy

### Manual Testing Steps

1. Create a scratch script (or temporarily add a `main()` block gated on `import.meta.url`) that calls `reviewCode(sampleDiff)` and `console.log`s the result
2. Use a small, known-good diff (e.g., a simple variable rename) — expect `verdict: "pass"`, all scores ≥ 7
3. Use a diff with an obvious security issue (e.g., `eval(userInput)` or raw SQL concatenation) — expect `securitySafety` score to drop and `verdict: "fail"`
4. Remove the scratch code before committing

## References

- AI SDK ToolLoopAgent docs: `node_modules/ai/docs/03-agents/02-building-agents.mdx`
- AI SDK structured output: `node_modules/ai/docs/03-ai-sdk-core/` (Output.object)
- Type-safe agents reference: `.agents/skills/ai-sdk/references/type-safe-agents.md`
- Common errors / deprecated APIs: `.agents/skills/ai-sdk/references/common-errors.md`
- Related change folder: `context/changes/tool-loop-agent/`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Monorepo Workspace Wiring

#### Automated

- [x] 1.1 `npm install` exits 0 — 3375728
- [x] 1.2 `npm ls @landmark-lore/code-reviewer` shows package linked — 3375728

#### Manual

- [x] 1.3 `node_modules/@landmark-lore/code-reviewer` symlink resolves to `packages/code-reviewer` — 3375728

### Phase 2: Module Files

#### Automated

- [x] 2.1 `npx tsc --noEmit -p packages/code-reviewer/tsconfig.json` passes with zero errors
- [x] 2.2 `npm run lint` passes for `packages/` files

#### Manual

- [x] 2.3 Smoke test: scratch script returns typed `Review` with valid `verdict` and five numeric scores
- [x] 2.4 `output.summary` is non-empty Markdown text
- [x] 2.5 Bad diff: `securitySafety` drops noticeably and `verdict` is `"fail"` vs. clean diff
