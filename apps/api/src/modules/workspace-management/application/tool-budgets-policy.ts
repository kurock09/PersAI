import { BadRequestException } from "@nestjs/common";
import type { AdminPlanToolBudgets } from "./admin-plan-management.types";

/**
 * ADR-074 Slice L1 — per-plan override of the runtime tool-loop iteration
 * limit per execution mode. Persisted on
 * `PlanCatalogPlan.billingProviderHints.toolBudgets` (Json) as:
 *
 *   {
 *     schema: "persai.toolBudgets.v1",
 *     loopLimitByMode: {
 *       normal: <int|null>,
 *       premium: <int|null>,
 *       reasoning: <int|null>
 *     }
 *   }
 *
 * NULL on a leaf means "use the runtime code default for that mode" (see
 * TOOL_LOOP_LIMIT_BY_MODE in
 * apps/runtime/src/modules/turns/tool-budget-policy.ts). The runtime is
 * defensive against zero/negative values: it ignores them and uses the
 * code default. The bundle compile pipeline forwards this struct to
 * `bundle.runtime.toolBudgets`.
 */
export const PERSAI_PLAN_TOOL_BUDGETS_SCHEMA = "persai.toolBudgets.v1" as const;

export function createDefaultPlanToolBudgets(): AdminPlanToolBudgets {
  return {
    loopLimitByMode: {
      normal: null,
      premium: null,
      reasoning: null
    }
  };
}

function asObject(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function toLooseNullablePositiveInt(value: unknown): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value !== "number" || !Number.isFinite(value) || !Number.isInteger(value)) {
    return null;
  }
  return value > 0 ? value : null;
}

/**
 * Lenient resolver for stored values: malformed leaves degrade to NULL so
 * an old/garbage row never blocks bundle compile. Mirrors the contract of
 * `resolveStoredPlanContextHydrationPolicy`.
 */
export function resolveStoredPlanToolBudgets(value: unknown): AdminPlanToolBudgets {
  const row = asObject(value);
  if (row === null) {
    return createDefaultPlanToolBudgets();
  }
  const rawLoop = asObject(row.loopLimitByMode);
  if (rawLoop === null) {
    return createDefaultPlanToolBudgets();
  }
  return {
    loopLimitByMode: {
      normal: toLooseNullablePositiveInt(rawLoop.normal),
      premium: toLooseNullablePositiveInt(rawLoop.premium),
      reasoning: toLooseNullablePositiveInt(rawLoop.reasoning)
    }
  };
}

function parseNullablePositiveInt(value: unknown, fieldName: string): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    !Number.isInteger(value) ||
    value <= 0
  ) {
    throw new BadRequestException(`${fieldName} must be a positive integer or null.`);
  }
  return value;
}

/**
 * Strict parser for incoming admin PATCH payloads. Throws on malformed
 * inputs; null leaves are accepted and mean "use code default".
 */
export function parsePlanToolBudgets(
  value: unknown,
  fieldName = "toolBudgets"
): AdminPlanToolBudgets {
  if (value === undefined) {
    return createDefaultPlanToolBudgets();
  }
  const row = asObject(value);
  if (row === null) {
    throw new BadRequestException(`${fieldName} must be an object.`);
  }
  const rawLoop = asObject(row.loopLimitByMode);
  if (rawLoop === null) {
    throw new BadRequestException(`${fieldName}.loopLimitByMode must be an object.`);
  }
  return {
    loopLimitByMode: {
      normal: parseNullablePositiveInt(rawLoop.normal, `${fieldName}.loopLimitByMode.normal`),
      premium: parseNullablePositiveInt(rawLoop.premium, `${fieldName}.loopLimitByMode.premium`),
      reasoning: parseNullablePositiveInt(
        rawLoop.reasoning,
        `${fieldName}.loopLimitByMode.reasoning`
      )
    }
  };
}

export function toPlanToolBudgetsDocument(budgets: AdminPlanToolBudgets): Record<string, unknown> {
  return {
    schema: PERSAI_PLAN_TOOL_BUDGETS_SCHEMA,
    loopLimitByMode: {
      normal: budgets.loopLimitByMode.normal,
      premium: budgets.loopLimitByMode.premium,
      reasoning: budgets.loopLimitByMode.reasoning
    }
  };
}

/**
 * True iff at least one leaf is non-null. Used by the bundle compile
 * pipeline to decide whether to emit `runtime.toolBudgets` at all (the
 * runtime treats absence and all-nulls identically, but emitting an empty
 * struct keeps the JSON noisier than necessary).
 */
export function hasAnyToolBudgetOverride(budgets: AdminPlanToolBudgets): boolean {
  const loop = budgets.loopLimitByMode;
  return loop.normal !== null || loop.premium !== null || loop.reasoning !== null;
}
