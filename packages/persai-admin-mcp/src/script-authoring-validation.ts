import Ajv2020Module from "ajv/dist/2020.js";

export const SCRIPT_SCHEMA_MAX_BYTES = 65_536;
export const SCRIPT_SCHEMA_MAX_DEPTH = 16;
export const SCRIPT_ENV_MAX_ENTRIES = 64;
export const SCRIPT_ENV_VALUE_MAX_CHARS = 4_096;
export const SCRIPT_WORKING_DIRECTORY_MAX_CHARS = 512;
export const SCENARIO_SCRIPT_MAPPING_MAX_ENTRIES = 32;
export const SCENARIO_SCRIPT_MAPPING_MAX_BYTES = 16_384;
export const SCENARIO_SCRIPT_LITERAL_MAX_DEPTH = 8;

const REMOTE_REFERENCE_KEYS = new Set(["$ref", "$dynamicRef"]);
const FORBIDDEN_OBJECT_KEYS = new Set(["__proto__", "constructor", "prototype"]);
type Ajv2020Instance = {
  validateSchema(schema: unknown): boolean;
  compile(schema: unknown): unknown;
};
type Ajv2020Constructor = new (options: Record<string, unknown>) => Ajv2020Instance;
const Ajv2020 = ((Ajv2020Module as unknown as { default?: unknown }).default ??
  Ajv2020Module) as unknown as Ajv2020Constructor;
const ajv = new Ajv2020({
  strict: true,
  strictSchema: true,
  allErrors: true,
  validateSchema: true
});

function serializedBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

export function jsonDepth(value: unknown): number {
  if (value === null || typeof value !== "object") {
    return 0;
  }
  const values = Array.isArray(value) ? value : Object.values(value);
  return 1 + Math.max(0, ...values.map(jsonDepth));
}

function assertNoRemoteReferences(value: unknown, path: string): void {
  if (Array.isArray(value)) {
    value.forEach((item) => assertNoRemoteReferences(item, path));
    return;
  }
  if (value === null || typeof value !== "object") {
    return;
  }
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (REMOTE_REFERENCE_KEYS.has(key) && typeof item === "string" && !item.startsWith("#")) {
      throw new Error(`${path} must not contain remote references.`);
    }
    assertNoRemoteReferences(item, path);
  }
}

export function assertScriptJsonSchema(
  schema: Record<string, unknown>,
  path: "inputSchema" | "outputSchema"
): void {
  if (serializedBytes(schema) > SCRIPT_SCHEMA_MAX_BYTES) {
    throw new Error(`${path} is too large.`);
  }
  if (jsonDepth(schema) > SCRIPT_SCHEMA_MAX_DEPTH) {
    throw new Error(`${path} is too deep.`);
  }
  assertNoRemoteReferences(schema, path);
  if (!ajv.validateSchema(schema)) {
    throw new Error(`${path} is not a valid JSON Schema Draft 2020-12 schema.`);
  }
  ajv.compile(schema);
  if (path === "inputSchema" && schema.type !== "object") {
    throw new Error("inputSchema.type must be object for Scenario input mapping.");
  }
}

export function assertScriptEnvironment(environment: Record<string, unknown>): void {
  const entries = Object.entries(environment);
  if (entries.length > SCRIPT_ENV_MAX_ENTRIES) {
    throw new Error("manifest.environment is too large.");
  }
  for (const [key, value] of entries) {
    if (!/^[A-Z_][A-Z0-9_]{0,127}$/.test(key) || FORBIDDEN_OBJECT_KEYS.has(key)) {
      throw new Error("manifest environment key is invalid.");
    }
    if (key.startsWith("PERSAI_SCRIPT_")) {
      throw new Error(`manifest environment key "${key}" is reserved by the platform.`);
    }
    if (typeof value !== "string" || value.length > SCRIPT_ENV_VALUE_MAX_CHARS) {
      throw new Error(`manifest.environment.${key} has an invalid length.`);
    }
  }
}

export function assertScenarioScriptLiteral(value: unknown, depth = 0): void {
  if (depth > SCENARIO_SCRIPT_LITERAL_MAX_DEPTH) {
    throw new Error("Scenario Script literal exceeds the maximum JSON depth.");
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
    value.forEach((item) => assertScenarioScriptLiteral(item, depth + 1));
    return;
  }
  if (typeof value === "object") {
    Object.values(value as Record<string, unknown>).forEach((item) =>
      assertScenarioScriptLiteral(item, depth + 1)
    );
    return;
  }
  throw new Error("Scenario Script literal must be JSON.");
}

export function assertScenarioScriptInputMapping(
  mapping: Record<string, { source: string; value?: unknown }>
): void {
  if (Object.keys(mapping).length > SCENARIO_SCRIPT_MAPPING_MAX_ENTRIES) {
    throw new Error(
      `inputMapping must contain at most ${String(SCENARIO_SCRIPT_MAPPING_MAX_ENTRIES)} entries.`
    );
  }
  for (const source of Object.values(mapping)) {
    if (source.source === "literal") {
      assertScenarioScriptLiteral(source.value);
    }
  }
  if (serializedBytes(mapping) > SCENARIO_SCRIPT_MAPPING_MAX_BYTES) {
    throw new Error("inputMapping exceeds the serialized byte limit.");
  }
}
