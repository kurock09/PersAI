import { BadRequestException } from "@nestjs/common";
import {
  DEFAULT_PERSAI_RUNTIME_CONTEXT_HYDRATION_CONFIG,
  DEFAULT_PERSAI_RUNTIME_CONTEXT_HYDRATION_PRESET,
  PERSAI_RUNTIME_CONTEXT_HYDRATION_PRESETS,
  PERSAI_RUNTIME_CONTEXT_HYDRATION_PRESET_DEFAULTS,
  type PersaiRuntimeContextHydrationPreset,
  type RuntimeContextHydrationConfig
} from "@persai/runtime-contract";

export const PERSAI_PLAN_CONTEXT_HYDRATION_POLICY_SCHEMA = "persai.planContextHydration.v1";

type PresetWithDefaults = Exclude<PersaiRuntimeContextHydrationPreset, "custom">;

function asObject(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function isPreset(value: unknown): value is PersaiRuntimeContextHydrationPreset {
  return (
    typeof value === "string" &&
    PERSAI_RUNTIME_CONTEXT_HYDRATION_PRESETS.includes(value as PersaiRuntimeContextHydrationPreset)
  );
}

function createPresetConfig(preset: PresetWithDefaults): RuntimeContextHydrationConfig {
  return {
    preset,
    ...PERSAI_RUNTIME_CONTEXT_HYDRATION_PRESET_DEFAULTS[preset]
  };
}

function createCustomConfigBase(): RuntimeContextHydrationConfig {
  return {
    ...DEFAULT_PERSAI_RUNTIME_CONTEXT_HYDRATION_CONFIG,
    preset: "custom"
  };
}

function toLoosePositiveInteger(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : fallback;
}

function toLooseNonNegativeInteger(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : fallback;
}

function toLooseBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function parsePositiveInteger(value: unknown, fieldName: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new BadRequestException(`${fieldName} must be a positive integer.`);
  }
  return value;
}

function parseNonNegativeInteger(value: unknown, fieldName: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new BadRequestException(`${fieldName} must be a non-negative integer.`);
  }
  return value;
}

function parseBoolean(value: unknown, fieldName: string): boolean {
  if (typeof value !== "boolean") {
    throw new BadRequestException(`${fieldName} must be a boolean.`);
  }
  return value;
}

function assertPolicyBounds(policy: RuntimeContextHydrationConfig, fieldPrefix: string): void {
  if (policy.compactionTriggerThreshold > policy.targetContextBudget) {
    throw new BadRequestException(
      `${fieldPrefix}.compactionTriggerThreshold must be less than or equal to ${fieldPrefix}.targetContextBudget.`
    );
  }
  if (policy.knowledgeHydrationBudget > policy.targetContextBudget) {
    throw new BadRequestException(
      `${fieldPrefix}.knowledgeHydrationBudget must be less than or equal to ${fieldPrefix}.targetContextBudget.`
    );
  }
}

function normalizePolicy(policy: RuntimeContextHydrationConfig): RuntimeContextHydrationConfig {
  return {
    ...policy,
    compactionTriggerThreshold: Math.min(
      policy.compactionTriggerThreshold,
      policy.targetContextBudget
    ),
    knowledgeHydrationBudget: Math.min(policy.knowledgeHydrationBudget, policy.targetContextBudget)
  };
}

export function createDefaultPlanContextHydrationPolicy(
  preset: PresetWithDefaults = DEFAULT_PERSAI_RUNTIME_CONTEXT_HYDRATION_PRESET
): RuntimeContextHydrationConfig {
  return createPresetConfig(preset);
}

