ALTER TABLE "assistants"
ADD COLUMN "draft_voice_profile" JSONB;

ALTER TABLE "assistant_published_versions"
ADD COLUMN "snapshot_voice_profile" JSONB;
