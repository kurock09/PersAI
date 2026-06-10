-- ADR-114 Slice 1 — live voice session substrate.
-- Durable session/control state only: no transcript bridge, no action tool execution.

CREATE TYPE "AssistantLiveVoiceSessionStatus" AS ENUM ('active', 'stopped', 'failed');
CREATE TYPE "AssistantLiveVoiceTransportProtocol" AS ENUM ('webrtc', 'websocket');
CREATE TYPE "AssistantLiveVoiceTransportRoute" AS ENUM ('direct', 'relay');

ALTER TABLE "platform_runtime_provider_settings"
ADD COLUMN "live_voice_settings" JSONB NOT NULL DEFAULT '{}';

CREATE TABLE "assistant_live_voice_sessions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "assistant_id" UUID NOT NULL,
  "workspace_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "chat_id" UUID NOT NULL,
  "status" "AssistantLiveVoiceSessionStatus" NOT NULL DEFAULT 'active',
  "transport_protocol" "AssistantLiveVoiceTransportProtocol" NOT NULL,
  "transport_route" "AssistantLiveVoiceTransportRoute" NOT NULL,
  "elevenlabs_agent_id" VARCHAR(128) NOT NULL,
  "elevenlabs_voice_id" VARCHAR(128) NOT NULL,
  "local_duration_ms" INTEGER,
  "failure_code" VARCHAR(128),
  "failure_message" TEXT,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "started_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "stopped_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "assistant_live_voice_sessions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "assistant_live_voice_sessions_assistant_id_fkey"
    FOREIGN KEY ("assistant_id") REFERENCES "assistants"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "assistant_live_voice_sessions_workspace_id_fkey"
    FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "assistant_live_voice_sessions_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "app_users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "assistant_live_voice_sessions_workspace_member_fkey"
    FOREIGN KEY ("workspace_id", "user_id") REFERENCES "workspace_members"("workspace_id", "user_id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "assistant_live_voice_sessions_chat_id_assistant_id_fkey"
    FOREIGN KEY ("chat_id", "assistant_id") REFERENCES "assistant_chats"("id", "assistant_id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "assistant_live_voice_sessions_assistant_id_chat_id_status_idx"
  ON "assistant_live_voice_sessions"("assistant_id", "chat_id", "status");

CREATE INDEX "assistant_live_voice_sessions_workspace_id_started_at_idx"
  ON "assistant_live_voice_sessions"("workspace_id", "started_at" DESC);

CREATE INDEX "assistant_live_voice_sessions_chat_id_started_at_idx"
  ON "assistant_live_voice_sessions"("chat_id", "started_at" DESC);
