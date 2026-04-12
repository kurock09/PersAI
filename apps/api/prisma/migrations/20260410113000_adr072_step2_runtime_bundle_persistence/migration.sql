-- AlterTable
ALTER TABLE "assistant_materialized_specs"
ADD COLUMN "runtime_bundle" JSONB,
ADD COLUMN "runtime_bundle_document" TEXT,
ADD COLUMN "runtime_bundle_hash" TEXT;
