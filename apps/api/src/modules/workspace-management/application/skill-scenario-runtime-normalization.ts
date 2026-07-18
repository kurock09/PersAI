import type { RuntimeBundleSkillScenarioStep } from "@persai/runtime-contract";

/**
 * ADR-151 — output of the pure/sync scenario-step normalization pass. `scriptRef`
 * here is the RAW persisted value, unparsed: explicit `null`/absent, a
 * well-formed authored `{scriptKey, inputMapping}` reference, or a malformed
 * non-null value. Parsing/validation is deliberately deferred to the async
 * materialization pass (`script-ref-materialization.ts`), which reuses the
 * exact same `parseScriptRef` the Admin authoring path uses (no duplicated
 * parsing logic here) and is the first point in this pipeline that has the
 * `skillId` needed for per-step Script pin resolution / degradation. This
 * pass must never canonicalize a malformed non-null value to `null` — doing
 * so would let bundle materialization silently succeed as if the authored ref
 * were explicitly absent.
 */
export type NormalizedSkillScenarioStep = Omit<RuntimeBundleSkillScenarioStep, "scriptRef"> & {
  scriptRef: unknown;
};

export function normalizeSkillScenarioSteps(value: unknown): NormalizedSkillScenarioStep[] {
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
        recoveryGuidance: typeof row.recoveryGuidance === "string" ? row.recoveryGuidance : null,
        scriptRef: row.scriptRef ?? null
      };
    });
}

function normalizeStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}
