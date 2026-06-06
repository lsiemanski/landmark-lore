---
date: 2026-06-05T00:00:00Z
researcher: lsiemanski
git_commit: 7142f27385cfe108b82ee6b4a74b329480d46226
branch: master
repository: Landmark Lore
topic: "Resolve open questions in ai-connection-research.md (F-02 AI provider spike)"
tags: [research, codebase, anthropic, cloudflare-workers, astro-env, vision, structured-output]
status: complete
last_updated: 2026-06-05
last_updated_by: lsiemanski
---

# Research: Resolve open questions in `ai-connection-research.md` (F-02 AI provider spike)

**Date**: 2026-06-05
**Researcher**: lsiemanski
**Git Commit**: 7142f27385cfe108b82ee6b4a74b329480d46226
**Branch**: master
**Repository**: Landmark Lore

## Research Question

Check `ai-connection-research.md` and resolve any open questions based on it — verify each
claim against the live codebase and current Anthropic SDK docs, and surface decisions for the
user where they are genuinely a judgement call.

## Summary

Every claim in `ai-connection-research.md` is **confirmed**. The internal integration claims all
match the live codebase, and the external Anthropic API claims all match the current
`@anthropic-ai/sdk` (TypeScript) docs (verified via Context7, `/anthropics/anthropic-sdk-typescript`).

Two decisions were taken with the user during this run:

1. **Scope** — this is a research run: document resolution + execution-ready playbook only.
   Install / secret / live-call / bundle-check are left to `/10x-implement`.
2. **Output contract** — **adopt structured output in the spike now** (was "defer to S-01").
   The SDK's `messages.parse()` + `json_schema` make a `recognised / subjectName / description`
   contract cheap to adopt immediately, and it lets the spike exercise the PRD's
   "not recognised" guardrail end-to-end.

The only residual open items are F-02's executable success criteria (set the Workers secret,
run a live call, dry-run the bundle), which require a real key and CLI execution — these belong
to the implementation phase, not research.

## Detailed Findings

### Internal integration claims — all confirmed against the live codebase

