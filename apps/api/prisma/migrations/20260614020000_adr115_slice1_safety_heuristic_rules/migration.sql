-- ADR-115 Slice 1: contour-1 heuristic rules, policy settings, moderation review job queue.

CREATE TYPE "safety_heuristic_pack" AS ENUM (
  'violence_extremism_explicit',
  'hack_abuse_request',
  'unsolicited_adult_spam',
  'structural_abuse_signal'
);
CREATE TYPE "safety_heuristic_locale" AS ENUM ('any', 'ru', 'en');
CREATE TYPE "safety_heuristic_pattern_type" AS ENUM ('literal', 'regex');
CREATE TYPE "safety_moderation_review_job_status" AS ENUM ('pending', 'processing', 'completed', 'failed');

CREATE TABLE "safety_heuristic_rules" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "signal_id" VARCHAR(128) NOT NULL,
    "pack" "safety_heuristic_pack" NOT NULL,
    "locale" "safety_heuristic_locale" NOT NULL DEFAULT 'any',
    "pattern_type" "safety_heuristic_pattern_type" NOT NULL DEFAULT 'literal',
    "pattern" TEXT NOT NULL,
    "weight" INTEGER NOT NULL DEFAULT 3,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "safety_heuristic_rules_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "safety_policy_settings" (
    "id" VARCHAR(64) NOT NULL,
    "sync_hold_timeout_ms" INTEGER NOT NULL DEFAULT 500,
    "instant_block_pack_allowlist" JSONB NOT NULL DEFAULT '[]',
    "moderation_model_id" VARCHAR(128) NOT NULL DEFAULT 'omni-moderation-latest',
    "contour2_enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "safety_policy_settings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "safety_moderation_review_jobs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "trigger_key" VARCHAR(255) NOT NULL,
    "user_id" UUID NOT NULL,
    "assistant_id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "chat_id" UUID,
    "surface" VARCHAR(64) NOT NULL,
    "surface_thread_key" VARCHAR(255),
    "message_snapshot" JSONB NOT NULL DEFAULT '{}',
    "precheck_outcome" JSONB NOT NULL DEFAULT '{}',
    "status" "safety_moderation_review_job_status" NOT NULL DEFAULT 'pending',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "safety_moderation_review_jobs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "safety_heuristic_rules_signal_id_key" ON "safety_heuristic_rules"("signal_id");
CREATE INDEX "safety_heuristic_rules_pack_enabled_idx" ON "safety_heuristic_rules"("pack", "enabled");
CREATE INDEX "safety_heuristic_rules_locale_enabled_idx" ON "safety_heuristic_rules"("locale", "enabled");

CREATE UNIQUE INDEX "safety_moderation_review_jobs_trigger_key_key" ON "safety_moderation_review_jobs"("trigger_key");
CREATE INDEX "safety_moderation_review_jobs_status_created_at_idx" ON "safety_moderation_review_jobs"("status", "created_at");
CREATE INDEX "safety_moderation_review_jobs_user_id_created_at_idx" ON "safety_moderation_review_jobs"("user_id", "created_at" DESC);

ALTER TABLE "safety_moderation_review_jobs" ADD CONSTRAINT "safety_moderation_review_jobs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "safety_moderation_review_jobs" ADD CONSTRAINT "safety_moderation_review_jobs_assistant_id_fkey" FOREIGN KEY ("assistant_id") REFERENCES "assistants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "safety_moderation_review_jobs" ADD CONSTRAINT "safety_moderation_review_jobs_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "safety_moderation_review_jobs" ADD CONSTRAINT "safety_moderation_review_jobs_chat_id_fkey" FOREIGN KEY ("chat_id") REFERENCES "assistant_chats"("id") ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "safety_policy_settings" ("id", "updated_at")
VALUES ('platform', CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;
