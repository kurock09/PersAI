import type { SkillScenario } from "@prisma/client";

export type SkillScenarioStatus = "draft" | "active" | "archived";

export type SkillScenarioLocaleMap = Record<string, string>;

export type SkillScenarioScriptInputSource =
  | { source: "literal"; value: unknown }
  | { source: "current_user_message" }
  | { source: "tool_input"; name: string };

export type SkillScenarioScriptRef = {
  scriptKey: string;
  inputMapping: Record<string, SkillScenarioScriptInputSource>;
};

export type SkillScenarioStepState = {
  number: number;
  directive: string;
  recommendedToolCall: string | null;
  mayBeSkippedIf: string | null;
  negativeGuards: string[];
  /** ADR-119 Slice 4 — what the model should expect the user to provide to satisfy this step. */
  expectedUserResponse: string | null;
  /** ADR-119 Slice 4 — explicit transition condition. */
  nextStepTrigger: string | null;
  /** ADR-119 Slice 4 — recovery guidance for off-script user responses. */
  recoveryGuidance: string | null;
  /** ADR-119 Slice 10 — step 1 only: overrides auto-derived catalog first_step_preview (≤200 chars). */
  firstStepPreview: string | null;
  scriptRef: SkillScenarioScriptRef | null;
};

export type AdminSkillScenarioState = {
  id: string;
  skillId: string;
  key: string;
  displayName: SkillScenarioLocaleMap;
  description: SkillScenarioLocaleMap;
  iconEmoji: string | null;
  intentExamples: string[];
  steps: SkillScenarioStepState[];
  recommendedTools: string[];
  exitCondition: string;
  /** ADR-119 Slice 10 — optional override for the catalog <first_step_preview> tag on step 1. */
  firstStepPreview: string | null;
  status: SkillScenarioStatus;
  displayOrder: number;
  createdAt: string;
  updatedAt: string;
};

export type CreateSkillScenarioInput = {
  key: string;
  displayName: SkillScenarioLocaleMap;
  description: SkillScenarioLocaleMap;
  iconEmoji: string | null;
  intentExamples: string[];
  steps: SkillScenarioStepState[];
  recommendedTools: string[];
  exitCondition: string;
  /** ADR-119 Slice 10 — optional override for the catalog <first_step_preview> tag on step 1. */
  firstStepPreview: string | null;
  status: SkillScenarioStatus | null;
  displayOrder: number | null;
};

export type UpdateSkillScenarioInput = {
  displayName?: SkillScenarioLocaleMap;
  description?: SkillScenarioLocaleMap;
  iconEmoji?: string | null;
  intentExamples?: string[];
  steps?: SkillScenarioStepState[];
  recommendedTools?: string[];
  exitCondition?: string;
  /** ADR-119 Slice 10 — optional override for the catalog <first_step_preview> tag on step 1. */
  firstStepPreview?: string | null;
  status?: SkillScenarioStatus;
  displayOrder?: number;
};

const MAX_SCENARIO_LOCALE_TEXT_CHARS = 500;
const MAX_SCENARIO_DESCRIPTION_CHARS = 1_000;
const MAX_INTENT_EXAMPLES = 10;
const MAX_INTENT_EXAMPLE_CHARS = 200;
const MAX_STEPS = 20;
const MAX_DIRECTIVE_CHARS = 600;
const MAX_TOOL_KEY_CHARS = 64;
const MAX_TOOLS = 12;
const MAX_EXIT_CONDITION_CHARS = 400;
const MAX_NEGATIVE_GUARDS = 8;
const MAX_NEGATIVE_GUARD_CHARS = 240;
const MAX_SKIP_CONDITION_CHARS = 240;
const MAX_EXPECTED_USER_RESPONSE_CHARS = 400;
const MAX_NEXT_STEP_TRIGGER_CHARS = 400;
const MAX_RECOVERY_GUIDANCE_CHARS = 400;
const MAX_FIRST_STEP_PREVIEW_CHARS = 200;
const MAX_SCRIPT_INPUT_MAPPING_ENTRIES = 32;
const MAX_SCRIPT_INPUT_MAPPING_BYTES = 16_384;
const MAX_SCRIPT_LITERAL_DEPTH = 8;
const KEY_REGEX = /^[a-z][a-z0-9_]{1,63}$/;
const INPUT_NAME_REGEX = /^[A-Za-z_][A-Za-z0-9_.-]{0,127}$/;
const FORBIDDEN_OBJECT_KEYS = new Set(["__proto__", "constructor", "prototype"]);

