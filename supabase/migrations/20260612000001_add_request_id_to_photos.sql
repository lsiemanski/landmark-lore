ALTER TABLE photos
  ADD COLUMN IF NOT EXISTS request_id UUID;

CREATE UNIQUE INDEX IF NOT EXISTS idx_photos_user_request_id
  ON photos (user_id, request_id)
  WHERE request_id IS NOT NULL;
