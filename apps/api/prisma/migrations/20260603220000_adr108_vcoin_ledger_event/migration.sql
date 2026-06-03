-- ADR-108 Slice 3: monthly-grant idempotency surface (workspace_vcoin_ledger_events).
--
-- This migration introduces `workspace_vcoin_ledger_events` as an append-only
-- VC ledger that:
--   - serves as the idempotency gate for monthly grants via the UNIQUE constraint
--     on (workspace_id, kind, reference_key). A P2002 on insert means the grant
--     was already applied for this (workspace, kind, reference_key) triple.
--   - stores `kind` as a discriminator. Slice 3 only writes `kind = "monthly_grant"`.
--     Slice 4 will add `package_purchase` / `package_refund`; future slices may
--     add `manual`.
--   - stores signed `amount_vc` (positive = credit; future debit entries would be
--     negative — Slice 3 only writes positive values).
--   - is intentionally separate from `model_cost_ledger_events` (USD COGS ledger).
--     Cross-slice invariant 2 of ADR-108 requires `model_cost_ledger_events` to
--     remain unchanged in shape and write site throughout the ADR-108 program.
--     This new table is independent of and parallel to the USD COGS ledger.
--
-- Reference-key semantics (documented here for future audit):
--   - kind = "monthly_grant": reference_key is the ISO 8601 UTC string of
--     periodStartedAt (e.g. "2026-06-01T00:00:00.000Z"). This makes the unique
--     constraint equivalent to "one grant per workspace per billing period start".

CREATE TABLE "workspace_vcoin_ledger_events" (
    "id"            UUID            NOT NULL DEFAULT gen_random_uuid(),
    "workspace_id"  UUID            NOT NULL,
    "kind"          TEXT            NOT NULL,
    "amount_vc"     INTEGER         NOT NULL,
    "reference_key" TEXT            NOT NULL,
    "plan_code"     TEXT,
    "created_at"    TIMESTAMPTZ(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workspace_vcoin_ledger_events_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "workspace_vcoin_ledger_events"
    ADD CONSTRAINT "workspace_vcoin_ledger_events_workspace_id_fkey"
    FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- This UNIQUE index IS the idempotency surface. P2002 on insert means
-- "already granted for this (workspace, kind, reference_key)".
CREATE UNIQUE INDEX "uniq_workspace_vcoin_ledger_event_kind_ref"
    ON "workspace_vcoin_ledger_events"("workspace_id", "kind", "reference_key");

-- Secondary index for per-workspace per-kind history queries.
CREATE INDEX "workspace_vcoin_ledger_events_workspace_id_kind_idx"
    ON "workspace_vcoin_ledger_events"("workspace_id", "kind");
