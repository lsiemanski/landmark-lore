# Lessons Learned

> Append-only register of recurring rules and patterns. Re-read at start by /10x-frame, /10x-research, /10x-plan, /10x-plan-review, /10x-implement, /10x-impl-review.

## Name migration files descriptively

- **Context**: Any phase that creates Supabase migration files
- **Problem**: The schema migration names are unreadable and don't give any context on what is being done (e.g. `_schema.sql`, `_storage.sql` say nothing about the tables or actions involved).
- **Rule**: Name the migration file so its suffix describes the purpose — e.g. `_create_folders_photos_identifications.sql` or `_add_photos_storage_bucket.sql`, not `_schema.sql`.
- **Applies to**: plan, implement

## Use OUT params for single-row RPCs; enforce one row

- **Context**: Postgres functions exposed via `supabase.rpc()` / PostgREST that are meant to return exactly one row (e.g. consumed in API routes).
- **Problem**: `RETURNS TABLE`/`SETOF` makes PostgREST return a JSON array even for a single row, forcing brittle `data[0]` indexing and array-typed signatures that misrepresent the contract; conversely, assuming a single object from a set-returning function can break on empty results.
- **Rule**: When an RPC must return exactly one row, declare it with `OUT` parameters (or a single composite type) so the client receives one object — not `RETURNS TABLE`/`SETOF`. If a set-returning shape is unavoidable, guarantee exactly one row and read it defensively.
- **Applies to**: plan, implement, impl-review

## Split long functions into short, self-documenting helpers

- **Context**: Any function — especially endpoint handlers (Astro `APIRoute` in `src/pages/api/**`) — that accumulates multiple responsibilities in one block.
- **Problem**: The `identify.ts` POST grew into one long block (auth, validation, consume, AI call + fallback, refund, response) — hard to read, hard to test, and hard to review; orchestration and logic are tangled.
- **Rule**: Don't write one long function. Keep functions short and single-responsibility; extract well-named private helpers (e.g. `validateUpload`, `consumeSlot`, `identifyImage`, `refundSlot`) so the handler reads as a sequence of intention-revealing steps. Function names should document behaviour — the code self-documents instead of relying on block comments.
- **Applies to**: implement, impl-review

## Build dev harnesses to production conventions

- **Context**: Any developer harness, spike, or test page (e.g. `src/pages/*-test.astro`, internal tooling UI) — anything labelled "throwaway" or "dev-only".
- **Problem**: Harnesses scoped as throwaway skip project conventions (e.g. vanilla `<script>` instead of a React island, no a11y locators, lint rules hidden by the `.astro` parser), so convention drift and latent mistakes go undetected until real UI is built.
- **Rule**: A developer harness must follow the same framework choice, lint, and structural conventions as production UI — no vanilla-script or convention shortcuts just because it's "temporary".
- **Applies to**: plan, plan-review, implement, impl-review

## Constants belong in config/resource files, not logic files

- **Context**: All layers / any phase — any time constants (strings, numbers, URLs, limits, magic values) are introduced or modified
- **Problem**: Constants get buried in logic files, making them hard to find, update, or audit; changes require digging through business logic to locate the value
- **Rule**: Move constants (strings, numbers, URLs, limits) to dedicated config files or resource files — never embed them in files that also contain business logic or implementation code.
- **Applies to**: all
