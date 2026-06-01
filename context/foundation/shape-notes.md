---
project: Landmark Lore
context_type: greenfield
created: 2026-05-26
updated: 2026-05-26
product_type: web-app
target_scale:
  users: medium
  qps: low
  data_volume: medium
timeline_budget:
  mvp_weeks: 3
  hard_deadline: 2026-06-21
  after_hours_only: true
checkpoint:
  current_phase: 8
  phases_completed: [1, 2, 3, 4, 5, 6, 7]
  frs_drafted: 10
  gray_areas_resolved:
    - topic: "pain category"
      decision: "three-layer: missing capability (auto-identification) + workflow friction (manual steps) + data trapped (meaning locked in photographer's head)"
    - topic: "insight"
      decision: "AI identification is only now good enough to recognize landmarks, art, and people reliably"
    - topic: "persona scope"
      decision: "any individual traveler building a personal archive for themselves — single-user, private"
    - topic: "auth strategy"
      decision: "email/password login; no OAuth; flat user model — every account is equal"
    - topic: "mvp timeline"
      decision: "3 weeks after-hours; hard deadline 2026-06-21"
    - topic: "secondary success"
      decision: "photos auto-tagged by subject type, place, and time from identification step"
    - topic: "guardrails"
      decision: "privacy (no cross-user leakage), no silent failures (always return a result), no photo data loss"
    - topic: "product type"
      decision: "web app — browser-based, no install required"
    - topic: "target scale"
      decision: "medium — dozens to a hundred users; identification rule holds at higher scale"
    - topic: "non-goals"
      decision: "no real-time camera mode, no social sharing, no cloud import, no in-house AI model"
  quality_check_status: accepted
---

## Functional Requirements

### Authentication
- FR-001: Traveler can create an account with email and password. Priority: must-have
- FR-002: Traveler can log in with email and password. Priority: must-have
  > Socrates: Counter-argument considered: "email/password without a recovery flow is a support burden." Resolution: accepted — password reset added as FR-010.
- FR-010: Traveler can reset their password via email. Priority: must-have
  > Socrates: Added after Socrates round on FR-002; incomplete auth without recovery.

### Photo & Identification
- FR-003: Traveler can upload a photo from their device. Priority: must-have
  > Socrates: Counter-argument considered: "server storage creates GDPR and image-rights compliance risk from day one." Resolution: FR stands; compliance risk recorded in Open Questions — a data retention policy and privacy commitment are needed before public launch.
- FR-004: Traveler can receive an identification and description of the subject in an uploaded photo. Priority: must-have
  > Socrates: Counter-argument considered: "a one-word label is technically an identification but not useful." Resolution: accepted — description must return at minimum a subject name and a substantive contextual description (not just a label); tightened in US-01 acceptance criteria.
- FR-005: Traveler can ask follow-up questions about an identified subject and receive answers. Priority: must-have
  > Socrates: Counter-argument considered: "limiting to one follow-up is arbitrary and will feel broken." Resolution: accepted — removed the one-question limit; traveler can ask multiple follow-up questions in a session.

### Album & Organisation
- FR-006: Traveler can review, edit the identification info, and save a photo to their archive. Priority: must-have
  > Socrates: Counter-argument considered: "saving before review is risky — wrong identifications get committed." Resolution: accepted — traveler can edit or reject the identification before saving; save is always an explicit action after review.
- FR-007: Traveler can manually move or re-organise saved photos between folders (overriding auto-organisation). Priority: must-have
  > Socrates: Counter-argument considered: "manual organisation is redundant if FR-009 auto-organises." Resolution: reframed — FR-007 is the override and trust mechanism for when FR-009 gets it wrong; both coexist. Auto-org proposes; traveler decides.
- FR-008: Saved photo is automatically tagged with subject type (landmark, artwork, person), place (city/country), and time (month + year) without manual input. Priority: nice-to-have
  > Socrates: Counter-argument considered: "place and time may come from photo metadata (GPS/EXIF), not AI — photos without metadata will have no place/time tag." Resolution: accepted — EXIF-first strategy for place and time; AI-inferred fallback when metadata is absent. Strategy goes to Open Questions.
- FR-009: System automatically organises saved photos into folders based on identified place and time as a suggestion the traveler can always override. Priority: nice-to-have
  > Socrates: Counter-argument considered: "auto-organisation that can't be overridden creates a system the traveler doesn't trust." Resolution: accepted — auto-org is a proposal, not a lock; traveler can always move photos via FR-007.

