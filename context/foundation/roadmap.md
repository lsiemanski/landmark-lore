---
project: Landmark Lore
version: 1
status: draft
created: 2026-06-01
updated: 2026-06-17
prd_version: 1
main_goal: speed
top_blocker: time
---

# Roadmap: Landmark Lore

> Derived from `context/foundation/prd.md` (v1) + auto-researched codebase baseline.
> Edit-in-place; archive when superseded.
> Slices below are listed in dependency order. The "At a glance" table is the index.

## Vision recap

A traveler returns from a trip with photos of landmarks, statues, and art — and can't identify most of them. AI visual recognition is now reliable enough to change this, but no product combines identification with a persistent personal archive. Landmark Lore does: upload a photo, receive the subject identified with its historical and cultural context, and save it to a private archive organized around what you actually photographed — not just when or where you were.

## North star

**S-01: upload a photo, receive identification, and save it to the archive** — the smallest end-to-end slice that proves the AI tour-guide experience is real.

> "North star" here means: the smallest end-to-end flow whose successful delivery proves the core product hypothesis — that AI identification combined with a persistent archive actually delivers the retrospective travel experience the Vision promises. It is placed first because everything else (follow-up questions, archive management, folder organisation) only matters if this works.

## At a glance

| ID   | Change ID                     | Outcome (user can …)                                                                  | Prerequisites    | PRD refs                      | Status |
| ---- | ----------------------------- | ------------------------------------------------------------------------------------- | ---------------- | ----------------------------- | ------ |
| F-01 | data-schema                   | (foundation) photos, folders, and identifications tables exist in Supabase            | —                | FR-003, FR-006, FR-007        | done   |
| F-02 | ai-provider-spike             | (foundation) AI provider chosen, key configured, test identification call verified    | —                | FR-004, FR-005                | done   |
| F-03 | testing-harness-bootstrap     | (foundation) Vitest runner configured; identification-contract integration tests pass | —                | —                             | done   |
| S-01 | first-identification-and-save | upload a photo, receive a subject name and description, and save it                   | F-01, F-02, F-03 | FR-003, FR-004, FR-006, US-01 | done   |
| S-02 | follow-up-questions           | ask follow-up questions about an identified photo and receive answers                 | S-01             | FR-005                        | ready  |
| S-03 | archive-and-folders           | view their archive and manually move photos between folders                           | S-01             | FR-007                        | done   |
| S-04 | account-lifecycle             | create an account, sign in, and reset their password via email                        | —                | FR-001, FR-002, FR-010        | done   |

## Streams

Navigation aid — groups items that share a Prerequisites chain. Canonical ordering still lives in the dependency graph below; this table is the proposed reading order across parallel tracks.

| Stream | Theme                  | Chain                                      | Note                                                                                                                                    |
| ------ | ---------------------- | ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| A      | Identification core    | `F-01` / `F-02` → `F-03` → `S-01` → `S-02` | Critical path for `main_goal: speed`; F-01, F-02, and F-03 can run in parallel once F-01/F-02 are done (F-03 has no schema dependency). |
| B      | Archive & organisation | `S-01` → `S-03`                            | Branches from Stream A at `S-01`; parallel with `S-02` once `S-01` lands.                                                               |
| C      | Auth completion        | `S-04`                                     | Standalone; no dependency on other slices; parallel with entire Stream A.                                                               |

## Baseline

What's already in place in the codebase as of `2026-06-01` (auto-researched + user-confirmed).
Foundations below assume these are present and do NOT re-scaffold them.

- **Frontend:** present — Astro 6.3.1 + React 19 + TailwindCSS; auth UI components in `src/components/auth/`, dashboard page scaffolded at `src/pages/dashboard.astro`
- **Backend / API:** present — Astro API routes for auth in `src/pages/api/auth/`; middleware in `src/middleware.ts` guards `/dashboard`
- **Data:** partial — Supabase client wired (`src/lib/supabase.ts`, `supabase/config.toml`); no schema or migration files present
- **Auth:** present — Supabase Auth fully wired: `signInWithPassword()`, `signOut()`, `getUser()` in middleware; sessions via server-side cookies; sign-up, sign-in, and confirm-email pages present
- **Deploy / infra:** present — Cloudflare Workers via `wrangler.jsonc`; GitHub Actions CI in `.github/workflows/ci.yml` (lint / build / deploy / preview jobs)
- **Observability:** absent — no logging library, error tracking, or metrics

## Foundations

### F-01: Data schema

