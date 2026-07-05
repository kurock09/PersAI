-- ADR-138 Slice S0 — assistant browser profile persistence foundation.

CREATE TYPE "AssistantBrowserProfileStatus" AS ENUM ('pending_login', 'active', 'expired');

CREATE TABLE "assistant_browser_profiles" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "assistant_id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "profile_key" VARCHAR(128) NOT NULL,
    "display_name" VARCHAR(500) NOT NULL,
    "login_url" TEXT NOT NULL,
    "origin_host" VARCHAR(255) NOT NULL,
    "provider_session_id" VARCHAR(512) NOT NULL,
    "status" "AssistantBrowserProfileStatus" NOT NULL,
    "last_used_at" TIMESTAMPTZ(6),
    "expires_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "assistant_browser_profiles_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "assistant_browser_profiles_assistant_id_profile_key_key"
ON "assistant_browser_profiles"("assistant_id", "profile_key");

CREATE INDEX "assistant_browser_profiles_assistant_id_status_idx"
ON "assistant_browser_profiles"("assistant_id", "status");

CREATE INDEX "assistant_browser_profiles_status_expires_at_idx"
ON "assistant_browser_profiles"("status", "expires_at");

ALTER TABLE "assistant_browser_profiles" ADD CONSTRAINT "assistant_browser_profiles_assistant_id_fkey"
FOREIGN KEY ("assistant_id") REFERENCES "assistants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "assistant_browser_profiles" ADD CONSTRAINT "assistant_browser_profiles_workspace_id_fkey"
FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
