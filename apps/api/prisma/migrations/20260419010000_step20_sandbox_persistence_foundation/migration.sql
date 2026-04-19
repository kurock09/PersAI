-- Step 20: sandbox persistence foundation
-- Adds durable sandbox job and file-ref state for the isolated sandbox service.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type
    WHERE typname = 'sandbox_job_status'
  ) THEN
    CREATE TYPE "sandbox_job_status" AS ENUM (
      'queued',
      'running',
      'completed',
      'failed',
      'blocked',
      'cancelled'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type
    WHERE typname = 'sandbox_file_origin'
  ) THEN
    CREATE TYPE "sandbox_file_origin" AS ENUM (
      'sandbox_output',
      'runtime_output',
      'uploaded_attachment'
    );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "sandbox_jobs" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "assistant_id" UUID NOT NULL,
  "workspace_id" UUID NOT NULL,
  "runtime_request_id" VARCHAR(128),
  "runtime_session_id" UUID,
  "tool_code" VARCHAR(64) NOT NULL,
  "status" "sandbox_job_status" NOT NULL DEFAULT 'queued',
  "relative_workspace" VARCHAR(255),
  "policy_snapshot" JSONB,
  "request_payload" JSONB,
  "result_payload" JSONB,
  "resource_usage" JSONB,
  "violation_code" VARCHAR(128),
  "violation_message" TEXT,
  "started_at" TIMESTAMPTZ(6),
  "completed_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "sandbox_jobs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "sandbox_jobs_assistant_id_fkey" FOREIGN KEY ("assistant_id") REFERENCES "assistants"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "sandbox_jobs_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "sandbox_file_refs" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "assistant_id" UUID NOT NULL,
  "workspace_id" UUID NOT NULL,
  "sandbox_job_id" UUID,
  "origin" "sandbox_file_origin" NOT NULL DEFAULT 'sandbox_output',
  "source_tool_code" VARCHAR(64),
  "object_key" VARCHAR(512) NOT NULL,
  "relative_path" VARCHAR(512) NOT NULL,
  "display_name" VARCHAR(255),
  "mime_type" VARCHAR(128) NOT NULL,
  "size_bytes" BIGINT NOT NULL,
  "logical_size_bytes" BIGINT,
  "sha256" VARCHAR(64),
  "metadata" JSONB,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "sandbox_file_refs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "sandbox_file_refs_assistant_id_fkey" FOREIGN KEY ("assistant_id") REFERENCES "assistants"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "sandbox_file_refs_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "sandbox_file_refs_sandbox_job_id_fkey" FOREIGN KEY ("sandbox_job_id") REFERENCES "sandbox_jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "sandbox_jobs_assistant_id_created_at_idx"
ON "sandbox_jobs"("assistant_id", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "sandbox_jobs_workspace_id_created_at_idx"
ON "sandbox_jobs"("workspace_id", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "sandbox_jobs_runtime_request_id_idx"
ON "sandbox_jobs"("runtime_request_id");

CREATE INDEX IF NOT EXISTS "sandbox_file_refs_assistant_id_created_at_idx"
ON "sandbox_file_refs"("assistant_id", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "sandbox_file_refs_workspace_id_created_at_idx"
ON "sandbox_file_refs"("workspace_id", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "sandbox_file_refs_sandbox_job_id_idx"
ON "sandbox_file_refs"("sandbox_job_id");