| Claim in `ai-connection-research.md` | Verdict | Evidence |
| --- | --- | --- |
| Repo already declares server secrets via Astro typed env | ✅ | [astro.config.mjs:17-22](../../../astro.config.mjs#L17-L22) declares `SUPABASE_URL` / `SUPABASE_KEY` with `envField.string({ context: "server", access: "secret", optional: true })` — the exact pattern to copy for `ANTHROPIC_API_KEY`. |
| Secrets consumed from `astro:env/server` in code | ✅ | [src/lib/supabase.ts:3](../../../src/lib/supabase.ts#L3) imports `{ SUPABASE_URL, SUPABASE_KEY } from "astro:env/server"` and guards on absence ([:7](../../../src/lib/supabase.ts#L7)). `identify.ts` mirrors this. |
| API route shape to follow | ✅ | [src/pages/api/auth/signin.ts:4](../../../src/pages/api/auth/signin.ts#L4) is `export const POST: APIRoute = async (context) => { … }` and reads `context.request.formData()` — identical to the spike sketch. |
| `nodejs_compat` already set | ✅ | [wrangler.jsonc](../../../wrangler.jsonc) `compatibility_flags: ["nodejs_compat"]` (`compatibility_date: 2026-05-08`). `Buffer.from(...)` in the route is therefore available. |
| `.dev.vars` gitignored | ✅ | `.gitignore:56` lists `.dev.vars` (and `.env*`). Safe for the local `wrangler dev` key. |
| `@anthropic-ai/sdk` not yet installed (first dependency add) | ✅ | Absent from `package.json` dependencies — this spike is its first introduction. |
| `src/pages/api/identify.ts` does not exist yet | ✅ | `src/pages/api/` contains only `auth/{signin,signout,signup}.ts`. |
| Workers secret mechanism matches infra doc | ✅ | [context/foundation/infrastructure.md:95](../../foundation/infrastructure.md#L95) — `echo "<VALUE>" | wrangler secret put <KEY>`; agent may set secrets unattended. |

### External Anthropic API claims — all confirmed via Context7

Source: `/anthropics/anthropic-sdk-typescript` (High reputation), queried 2026-06-05.

| Claim | Verdict | Note |
| --- | --- | --- |
| Vision = image block + text block, `source.type: "base64"` with `media_type` + `data` | ✅ | SDK example uses exactly `{ type: "image", source: { type: "base64", media_type: "image/jpeg", data } }` followed by a text block. |
| Pass `apiKey` explicitly on workerd (zero-arg reads env, unreliable on workerd) | ✅ | Constructor calls `readEnv('ANTHROPIC_API_KEY')` only when `apiKey === undefined`; an explicitly-passed `apiKey` **wins** over the env/credential chain. The explicit form is the safe path. |
| Structured output via `output_config: { format: { type: "json_schema", schema } }` | ✅ | Confirmed in `MessageCreateParamsBase` (`output_config?: OutputConfig`). Best consumed via `client.messages.parse()`, which returns `message.parsed_output`. Helpers `jsonSchemaOutputFormat()` and `zodOutputFormat()` exist for ergonomic schemas. |
| `cache_control` is a valid param | ✅ | Present on `MessageCreateParamsBase` and on content blocks (`cache_control: { type: "ephemeral" }`). |
| Model id `claude-sonnet-4-6`, verbatim, no date suffix | ✅ | Matches the canonical Sonnet 4.6 id. (SDK examples happen to show `claude-sonnet-4-5`, but that's just the example's model, not a constraint.) |
| ~5 MB base64 image limit; 2048-token min cacheable prefix on Sonnet | ⚠️ Doc-level | These are Anthropic **API documentation** facts, not surfaced in the SDK repo. They match known published limits and the research doc's statement; treat as authoritative but re-confirm against `docs.anthropic.com` if a hard edge is hit. |

### Decision: structured output in the spike contract

The research doc originally recommended plain text for F-02 and deferring structured output to
S-01. With `messages.parse()` the cost of adopting it now is small, and it lets the spike prove
the PRD's "not recognised" guardrail. **Updated spike contract:**

```ts
// src/pages/api/identify.ts
import type { APIRoute } from "astro";
import { ANTHROPIC_API_KEY } from "astro:env/server";
import Anthropic from "@anthropic-ai/sdk";

const identificationSchema = {
  type: "object",
  properties: {
    recognised: {
      type: "boolean",
      description: "True only if a primary subject can be confidently identified.",
    },
    subjectName: {
      type: "string",
      description: "Name of the landmark/artwork/monument/subject; empty when not recognised.",
    },
    description: {
      type: "string",
      description: "Substantive historical/cultural description, or why it could not be identified.",
    },
  },
  required: ["recognised", "subjectName", "description"],
  additionalProperties: false,
} as const;

export const POST: APIRoute = async (context) => {
  if (!ANTHROPIC_API_KEY) {
    return new Response(JSON.stringify({ error: "AI provider not configured" }), { status: 503 });
  }

  const form = await context.request.formData();
  const file = form.get("photo") as File;
  const base64 = Buffer.from(await file.arrayBuffer()).toString("base64");

  const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

  const message = await client.messages.parse({
    model: "claude-sonnet-4-6",
    max_tokens: 1024,
    system:
      "Identify the primary landmark, artwork, monument, or notable subject in the photo. " +
      "Provide a substantive historical/cultural description, not just a label. " +
      "If you cannot confidently identify it, set recognised=false and explain why.",
    messages: [{
      role: "user",
      content: [
        { type: "image", source: { type: "base64", media_type: file.type, data: base64 } },
        { type: "text", text: "Identify the main subject of this photo." },
      ],
    }],
    output_config: { format: { type: "json_schema", schema: identificationSchema } },
  });

  return new Response(JSON.stringify({ result: message.parsed_output }), {
    headers: { "content-type": "application/json" },
  });
};
```

Implementation caveats to carry into `/10x-implement`:
- `messages.parse()` + `output_config` require a **recent** `@anthropic-ai/sdk`; pin a current
  version when adding the dependency (don't accept a stale cached resolve).
- `media_type` must be one of `image/jpeg | image/png | image/gif | image/webp`. `file.type`
  from the upload should be validated/normalised before sending (full validation is S-01 work;
  for the spike, feed a known JPEG/PNG).
- Optional ergonomics: swap the raw schema for `zodOutputFormat(...)` to get a typed
  `parsed_output` if Zod is introduced later.
- Caching stays a no-op for now (short system prompt < 2048-token min prefix). Revisit in
  S-01/S-02 only if the system prompt grows large.

## Code References

- `astro.config.mjs:17-22` — server secret schema to extend with `ANTHROPIC_API_KEY`.
- `src/lib/supabase.ts:3,7` — `astro:env/server` import + absence guard pattern.
- `src/pages/api/auth/signin.ts:4` — canonical `APIRoute` POST shape + `formData()` read.
- `wrangler.jsonc` — `nodejs_compat`, `compatibility_date: 2026-05-08`.
- `.gitignore:56` — `.dev.vars` ignored.
- `context/foundation/infrastructure.md:95,105,107` — secret mechanism, Workers CPU-limit risk, bundle-size risk.
- `context/foundation/roadmap.md:76-84` — F-02 outcome, unlocks, prerequisites.

## Architecture Insights

- The codebase has a single, consistent secrets idiom: declare in `astro.config.mjs` `env.schema`
  as a server-secret `envField`, consume via `import { X } from "astro:env/server"`, guard on
  absence, return a graceful status when unconfigured. `identify.ts` should not invent a new
  pattern — `503 "AI provider not configured"` mirrors `supabase.ts` returning `null`.
- workerd is the binding constraint behind the "pass `apiKey` explicitly" rule: `process.env`
  is not reliably populated, so any SDK that lazily reads env can silently get `null`. The
  explicit-arg path is verified to take precedence in the SDK constructor.
- Two infra risks gate this stream and should be honoured by the implementation:
  bundle size (verify with `wrangler deploy --dry-run` before S-01) and the 10 ms free-tier CPU
  limit (infra recommends the $5/mo paid plan from day one once base64 decode + parse land).

## Historical Context (from prior changes)

- `context/changes/ai-provider-spike/ai-connection-research.md` — original spike research; every
  claim verified here. Its §"Notes for S-01" structured-output note is now **promoted into the
  F-02 spike** per the 2026-06-05 decision.
- `context/foundation/infrastructure.md` (Risk Register) — bundle-size (L/H) and CPU-time (M/M)
  risks; mitigations are the dry-run check and the paid plan.
- Memory: AI provider decision (Claude API, `claude-sonnet-4-6`, key as Workers secret
  `ANTHROPIC_API_KEY`) made 2026-06-01 — consistent with these findings.

## Related Research

- `context/changes/ai-provider-spike/ai-connection-research.md` (same change, source document).

## Open Questions

None outstanding for research. Remaining items are **execution** tasks for `/10x-implement`:

1. **Configure the secret** — `echo "$ANTHROPIC_API_KEY" | npx wrangler secret put ANTHROPIC_API_KEY`
   (and add to `.dev.vars` for `wrangler dev`). Requires a real key.
2. **Live identification call** — run the route against a known image, confirm
   `parsed_output` returns `{ recognised, subjectName, description }` end-to-end.
3. **Bundle-size verification** — `npx wrangler deploy --dry-run`, confirm compressed size is
   well under the 1 MB Workers limit (registered low-likelihood/high-impact risk).

## Updated F-02 success-criteria mapping

- [x] Provider chosen — Claude API, `claude-sonnet-4-6`.
- [x] Integration approach verified — env idiom, route shape, workerd `apiKey` handling, vision
      base64 format, structured-output contract all confirmed.
- [ ] Key configured as a Cloudflare Workers secret — `/10x-implement`.
- [ ] Test identification call returns subject + substantive description end-to-end — `/10x-implement`.
- [ ] Bundle size verified against the 1 MB compressed Workers limit — `/10x-implement`.
