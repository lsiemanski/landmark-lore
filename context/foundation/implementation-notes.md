# Implementation Notes

Cross-cutting decisions and integration steps that apply before or across all development changes. Edit in place as the project evolves.

---

## AI provider: Claude API (Anthropic) — decision 2026-06-01

**Applies to:** FR-004 (identification + description), FR-005 (follow-up questions)

**Decision:** Use the Claude API via `@anthropic-ai/sdk`. Provider chosen over OpenAI Vision because of Anthropic's structured output quality for cultural/historical descriptions and first-class TypeScript SDK support.

**Model:** `claude-sonnet-4-6` — supports image input (base64 or URL), returns rich natural-language descriptions suitable for the "tour guide" layer the PRD defines. Use this model for both FR-004 (identification) and FR-005 (follow-up).

**Key configuration:** Store the API key as a Cloudflare Workers secret, never in `wrangler.jsonc` or committed files:

```bash
echo "$ANTHROPIC_API_KEY" | npx wrangler secret put ANTHROPIC_API_KEY
```

Add the same key to GitHub repository secrets for CI use. Access it in Astro server endpoints via `import.meta.env.ANTHROPIC_API_KEY`.

**Integration point:** Call the Claude API exclusively from Astro server endpoints (`.ts` files under `src/pages/api/`). The API key must never reach the client — no client-side SDK calls.

**Streaming:** The Claude API supports streaming via the SDK's `stream()` method. Use streaming on the identification endpoint to satisfy the NFR: "continuous visible progress feedback; the result appears without requiring a page reload or manual refresh." Send a streaming response from the Astro endpoint and consume it with a React component using the Fetch API's `ReadableStream`.

**Acceptance gates (per PRD):**
- Identification must return at minimum a subject name plus a substantive contextual description — not just a label (US-01 AC, FR-004).
- An unrecognised subject must surface an explicit "not recognised" state, never a blank or a low-confidence guess presented as fact (FR-004, NFR).
- Follow-up answers must be contextually relevant to the identified subject (FR-005).

**Bundle size note:** Verify `@anthropic-ai/sdk` does not push the Workers bundle past the 1 MB compressed limit before implementing FR-004 (see infrastructure.md risk register). Use `npx wrangler deploy --dry-run` to check bundle size after adding the dependency.
