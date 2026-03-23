-- CreateTable
CREATE TABLE "assistant_published_versions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "assistant_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "snapshot_display_name" TEXT,
    "snapshot_instructions" TEXT,
    "published_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assistant_published_versions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "assistant_published_versions_assistant_id_version_key" ON "assistant_published_versions"("assistant_id", "version");

-- AddForeignKey
ALTER TABLE "assistant_published_versions" ADD CONSTRAINT "assistant_published_versions_assistant_id_fkey" FOREIGN KEY ("assistant_id") REFERENCES "assistants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assistant_published_versions" ADD CONSTRAINT "assistant_published_versions_published_by_user_id_fkey" FOREIGN KEY ("published_by_user_id") REFERENCES "app_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateFunction
CREATE OR REPLACE FUNCTION reject_assistant_published_version_mutation()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'assistant_published_versions rows are immutable';
END;
$$ LANGUAGE plpgsql;

-- CreateTrigger
CREATE TRIGGER assistant_published_versions_no_update
BEFORE UPDATE ON "assistant_published_versions"
FOR EACH ROW
EXECUTE FUNCTION reject_assistant_published_version_mutation();

-- CreateTrigger
CREATE TRIGGER assistant_published_versions_no_delete
BEFORE DELETE ON "assistant_published_versions"
FOR EACH ROW
EXECUTE FUNCTION reject_assistant_published_version_mutation();
