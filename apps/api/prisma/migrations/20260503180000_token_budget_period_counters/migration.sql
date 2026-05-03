CREATE TABLE "workspace_token_budget_period_counters" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "workspace_id" UUID NOT NULL,
  "period_started_at" TIMESTAMPTZ(6) NOT NULL,
  "period_ends_at" TIMESTAMPTZ(6) NOT NULL,
  "used_credits" BIGINT NOT NULL DEFAULT 0,
  "limit_credits" BIGINT,
  "last_computed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "workspace_token_budget_period_counters_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "workspace_token_budget_period_counters_workspace_id_fkey"
    FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "workspace_token_budget_period_counters_workspace_period_key"
  ON "workspace_token_budget_period_counters"("workspace_id", "period_started_at", "period_ends_at");

CREATE INDEX "workspace_token_budget_period_counters_workspace_ends_idx"
  ON "workspace_token_budget_period_counters"("workspace_id", "period_ends_at");