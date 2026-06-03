# Data Schema Implementation Plan

## Overview

Create the full data layer for Landmark Lore: three PostgreSQL tables (`folders`, `photos`, `identifications`), RLS policies, a default-folder trigger, a private Supabase Storage bucket, and typed TypeScript bindings. This is the foundational contract that unblocks every photo-handling slice (S-01, S-03).

## Current State Analysis

Supabase is wired and healthy: `supabase/config.toml` is configured (PostgreSQL 17, local dev on port 54322, storage enabled at 50 MiB/file), `@supabase/supabase-js` v2.99.1 and the Supabase CLI v2.23.4 are installed, and an SSR-safe client exists at `src/lib/supabase.ts`. Auth works end-to-end.

What is missing: `schema_paths = []` in config.toml (no migrations), no `supabase/migrations/` directory, no domain types in `src/`, no storage bucket, and no RLS policies. The entire data layer is greenfield.

## Desired End State

After this plan:
- `supabase db reset` applies cleanly from a blank state
- `folders`, `photos`, and `identifications` tables exist with full RLS (users own only their own rows)
- Every new user signup auto-creates an "Uncategorized" folder via a DB trigger
- A private `photos` bucket exists in Supabase Storage with user-scoped RLS
- `src/types/supabase.ts` contains CLI-generated types for all three tables
- `src/lib/supabase.ts` passes the `Database` generic to `createServerClient`, giving typed query results across the app

### Key Discoveries

- `supabase/config.toml` uses `schema_paths = []` — migrations go in `supabase/migrations/` (auto-discovered by the CLI, no config change needed)
- `src/lib/supabase.ts` calls `createServerClient` from `@supabase/ssr` — adding the `Database` generic is a one-line change
- Storage RLS in Supabase operates on `storage.objects`; the user-ownership check for path `{user_id}/{photo_id}.ext` is `(storage.foldername(name))[1] = auth.uid()::text`
- The default folder trigger fires on `auth.users` (the `auth` schema) — the function must be declared `SECURITY DEFINER` to insert into `public.folders`
- `photos.folder_id` uses `ON DELETE RESTRICT`: a folder cannot be dropped while it has photos (enforced at DB level). User-deletion cascades are safe because `photos.user_id ON DELETE CASCADE` deletes all photo rows first, removing any references to that user's folders before the `folders.user_id ON DELETE CASCADE` fires

## What We're NOT Doing

- No `follow_up_conversations` / `conversation_messages` table — deferred to S-02 (follow-up questions slice)
- No `subject_type` column on `identifications` — deferred to the FR-008 slice (auto-tagging, parked)
- No auto-organisation trigger or folder suggestions — deferred to FR-009
- No place/time metadata columns — deferred to FR-008
- No seed data for photos or identifications — this plan creates schema only
- No changes to auth flow or signup UX — the trigger is invisible to the application layer

## Implementation Approach

Two SQL migration files cover the schema and storage concerns separately so each can be debugged in isolation. A third step generates TypeScript types from the running local schema and wires the typed client. Migrations are applied via `supabase db reset` (development) and will be applied automatically by the Supabase CLI in CI once connected.

## Critical Implementation Details

**Trigger security context:** `create_default_folder()` must be declared `SECURITY DEFINER` and created by a superuser role. The trigger fires as the `auth` schema user, which does not have `INSERT` privileges on `public.folders` without `SECURITY DEFINER`. Without this flag the trigger silently fails on signup.

**Storage RLS — do not re-enable:** Supabase hosted and local dev both enable RLS on `storage.objects` by default, so the migration only adds policies. We deliberately omit `ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY`: that statement requires ownership of `storage.objects`, which on hosted Supabase belongs to `supabase_storage_admin` rather than the migrating role, so it can fail with "must be owner of table objects" at deploy time. Locally it would pass (postgres is superuser), masking the hosted failure.

---

## Phase 1: SQL Migration — Tables, RLS, and Triggers

### Overview

