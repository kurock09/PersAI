-- ADR-090: Idle Re-Engagement Prod Hardening
-- Adds assistant_idle_evaluation_markers table as the durable per-(assistant, chat)
-- source of truth for idle re-engagement evaluation state.

CREATE TABLE "assistant_idle_evaluation_markers" (
    "id"                               UUID        NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id"                     UUID        NOT NULL,
    "assistant_id"                     UUID        NOT NULL,
    "chat_id"                          UUID        NOT NULL,
    "latest_user_message_at_snapshot"  TIMESTAMPTZ NOT NULL,
    "last_decision"                    VARCHAR(32) NOT NULL,
    "attempts_for_current_user_message" INTEGER    NOT NULL DEFAULT 0,
    "next_eligible_evaluation_at"      TIMESTAMPTZ,
    "created_at"                       TIMESTAMPTZ NOT NULL DEFAULT now(),
    "updated_at"                       TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT "assistant_idle_evaluation_markers_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "assistant_idle_evaluation_markers_assistant_id_chat_id_key"
    ON "assistant_idle_evaluation_markers" ("assistant_id", "chat_id");

CREATE INDEX "assistant_idle_evaluation_markers_assistant_id_idx"
    ON "assistant_idle_evaluation_markers" ("assistant_id");

CREATE INDEX "assistant_idle_evaluation_markers_workspace_id_idx"
    ON "assistant_idle_evaluation_markers" ("workspace_id");
