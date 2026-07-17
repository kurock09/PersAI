import type { RuntimeBundleSkillScenarioStep } from "@persai/runtime-contract";
import type {
  SkillScenarioScriptInputSource,
  SkillScenarioScriptRef
} from "./skill-scenario.types";

/**
 * ADR-151 — output of the pure/sync scenario-step normalization pass. `scriptRef`
 * here is the raw authored `{scriptKey, inputMapping}` reference (no pin), matching
 * exactly what `SkillScenarioStepState.scriptRef` stores. Resolving it into the
 * pinned `RuntimeBundleSkillScenarioScriptRef` shape required by the runtime
 * contract needs a database round-trip, so it happens in a separate async
 * materialization pass (see `script-ref-materialization.ts`) over this output.
 */
export type NormalizedSkillScenarioStep = Omit<RuntimeBundleSkillScenarioStep, "scriptRef"> & {
  scriptRef: SkillScenarioScriptRef | null;
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
        scriptRef: normalizeRawScriptRef(row.scriptRef)
      };
    });
}

function normalizeRawScriptRef(value: unknown): SkillScenarioScriptRef | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const row = value as Record<string, unknown>;
  if (typeof row.scriptKey !== "string" || row.scriptKey.trim().length === 0) {
    return null;
  }
  const mappingRow = row.inputMapping;
  if (mappingRow === null || typeof mappingRow !== "object" || Array.isArray(mappingRow)) {
    return null;
  }
  const inputMapping: Record<string, SkillScenarioScriptInputSource> = {};
  for (const [name, sourceValue] of Object.entries(mappingRow as Record<string, unknown>)) {
    const source = normalizeRawScriptInputSource(sourceValue);
    if (source !== null) {
      inputMapping[name] = source;
    }
  }
  return { scriptKey: row.scriptKey.trim(), inputMapping };
}

function normalizeRawScriptInputSource(value: unknown): SkillScenarioScriptInputSource | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const row = value as Record<string, unknown>;
  if (row.source === "literal") {
    return { source: "literal", value: row.value };
  }
  if (row.source === "current_user_message") {
    return { source: "current_user_message" };
  }
  if (row.source === "tool_input" && typeof row.name === "string" && row.name.trim().length > 0) {
    return { source: "tool_input", name: row.name.trim() };
  }
  return null;
}

function normalizeStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}