export function parseCreateSkillScenarioInput(body: unknown): CreateSkillScenarioInput {
  const row = asObject(body, "Request body");
  return {
    key: parseKey(row.key),
    displayName: parseLocaleMap(row.displayName, "displayName", MAX_SCENARIO_LOCALE_TEXT_CHARS),
    description: parseLocaleMap(row.description, "description", MAX_SCENARIO_DESCRIPTION_CHARS),
    iconEmoji: parseNullableBoundedString(row.iconEmoji, "iconEmoji", 16),
    intentExamples: parseStringList(
      row.intentExamples,
      "intentExamples",
      MAX_INTENT_EXAMPLES,
      MAX_INTENT_EXAMPLE_CHARS
    ),
    steps: parseSteps(row.steps),
    recommendedTools: parseStringList(
      row.recommendedTools,
      "recommendedTools",
      MAX_TOOLS,
      MAX_TOOL_KEY_CHARS
    ),
    exitCondition: parseBoundedString(
      row.exitCondition,
      "exitCondition",
      1,
      MAX_EXIT_CONDITION_CHARS
    ),
    firstStepPreview: parseNullableBoundedString(
      row.firstStepPreview,
      "firstStepPreview",
      MAX_FIRST_STEP_PREVIEW_CHARS
    ),
    status: parseNullableScenarioStatus(row.status, "status"),
    displayOrder: parseNullableInteger(row.displayOrder, "displayOrder")
  };
}

export function parseUpdateSkillScenarioInput(body: unknown): UpdateSkillScenarioInput {
  const row = asObject(body, "Request body");
  const result: UpdateSkillScenarioInput = {};
  if (row.displayName !== undefined) {
    result.displayName = parseLocaleMap(
      row.displayName,
      "displayName",
      MAX_SCENARIO_LOCALE_TEXT_CHARS
    );
  }
  if (row.description !== undefined) {
    result.description = parseLocaleMap(
      row.description,
      "description",
      MAX_SCENARIO_DESCRIPTION_CHARS
    );
  }
  if (row.iconEmoji !== undefined) {
    result.iconEmoji = parseNullableBoundedString(row.iconEmoji, "iconEmoji", 16);
  }
  if (row.intentExamples !== undefined) {
    result.intentExamples = parseStringList(
      row.intentExamples,
      "intentExamples",
      MAX_INTENT_EXAMPLES,
      MAX_INTENT_EXAMPLE_CHARS
    );
  }
  if (row.steps !== undefined) {
    result.steps = parseSteps(row.steps);
  }
  if (row.recommendedTools !== undefined) {
    result.recommendedTools = parseStringList(
      row.recommendedTools,
      "recommendedTools",
      MAX_TOOLS,
      MAX_TOOL_KEY_CHARS
    );
  }
  if (row.exitCondition !== undefined) {
    result.exitCondition = parseBoundedString(
      row.exitCondition,
      "exitCondition",
      1,
      MAX_EXIT_CONDITION_CHARS
    );
  }
  if (row.firstStepPreview !== undefined) {
    result.firstStepPreview = parseNullableBoundedString(
      row.firstStepPreview,
      "firstStepPreview",
      MAX_FIRST_STEP_PREVIEW_CHARS
    );
  }
  if (row.status !== undefined) {
    result.status = parseScenarioStatus(row.status, "status");
  }
  if (row.displayOrder !== undefined) {
    result.displayOrder = parsePositiveInteger(row.displayOrder, "displayOrder");
  }
  return result;
}

