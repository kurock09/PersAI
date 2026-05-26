type JsonObject = Record<string, unknown>;

function asObject(value: unknown): JsonObject | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : null;
}

export function resolveAssistantPolicy(input: { billingProviderHints: unknown | null }): {
  maxAssistants: number;
} {
  const billingProviderHints = asObject(input.billingProviderHints);
  const assistantPolicy = asObject(billingProviderHints?.assistantPolicy);
  const maxAssistants = assistantPolicy?.maxAssistants;
  return {
    maxAssistants:
      typeof maxAssistants === "number" &&
      Number.isInteger(maxAssistants) &&
      Number.isFinite(maxAssistants) &&
      maxAssistants > 0
        ? maxAssistants
        : 1
  };
}
