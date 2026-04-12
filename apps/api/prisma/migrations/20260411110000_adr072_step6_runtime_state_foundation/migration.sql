CREATE TYPE "RuntimeTier" AS ENUM (
  'free_shared_restricted',
  'paid_shared_restricted',
  'paid_isolated'
);

CREATE TYPE "RuntimeConversationChannel" AS ENUM (
  'web',
  'telegram',
  'max_ru'
);

CREATE TYPE "RuntimeConversationMode" AS ENUM (
  'direct',
  'group'
);

CREATE TYPE "RuntimeTurnReceiptStatus" AS ENUM (
  'accepted',
  'completed',
  'interrupted',
  'failed'
);

CREATE TABLE "runtime_bundle_states" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "assistant_id" UUID NOT NULL,
  "workspace_id" UUID NOT NULL,
  "materialized_spec_id" UUID NOT NULL,
  "published_version_id" UUID NOT NULL,
  "runtime_tier" "RuntimeTier" NOT NULL,
  "bundle_hash" VARCHAR(64) NOT NULL,
  "last_warmed_at" TIMESTAMPTZ(6),
  "invalidated_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "runtime_bundle_states_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "runtime_bundle_states_materialized_spec_id_key" UNIQUE ("materialized_spec_id"),
  CONSTRAINT "runtime_bundle_states_published_version_id_key" UNIQUE ("published_version_id"),
  CONSTRAINT "runtime_bundle_states_assistant_id_fkey" FOREIGN KEY ("assistant_id") REFERENCES "assistants"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "runtime_bundle_states_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "runtime_bundle_states_materialized_spec_id_fkey" FOREIGN KEY ("materialized_spec_id") REFERENCES "assistant_materialized_specs"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "runtime_bundle_states_published_version_id_fkey" FOREIGN KEY ("published_version_id") REFERENCES "assistant_published_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "runtime_sessions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "assistant_id" UUID NOT NULL,
  "workspace_id" UUID NOT NULL,
  "current_published_version_id" UUID,
  "runtime_tier" "RuntimeTier" NOT NULL,
  "conversation_key" VARCHAR(64) NOT NULL,
  "channel" "RuntimeConversationChannel" NOT NULL,
  "external_thread_key" VARCHAR(255) NOT NULL,
  "external_user_key" VARCHAR(255),
  "mode" "RuntimeConversationMode" NOT NULL,
  "current_bundle_hash" VARCHAR(64),
  "current_tokens" INTEGER,
  "total_tokens_fresh" BOOLEAN NOT NULL DEFAULT true,
  "compaction_count" INTEGER NOT NULL DEFAULT 0,
  "compaction_hint_tokens" INTEGER,
  "provider_key" VARCHAR(64),
  "model_key" VARCHAR(256),
  "last_turn_at" TIMESTAMPTZ(6),
  "closed_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "runtime_sessions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "runtime_sessions_conversation_key_key" UNIQUE ("conversation_key"),
  CONSTRAINT "runtime_sessions_assistant_id_fkey" FOREIGN KEY ("assistant_id") REFERENCES "assistants"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "runtime_sessions_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "runtime_sessions_current_published_version_id_fkey" FOREIGN KEY ("current_published_version_id") REFERENCES "assistant_published_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "runtime_session_compactions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "runtime_session_id" UUID NOT NULL,
  "assistant_id" UUID NOT NULL,
  "workspace_id" UUID NOT NULL,
  "request_id" VARCHAR(128),
  "reason" VARCHAR(128),
  "instructions" TEXT,
  "summary_payload" JSONB,
  "tokens_before" INTEGER,
  "tokens_after" INTEGER,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "runtime_session_compactions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "runtime_session_compactions_runtime_session_id_fkey" FOREIGN KEY ("runtime_session_id") REFERENCES "runtime_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "runtime_session_compactions_assistant_id_fkey" FOREIGN KEY ("assistant_id") REFERENCES "assistants"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "runtime_session_compactions_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "runtime_turn_receipts" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "assistant_id" UUID NOT NULL,
  "workspace_id" UUID NOT NULL,
  "runtime_session_id" UUID,
  "published_version_id" UUID,
  "runtime_tier" "RuntimeTier" NOT NULL,
  "conversation_key" VARCHAR(64) NOT NULL,
  "channel" "RuntimeConversationChannel" NOT NULL,
  "external_thread_key" VARCHAR(255) NOT NULL,
  "external_user_key" VARCHAR(255),
  "mode" "RuntimeConversationMode" NOT NULL,
  "request_id" VARCHAR(128) NOT NULL,
  "idempotency_key" VARCHAR(128) NOT NULL,
  "bundle_hash" VARCHAR(64),
  "status" "RuntimeTurnReceiptStatus" NOT NULL DEFAULT 'accepted',
  "result_payload" JSONB,
  "error_code" VARCHAR(128),
  "error_message" TEXT,
  "completed_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "runtime_turn_receipts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "runtime_turn_receipts_request_id_key" UNIQUE ("request_id"),
  CONSTRAINT "runtime_turn_receipts_conversation_key_idempotency_key_key" UNIQUE ("conversation_key", "idempotency_key"),
  CONSTRAINT "runtime_turn_receipts_assistant_id_fkey" FOREIGN KEY ("assistant_id") REFERENCES "assistants"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "runtime_turn_receipts_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "runtime_turn_receipts_runtime_session_id_fkey" FOREIGN KEY ("runtime_session_id") REFERENCES "runtime_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "runtime_turn_receipts_published_version_id_fkey" FOREIGN KEY ("published_version_id") REFERENCES "assistant_published_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "runtime_bundle_states_assistant_id_updated_at_idx"
ON "runtime_bundle_states"("assistant_id", "updated_at" DESC);

CREATE INDEX "runtime_bundle_states_workspace_id_invalidated_at_idx"
ON "runtime_bundle_states"("workspace_id", "invalidated_at");

CREATE INDEX "runtime_sessions_assistant_id_updated_at_idx"
ON "runtime_sessions"("assistant_id", "updated_at" DESC);

CREATE INDEX "runtime_sessions_workspace_id_updated_at_idx"
ON "runtime_sessions"("workspace_id", "updated_at" DESC);

CREATE INDEX "runtime_sessions_assistant_id_channel_updated_at_idx"
ON "runtime_sessions"("assistant_id", "channel", "updated_at" DESC);

CREATE INDEX "runtime_session_compactions_runtime_session_id_created_at_idx"
ON "runtime_session_compactions"("runtime_session_id", "created_at" DESC);

CREATE INDEX "runtime_session_compactions_assistant_id_created_at_idx"
ON "runtime_session_compactions"("assistant_id", "created_at" DESC);

CREATE INDEX "runtime_turn_receipts_assistant_id_created_at_idx"
ON "runtime_turn_receipts"("assistant_id", "created_at" DESC);

CREATE INDEX "runtime_turn_receipts_runtime_session_id_created_at_idx"
ON "runtime_turn_receipts"("runtime_session_id", "created_at" DESC);
