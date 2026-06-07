-- ADR-111 Slice 3: workspace-scoped HeyGen cloned voice substrate.

ALTER TABLE "platform_runtime_provider_settings"
  ADD COLUMN "heygen_voice_clone_workspace_limit" INTEGER NOT NULL DEFAULT 5,
  ADD COLUMN "heygen_voice_clone_creation_vcoin" INTEGER NOT NULL DEFAULT 50;

CREATE TYPE "WorkspaceVideoClonedVoiceStatus" AS ENUM ('pending', 'ready', 'failed');

CREATE TABLE "workspace_video_cloned_voices" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "workspace_id" UUID NOT NULL,
  "display_name" VARCHAR(80) NOT NULL,
  "display_name_lower" VARCHAR(80) NOT NULL,
  "heygen_voice_clone_id" VARCHAR(128),
  "language_hint" VARCHAR(32),
  "status" "WorkspaceVideoClonedVoiceStatus" NOT NULL DEFAULT 'pending',
  "is_default" BOOLEAN NOT NULL DEFAULT false,
  "preview_audio_url" TEXT,
  "source_metadata" JSONB NOT NULL DEFAULT '{}',
  "archived" BOOLEAN NOT NULL DEFAULT false,
  "archived_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "workspace_video_cloned_voices_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "workspace_video_cloned_voices_workspace_id_fkey"
    FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "uniq_workspace_video_cloned_voice_name"
  ON "workspace_video_cloned_voices"("workspace_id", "display_name_lower");

CREATE INDEX "workspace_video_cloned_voices_workspace_id_archived_idx"
  ON "workspace_video_cloned_voices"("workspace_id", "archived");

CREATE INDEX "workspace_video_cloned_voices_workspace_id_status_idx"
  ON "workspace_video_cloned_voices"("workspace_id", "status");