## User Stories

### US-01: Traveler identifies and saves a travel photo

- **Given** a logged-in traveler with a photo on their device
- **When** they upload it
- **Then** they see the subject identified with a name and description

#### Acceptance Criteria
- Identification returns at minimum a subject name and a short description
- An unrecognised subject surfaces an explicit "not recognised" state, never a blank
- Traveler can save the photo + info in one action after reviewing

## Success Criteria

### Primary
- A traveler uploads a photo, receives an identification and description of its subject, optionally asks a follow-up question, and saves the photo with its info into a folder — all in a single session.

### Secondary
- Photos are automatically tagged by subject type (landmark, artwork, person) from the identification step, with no manual input from the traveler.

### Guardrails
- A traveler's photos and data are never visible to other users — privacy is the floor.
- Identification always returns a result; subjects that cannot be recognized surface an explicit "not recognized" state, never a silent failure.
- Photo upload never corrupts or loses the original file.

## Vision & Problem Statement

A traveler returns from a trip with a camera roll full of photos — buildings, statues, art pieces, places — and can't identify most of them. The meaning of those moments is trapped: reverse image searching is slow, imprecise, and doesn't persist anywhere useful.

The insight: AI visual recognition is now reliable enough to identify landmarks, art pieces, and notable subjects from a photo. No clean product exists that combines identification with a persistent, organized personal archive. Existing platform solutions (Google Photos, Apple Photos) organize by date and location, not by what the subject actually is or what it means.

## Non-Functional Requirements

- During any photo analysis operation, the traveler receives continuous visible progress feedback; the result appears without requiring a page reload or manual refresh.
- A traveler's photos, identification results, and album structure are visible only to that traveler's own account — no other user or operator can access them.
- The full core flow (upload, identify, save, organise) is accessible on the latest two major versions of mainstream mobile and desktop browsers without installing a native application.
- When the app cannot confidently identify a subject, the result is clearly marked as uncertain or unrecognised — it never presents a low-confidence guess as a verified fact.

## Business Logic

Given a photo, the app identifies its primary subject and surfaces factual contextual information about it.

The input is a photo uploaded by the traveler — no additional context or metadata is required from the user. The output is a subject name plus historical and cultural background: why the subject matters, when it was built or created, what it signifies. This is the "tour guide" layer — richer than a label, not a practical directory. The traveler encounters it immediately after upload as the identification result, which they can read, follow up on with questions, edit for accuracy, and then save alongside the photo.

## Access Control

Email/password login; no OAuth. Flat user model — every account is equal, no role separation. Each user owns and sees only their own photos and albums. Unauthenticated users cannot access any content; sign-up creates a new account.

## Non-Goals

- No real-time / live camera identification in v1 — the app works on existing photos only. Rationale: in-the-moment identification is a different use case and doubles the surface area.
- No social sharing or public albums — the archive is private. Rationale: the primary persona is building a personal record, not a shareable portfolio.
- No importing from cloud photo services (Google Photos, iCloud, Dropbox) in v1 — device upload only. Rationale: cloud-source integrations require per-provider OAuth and significantly widen scope.
- No in-house AI identification model — identification relies on an external AI service. Rationale: training or fine-tuning a recognition model is a separate product; using an external API is the right v1 trade-off.

## Open Questions

1. **GDPR and image-rights compliance** — Server-side photo storage requires a data retention policy, a right-to-deletion flow, and a privacy notice before public launch. Owner: user. Block: yes for public launch (not for private testing).
2. **Place/time tagging strategy for FR-008** — Should place (city/country) and time (month + year) come primarily from photo EXIF metadata, with AI-inferred fallback for photos without metadata? Or should AI inference be the primary path? Owner: user. Block: no (affects FR-008/FR-009 which are nice-to-have).
3. **Follow-up question context (FR-005)** — Does the AI retain the identification context between follow-up questions in a session (stateful), or does each question start fresh (stateless)? Stateful produces better answers but requires conversation memory in the backend. Owner: user. Block: no for v1 if stateless is acceptable.

## User & Persona

**Primary persona: The retrospective traveler**

An individual who has taken travel photos — landmarks, artwork, monuments, buildings — and wants to build a meaningful personal archive of what they saw. They're not looking to identify things in real time; they're sitting with an existing camera roll and trying to recover the context that was lost. They want the album to tell the story of their trips, organized around what they actually photographed, not just when or where they were.
