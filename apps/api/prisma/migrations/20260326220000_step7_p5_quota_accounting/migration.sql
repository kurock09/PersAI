-- CreateEnum
CREATE TYPE "WorkspaceQuotaDimension" AS ENUM (
  'token_budget',
  'cost_or_token_driving_tool_class',
  'active_web_chats_cap'
);

-- CreateTable
CREATE TABLE "workspace_quota_accounting_state" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL,
    "token_budget_used" BIGINT NOT NULL DEFAULT 0,
    "token_budget_limit" BIGINT,
    "cost_or_token_driving_tool_class_units_used" INTEGER NOT NULL DEFAULT 0,
    "cost_or_token_driving_tool_class_units_limit" INTEGER,
    "active_web_chats_current" INTEGER NOT NULL DEFAULT 0,
    "active_web_chats_limit" INTEGER,
    "last_computed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "workspace_quota_accounting_state_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workspace_quota_usage_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL,
    "assistant_id" UUID,
    "user_id" UUID,
    "dimension" "WorkspaceQuotaDimension" NOT NULL,
    "delta" BIGINT NOT NULL DEFAULT 0,
    "current_value" BIGINT,
    "limit_value" BIGINT,
    "source" VARCHAR(64) NOT NULL,
    "metadata" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workspace_quota_usage_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "workspace_quota_accounting_state_workspace_id_key"
ON "workspace_quota_accounting_state"("workspace_id");

-- CreateIndex
CREATE INDEX "workspace_quota_usage_events_workspace_id_dimension_created_at_idx"
ON "workspace_quota_usage_events"("workspace_id", "dimension", "created_at");

-- AddForeignKey
ALTER TABLE "workspace_quota_accounting_state"
ADD CONSTRAINT "workspace_quota_accounting_state_workspace_id_fkey"
FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_quota_usage_events"
ADD CONSTRAINT "workspace_quota_usage_events_workspace_id_fkey"
FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
