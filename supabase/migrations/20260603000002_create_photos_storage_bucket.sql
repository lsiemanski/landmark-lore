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
