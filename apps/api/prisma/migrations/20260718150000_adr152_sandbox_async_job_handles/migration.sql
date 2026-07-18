ALTER TYPE "AssistantAsyncJobHandleKind" ADD VALUE IF NOT EXISTS 'sandbox';
ALTER TYPE "sandbox_job_status" ADD VALUE IF NOT EXISTS 'detached';

ALTER TABLE "assistant_async_job_handles"
  ADD COLUMN "runtime_session_id" UUID;
