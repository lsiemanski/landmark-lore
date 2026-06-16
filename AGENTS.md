# Repository Guidelines

Landmark Lore is a solo-built travel photo archival app. Stack: Astro 6 SSR + React 19 + TypeScript 5.9 + Supabase (auth / storage / PostgreSQL) + Cloudflare Pages. See `@context/foundation/tech-stack.md` for stack rationale and `@context/foundation/prd.md` for feature requirements.

## Hard Rules

- **AI identification must never silently fail.** When the AI provider cannot identify a subject, return an explicit "not recognized" state — never a blank result or a low-confidence guess presented as fact.
- **Data access must be user-scoped.** Every Supabase query touching photos, results, or album structure must filter to the authenticated user. No endpoint may expose another user's data.
- **Never commit secrets.** `SUPABASE_URL` and `SUPABASE_KEY` are server-only secrets. Reference via `.env` locally; CI reads from GitHub repository secrets. Never hard-code or log their values.
- **Run `npx astro sync` after changing `astro.config.mjs` env schema.** CI runs it before lint; skip it locally and type errors follow.

## Project Structure

Source root: `src/`. Pages live in `src/pages/`; server-only API endpoints in `src/pages/api/<feature>/<action>.ts`. Components in `src/components/<feature>/` (Astro: `.astro` PascalCase; React: `.tsx` PascalCase). Shared utilities in `src/lib/`. Astro middleware at `src/middleware.ts`. Add new features as matching sub-packages under `src/components/<feature>/` and `src/pages/api/<feature>/`. Foundation docs at `@context/foundation/`. Supabase local config and migrations at `supabase/`.

## Build, Test, and Development Commands

- `npm run dev` — local dev server
- `npm run build` — production build (requires `.env` with `SUPABASE_URL` and `SUPABASE_KEY`)
- `npm run lint` — ESLint; CI gate, must pass before merge
- `npm run lint:fix` — ESLint with auto-fix
- `npm run format` — Prettier across all files
- `npx astro sync` — regenerate Astro type declarations after config changes

No test framework is configured — add one before implementing FR-004 / FR-005.

## Naming Conventions

- **Gallery vs Archive**: The user-facing name for the photo collection feature is **Gallery** (routes, page titles, link labels). The internal/backend name is **archive** (file paths, API routes, component folders, lib modules, DB identifiers). Example: the page is `/gallery` and its title is "Gallery", but the component lives in `src/components/archive/`, the API is at `/api/archive/`, and the lib module is `src/lib/archive/`.

## Coding Style & Naming

TypeScript 5.9 strict mode; see `@tsconfig.json`. Path alias `@/*` maps to `src/*`. ESLint 9 + Prettier enforce style; Husky runs both pre-commit on `*.{ts,tsx,astro}`. React components: PascalCase `.tsx`. Astro pages and layouts: PascalCase `.astro`. API endpoints: server-only `.ts` in `src/pages/api/`.

## Commit & Pull Request Guidelines

No convention established yet — adopt Conventional Commits (`feat:`, `fix:`, `chore:`, `test:`) before first feature merge. CI gate on push/PR to `master`: `npx astro sync` → `npm run lint` → `npm run build` (see `@.github/workflows/ci.yml`). Run `npm run lint && npm run build` locally before opening a PR.
