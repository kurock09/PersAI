-- AlterTable: add daily_call_limit to plan_catalog_tool_activations
ALTER TABLE "plan_catalog_tool_activations" ADD COLUMN "daily_call_limit" INTEGER;

-- AlterTable: widen provider_key column to accommodate tool credential keys
ALTER TABLE "platform_runtime_provider_secrets" ALTER COLUMN "provider_key" TYPE VARCHAR(64);

-- CreateTable
CREATE TABLE "workspace_tool_usage_daily_counters" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL,
    "tool_code" VARCHAR(64) NOT NULL,
    "date" DATE NOT NULL,
    "call_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "workspace_tool_usage_daily_counters_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "workspace_tool_usage_daily_counters_workspace_id_tool_code_da_key" ON "workspace_tool_usage_daily_counters"("workspace_id", "tool_code", "date");

-- CreateIndex
CREATE INDEX "workspace_tool_usage_daily_counters_workspace_id_date_idx" ON "workspace_tool_usage_daily_counters"("workspace_id", "date");

-- AddForeignKey
ALTER TABLE "workspace_tool_usage_daily_counters" ADD CONSTRAINT "workspace_tool_usage_daily_counters_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
