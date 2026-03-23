-- CreateEnum
CREATE TYPE "AssistantIntegrationProviderKey" AS ENUM (
  'web_internal',
  'telegram',
  'whatsapp',
  'max',
  'system_notifications'
);

-- CreateEnum
CREATE TYPE "AssistantIntegrationSurfaceType" AS ENUM (
  'web_chat',
  'telegram_bot',
  'whatsapp_business',
  'max_bot',
  'max_mini_app',
  'system_notification'
);

-- CreateEnum
CREATE TYPE "AssistantChannelBindingState" AS ENUM (
  'active',
  'inactive',
  'unconfigured'
);

-- CreateTable
CREATE TABLE "assistant_channel_surface_bindings" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "assistant_id" UUID NOT NULL,
  "provider_key" "AssistantIntegrationProviderKey" NOT NULL,
  "surface_type" "AssistantIntegrationSurfaceType" NOT NULL,
  "binding_state" "AssistantChannelBindingState" NOT NULL DEFAULT 'unconfigured',
  "token_fingerprint" VARCHAR(128),
  "token_last_four" VARCHAR(4),
  "policy" JSONB,
  "config" JSONB,
  "metadata" JSONB,
  "connected_at" TIMESTAMPTZ(6),
  "disconnected_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "assistant_channel_surface_bindings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "assistant_channel_surface_bindings_assistant_id_provider_key_surface_key"
ON "assistant_channel_surface_bindings"("assistant_id", "provider_key", "surface_type");

-- CreateIndex
CREATE INDEX "assistant_channel_surface_bindings_assistant_id_provider_key_binding_st_idx"
ON "assistant_channel_surface_bindings"("assistant_id", "provider_key", "binding_state");

-- AddForeignKey
ALTER TABLE "assistant_channel_surface_bindings"
ADD CONSTRAINT "assistant_channel_surface_bindings_assistant_id_fkey"
FOREIGN KEY ("assistant_id") REFERENCES "assistants"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