Create the `photo_status` enum, three tables with foreign keys and indexes, RLS policies for all three, an `updated_at` trigger function, and the `create_default_folder` trigger that fires on `auth.users` INSERT.

### Changes Required

#### 1. Migration file

**File:** `supabase/migrations/20260603000001_create_folders_photos_identifications.sql`

**Intent:** Apply the complete schema for photos, folders, and identifications in a single idempotent migration.

**Contract:**

```sql
-- Enum for photo lifecycle state (guarded: CREATE TYPE has no IF NOT EXISTS)
DO $$ BEGIN
  CREATE TYPE photo_status AS ENUM ('pending', 'identified', 'unrecognized', 'error');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Folders (flat, one per user minimum via trigger below)
CREATE TABLE IF NOT EXISTS folders (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name        TEXT        NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_folders_user_id ON folders(user_id);

-- Photos
CREATE TABLE IF NOT EXISTS photos (
  id                UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID         NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  folder_id         UUID         NOT NULL REFERENCES folders(id) ON DELETE RESTRICT,
  storage_path      TEXT         NOT NULL,   -- "{user_id}/{photo_id}.{ext}"
  original_filename TEXT         NOT NULL,
  file_size         INTEGER,                 -- bytes; NULL if unknown at upload time
  mime_type         TEXT         NOT NULL,
  status            photo_status NOT NULL DEFAULT 'pending',
  created_at        TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_photos_user_id   ON photos(user_id);
CREATE INDEX IF NOT EXISTS idx_photos_folder_id ON photos(folder_id);

-- Identifications (one per photo, created when status → 'identified')
CREATE TABLE IF NOT EXISTS identifications (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  photo_id     UUID        NOT NULL UNIQUE REFERENCES photos(id) ON DELETE CASCADE,
  subject_name TEXT        NOT NULL,
  description  TEXT        NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_identifications_photo_id ON identifications(photo_id);

-- RLS
ALTER TABLE folders        ENABLE ROW LEVEL SECURITY;
ALTER TABLE photos         ENABLE ROW LEVEL SECURITY;
ALTER TABLE identifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "owner_all" ON folders;
CREATE POLICY "owner_all" ON folders FOR ALL
  USING  (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "owner_all" ON photos;
CREATE POLICY "owner_all" ON photos FOR ALL
  USING  (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "owner_all" ON identifications;
CREATE POLICY "owner_all" ON identifications FOR ALL
  USING  (EXISTS (
    SELECT 1 FROM photos
    WHERE photos.id = identifications.photo_id
      AND photos.user_id = auth.uid()
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM photos
    WHERE photos.id = identifications.photo_id
      AND photos.user_id = auth.uid()
  ));

-- updated_at trigger (shared function)
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER folders_updated_at
  BEFORE UPDATE ON folders
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE OR REPLACE TRIGGER photos_updated_at
  BEFORE UPDATE ON photos
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Default folder trigger: fires when a new auth user is created
CREATE OR REPLACE FUNCTION create_default_folder()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO public.folders (user_id, name)
  VALUES (NEW.id, 'Uncategorized');
  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION create_default_folder();
```

### Success Criteria

#### Automated Verification

- Migration applies cleanly from blank state: `supabase db reset` exits 0
- All three tables exist: `psql "$DB_URL" -c "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename"` returns `folders`, `identifications`, `photos`
- RLS is enabled: `psql "$DB_URL" -c "SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname='public'"` shows `true` for all three
- Enum exists: `psql "$DB_URL" -c "SELECT typname FROM pg_type WHERE typname='photo_status'"` returns one row

> `DB_URL = postgresql://postgres:postgres@127.0.0.1:54322/postgres` (local DB port from `config.toml`; get it any time with `supabase status`). The Supabase CLI has no ad-hoc SQL subcommand. If `psql` isn't on PATH, run the same SQL via Supabase Studio (`http://localhost:54323`) or `docker exec -i supabase_db_<project_id> psql -U postgres -c "…"`.

#### Manual Verification

