ALTER TABLE "assistants"
ADD COLUMN "draft_assistant_gender" VARCHAR(32);

ALTER TABLE "assistant_published_versions"
ADD COLUMN "snapshot_assistant_gender" VARCHAR(32);
