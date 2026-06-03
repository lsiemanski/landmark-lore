# Lessons Learned

> Append-only register of recurring rules and patterns. Re-read at start by /10x-frame, /10x-research, /10x-plan, /10x-plan-review, /10x-implement, /10x-impl-review.

## Name migration files descriptively

- **Context**: Any phase that creates Supabase migration files
- **Problem**: The schema migration names are unreadable and don't give any context on what is being done (e.g. `_schema.sql`, `_storage.sql` say nothing about the tables or actions involved).
- **Rule**: Name the migration file so its suffix describes the purpose — e.g. `_create_folders_photos_identifications.sql` or `_add_photos_storage_bucket.sql`, not `_schema.sql`.
- **Applies to**: plan, implement
