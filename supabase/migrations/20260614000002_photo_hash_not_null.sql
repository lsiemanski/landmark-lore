-- Remove rows without a hash (test data predating the photo_hash column).
-- identifications rows reference photos via FK; delete child rows first.
DELETE FROM identifications
  WHERE photo_id IN (SELECT id FROM photos WHERE photo_hash IS NULL);

DELETE FROM photos WHERE photo_hash IS NULL;

ALTER TABLE photos ALTER COLUMN photo_hash SET NOT NULL;
