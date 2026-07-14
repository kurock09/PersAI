export function normalizeSkillScenarioSteps(
  value: unknown
): import("@persai/runtime-contract").RuntimeBundleSkillScenarioStep[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((item) => item !== null && typeof item === "object")
    .map((item) => {
      const row = item as Record<string, unknown>;
      return {
        number: typeof row.number === "number" ? row.number : 0,
        directive: typeof row.directive === "string" ? row.directive : "",
        recommendedToolCall:
          typeof row.recommendedToolCall === "string" ? row.recommendedToolCall : null,
        mayBeSkippedIf: typeof row.mayBeSkippedIf === "string" ? row.mayBeSkippedIf : null,
        negativeGuards: normalizeStringArray(row.negativeGuards),
        expectedUserResponse:
          typeof row.expectedUserResponse === "string" ? row.expectedUserResponse : null,
        nextStepTrigger: typeof row.nextStepTrigger === "string" ? row.nextStepTrigger : null,
        recoveryGuidance: typeof row.recoveryGuidance === "string" ? row.recoveryGuidance : null
      };
    });
}

function normalizeStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}
