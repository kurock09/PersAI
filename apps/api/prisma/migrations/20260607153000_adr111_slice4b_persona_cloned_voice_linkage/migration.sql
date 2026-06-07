-- ADR-111 Slice 4b — allow workspace video personas to link a workspace-scoped
-- cloned voice while preserving the existing preset HeyGen fallback fields.

ALTER TABLE "workspace_video_cloned_voices"
  ADD CONSTRAINT "uniq_workspace_video_cloned_voice_workspace_id_id"
  UNIQUE ("workspace_id", "id");

ALTER TABLE "workspace_video_personas"
  ADD COLUMN "cloned_voice_id" UUID;

CREATE INDEX "workspace_video_personas_workspace_id_cloned_voice_id_idx"
  ON "workspace_video_personas"("workspace_id", "cloned_voice_id");

ALTER TABLE "workspace_video_personas"
  ADD CONSTRAINT "workspace_video_personas_workspace_id_cloned_voice_id_fkey"
  FOREIGN KEY ("workspace_id", "cloned_voice_id")
  REFERENCES "workspace_video_cloned_voices"("workspace_id", "id")
  ON DELETE RESTRICT
  ON UPDATE CASCADE;