- Sign up a new user via the app's `/auth/signup` page; then query `SELECT * FROM folders` — one "Uncategorized" row should appear for that user's `user_id`
- Confirm that querying `SELECT * FROM folders` as a different user (or unauthenticated via anon key) returns zero rows (RLS working)

**Implementation Note:** After this phase passes all automated checks, pause for the manual verification above before proceeding to Phase 2.

---

## Phase 2: Storage Bucket and Policies

### Overview

Create the private `photos` bucket in Supabase Storage and apply user-scoped RLS policies so that only the file owner can upload, read, or delete their photos.

### Changes Required

#### 1. Storage migration file

**File:** `supabase/migrations/20260603000002_create_photos_storage_bucket.sql`

**Intent:** Create the `photos` bucket and three storage RLS policies that enforce user ownership via the `{user_id}/` path prefix.

**Contract:**

```sql
-- Create private photos bucket (50 MiB limit matches supabase/config.toml)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'photos',
  'photos',
  false,
  52428800,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
)
ON CONFLICT (id) DO NOTHING;

-- Note: RLS is already enabled on storage.objects by default (local + hosted).
-- We do NOT run `ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY` — that
-- statement requires table ownership and fails on hosted Supabase, where
-- storage.objects is owned by supabase_storage_admin, not the migrating role.

-- Upload: only the owner's user_id prefix
DROP POLICY IF EXISTS "photos_insert" ON storage.objects;
CREATE POLICY "photos_insert"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'photos'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

-- Read: only the owner
DROP POLICY IF EXISTS "photos_select" ON storage.objects;
CREATE POLICY "photos_select"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'photos'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

-- Delete: only the owner
DROP POLICY IF EXISTS "photos_delete" ON storage.objects;
CREATE POLICY "photos_delete"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'photos'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );
```

### Success Criteria

#### Automated Verification

- `supabase db reset` (both migrations) exits 0
- Bucket exists: `psql "$DB_URL" -c "SELECT id, public FROM storage.buckets WHERE id='photos'"` returns one row with `public = false`
- Policies exist: `psql "$DB_URL" -c "SELECT policyname FROM pg_policies WHERE tablename='objects' AND schemaname='storage'"` returns `photos_insert`, `photos_select`, `photos_delete`

> `DB_URL` as defined in Phase 1 (`postgresql://postgres:postgres@127.0.0.1:54322/postgres`); Studio / `docker exec` fallback applies here too.

#### Manual Verification

- Upload a test image as user A; confirm the file is accessible via a signed URL for user A and inaccessible (403) when accessed without auth or as user B
- Attempt to upload a file with a path that doesn't start with `auth.uid()` — should be rejected with a storage policy violation

**Implementation Note:** After automated checks pass, perform the manual upload test before proceeding to Phase 3.

---

## Phase 3: TypeScript Types and Typed Client

### Overview

Generate TypeScript types from the live local schema and update the Supabase client to pass the `Database` generic, giving typed query results throughout the application.

### Changes Required

#### 1. Generate types file

**File:** `src/types/supabase.ts` (generated — do not hand-edit)

**Intent:** Run `supabase gen types typescript --local` to produce a `Database` type reflecting the current schema. This file is the single source of truth for DB types; it must be regenerated whenever the schema changes.

**Contract:** Run after `supabase start` is confirmed running:
```bash
supabase gen types typescript --local > src/types/supabase.ts
```
The output file exports a `Database` type with `public.Tables` containing `folders`, `photos`, and `identifications` with full `Row`, `Insert`, and `Update` variants.

#### 2. Typed Supabase client

**File:** `src/lib/supabase.ts`

**Intent:** Add the `Database` generic to `createServerClient` so all downstream queries in API routes and server components are type-checked against the actual schema.

**Contract:** Import `Database` from `../types/supabase` and pass it as the generic parameter to `createServerClient<Database>(...)`. No other changes to the function signature or cookie logic.

### Success Criteria

#### Automated Verification

