import type { PersaiRuntimeModelRole, RoutingLevel } from "@persai/runtime-contract";

export type ExecutionMode = "normal" | "premium" | "reasoning";

export interface ExecutionProfile {
  level: RoutingLevel;
  executionMode: ExecutionMode;
  modelRole: PersaiRuntimeModelRole;
  thinkingBudget: number;
}

export const DEFAULT_THINKING_BUDGET_BY_LEVEL: Record<RoutingLevel, number> = {
  light: 0,
  medium: 0,
  heavy: 8192,
  deep: 32768
};

export type ThinkingBudgetOverrides = Partial<Record<RoutingLevel, number>>;

const LEVEL_PROFILES: Record<
  RoutingLevel,
  Pick<ExecutionProfile, "executionMode" | "modelRole">
> = {
  light: { executionMode: "normal", modelRole: "normal_reply" },
  medium: { executionMode: "premium", modelRole: "premium_reply" },
  heavy: { executionMode: "premium", modelRole: "premium_reply" },
  deep: { executionMode: "reasoning", modelRole: "reasoning" }
};

/**
 * ADR-121 D2 — the single seat that maps the router's semantic `level` to an execution
 * profile (model slot + thinking budget). `executionMode` is derived and consistent with
 * `mapExecutionModeToModelRole` in turn-execution.service.ts. Pure and fully unit-testable.
 */
export function resolveExecutionProfile(
  level: RoutingLevel,
  overrides?: ThinkingBudgetOverrides
): ExecutionProfile {
  const { executionMode, modelRole } = LEVEL_PROFILES[level];

  const overrideValue = overrides?.[level];
  const thinkingBudget =
    overrideValue !== undefined && Number.isFinite(overrideValue) && overrideValue >= 0
      ? overrideValue
      : DEFAULT_THINKING_BUDGET_BY_LEVEL[level];

  return { level, executionMode, modelRole, thinkingBudget };
}
