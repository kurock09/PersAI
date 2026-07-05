-- ADR-138 P0 — chat-scoped pending browser login.

ALTER TABLE "assistant_browser_profiles" ADD COLUMN "originating_chat_id" UUID;

CREATE INDEX "assistant_browser_profiles_assistant_id_originating_chat_id_status_idx"
  ON "assistant_browser_profiles" ("assistant_id", "originating_chat_id", "status");
