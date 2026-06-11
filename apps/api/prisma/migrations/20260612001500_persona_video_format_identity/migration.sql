-- Persona video format becomes part of avatar identity.
-- Historical personas were normalized to square 1024x1024 portraits, so a
-- clean backfill to 1:1 matches the real persisted avatar substrate.

ALTER TABLE "workspace_video_personas"
  ADD COLUMN "video_format" VARCHAR(8);

UPDATE "workspace_video_personas"
SET "video_format" = '1:1'
WHERE "video_format" IS NULL;

ALTER TABLE "workspace_video_personas"
  ALTER COLUMN "video_format" SET NOT NULL;
