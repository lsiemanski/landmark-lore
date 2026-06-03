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
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  INSERT INTO public.folders (user_id, name)
  VALUES (NEW.id, 'Uncategorized');
  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION create_default_folder();
