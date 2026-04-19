-- Assistant workspace lease foundation
-- Adds a multi-pod-safe lease row per assistant workspace for sandbox execution.

CREATE TABLE IF NOT EXISTS "assistant_workspace_leases" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "assistant_id" UUID NOT NULL,
  "workspace_id" UUID NOT NULL,
  "sandbox_job_id" UUID,
  "lease_token" VARCHAR(128) NOT NULL,
  "holder_id" VARCHAR(255) NOT NULL,
  "expires_at" TIMESTAMPTZ(6) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "assistant_workspace_leases_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "assistant_workspace_leases_assistant_id_fkey" FOREIGN KEY ("assistant_id") REFERENCES "assistants"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "assistant_workspace_leases_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "assistant_workspace_leases_sandbox_job_id_fkey" FOREIGN KEY ("sandbox_job_id") REFERENCES "sandbox_jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "assistant_workspace_leases_assistant_id_workspace_id_key"
ON "assistant_workspace_leases"("assistant_id", "workspace_id");

CREATE INDEX IF NOT EXISTS "assistant_workspace_leases_expires_at_idx"
ON "assistant_workspace_leases"("expires_at");

CREATE INDEX IF NOT EXISTS "assistant_workspace_leases_sandbox_job_id_idx"
ON "assistant_workspace_leases"("sandbox_job_id");