- **Outcome:** (foundation) photos, folders, and identification results tables exist in Supabase; the minimal schema contract that unblocks all photo-handling slices.
- **Change ID:** data-schema
- **PRD refs:** FR-003 (photo storage), FR-006 (save to archive), FR-007 (folder structure)
- **Unlocks:** S-01 (photo upload and save require photos and identifications tables), S-03 (folder management requires folders table)
- **Prerequisites:** —
- **Parallel with:** F-02, S-04
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Schema designed upfront avoids mid-sprint migrations; if the folders table design does not account for FR-007's manual-move requirement, S-03 will require a schema migration before it can ship.
- **Status:** done

### F-02: AI provider spike

- **Outcome:** (foundation) AI provider chosen, API key configured as a Cloudflare Workers secret, and a test image identification call returns a subject name and substantive description end-to-end.
- **Change ID:** ai-provider-spike
- **PRD refs:** FR-004 (identification), FR-005 (follow-up questions)
- **Unlocks:** S-01 (identification endpoint cannot be planned or built without a chosen provider), S-02 (follow-up depends on the same provider's conversation model)
- **Prerequisites:** —
- **Parallel with:** F-01, S-04
- **Blockers:** —
- **Unknowns:** —
- **Risk:** `openai` SDK (used via OpenRouter) bundle size must be verified against the Workers 1 MB compressed limit (infrastructure.md risk register); verifying this before S-01 prevents a mid-sprint integration failure.
- **Status:** done

## Slices

### F-03: Test harness bootstrap

- **Outcome:** (foundation) Vitest runner configured; identification-contract and provider-error-handling integration tests pass against a mocked OpenRouter endpoint; test infrastructure is in place for all subsequent slices.
- **Change ID:** testing-harness-bootstrap
- **PRD refs:** —
- **Unlocks:** S-01 integration test coverage (S-01 plan is explicitly blocked on this); all subsequent slices inherit the test runner and mock patterns.
- **Prerequisites:** —
- **Parallel with:** S-04
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Astro API routes run on workerd — the integration test approach (`wrangler`/`unstable_dev` vs. Astro test container) must be grounded in research before planning; the wrong choice leads to tests that pass locally but fail in the real Workers runtime.
- **Status:** done

### S-01: Upload, identify, and save a photo

- **Outcome:** user can upload a photo from their device, receive a subject name and substantive description, and save it to their archive — all in one session.
- **Change ID:** first-identification-and-save
- **PRD refs:** FR-003, FR-004, FR-006, US-01
- **Prerequisites:** F-01, F-02, F-03
- **Parallel with:** S-04
- **Blockers:** F-03 (`testing-harness-bootstrap`) — integration tests for this slice cannot be written until the test runner is configured and the mock patterns are established.
- **Unknowns:**
  - Progress feedback mechanism: the NFR requires "continuous visible progress feedback" during AI analysis — streaming vs. polling during the provider API call. Owner: user. Block: no (either approach satisfies the NFR; decide during planning).
- **Risk:** The highest-risk slice — new AI integration, photo upload to Supabase Storage, and identification result persistence all land here for the first time; Workers CPU time limit (10 ms free tier, infrastructure.md) may require profiling before public launch.
- **Status:** done

### S-02: Follow-up questions

- **Outcome:** user can ask follow-up questions about an identified subject in the same session and receive answers.
- **Change ID:** follow-up-questions
- **PRD refs:** FR-005
- **Prerequisites:** S-01
- **Parallel with:** S-03
- **Blockers:** —
- **Unknowns:** —
- **Decisions made:** In-browser only (React state, not DB); same screen as the identification result; works for both identified and unrecognized photos; stateless per-question calls (no session context retained). Resolved 2026-06-11.
- **Risk:** Stateless implementation ships fastest but reduces answer quality when follow-ups reference earlier context in the session; acceptable for v1.
- **Status:** ready

### S-03: Archive view and folder management

- **Outcome:** user can view their saved photos in a personal archive and manually move photos between folders.
- **Change ID:** archive-and-folders
- **PRD refs:** FR-007
- **Prerequisites:** S-01
- **Parallel with:** S-02
- **Blockers:** —
- **Unknowns:** —
- **Risk:** Folder move logic depends on the schema designed in F-01; if the folders table does not model the structure needed for FR-007, a schema migration is required before this slice can ship.
- **Status:** done

### S-04: Account lifecycle complete

- **Outcome:** user can create an account, sign in, and reset their password via email.
- **Change ID:** account-lifecycle
- **PRD refs:** FR-001, FR-002, FR-010
- **Prerequisites:** —
- **Parallel with:** F-01, F-02, S-01
- **Blockers:** —
- **Unknowns:** —
- **Risk:** FR-001 and FR-002 are present in the baseline scaffold; this slice adds FR-010 (password reset) and verifies the complete auth flow end-to-end. Minimal risk, but required before any user other than the owner can access the product.
- **Status:** done

## Backlog Handoff

| Roadmap ID | Change ID                     | Suggested issue title                                                                  | Ready for `/10x-plan` | Notes                                                                    |
| ---------- | ----------------------------- | -------------------------------------------------------------------------------------- | --------------------- | ------------------------------------------------------------------------ |
| F-01       | data-schema                   | Design and apply Supabase schema for photos, folders, identifications                  | done                  | Complete                                                                 |
| F-02       | ai-provider-spike             | Configure OpenRouter API key (Gemini 2.5 Flash), verify identification call end-to-end | done                  | Complete — unlocks S-01, S-02                                            |
| F-03       | testing-harness-bootstrap     | Set up Vitest + identification-contract integration tests                              | yes                   | Run `/10x-new testing-harness-bootstrap` → `/10x-research` → `/10x-plan` |
| S-01       | first-identification-and-save | Build upload → identify → save core flow                                               | done                  | Complete                                                                 |
| S-02       | follow-up-questions           | Add follow-up questions to the identification session                                  | yes                   | Run `/10x-new follow-up-questions` → `/10x-plan`                         |
| S-03       | archive-and-folders           | Build archive view and manual folder management                                        | yes                   | Run `/10x-new archive-and-folders` → `/10x-plan`                         |
| S-04       | account-lifecycle             | Add password reset; verify full auth flow end-to-end                                   | yes                   | Run `/10x-plan account-lifecycle`                                        |

## Open Roadmap Questions

1. **GDPR and image-rights compliance** — Owner: user. Block: public launch (all data-handling slices need a GDPR-compliant deletion flow before inviting users other than the owner). PRD resolution note: private testing with the owner's own photos is exempt under GDPR Recital 18; before inviting others, account deletion cascade must exist as a technical prerequisite regardless of legal readiness.

2. **Place/time tagging strategy** — Should place (city/country) and time (month + year) derive primarily from EXIF metadata with AI-inferred fallback, or primarily from AI inference? Owner: user. Block: no — affects FR-008/FR-009 which are parked for v1.

3. **Follow-up question context** — Stateful (retains identification context across questions in a session) vs. stateless (each question independent)? Owner: user. Block: no for v1 if stateless is acceptable. See also S-02 Unknowns.

## Parked

- **FR-008: Auto-tagging (subject type, place, time)** — Why parked: nice-to-have per PRD; place/time tagging strategy is an open question; deferred per `main_goal: speed`.
- **FR-009: Auto-organisation into folders** — Why parked: nice-to-have per PRD; depends on FR-008 metadata; deferred per `main_goal: speed`.
- **Real-time / live camera identification** — Why parked: PRD §Non-Goals; in-the-moment identification is a different use case and doubles the surface area.
- **Social sharing / public albums** — Why parked: PRD §Non-Goals; primary persona builds a private personal record.
- **Cloud photo service import (Google Photos, iCloud, Dropbox)** — Why parked: PRD §Non-Goals; per-provider OAuth flows significantly widen scope.
- **In-house AI identification model** — Why parked: PRD §Non-Goals; training or fine-tuning a recognition model is a separate product.

## Done

(Empty on first generation. `/10x-archive` appends entries here when a change is archived.)

- **F-01: (foundation) photos, folders, and identifications tables exist in Supabase** — Archived 2026-06-12 → `context/archive/2026-06-03-data-schema/`. Lesson: —.
- **F-02: (foundation) AI provider chosen, key configured, test identification call verified** — Archived 2026-06-12 → `context/archive/2026-06-05-ai-provider-spike/`. Lesson: —.
- **F-03: (foundation) Vitest runner configured; identification-contract integration tests pass** — Archived 2026-06-12 → `context/archive/2026-06-12-testing-harness-bootstrap/`. Lesson: —.
- **S-01: upload a photo, receive identification, and save it to the archive** — Implemented 2026-06-14. Change ID: `first-identification-and-save`. Unlocks S-02, S-03.
- **S-04: user can create an account, sign in, and reset their password via email** — Archived 2026-06-14 → `context/archive/2026-06-14-account-lifecycle/`. Lesson: —.
- **S-03: user can view their saved photos in a personal archive and manually move photos between folders** — Archived 2026-06-17 → `context/archive/2026-06-14-archive-and-folders/`. Lesson: —.