export function resolveStoredPlanContextHydrationPolicy(
  value: unknown
): RuntimeContextHydrationConfig {
  const row = asObject(value);
  if (row === null) {
    return createDefaultPlanContextHydrationPolicy();
  }
  const preset = isPreset(row.preset)
    ? row.preset
    : DEFAULT_PERSAI_RUNTIME_CONTEXT_HYDRATION_PRESET;
  const base =
    preset === "custom"
      ? createCustomConfigBase()
      : createPresetConfig(preset as PresetWithDefaults);
  return normalizePolicy({
    preset,
    targetContextBudget: toLoosePositiveInteger(row.targetContextBudget, base.targetContextBudget),
    compactionTriggerThreshold: toLoosePositiveInteger(
      row.compactionTriggerThreshold,
      base.compactionTriggerThreshold
    ),
    keepRecentMinimum: toLoosePositiveInteger(row.keepRecentMinimum, base.keepRecentMinimum),
    knowledgeHydrationBudget: toLooseNonNegativeInteger(
      row.knowledgeHydrationBudget,
      base.knowledgeHydrationBudget
    ),
    autoCompactionWeb: toLooseBoolean(row.autoCompactionWeb, base.autoCompactionWeb),
    autoCompactionTelegram: toLooseBoolean(row.autoCompactionTelegram, base.autoCompactionTelegram)
  });
}

export function parsePlanContextHydrationPolicy(
  value: unknown,
  fieldName = "contextPolicy"
): RuntimeContextHydrationConfig {
  const row = asObject(value);
  if (row === null) {
    throw new BadRequestException(`${fieldName} must be an object.`);
  }
  if (!isPreset(row.preset)) {
    throw new BadRequestException(
      `${fieldName}.preset must be one of ${PERSAI_RUNTIME_CONTEXT_HYDRATION_PRESETS.join(", ")}.`
    );
  }
  const policy: RuntimeContextHydrationConfig = {
    preset: row.preset,
    targetContextBudget: parsePositiveInteger(
      row.targetContextBudget,
      `${fieldName}.targetContextBudget`
    ),
    compactionTriggerThreshold: parsePositiveInteger(
      row.compactionTriggerThreshold,
      `${fieldName}.compactionTriggerThreshold`
    ),
    keepRecentMinimum: parsePositiveInteger(
      row.keepRecentMinimum,
      `${fieldName}.keepRecentMinimum`
    ),
    knowledgeHydrationBudget: parseNonNegativeInteger(
      row.knowledgeHydrationBudget,
      `${fieldName}.knowledgeHydrationBudget`
    ),
    autoCompactionWeb: parseBoolean(row.autoCompactionWeb, `${fieldName}.autoCompactionWeb`),
    autoCompactionTelegram: parseBoolean(
      row.autoCompactionTelegram,
      `${fieldName}.autoCompactionTelegram`
    )
  };
  assertPolicyBounds(policy, fieldName);
  return policy;
}

export function toPlanContextHydrationPolicyDocument(
  policy: RuntimeContextHydrationConfig
): Record<string, unknown> {
  return {
    schema: PERSAI_PLAN_CONTEXT_HYDRATION_POLICY_SCHEMA,
    preset: policy.preset,
    targetContextBudget: policy.targetContextBudget,
    compactionTriggerThreshold: policy.compactionTriggerThreshold,
    keepRecentMinimum: policy.keepRecentMinimum,
    knowledgeHydrationBudget: policy.knowledgeHydrationBudget,
    autoCompactionWeb: policy.autoCompactionWeb,
    autoCompactionTelegram: policy.autoCompactionTelegram
  };
}

export function buildRuntimeContextHydrationConfig(params: {
  policy: RuntimeContextHydrationConfig;
  telegramAutoCompactionEnabled: boolean;
}): RuntimeContextHydrationConfig {
  return {
    ...params.policy,
    autoCompactionTelegram:
      params.policy.autoCompactionTelegram && params.telegramAutoCompactionEnabled
  };
}

export function deriveSharedCompactionBudgetsFromContextHydration(
  policy: RuntimeContextHydrationConfig
): {
  reserveTokens: number;
  keepRecentTokens: number;
  recentTurnsPreserve: number;
} {
  return {
    reserveTokens: policy.targetContextBudget,
    keepRecentTokens: Math.max(0, policy.targetContextBudget - policy.compactionTriggerThreshold),
    recentTurnsPreserve: policy.keepRecentMinimum
  };
}
