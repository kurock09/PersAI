-- ADR-109 Slice 5b (E12): heygen_avatar_id is populated at persona creation time.
-- No production rows exist yet (Slice 5 just landed) so a defensive backfill is
-- safe and expected to affect zero rows in practice.
--
-- Defensive backfill: any existing rows with NULL get the sentinel value
-- 'unset_legacy'. Such a row will fall through to the defensive lazy-create path
-- inside HeyGenProviderClient.generateVideo on its first video render.

UPDATE "workspace_video_personas"
SET "heygen_avatar_id" = 'unset_legacy'
WHERE "heygen_avatar_id" IS NULL;

ALTER TABLE "workspace_video_personas"
  ALTER COLUMN "heygen_avatar_id" SET NOT NULL;
