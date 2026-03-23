-- CreateEnum
CREATE TYPE "AssistantMaterializationSourceAction" AS ENUM ('publish', 'rollback', 'reset');

-- CreateTable
CREATE TABLE "assistant_materialized_specs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "assistant_id" UUID NOT NULL,
    "published_version_id" UUID NOT NULL,
    "source_action" "AssistantMaterializationSourceAction" NOT NULL,
    "algorithm_version" INTEGER NOT NULL DEFAULT 1,
    "layers" JSONB NOT NULL,
    "openclaw_bootstrap" JSONB NOT NULL,
    "openclaw_workspace" JSONB NOT NULL,
    "layers_document" TEXT NOT NULL,
    "openclaw_bootstrap_document" TEXT NOT NULL,
    "openclaw_workspace_document" TEXT NOT NULL,
    "content_hash" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "assistant_materialized_specs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "assistant_materialized_specs_published_version_id_key" ON "assistant_materialized_specs"("published_version_id");

-- AddForeignKey
ALTER TABLE "assistant_materialized_specs" ADD CONSTRAINT "assistant_materialized_specs_assistant_id_fkey" FOREIGN KEY ("assistant_id") REFERENCES "assistants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assistant_materialized_specs" ADD CONSTRAINT "assistant_materialized_specs_published_version_id_fkey" FOREIGN KEY ("published_version_id") REFERENCES "assistant_published_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
