export const PLAN_LIFECYCLE_POLICY_SCHEMA = "persai.planLifecyclePolicy.v1";

export type PlanLifecyclePolicy = {
  schema: typeof PLAN_LIFECYCLE_POLICY_SCHEMA;
  trialFallbackPlanCode: string | null;
  paidFallbackPlanCode: string | null;
};

function asObject(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function toNullableString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function createPlanLifecyclePolicyDocument(
  trialFallbackPlanCode: string | null,
  paidFallbackPlanCode: string | null = null
): PlanLifecyclePolicy {
  return {
    schema: PLAN_LIFECYCLE_POLICY_SCHEMA,
    trialFallbackPlanCode,
    paidFallbackPlanCode
  };
}

export function resolveStoredPlanLifecyclePolicy(
  billingProviderHints: unknown
): PlanLifecyclePolicy {
  const hints = asObject(billingProviderHints);
  const lifecyclePolicy = asObject(hints?.lifecyclePolicy);
  return createPlanLifecyclePolicyDocument(
    toNullableString(lifecyclePolicy?.trialFallbackPlanCode),
    toNullableString(lifecyclePolicy?.paidFallbackPlanCode)
  );
}
