import { BadRequestException } from "@nestjs/common";
import type { AdminPlanThinkingBudgetByLevel } from "./admin-plan-management.types";

/**
 * ADR-121 Slice 4 — per-plan override of the thinking-token budget per
 * routing level. Persisted on
 * `PlanCatalogPlan.billingProviderHints.thinkingBudgetByLevel` (Json) as:
 *
 *   {
 *     schema: "persai.thinkingBudgetByLevel.v1",
 *     byLevel: {
 *       light: <int|null>,
 *       medium: <int|null>,
 *       heavy: <int|null>,
 *       deep: <int|null>
 *     }
 *   }
 *
 * NULL on a leaf means "use the resolver default for that level" (see
 * DEFAULT_THINKING_BUDGET_BY_LEVEL in execution-profile-resolver.ts).
 * 0 is a valid explicit value meaning "thinking off for this level".
 * The bundle compile pipeline forwards this struct to
 * `bundle.runtime.thinkingBudgetByLevel`.
 */
export const PERSAI_PLAN_THINKING_BUDGET_BY_LEVEL_SCHEMA =
  "persai.thinkingBudgetByLevel.v1" as const;

export function createDefaultPlanThinkingBudgetByLevel(): AdminPlanThinkingBudgetByLevel {
  return {
    light: null,
    medium: null,
    heavy: null,
    deep: null
  };
}

function asObject(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function toLooseNullableNonNegativeInt(value: unknown): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value !== "number" || !Number.isFinite(value) || !Number.isInteger(value)) {
    return null;
  }
  return value >= 0 ? value : null;
}

/**
 * Lenient resolver for stored values: malformed leaves degrade to NULL so
 * an old/garbage row never blocks bundle compile. Mirrors the contract of
 * `resolveStoredPlanToolBudgets`.
 */
export function resolveStoredPlanThinkingBudgetByLevel(
  value: unknown
): AdminPlanThinkingBudgetByLevel {
  const row = asObject(value);
  if (row === null) {
    return createDefaultPlanThinkingBudgetByLevel();
  }
  const rawByLevel = asObject(row.byLevel);
  if (rawByLevel === null) {
    return createDefaultPlanThinkingBudgetByLevel();
  }
  return {
    light: toLooseNullableNonNegativeInt(rawByLevel.light),
    medium: toLooseNullableNonNegativeInt(rawByLevel.medium),
    heavy: toLooseNullableNonNegativeInt(rawByLevel.heavy),
    deep: toLooseNullableNonNegativeInt(rawByLevel.deep)
  };
}

function parseNullableNonNegativeInt(value: unknown, fieldName: string): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    !Number.isInteger(value) ||
    value < 0
  ) {
    throw new BadRequestException(`${fieldName} must be a non-negative integer or null.`);
  }
  return value;
}

/**
 * Strict parser for incoming admin PATCH payloads. Throws on malformed
 * inputs; null leaves are accepted and mean "use resolver default".
 * 0 is explicitly accepted (thinking off for this level).
 */
export function parsePlanThinkingBudgetByLevel(
  value: unknown,
  fieldName = "thinkingBudgetByLevel"
): AdminPlanThinkingBudgetByLevel {
  if (value === undefined) {
    return createDefaultPlanThinkingBudgetByLevel();
  }
  const row = asObject(value);
  if (row === null) {
    throw new BadRequestException(`${fieldName} must be an object.`);
  }
  return {
    light: parseNullableNonNegativeInt(row.light, `${fieldName}.light`),
    medium: parseNullableNonNegativeInt(row.medium, `${fieldName}.medium`),
    heavy: parseNullableNonNegativeInt(row.heavy, `${fieldName}.heavy`),
    deep: parseNullableNonNegativeInt(row.deep, `${fieldName}.deep`)
  };
}

export function toPlanThinkingBudgetByLevelDocument(
  budgets: AdminPlanThinkingBudgetByLevel
): Record<string, unknown> {
  return {
    schema: PERSAI_PLAN_THINKING_BUDGET_BY_LEVEL_SCHEMA,
    byLevel: {
      light: budgets.light,
      medium: budgets.medium,
      heavy: budgets.heavy,
      deep: budgets.deep
    }
  };
}

/**
 * True iff at least one leaf is non-null. Used by the bundle compile
 * pipeline to decide whether to emit `runtime.thinkingBudgetByLevel` at
 * all (the runtime treats absence and all-nulls identically, but emitting
 * an empty struct keeps the JSON noisier than necessary).
 */
export function hasAnyThinkingBudgetOverride(budgets: AdminPlanThinkingBudgetByLevel): boolean {
  return (
    budgets.light !== null ||
    budgets.medium !== null ||
    budgets.heavy !== null ||
    budgets.deep !== null
  );
}