export function toAdminSkillScenarioState(row: SkillScenario): AdminSkillScenarioState {
  return {
    id: row.id,
    skillId: row.skillId,
    key: row.key,
    displayName: normalizeLocaleMapState(row.displayName),
    description: normalizeLocaleMapState(row.description),
    iconEmoji: row.iconEmoji,
    intentExamples: normalizeStringArray(row.intentExamples),
    steps: normalizeStepsState(row.steps),
    recommendedTools: normalizeStringArray(row.recommendedTools),
    exitCondition: row.exitCondition,
    firstStepPreview: typeof row.firstStepPreview === "string" ? row.firstStepPreview : null,
    status: row.status as SkillScenarioStatus,
    displayOrder: row.displayOrder,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}

function parseKey(value: unknown): string {
  if (typeof value !== "string") {
    throw new Error("key must be a string.");
  }
  const trimmed = value.trim();
  if (!KEY_REGEX.test(trimmed)) {
    throw new Error(
      "key must match ^[a-z][a-z0-9_]{1,63}$ (lowercase, starts with letter, underscores allowed)."
    );
  }
  return trimmed;
}

function parseLocaleMap(value: unknown, path: string, maxChars: number): SkillScenarioLocaleMap {
  const row = asObject(value, path);
  const result: SkillScenarioLocaleMap = {};
  for (const [locale, textValue] of Object.entries(row)) {
    const localeKey = parseBoundedString(locale, `${path} locale`, 2, 16).toLowerCase();
    result[localeKey] = parseBoundedString(textValue, `${path}.${localeKey}`, 1, maxChars);
  }
  if (!Object.prototype.hasOwnProperty.call(result, "ru") || (result["ru"] ?? "").length === 0) {
    throw new Error(`${path}.ru is required and must be non-empty.`);
  }
  if (!Object.prototype.hasOwnProperty.call(result, "en") || (result["en"] ?? "").length === 0) {
    throw new Error(`${path}.en is required and must be non-empty.`);
  }
  return result;
}

function parseSteps(value: unknown): SkillScenarioStepState[] {
  if (!Array.isArray(value)) {
    throw new Error("steps must be an array.");
  }
  if (value.length === 0) {
    throw new Error("steps must contain at least one step.");
  }
  if (value.length > MAX_STEPS) {
    throw new Error(`steps must contain at most ${String(MAX_STEPS)} steps.`);
  }
  return value.map((item, idx) => parseStep(item, idx));
}

function parseStep(value: unknown, idx: number): SkillScenarioStepState {
  const path = `steps[${String(idx)}]`;
  const row = asObject(value, path);
  const number = parsePositiveInteger(row.number, `${path}.number`);
  const directive = parseBoundedString(row.directive, `${path}.directive`, 1, MAX_DIRECTIVE_CHARS);
  const recommendedToolCall =
    row.recommendedToolCall === undefined || row.recommendedToolCall === null
      ? null
      : parseBoundedString(
          row.recommendedToolCall,
          `${path}.recommendedToolCall`,
          1,
          MAX_TOOL_KEY_CHARS
        );
  const mayBeSkippedIf =
    row.mayBeSkippedIf === undefined || row.mayBeSkippedIf === null
      ? null
      : parseBoundedString(
          row.mayBeSkippedIf,
          `${path}.mayBeSkippedIf`,
          1,
          MAX_SKIP_CONDITION_CHARS
        );
  const negativeGuards = parseStringList(
    row.negativeGuards ?? [],
    `${path}.negativeGuards`,
    MAX_NEGATIVE_GUARDS,
    MAX_NEGATIVE_GUARD_CHARS
  );
  const expectedUserResponse =
    row.expectedUserResponse === undefined || row.expectedUserResponse === null
      ? null
      : parseBoundedString(
          row.expectedUserResponse,
          `${path}.expectedUserResponse`,
          1,
          MAX_EXPECTED_USER_RESPONSE_CHARS
        );
  const nextStepTrigger =
    row.nextStepTrigger === undefined || row.nextStepTrigger === null
      ? null
      : parseBoundedString(
          row.nextStepTrigger,
          `${path}.nextStepTrigger`,
          1,
          MAX_NEXT_STEP_TRIGGER_CHARS
        );
  const recoveryGuidance =
    row.recoveryGuidance === undefined || row.recoveryGuidance === null
      ? null
      : parseBoundedString(
          row.recoveryGuidance,
          `${path}.recoveryGuidance`,
          1,
          MAX_RECOVERY_GUIDANCE_CHARS
        );
  const firstStepPreview =
    row.firstStepPreview === undefined || row.firstStepPreview === null
      ? null
      : parseBoundedString(
          row.firstStepPreview,
          `${path}.firstStepPreview`,
          1,
          MAX_FIRST_STEP_PREVIEW_CHARS
        );
  const scriptRef = parseScriptRef(row.scriptRef, `${path}.scriptRef`);
  return {
    number,
    directive,
    recommendedToolCall,
    mayBeSkippedIf,
    negativeGuards,
    expectedUserResponse,
    nextStepTrigger,
    recoveryGuidance,
    firstStepPreview,
    scriptRef
  };
}

function parseScriptRef(value: unknown, path: string): SkillScenarioScriptRef | null {
  if (value === undefined || value === null) {
    return null;
  }
  const row = asObject(value, path);
  assertExactKeys(row, ["scriptKey", "inputMapping"], path);
  const scriptKey = parseKey(row.scriptKey);
  const mappingRow = asObject(row.inputMapping, `${path}.inputMapping`);
  const entries = Object.entries(mappingRow);
  if (entries.length > MAX_SCRIPT_INPUT_MAPPING_ENTRIES) {
    throw new Error(
      `${path}.inputMapping must contain at most ${String(MAX_SCRIPT_INPUT_MAPPING_ENTRIES)} entries.`
    );
  }
  const inputMapping: Record<string, SkillScenarioScriptInputSource> = {};
  for (const [name, sourceValue] of entries) {
    if (!INPUT_NAME_REGEX.test(name) || FORBIDDEN_OBJECT_KEYS.has(name)) {
      throw new Error(`${path}.inputMapping key "${name}" has an invalid format.`);
    }
    inputMapping[name] = parseScriptInputSource(sourceValue, `${path}.inputMapping.${name}`);
  }
  if (Buffer.byteLength(JSON.stringify(inputMapping), "utf8") > MAX_SCRIPT_INPUT_MAPPING_BYTES) {
    throw new Error(`${path}.inputMapping exceeds the serialized byte limit.`);
  }
  return { scriptKey, inputMapping };
}

function parseScriptInputSource(value: unknown, path: string): SkillScenarioScriptInputSource {
  const row = asObject(value, path);
  if (row.source === "literal") {
    assertExactKeys(row, ["source", "value"], path);
    assertJsonValue(row.value, `${path}.value`, 0);
    return { source: "literal", value: row.value };
  }
  if (row.source === "current_user_message") {
    assertExactKeys(row, ["source"], path);
    return { source: "current_user_message" };
  }
  if (row.source === "tool_input") {
    assertExactKeys(row, ["source", "name"], path);
    const name = parseBoundedString(row.name, `${path}.name`, 1, 128);
    if (!INPUT_NAME_REGEX.test(name) || FORBIDDEN_OBJECT_KEYS.has(name)) {
      throw new Error(`${path}.name has an invalid format.`);
    }
    return { source: "tool_input", name };
  }
  throw new Error(`${path}.source must be literal, current_user_message, or tool_input.`);
}

function assertJsonValue(value: unknown, path: string, depth: number): void {
  if (depth > MAX_SCRIPT_LITERAL_DEPTH) {
    throw new Error(`${path} exceeds the maximum JSON depth.`);
  }
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  ) {
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertJsonValue(item, `${path}[${String(index)}]`, depth + 1));
    return;
  }
  if (typeof value === "object") {
    Object.entries(value as Record<string, unknown>).forEach(([key, item]) =>
      assertJsonValue(item, `${path}.${key}`, depth + 1)
    );
    return;
  }
  throw new Error(`${path} must be JSON.`);
}

