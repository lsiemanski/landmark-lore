# F-02: AI Provider Connection Research

> Research for the **ai-provider-spike** change (roadmap F-02). How to connect the Claude API
> for image identification (FR-004) in an Astro 6 API route on Cloudflare Workers.
> Captured 2026-06-05.
>
> **Verified & resolved 2026-06-05** in [`research.md`](research.md): every claim below was
> confirmed against the live codebase and the current `@anthropic-ai/sdk` docs.
> **One decision changed** — structured output is now adopted in the spike itself (not deferred
> to S-01); see the updated note in §"The five integration questions" and the spike sketch in
> `research.md`.

## Decision recap

- **Provider:** Claude API (Anthropic), chosen for FR-004/FR-005.
- **Model:** `claude-sonnet-4-6` — use this exact string, no date suffix. Chosen over Opus for cost.
- **SDK:** `@anthropic-ai/sdk` (not yet installed — first dependency add).
- **Secret:** `ANTHROPIC_API_KEY`, stored as a Cloudflare Workers secret.

## How it fits the existing codebase

The repo already has the pattern: server-side secrets via Astro's typed env, consumed in an
API route. F-02 reuses it.

1. **Declare the secret** in `astro.config.mjs`, alongside the Supabase keys:
   ```js
   ANTHROPIC_API_KEY: envField.string({ context: "server", access: "secret", optional: true }),
   ```
2. **Set the secret** as a Cloudflare Workers secret (matches `infrastructure.md` §Secrets):
   ```bash
   echo "$ANTHROPIC_API_KEY" | npx wrangler secret put ANTHROPIC_API_KEY
   ```
   For `wrangler dev`, add it to `.dev.vars` (gitignored).
3. **New API route** `src/pages/api/identify.ts` follows the same `APIRoute` shape as
   `src/pages/api/auth/signin.ts`, reading the key from `astro:env/server`.

**Workers detail:** pass the key explicitly — `new Anthropic({ apiKey: ANTHROPIC_API_KEY })`.
The SDK's zero-arg constructor reads `process.env`, which is not reliably populated on workerd;
the explicit form is the safe path. `nodejs_compat` is already set in `wrangler.jsonc`, so the
SDK runs fine.

## The five integration questions

### Model id
`claude-sonnet-4-6` is correct and complete. Use verbatim; do **not** append a date suffix.

### Vision input format
Image block + text block in a single user message:
```ts
content: [
  { type: "image", source: { type: "base64", media_type: "image/jpeg", data: base64 } },
  { type: "text", text: "Identify the primary landmark/artwork/subject..." },
]
```

### base64 vs URL
Use **base64**. The traveler uploads from their device (FR-003); at identification time you have
the bytes, not a public URL. (`{ type: "url" }` only makes sense once the image is already at a
publicly fetchable address.) Caveats:
- API base64 image limit is ~5 MB per image; large images cost more tokens + more Workers CPU to
  decode. Resize/downscale client-side or in the route before sending.
- base64 inflates the payload ~33% — relevant to the Workers request budget.

### Prompt caching for the system prompt
**Sonnet 4.6's minimum cacheable prefix is 2048 tokens.** A short identification system prompt
won't reach that, so `cache_control` would be a no-op (`cache_read_input_tokens: 0`). Caching only
pays off if the system prompt grows large (detailed instructions + few-shot examples).
- For the F-02 spike: **skip caching.** *(Confirmed 2026-06-05 — short prompt is a no-op.)*
- Revisit in S-01/S-02 if the system prompt becomes substantial. If added, put
  `cache_control: { type: "ephemeral" }` on the last system block and keep the per-request
  image/question after it.

### Workers bundle-size (the registered risk)
`@anthropic-ai/sdk` is fetch-based pure JS and bundles well under the 1 MB compressed Workers
limit; low risk in practice. Verify before S-01 (per the risk register):
```bash
npx wrangler deploy --dry-run
```
Check the reported compressed size. Fallback if ever a concern: skip the SDK and call
`POST https://api.anthropic.com/v1/messages` with native `fetch` — almost certainly unnecessary.

## Spike route sketch

```ts
// src/pages/api/identify.ts
import type { APIRoute } from "astro";
import { ANTHROPIC_API_KEY } from "astro:env/server";
import Anthropic from "@anthropic-ai/sdk";

export const POST: APIRoute = async (context) => {
  if (!ANTHROPIC_API_KEY) {
    return new Response(JSON.stringify({ error: "AI provider not configured" }), { status: 503 });
  }

  const form = await context.request.formData();
  const file = form.get("photo") as File;
  const base64 = Buffer.from(await file.arrayBuffer()).toString("base64");

  const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

  const message = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 1024,
    system: "Identify the primary landmark, artwork, monument, or notable subject in the photo. Provide a substantive historical/cultural description, not just a label.",
    messages: [{
      role: "user",
      content: [
        { type: "image", source: { type: "base64", media_type: file.type, data: base64 } },
        { type: "text", text: "What is the main subject? If you cannot confidently identify it, say so explicitly." },
      ],
    }],
  });

  const text = message.content.find((b) => b.type === "text");
  return new Response(JSON.stringify({ result: text?.text ?? "" }), {
    headers: { "content-type": "application/json" },
  });
};
```

## Notes for S-01 (beyond the spike)

- **Structured output:** Sonnet 4.6 supports `output_config: { format: { type: "json_schema", ... } }`.
  Use it to cleanly separate `subjectName` / `description` and surface the PRD's explicit
  "not recognised" guardrail state.
  **DECISION 2026-06-05 — promoted into the F-02 spike** (no longer deferred): consume it via
  `client.messages.parse()` (returns `message.parsed_output`), with a
  `{ recognised, subjectName, description }` schema. Updated spike sketch lives in
  [`research.md`](research.md). Verified against `/anthropics/anthropic-sdk-typescript`; helpers
  `jsonSchemaOutputFormat()` / `zodOutputFormat()` available. Requires a recent SDK version.
- **Workers CPU limit:** the free-tier 10 ms CPU limit can bite once base64 decode + JSON parse +
  validation are added. `infrastructure.md` recommends moving to the $5/mo paid plan from day one.

## F-02 success criteria mapping

- [x] Provider chosen — Claude API.
- [ ] Key configured as a Cloudflare Workers secret — `wrangler secret put ANTHROPIC_API_KEY`.
- [ ] Test image identification call returns a subject name + substantive description end-to-end.
- [ ] Bundle size verified against the 1 MB compressed Workers limit (`wrangler deploy --dry-run`).
