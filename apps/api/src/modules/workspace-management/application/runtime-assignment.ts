export const RUNTIME_TIER_VALUES = [
  "free_shared_restricted",
  "paid_shared_restricted",
  "paid_isolated"
] as const;

export type RuntimeTier = (typeof RUNTIME_TIER_VALUES)[number];

export type RuntimeAssignmentSource = "platform_fallback" | "plan_default" | "assistant_override";

export type RuntimeAssignmentState = {
  schema: "persai.runtimeAssignment.v1";
  planDefaultTier: RuntimeTier | null;
  runtimeTierOverride: RuntimeTier | null;
  effectiveTier: RuntimeTier;
  source: RuntimeAssignmentSource;
};

function asObject(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

export function parseRuntimeTier(value: unknown): RuntimeTier | null {
  if (typeof value !== "string") {
    return null;
  }
  return (RUNTIME_TIER_VALUES as readonly string[]).includes(value) ? (value as RuntimeTier) : null;
}

export function resolveRuntimeTierDefaultFromBillingHints(
  billingProviderHints: unknown
): RuntimeTier | null {
  const hints = asObject(billingProviderHints);
  return parseRuntimeTier(hints?.runtimeTierDefault);
}

export function resolveRuntimeTierOverrideFromPolicyEnvelope(
  policyEnvelope: unknown
): RuntimeTier | null {
  const envelope = asObject(policyEnvelope);
  const runtimeAssignment = asObject(envelope?.runtimeAssignment);
  return parseRuntimeTier(runtimeAssignment?.runtimeTierOverride);
}

export function resolveRuntimeAssignmentState(params: {
  billingProviderHints: unknown;
  policyEnvelope: unknown;
}): RuntimeAssignmentState {
  const planDefaultTier = resolveRuntimeTierDefaultFromBillingHints(params.billingProviderHints);
  const runtimeTierOverride = resolveRuntimeTierOverrideFromPolicyEnvelope(params.policyEnvelope);
  const effectiveTier = runtimeTierOverride ?? planDefaultTier ?? "free_shared_restricted";
  const source: RuntimeAssignmentSource =
    runtimeTierOverride !== null
      ? "assistant_override"
      : planDefaultTier !== null
        ? "plan_default"
        : "platform_fallback";

  return {
    schema: "persai.runtimeAssignment.v1",
    planDefaultTier,
    runtimeTierOverride,
    effectiveTier,
    source
  };
}

export function readRuntimeAssignmentStateFromMaterializedLayers(
  layers: unknown
): RuntimeAssignmentState | null {
  const root = asObject(layers);
  const rootLayers = asObject(root?.layers);
  const governance = asObject(rootLayers?.governance);
  const runtimeAssignment = asObject(governance?.runtimeAssignment);
  const effectiveTier = parseRuntimeTier(runtimeAssignment?.effectiveTier);
  if (effectiveTier === null) {
    return null;
  }

  const sourceValue = runtimeAssignment?.source;
  const source: RuntimeAssignmentSource =
    sourceValue === "assistant_override" ||
    sourceValue === "plan_default" ||
    sourceValue === "platform_fallback"
      ? sourceValue
      : "platform_fallback";

  return {
    schema: "persai.runtimeAssignment.v1",
    planDefaultTier: parseRuntimeTier(runtimeAssignment?.planDefaultTier),
    runtimeTierOverride: parseRuntimeTier(runtimeAssignment?.runtimeTierOverride),
    effectiveTier,
    source
  };
}

export function readRuntimeAssignmentStateFromOpenClawBootstrap(
  openclawBootstrap: unknown
): RuntimeAssignmentState | null {
  const root = asObject(openclawBootstrap);
  const governance = asObject(root?.governance);
  const runtimeAssignment = asObject(governance?.runtimeAssignment);
  const effectiveTier = parseRuntimeTier(runtimeAssignment?.effectiveTier);
  if (effectiveTier === null) {
    return null;
  }

  const sourceValue = runtimeAssignment?.source;
  const source: RuntimeAssignmentSource =
    sourceValue === "assistant_override" ||
    sourceValue === "plan_default" ||
    sourceValue === "platform_fallback"
      ? sourceValue
      : "platform_fallback";

  return {
    schema: "persai.runtimeAssignment.v1",
    planDefaultTier: parseRuntimeTier(runtimeAssignment?.planDefaultTier),
    runtimeTierOverride: parseRuntimeTier(runtimeAssignment?.runtimeTierOverride),
    effectiveTier,
    source
  };
}