function parseStringList(
  value: unknown,
  path: string,
  maxItems: number,
  maxItemChars: number
): string[] {
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new Error(`${path} must be an array.`);
  }
  const result: string[] = [];
  for (const item of value) {
    const parsed = parseBoundedString(item, `${path}[]`, 1, maxItemChars);
    result.push(parsed);
    if (result.length > maxItems) {
      throw new Error(`${path} must contain at most ${String(maxItems)} items.`);
    }
  }
  return result;
}

function parseNullableScenarioStatus(value: unknown, path: string): SkillScenarioStatus | null {
  if (value === undefined || value === null) {
    return null;
  }
  return parseScenarioStatus(value, path);
}

function parseScenarioStatus(value: unknown, path: string): SkillScenarioStatus {
  if (value === "draft" || value === "active" || value === "archived") {
    return value;
  }
  throw new Error(`${path} must be draft, active, or archived.`);
}

function parsePositiveInteger(value: unknown, path: string): number {
  if (!Number.isInteger(value) || (value as number) < 0) {
    throw new Error(`${path} must be a non-negative integer.`);
  }
  return value as number;
}

function parseNullableInteger(value: unknown, path: string): number | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (!Number.isInteger(value)) {
    throw new Error(`${path} must be an integer.`);
  }
  return value as number;
}

function parseNullableBoundedString(value: unknown, path: string, maxChars: number): string | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  return parseBoundedString(value, path, 1, maxChars);
}

function parseBoundedString(
  value: unknown,
  path: string,
  minChars: number,
  maxChars: number
): string {
  if (typeof value !== "string") {
    throw new Error(`${path} must be a string.`);
  }
  const trimmed = value.trim();
  if (trimmed.length < minChars || trimmed.length > maxChars) {
    throw new Error(`${path} must be between ${String(minChars)} and ${String(maxChars)} chars.`);
  }
  return trimmed;
}

function asObject(value: unknown, path: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${path} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function assertExactKeys(
  row: Record<string, unknown>,
  allowedKeys: readonly string[],
  path: string
): void {
  const allowed = new Set(allowedKeys);
  const unknown = Object.keys(row).filter((key) => !allowed.has(key));
  if (unknown.length > 0) {
    throw new Error(`${path} contains unknown field(s): ${unknown.sort().join(", ")}.`);
  }
}

function normalizeLocaleMapState(value: unknown): SkillScenarioLocaleMap {
  const result: SkillScenarioLocaleMap = {};
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    for (const [key, textValue] of Object.entries(value as Record<string, unknown>)) {
      if (typeof textValue === "string") {
        result[key] = textValue;
      }
    }
  }
  return result;
}

function normalizeStepsState(value: unknown): SkillScenarioStepState[] {
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
        firstStepPreview: typeof row.firstStepPreview === "string" ? row.firstStepPreview : null,
        scriptRef: normalizeScriptRef(row.scriptRef)
      };
    });
}

function normalizeScriptRef(value: unknown): SkillScenarioScriptRef | null {
  return parseScriptRef(value, "scriptRef");
}

function normalizeStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}
