-- ADR-109 Slice 5 — add HeyGen persona runtime knobs to platform settings table.
ALTER TABLE "platform_runtime_provider_settings"
  ADD COLUMN IF NOT EXISTS "heygen_persona_workspace_limit" INTEGER NOT NULL DEFAULT 10,
  ADD COLUMN IF NOT EXISTS "heygen_persona_creation_vcoin" INTEGER NOT NULL DEFAULT 20;

-- ADR-109 Slice 5 — workspace video persona registry.
CREATE TABLE "workspace_video_personas" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id" UUID NOT NULL,
    "display_name" VARCHAR(80) NOT NULL,
    "display_name_lower" VARCHAR(80) NOT NULL,
    "portrait_image_url" TEXT NOT NULL,
    "portrait_image_storage_key" TEXT NOT NULL,
    "heygen_voice_id" VARCHAR(128) NOT NULL,
    "heygen_voice_label" VARCHAR(120) NOT NULL,
    "heygen_avatar_id" VARCHAR(128),
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "archived_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "workspace_video_personas_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "uniq_workspace_video_persona_name" ON "workspace_video_personas"("workspace_id", "display_name_lower");

CREATE INDEX "workspace_video_personas_workspace_id_archived_idx" ON "workspace_video_personas"("workspace_id", "archived");

ALTER TABLE "workspace_video_personas" ADD CONSTRAINT "workspace_video_personas_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
