# Landmark Lore

An AI-powered travel photo archive. Upload a photo of a landmark, artwork, or monument — get an identification with historical and cultural context, ask follow-up questions, then save it to your private archive organized by folder.

## What It Does

A traveler comes home with a camera roll full of photos of buildings, statues, and places they can't name. Landmark Lore lets them identify each one and build a meaningful personal archive, organized around what they actually photographed rather than just when or where.

The core loop:

1. **Upload** a photo from your device
2. **Identify** — the AI returns a subject name plus substantive historical/cultural background (not just a label)
3. **Ask follow-up questions** in a chat thread about the identified subject
4. **Save** the photo with its identification to a folder in your archive
5. **Browse** your archive, move photos between folders, view the full identification detail, or delete entries

Unrecognized subjects surface an explicit "not recognized" state — the app never presents a low-confidence guess as a verified fact.

## Tech Stack

| Layer              | Choice                                                             | Why                                                                                                     |
| ------------------ | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| Framework          | [Astro](https://astro.build/) v6 + [React](https://react.dev/) v19 | Server-first rendering with selective islands for interactive components (uploader, chat, archive grid) |
| Runtime            | [Cloudflare Workers](https://workers.cloudflare.com/) (workerd)    | Edge deployment; no cold starts; Workers-compatible Supabase client                                     |
| Database & Storage | [Supabase](https://supabase.com/)                                  | Auth, Postgres (with RLS), and object storage in one service                                            |
| AI Provider        | [OpenRouter](https://openrouter.ai/) → `google/gemini-2.5-flash`   | Cost-efficient vision model; OpenRouter gives model portability and a fallback path                     |
| Language           | TypeScript v5                                                      | End-to-end type safety including generated Supabase types                                               |
| Styling            | Tailwind CSS v4                                                    | Utility-first; co-located with component files                                                          |

## Key Technical Decisions

### AI identification contract

The AI response is validated against a strict Zod schema (`recognised`, `subjectName`, `description`). If the model rejects structured output (`json_schema` format returns a 400), the route automatically retries with `json_object` format. Empty or malformed responses throw typed errors — the route never silently accepts junk.

Model requests go through `withModelFallback()`, which tries a primary model then a fallback before surfacing an error.

### Per-user daily rate limiting

Identification and follow-up calls are gated by a daily per-user quota stored in Postgres and managed via Supabase RPC functions (`try_consume_image_usage`, `refund_image_usage`). A slot is consumed before the AI call and refunded if the call fails, so errors never silently drain a user's quota.

### Idempotent saves

Every identification carries a `requestId`. Saving a photo is idempotent: a `(user_id, request_id)` unique index in the database deduplicates replayed saves. The API returns `201` for a new photo and `200` for a replay, so the client can distinguish them.

### Privacy by design

- All database queries are scoped by `user_id` in application code and backed by Supabase Row Level Security (RLS) policies
- Storage objects are path-prefixed with the user's ID
- `requireAuthenticatedUser()` is called at the top of every API handler; unauthenticated requests get a 401 before any data is touched
- The middleware layer redirects unauthenticated page requests to `/auth/signin`

### Image handling

Photos are downscaled client-side before being sent to the AI to reduce latency and provider cost. The **original** bytes are what get persisted to Supabase Storage — the downscaled copy is used only for the AI call and is never saved.

## Project Structure

```
src/
├── pages/
│   ├── api/
│   │   ├── identify.ts          # POST — runs AI identification, consumes quota slot
│   │   ├── follow-up.ts         # POST — multi-turn follow-up Q&A on identified subject
│   │   ├── archive/
│   │   │   ├── photos.ts        # GET (list), POST (save identified photo)
│   │   │   ├── photos/[id].ts   # PATCH (move to folder), DELETE
│   │   │   ├── folders.ts       # GET (list), POST (create)
│   │   │   └── folders/[id].ts  # PATCH (rename), DELETE
│   │   └── auth/                # signup, signin, signout, forgot/reset password, delete account
│   ├── gallery.astro            # Protected archive page
│   └── index.astro              # Landing (signed out) / identify dashboard (signed in)
├── components/
│   ├── identify/                # Upload flow, identification result, follow-up chat, folder picker
│   └── archive/                 # Archive view, photo grid, folder sidebar, detail modal
├── lib/
│   ├── ai/
│   │   ├── identification.ts    # identifyImage() — Zod validation, model fallback, format retry
│   │   ├── follow-up.ts         # follow-up Q&A with subject context
│   │   ├── openrouter.ts        # withModelFallback(), withoutReasoning() helpers
│   │   └── identify-prompts.yaml
│   ├── identify/
│   │   ├── quota.ts             # consumeSlot / refundSlot — daily rate limiting
│   │   ├── persistence.ts       # persistPhotoAndIdentification() — idempotent save
│   │   ├── upload.ts            # hashPhoto() for deduplication
│   │   └── storage.ts           # Supabase Storage paths
│   └── archive/
│       ├── photos.ts            # listPhotos, movePhoto, deletePhotoRecord, updateIdentification
│       └── folders.ts           # listFolders, createFolder, renameFolder, deleteFolder
├── middleware.ts                 # Auth gate + user context injection
└── types/supabase.ts            # CLI-generated Supabase types
supabase/
└── migrations/                  # Schema, RLS policies, quota RPC functions
test/
├── unit/                        # identification contract, downscale, component tests
├── integration/                 # API route tests with MSW + Vitest
├── msw/                         # Mock Service Worker server setup
└── helpers/                     # Route harness, Supabase test client, OpenRouter stubs
context/
└── foundation/
    ├── prd.md                   # Full product requirements
    ├── test-plan.md             # Risk map + phased test rollout
    ├── tech-stack.md
    ├── roadmap.md
    └── shape-notes.md
```

## Core Flow in Detail

### 1 — Photo Upload and Identification

The user selects a photo on the identify page (`/`). The client downscales the image, then `POST /api/identify` sends it to OpenRouter as a base64-encoded vision message. The server validates the JSON response against a Zod schema and returns `{ recognised, subjectName, description }`.

If `recognised` is `false`, the UI shows an explicit "not recognized" panel — never a blank. If the provider errors or returns a malformed shape, the route returns a typed error response and the UI surfaces a retry state.

### 2 — Follow-up Chat

After identification, the user can ask follow-up questions in a chat thread. `POST /api/follow-up` sends the original subject context plus the conversation history to the AI and streams back the answer. Each follow-up call consumes a separate daily quota slot.

### 3 — Saving to the Archive

The user reviews the identification, optionally edits the subject name or description, picks a folder, and saves. `POST /api/archive/photos` persists the original image and thumbnail to Supabase Storage, writes a `photos` row and an `identifications` row to Postgres, and returns the new `photoId`. Replaying the same `requestId` is safe — the server deduplicates and returns the existing `photoId`.

### 4 — Gallery and Organisation

`/gallery` (protected) shows the user's archive via `GET /api/archive/photos`. Photos are displayed in a grid with thumbnails; clicking opens a detail modal with the full-resolution image and identification text.

Users can create folders (`POST /api/archive/folders`), move photos between them (`PATCH /api/archive/photos/[id]`), rename folders (`PATCH /api/archive/folders/[id]`), and delete photos or folders. The default "Unsorted" folder always exists and cannot be renamed or deleted.

## Authentication

Email and password via Supabase Auth. The full account lifecycle is implemented:

| Route                             | Purpose                                |
| --------------------------------- | -------------------------------------- |
| `/auth/signup`                    | Create account                         |
| `/auth/signin`                    | Sign in                                |
| `/auth/forgot-password`           | Request password reset email           |
| `/auth/reset-password`            | Set a new password from the reset link |
| `DELETE /api/auth/delete-account` | Delete account, photos, and all data   |

## Prerequisites

- Node.js v22.14.0 (see `.nvmrc`)
- npm
- Docker (for local Supabase stack, ~7 GB RAM)
- An [OpenRouter](https://openrouter.ai/) API key

## Getting Started

```bash
# 1. Install dependencies
npm install

# 2. Start the local Supabase stack (downloads Docker images on first run)
npx supabase start

# 3. Copy credentials into your environment files
cp .env.example .env
cp .env.example .dev.vars
# Fill in SUPABASE_URL and SUPABASE_KEY from the `supabase start` output
# Fill in OPENROUTER_API_KEY

# 4. Apply database migrations
npx supabase db reset

# 5. Start the dev server (runs on Cloudflare workerd locally)
npm run dev
```

The local Supabase Studio is available at `http://localhost:54323`.

### Environment Variables

| Variable             | Where                | Purpose                                 |
| -------------------- | -------------------- | --------------------------------------- |
| `SUPABASE_URL`       | `.env` + `.dev.vars` | Supabase project URL                    |
| `SUPABASE_KEY`       | `.env` + `.dev.vars` | Supabase `anon` key                     |
| `OPENROUTER_API_KEY` | `.dev.vars` only     | OpenRouter API key (server-only secret) |

All variables are declared via Astro's `astro:env` schema and treated as server-only secrets — they are never bundled into the client.

## Available Scripts

```bash
npm run dev          # Dev server (Cloudflare workerd runtime)
npm run build        # Production build
npm run preview      # Preview production build locally
npm run lint         # ESLint with type-checked rules
npm run lint:fix     # Auto-fix ESLint issues
npm run format       # Prettier
npm test             # Vitest (unit + integration)
```

## Testing

Tests are in `test/` and run with Vitest. The test plan in `context/foundation/test-plan.md` defines the risk map; test files are labelled with the risk they target.

```bash
npm test             # Run all tests
npm test -- --watch  # Watch mode
```

Key coverage areas:

- **Risk #1** (recognition contract): `test/unit/identification.test.ts` — verifies `recognised: false` never throws, `recognised: true` returns the expected shape
- **Risk #4** (provider error handling): same file — verifies malformed/empty/truncated AI responses produce typed errors, not crashes
- **Integration**: route-level tests with MSW intercepting the OpenRouter endpoint; covers identify, save, follow-up, archive CRUD, and auth routes

## Deployment

The app deploys to Cloudflare Workers via Wrangler. CI (GitHub Actions) runs lint + build on every push and PR to `master`.

```bash
npm run build
npx wrangler deploy
```

Set `SUPABASE_URL`, `SUPABASE_KEY`, and `OPENROUTER_API_KEY` as secrets in the Cloudflare dashboard or via `npx wrangler secret put <NAME>`.

## License

MIT
