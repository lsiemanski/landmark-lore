# Data Schema — Plan Brief

> Full plan: `context/changes/data-schema/plan.md`

## What & Why

Landmark Lore has Supabase wired (client, auth, config) but no schema at all — `schema_paths = []`, no migration files, no storage bucket, no TypeScript domain types. This change creates the three-table data contract (`folders`, `photos`, `identifications`) that every photo-handling slice depends on. Nothing from S-01 (upload + identify) or S-03 (archive + folders) can be built until this lands.

## Starting Point

`supabase/config.toml` is configured for local dev (PostgreSQL 17, port 54322, 50 MiB storage limit). `@supabase/supabase-js` v2.99.1 and the Supabase CLI v2.23.4 are installed. Auth works end-to-end. The data layer is entirely absent.

## Desired End State

`supabase db reset` applies cleanly from blank state. Three tables exist with RLS — users see only their own rows. A new signup automatically creates an "Uncategorized" folder via a DB trigger. A private `photos` bucket enforces user-scoped storage access. `src/lib/supabase.ts` is typed with the generated `Database` type, giving typed query results across the app.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) | Source |
|---|---|---|---|
| Folder hierarchy | Flat (no nesting) | PRD FR-007 says "move between folders" — peer-level organisation; nesting adds RLS and query complexity for zero v1 benefit | Plan |
| Photos without a folder | Mandatory default folder ("Uncategorized") created per user | Every photo always has a `folder_id`, simplifying queries and preventing orphaned rows | Plan |
| Identification storage | Separate `identifications` table + `status` enum on `photos` | Status on `photos` lets the UI query lifecycle with a simple SELECT; separate table keeps AI result data normalized and editable | Plan |
| Follow-up questions table | Defer to S-02 | Unused until S-02 ships; a table migration is trivial to add later | Plan |
| Subject type column | Defer to FR-008 slice | FR-008 (auto-tagging) is parked; adding a NULL column for every v1 row provides no value | Plan |
| Storage path | `{user_id}/{photo_id}.{ext}` in a private `photos` bucket | User-prefix path makes storage RLS trivial without a separate lookup | Plan |
| TypeScript types | CLI-generated via `supabase gen types typescript --local` | Types stay in sync with the actual schema automatically | Plan |

## Scope

**In scope:**
- `photo_status` enum (`pending`, `identified`, `unrecognized`, `error`)
- `folders`, `photos`, `identifications` tables with indexes and foreign keys
- RLS policies (owner-only access on all three tables)
- `updated_at` trigger on `folders` and `photos`
- Default-folder trigger on `auth.users` INSERT
- Private `photos` storage bucket with user-scoped RLS policies
- Generated TypeScript types + typed `createServerClient<Database>` in `src/lib/supabase.ts`

**Out of scope:**
- `conversation_messages` / follow-up Q&A table (S-02)
- `subject_type` column (FR-008)
- Auto-organisation logic (FR-009)
- Place/time metadata columns (FR-008)
- Seed data, demo fixtures, or test data

## Architecture / Approach

Two SQL migration files (timestamped) are applied via `supabase db reset`. The schema migration creates the domain tables and triggers; the storage migration creates the bucket and its policies. A third step generates TypeScript types from the running local schema and adds the `Database` generic to the existing Supabase client. No application code changes beyond `src/lib/supabase.ts` — this plan creates infrastructure only.

## Phases at a Glance

| Phase | What it delivers | Key risk |
|---|---|---|
| 1. SQL Migration | Tables, enums, RLS, triggers, default-folder automation | `create_default_folder()` must be `SECURITY DEFINER` — missing it silently breaks signup |
| 2. Storage Bucket | Private `photos` bucket + user-scoped storage RLS | Storage policy name conflicts if `storage.objects` already has policies from previous attempts |
| 3. TypeScript Types | Generated types + typed client | Requires `supabase start` (local Docker); generated file must be kept in sync with future migrations |

**Prerequisites:** `supabase start` must be running locally (Docker); Supabase CLI v2.23.4 is already installed.  
**Estimated effort:** ~1 session across 3 phases

## Open Risks & Assumptions

- The `SECURITY DEFINER` flag on `create_default_folder()` is load-bearing — if the function is created without it (e.g., copy-pasted without the flag), signups will silently not create the default folder, and every subsequent photo insert will fail the `NOT NULL` constraint on `folder_id`
- Committing vs. gitignoring `src/types/supabase.ts` is an open decision in Phase 3; recommendation is to commit it so CI type-checks without needing a running Supabase instance

## Success Criteria (Summary)

- `supabase db reset` applies both migrations cleanly from blank state
- A new user signup creates an "Uncategorized" folder automatically (visible in Supabase Studio)
- `npm run build` passes with the typed `createServerClient<Database>` — no TypeScript errors
