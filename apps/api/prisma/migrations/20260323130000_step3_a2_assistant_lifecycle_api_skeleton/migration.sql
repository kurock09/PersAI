-- AlterTable
ALTER TABLE "assistants"
ADD COLUMN "draft_display_name" TEXT,
ADD COLUMN "draft_instructions" TEXT,
ADD COLUMN "draft_updated_at" TIMESTAMPTZ(6);
