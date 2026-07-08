ALTER TABLE "assistant_browser_profiles"
  ADD COLUMN "bridge_session_ref" TEXT,
  ADD COLUMN "bridge_client_kind" TEXT;

UPDATE "assistant_browser_profiles"
SET
  "status" = 'expired',
  "bridge_session_ref" = NULL,
  "bridge_client_kind" = NULL;

ALTER TABLE "assistant_browser_profiles"
  DROP COLUMN "provider_session_id",
  DROP COLUMN "live_url";

CREATE INDEX "assistant_browser_profiles_bridge_session_ref_idx"
  ON "assistant_browser_profiles"("bridge_session_ref");
