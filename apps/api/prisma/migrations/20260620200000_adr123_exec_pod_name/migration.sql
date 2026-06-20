-- ADR-123 Slice 1: add exec_pod_name to sandbox_jobs for exec pod tracking
ALTER TABLE "sandbox_jobs" ADD COLUMN "exec_pod_name" VARCHAR(128);
