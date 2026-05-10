-- ADR-091 Session 1: Lease foundation for background schedulers
-- Adds scheduler_leases as the shared single-leader control plane for
-- idle re-engagement, background tasks, background compaction, and media jobs.

CREATE TABLE "scheduler_leases" (
    "scheduler_key"   VARCHAR(64)  NOT NULL,
    "holder_id"       VARCHAR(255) NOT NULL,
    "lease_token"     VARCHAR(128) NOT NULL,
    "expires_at"      TIMESTAMPTZ  NOT NULL,
    "last_heartbeat"  TIMESTAMPTZ  NOT NULL,
    "created_at"      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    "updated_at"      TIMESTAMPTZ  NOT NULL DEFAULT now(),

    CONSTRAINT "scheduler_leases_pkey" PRIMARY KEY ("scheduler_key")
);

CREATE INDEX "scheduler_leases_expires_at_idx"
    ON "scheduler_leases" ("expires_at");

INSERT INTO "scheduler_leases" (
    "scheduler_key",
    "holder_id",
    "lease_token",
    "expires_at",
    "last_heartbeat",
    "created_at",
    "updated_at"
)
VALUES
    ('idle_reengagement', '', '', NOW(), NOW(), NOW(), NOW()),
    ('background_task', '', '', NOW(), NOW(), NOW(), NOW()),
    ('background_compaction', '', '', NOW(), NOW(), NOW(), NOW()),
    ('media_job', '', '', NOW(), NOW(), NOW(), NOW())
ON CONFLICT ("scheduler_key") DO NOTHING;
