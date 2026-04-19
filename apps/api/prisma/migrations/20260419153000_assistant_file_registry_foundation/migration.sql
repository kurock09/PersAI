-- Assistant file registry foundation
-- Introduces a canonical assistant-level file table and backfills it from sandbox-era refs.

CREATE TABLE IF NOT EXISTS "assistant_files" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "assistant_id" UUID NOT NULL,
  "workspace_id" UUID NOT NULL,
  "sandbox_job_id" UUID,
  "origin" "sandbox_file_origin" NOT NULL DEFAULT 'sandbox_output',
  "source_tool_code" VARCHAR(64),
  "object_key" VARCHAR(512) NOT NULL,
  "relative_path" VARCHAR(1024) NOT NULL,
  "display_name" VARCHAR(255),
  "mime_type" VARCHAR(255) NOT NULL,
  "size_bytes" BIGINT NOT NULL,
  "logical_size_bytes" BIGINT,
  "sha256" VARCHAR(128),
  "metadata" JSONB,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "assistant_files_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "assistant_files_assistant_id_fkey" FOREIGN KEY ("assistant_id") REFERENCES "assistants"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "assistant_files_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "assistant_files_sandbox_job_id_fkey" FOREIGN KEY ("sandbox_job_id") REFERENCES "sandbox_jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "assistant_files_assistant_id_workspace_id_origin_object_key_key"
ON "assistant_files"("assistant_id", "workspace_id", "origin", "object_key");

CREATE INDEX IF NOT EXISTS "assistant_files_assistant_id_created_at_idx"
ON "assistant_files"("assistant_id", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "assistant_files_workspace_id_created_at_idx"
ON "assistant_files"("workspace_id", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "assistant_files_assistant_id_relative_path_created_at_idx"
ON "assistant_files"("assistant_id", "relative_path", "created_at" DESC);

CREATE INDEX IF NOT EXISTS "assistant_files_sandbox_job_id_idx"
ON "assistant_files"("sandbox_job_id");

INSERT INTO "assistant_files" (
  "assistant_id",
  "workspace_id",
  "sandbox_job_id",
  "origin",
  "source_tool_code",
  "object_key",
  "relative_path",
  "display_name",
  "mime_type",
  "size_bytes",
  "logical_size_bytes",
  "sha256",
  "metadata",
  "created_at",
  "updated_at"
)
SELECT
  "assistant_id",
  "workspace_id",
  "sandbox_job_id",
  "origin",
  "source_tool_code",
  "object_key",
  "relative_path",
  "display_name",
  "mime_type",
  "size_bytes",
  "logical_size_bytes",
  "sha256",
  "metadata",
  "created_at",
  "created_at"
FROM "sandbox_file_refs"
ON CONFLICT ("assistant_id", "workspace_id", "origin", "object_key") DO NOTHING;
