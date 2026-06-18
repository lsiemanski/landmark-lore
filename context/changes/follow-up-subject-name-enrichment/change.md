---
change_id: follow-up-subject-name-enrichment
title: Follow-up can correct the subject name, not just the description
status: complete
created: 2026-06-18
updated: 2026-06-18
---

## Problem

A follow-up exchange could enrich the photo's _description_ but never its
_subject name_ — so if the conversation established that the original
identification was wrong or imprecise, the stored/displayed name stayed stale.

## Change

Add an `updatedSubjectName` field to the follow-up result, set by the model only
when this exchange corrects or sharpens the subject (otherwise empty), and thread
it through the same path the enriched description already uses:

- **Prompt (`identify-prompts.yaml`)** — instructs the model to emit
  `updatedSubjectName` only on a genuine correction; empty string otherwise.
  JSON-shape hint updated to the 3-field object.
- **`answerFollowUp` (`follow-up.ts`)** — `FollowUpResultSchema` gains
  `updatedSubjectName`.
- **`POST /api/follow-up`** — persists the name only when it is non-empty _and_
  differs from the anchor's `subjectName`; returns it in the body when set.
- **`updateIdentification` (`src/lib/archive/photos.ts`)** — renamed from
  `updateIdentificationDescription`; now writes `description` and/or
  `subject_name` (only the fields provided).
- **Client** — `FollowUpChat` surfaces `onSubjectNameUpdate`; `UploadFlow`
  applies it to the in-memory result so a later Save carries the corrected name.

## Files

- `src/lib/ai/identify-prompts.yaml`
- `src/lib/ai/follow-up.ts`
- `src/pages/api/follow-up.ts`
- `src/lib/archive/photos.ts`
- `src/components/identify/{FollowUpChat,PostIdentifyPanel,UploadFlow}.tsx`
- `test/unit/{follow-up,follow-up-chat}.test.{ts,tsx}`

## Note

Threaded through files that also carry the rate-limit fix and the read-only
persistence redesign — see those change folders. The three were implemented in
one working session and could not be cleanly separated into independent commits
at file granularity (several files implement more than one concern).
