-- ADR-108 Slice 1: schema + platform contract for Vcoin (VC) wallet.
-- This migration is platform-contract carrying only. It introduces the
-- workspace-scoped VC wallet table (`workspace_vcoin_balances`) plus the
-- platform-level integer exchange-rate column on
-- `platform_runtime_provider_settings` so subsequent slices can wire the
-- actual debit / credit paths. No behavioral runtime change here.
--
-- ADR-108 cross-slice invariants enforced by this migration:
--   - `balance_vc` is integer (no fractional VC anywhere).
--   - exchange rate is a single platform-level numeric field (not plan-scoped).
--   - `videoGenerateMonthlyUnitsLimit` is intentionally NOT removed (kept
--     for one release cycle as rollback insurance per ADR-108 Non-goals).

-- 1. Workspace VC wallet table.
CREATE TABLE "workspace_vcoin_balances" (
    "workspace_id" UUID NOT NULL,
    "balance_vc"   INTEGER NOT NULL DEFAULT 0,
    "created_at"   TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"   TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "workspace_vcoin_balances_pkey" PRIMARY KEY ("workspace_id")
);

ALTER TABLE "workspace_vcoin_balances"
    ADD CONSTRAINT "workspace_vcoin_balances_workspace_id_fkey"
    FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- 2. Platform-level Vcoin exchange rate. Default 20 means `1 USD = 20 VC`
-- (i.e. `1 VC = $0.05`). Existing rows get the default backfilled atomically
-- by the NOT NULL + DEFAULT clause; new admin saves round-trip the value
-- through `PlatformRuntimeProviderSettingsState.vcoinExchangeRate`.
ALTER TABLE "platform_runtime_provider_settings"
    ADD COLUMN "vcoin_exchange_rate" INTEGER NOT NULL DEFAULT 20;
