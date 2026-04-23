-- ADR-074 Slice L1 — Per-plan override for tool per-turn hard cap.
--
-- Adds the `per_turn_cap` column to `plan_catalog_tool_activations` so the
-- founder/admin can tune the per-turn hard cap on cost-driving tools
-- (web_fetch, web_search, image/video) without a runtime code change.
--
-- Resolution order at runtime (see ToolBudgetPolicy):
--
--   1. Bundle-side `RuntimeToolPolicy.perTurnCap` (this column, after the
--      bundle compile pipeline copies it into the per-tool policy).
--   2. `TOOL_HARD_CAP_PER_TURN[toolCode]` code default in
--      apps/runtime/src/modules/turns/tool-budget-policy.ts.
--   3. No cap (still bounded by the per-mode loop limit).
--
-- NULL means "no per-plan override; fall back to the runtime code default".
-- Use 2147483647 (max Int4) to make a normally-capped tool effectively
-- uncapped on this plan.
--
-- Reversible: drop the column. No backfill — existing rows stay NULL and
-- pick up the runtime code default automatically. Plan-side seed updates
-- (apps/api/prisma/seed.ts + STARTER_TRIAL_TOOL_POLICY) carry the explicit
-- numbers so re-seeding will populate them; admin PATCH writes them
-- afterwards.

ALTER TABLE "plan_catalog_tool_activations"
  ADD COLUMN "per_turn_cap" INTEGER;