- `src/types/supabase.ts` exists and is non-empty after generation
- Type-check passes: `npx astro check` exits 0 — the Astro-aware type checker (installs `@astrojs/check` on first run). This is the real gate: `astro build` strips types via esbuild and would not catch a bad `Database` generic. Since no query consumers exist yet, the strongest confirmation is the manual IDE check in 3.4.
- Types file contains expected table names: `grep -c "folders\|photos\|identifications" src/types/supabase.ts` returns > 0

#### Manual Verification

- Open `src/lib/supabase.ts` in the IDE; verify that a query like `supabase.from('photos').select()` shows typed results (IDE completion shows `id`, `user_id`, `folder_id`, etc.)
- Confirm `src/types/supabase.ts` is committed to git (NOT gitignored). Decision: commit the generated file so CI can run `astro check` without a running Supabase stack; regenerate and re-commit whenever the schema changes.

---

## Testing Strategy

### Automated

- `supabase db reset` is the primary gate — both migrations must apply cleanly from blank state
- TypeScript type-check (`npx astro check`) validates the typed client — not `astro build`, which strips types

### Manual Testing Steps

1. `supabase start` → `supabase db reset` → verify tables via Supabase Studio at `http://localhost:54323`
2. Sign up a new user via `/auth/signup`; in Studio, confirm one `folders` row ("Uncategorized") exists for that user
3. In Studio Table Editor, attempt to view another user's rows while authenticated as a different user — expect zero results (RLS working)
4. Upload a test file to the `photos` bucket via the Supabase Studio Storage UI; verify it's scoped to the correct user path
5. Run `supabase gen types typescript --local > src/types/supabase.ts`; open `src/lib/supabase.ts` and confirm IDE type completion works on `.from('photos')`

## Migration Notes

Every statement in both files is written to be re-runnable so a partial or repeated apply never errors: tables and indexes use `IF NOT EXISTS`, the enum is wrapped in a `DO` block that swallows `duplicate_object`, policies are `DROP POLICY IF EXISTS` then `CREATE`, triggers use `CREATE OR REPLACE TRIGGER`, functions use `CREATE OR REPLACE FUNCTION`, and the bucket insert uses `ON CONFLICT DO NOTHING`. Note that `supabase db reset` drops the schema first and the CLI's migration tracker runs each file once, so idempotency is a safety net (manual re-runs, re-pushes), not a normal-path requirement. The first time `supabase db reset` runs, it applies both files in timestamp order. Future schema changes (e.g., adding `subject_type` for FR-008) add a new migration file rather than editing these.

## References

- Roadmap: F-01 in `context/foundation/roadmap.md`
- PRD: FR-003, FR-006, FR-007 in `context/foundation/prd.md`
- Infrastructure: Supabase on Cloudflare Workers — `context/foundation/infrastructure.md`
- Supabase client: `src/lib/supabase.ts`
- Supabase config: `supabase/config.toml`

---

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: SQL Migration — Tables, RLS, and Triggers

#### Automated

- [x] 1.1 `supabase db reset` exits 0
- [x] 1.2 All three tables exist in public schema
- [x] 1.3 RLS enabled on all three tables
- [x] 1.4 `photo_status` enum exists

#### Manual

- [x] 1.5 New user signup creates "Uncategorized" folder via trigger
- [x] 1.6 RLS verified: different user sees zero rows

### Phase 2: Storage Bucket and Policies

#### Automated

- [x] 2.1 `supabase db reset` (both migrations) exits 0
- [x] 2.2 `photos` bucket exists and is private
- [x] 2.3 Three storage policies exist (`photos_insert`, `photos_select`, `photos_delete`)

#### Manual

- [x] 2.4 File upload accessible to owner, rejected for other users
- [x] 2.5 Upload with wrong path prefix rejected

### Phase 3: TypeScript Types and Typed Client

#### Automated

- [x] 3.1 `src/types/supabase.ts` generated and non-empty
- [x] 3.2 `npx astro check` exits 0 (type-check; not `astro build`)
- [x] 3.3 Types file contains expected table names

#### Manual

- [x] 3.4 IDE type completion works on `supabase.from('photos')`
- [x] 3.5 `src/types/supabase.ts` is committed to git (not gitignored)
