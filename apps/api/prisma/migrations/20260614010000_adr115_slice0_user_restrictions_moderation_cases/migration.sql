-- ADR-115 Slice 0: user-wide safety restrictions and moderation case evidence.

CREATE TYPE "user_restriction_kind" AS ENUM ('safety', 'spam_global');
CREATE TYPE "user_restriction_status" AS ENUM ('active', 'cleared');
CREATE TYPE "user_restriction_source" AS ENUM ('moderation_auto', 'admin');
CREATE TYPE "moderation_case_decision" AS ENUM ('pending', 'allow', 'warn', 'block_user');

CREATE TABLE "user_restrictions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "kind" "user_restriction_kind" NOT NULL,
    "status" "user_restriction_status" NOT NULL DEFAULT 'active',
    "blocked_until" TIMESTAMPTZ(6),
    "reason_code" VARCHAR(128) NOT NULL,
    "source" "user_restriction_source" NOT NULL,
    "source_assistant_id" UUID,
    "source_moderation_case_id" UUID,
    "cleared_at" TIMESTAMPTZ(6),
    "cleared_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "user_restrictions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "moderation_cases" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "assistant_id" UUID,
    "chat_id" UUID,
    "surface" VARCHAR(64),
    "trigger_snapshot" JSONB NOT NULL DEFAULT '{}',
    "thread_snapshot" JSONB,
    "scores" JSONB,
    "decision" "moderation_case_decision" NOT NULL DEFAULT 'pending',
    "reason_code" VARCHAR(128),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "moderation_cases_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "user_restrictions_user_id_kind_key" ON "user_restrictions"("user_id", "kind");
CREATE INDEX "user_restrictions_status_kind_blocked_until_idx" ON "user_restrictions"("status", "kind", "blocked_until");
CREATE INDEX "moderation_cases_user_id_created_at_idx" ON "moderation_cases"("user_id", "created_at" DESC);

ALTER TABLE "user_restrictions" ADD CONSTRAINT "user_restrictions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "user_restrictions" ADD CONSTRAINT "user_restrictions_source_assistant_id_fkey" FOREIGN KEY ("source_assistant_id") REFERENCES "assistants"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "user_restrictions" ADD CONSTRAINT "user_restrictions_source_moderation_case_id_fkey" FOREIGN KEY ("source_moderation_case_id") REFERENCES "moderation_cases"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "user_restrictions" ADD CONSTRAINT "user_restrictions_cleared_by_user_id_fkey" FOREIGN KEY ("cleared_by_user_id") REFERENCES "app_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "moderation_cases" ADD CONSTRAINT "moderation_cases_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "app_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "moderation_cases" ADD CONSTRAINT "moderation_cases_assistant_id_fkey" FOREIGN KEY ("assistant_id") REFERENCES "assistants"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "moderation_cases" ADD CONSTRAINT "moderation_cases_chat_id_fkey" FOREIGN KEY ("chat_id") REFERENCES "assistant_chats"("id") ON DELETE SET NULL ON UPDATE CASCADE;
