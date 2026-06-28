# Code Reviewer ToolLoopAgent — Plan Brief

> Full plan: `context/changes/tool-loop-agent/plan.md`

## What & Why

Extract and modernise the existing code review logic into a standalone npm workspace package (`packages/code-reviewer`) using the Vercel AI SDK's `ToolLoopAgent`. The motivation is modularity and eval-readiness: by decoupling the schema, prompt, and agent into separate modules with a clean public API, the reviewer can be imported and exercised by promptfoo without any coupling to the Astro app.

## Starting Point

An ad-hoc code review script exists with a Zod schema (5 scores + verdict + summary), a Polish-language system prompt, and model calls via the Anthropic Claude Agent SDK's `z.toJSONSchema` pattern. No `packages/` directory exists; npm workspaces are not configured.

## Desired End State

`packages/code-reviewer/` is a linked workspace (`@landmark-lore/code-reviewer`) with four source modules. Callers import `reviewCode(diff)` for a typed `Review` or `reviewerAgent` for type inference. A future promptfoo eval config can import the function by package name with no path hacks.

## Key Decisions Made

| Decision                 | Choice                                                 | Why (1 sentence)                                                                                                |
| ------------------------ | ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| Package location         | `packages/code-reviewer/` (own package.json)           | Importable by name; clean separation from Astro app                                                             |
| Workspace setup          | npm workspaces (`"workspaces": ["packages/*"]`)        | Standard; zero extra tooling; hoists shared deps from root                                                      |
| SDK                      | Vercel AI SDK `ToolLoopAgent`                          | Replaces manual Claude Agent SDK pattern; `Output.object({ schema })` handles JSON schema conversion internally |
| Model                    | OpenRouter + `anthropic/claude-sonnet-4.5`             | Project default provider; env var stays the same                                                                |
| Agent tools              | None (structured output only)                          | Simpler eval surface; single-shot diff-in → Review-out                                                          |
| Input interface          | Plain string (diff text)                               | `agent.generate({ prompt: diff })` — promptfoo can feed strings directly                                        |
| Export surface           | `reviewerAgent` instance + `reviewCode(diff)` function | Agent for type inference; function for eval/CLI callers                                                         |
| Schema change            | Verbatim extraction — no schema changes                | Existing schema is correct; `.describe()` not `.min()/.max()` is intentional                                    |
| `z.toJSONSchema` removal | Dropped                                                | No longer needed; `Output.object({ schema })` handles it in the Vercel AI SDK                                   |

## Scope

**In scope:**

- `packages/code-reviewer/package.json` + `tsconfig.json`
- `src/schemas.ts`, `src/prompts.ts`, `src/agent.ts`, `src/index.ts`
- Root `package.json` workspaces field + `npm install`
- Typecheck + smoke test verification

**Out of scope:**

- promptfoo config or eval test cases
- Streaming UI consumer
- Modifying `src/index.ts` at root
- Removing `@anthropic-ai/claude-agent-sdk` from root

## Architecture / Approach

```
packages/code-reviewer/
  package.json          @landmark-lore/code-reviewer workspace manifest
  tsconfig.json         standalone (not Astro); moduleResolution: bundler
  src/
    schemas.ts          REVIEW_SCHEMA (5 scores + verdict + summary) + Review type
    prompts.ts          SYSTEM_PROMPT (Polish-language reviewer instructions)
    agent.ts            new ToolLoopAgent({ model, instructions, output }) + ReviewerAgentUIMessage type
    index.ts            re-exports + reviewCode(diff: string): Promise<Review>
```

Data flow: `reviewCode(diff)` → `reviewerAgent.generate({ prompt: diff })` → `output: Review`

## Phases at a Glance

| Phase              | What it delivers                                   | Key risk                                                          |
| ------------------ | -------------------------------------------------- | ----------------------------------------------------------------- |
| 1. Monorepo Wiring | npm workspace linked; package importable by name   | Workspace config error causes hoisting issues                     |
| 2. Module Files    | 4 source files; typecheck passes; smoke test green | `Output.object` behaviour with Zod v4 worth confirming in ai docs |

**Prerequisites:** `OPENROUTER_API_KEY` set in `.env`; npm 7+ (workspaces support)
**Estimated effort:** ~1 session; mechanical once decisions are made

## Open Risks & Assumptions

- OpenRouter model ID is `anthropic/claude-sonnet-4.5` (confirmed)
- `Output.object({ schema: REVIEW_SCHEMA })` behaviour with Zod v4 should be confirmed against `node_modules/ai/docs/` at implementation time; the REVIEW_SCHEMA is currently Zod v4 syntax
- Root ESLint config may not cover `packages/` — check `eslint.config.js` before claiming lint passes

## Success Criteria (Summary)

- `npx tsc --noEmit -p packages/code-reviewer/tsconfig.json` exits 0
- `reviewCode(sampleDiff)` returns a `Review` with `verdict: "pass"|"fail"` and five numeric scores
- Package is importable as `@landmark-lore/code-reviewer` from the repo root
