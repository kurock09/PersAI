CREATE TABLE "workspace_media_monthly_quota_counters" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "workspace_id" UUID NOT NULL,
  "tool_code" VARCHAR(64) NOT NULL,
  "period_started_at" TIMESTAMPTZ(6) NOT NULL,
  "period_ends_at" TIMESTAMPTZ(6) NOT NULL,
  "reserved_units" INTEGER NOT NULL DEFAULT 0,
  "settled_units" INTEGER NOT NULL DEFAULT 0,
  "released_units" INTEGER NOT NULL DEFAULT 0,
  "reconciliation_required_units" INTEGER NOT NULL DEFAULT 0,
  "limit_units" INTEGER,
  "last_computed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "workspace_media_monthly_quota_counters_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "workspace_media_monthly_quota_counters_workspace_id_fkey"
    FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "workspace_media_monthly_quota_counters_workspace_tool_period_key"
  ON "workspace_media_monthly_quota_counters"("workspace_id", "tool_code", "period_started_at", "period_ends_at");

CREATE INDEX "workspace_media_monthly_quota_counters_workspace_period_idx"
  ON "workspace_media_monthly_quota_counters"("workspace_id", "period_started_at", "period_ends_at");

CREATE INDEX "workspace_media_monthly_quota_counters_workspace_tool_ends_idx"
  ON "workspace_media_monthly_quota_counters"("workspace_id", "tool_code", "period_ends_at");
