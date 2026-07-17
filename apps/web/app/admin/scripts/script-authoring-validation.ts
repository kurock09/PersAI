import Ajv2020 from "ajv/dist/2020.js";

export const SCRIPT_SCHEMA_MAX_BYTES = 65_536;
export const SCRIPT_SCHEMA_MAX_DEPTH = 16;
export const SCRIPT_WORKING_DIRECTORY_MAX_CHARS = 512;

const ajv = new Ajv2020({
  strict: true,
  strictSchema: true,
  allErrors: true,
  validateSchema: true
});

function serializedBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

export function jsonDepth(value: unknown): number {
  if (value === null || typeof value !== "object") {
    return 0;
  }
  const values = Array.isArray(value) ? value : Object.values(value);
  return 1 + Math.max(0, ...values.map(jsonDepth));
}

function assertNoRemoteReferences(value: unknown): void {
  if (Array.isArray(value)) {
    value.forEach(assertNoRemoteReferences);
    return;
  }
  if (value === null || typeof value !== "object") {
    return;
  }
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (
      (key === "$ref" || key === "$dynamicRef") &&
      typeof item === "string" &&
      !item.startsWith("#")
    ) {
      throw new Error("Remote JSON Schema references are not allowed.");
    }
    assertNoRemoteReferences(item);
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
  assertNoRemoteReferences(schema);
  if (!ajv.validateSchema(schema)) {
    throw new Error(`${path} is not a valid JSON Schema Draft 2020-12 schema.`);
  }
  ajv.compile(schema);
  if (path === "inputSchema" && schema.type !== "object") {
    throw new Error("inputSchema.type must be object.");
  }
}

export function assertScriptEnvironment(environment: Record<string, unknown>): void {
  const entries = Object.entries(environment);
  if (entries.length > 64) {
    throw new Error("manifest.environment is too large.");
  }
  for (const [key, value] of entries) {
    if (!/^[A-Z_][A-Z0-9_]{0,127}$/.test(key)) {
      throw new Error("manifest environment key is invalid.");
    }
    if (key.startsWith("PERSAI_SCRIPT_")) {
      throw new Error("manifest environment key is reserved.");
    }
    if (typeof value !== "string" || value.length > 4_096) {
      throw new Error("manifest environment value is invalid.");
    }
  }
}

export function assertScriptVersionAuthoringContract(input: {
  code: string;
  workingDirectory: string;
  environment: Record<string, unknown>;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  runtime: string;
  entryCommand: string;
  limits: {
    timeoutMs: number;
    maxMemoryMb: number;
    maxCpuMillicores: number;
    maxOutputBytes: number;
  };
}): void {
  if (input.code.length < 1 || input.code.length > 1_000_000) {
    throw new Error("code has an invalid length.");
  }
  const normalizedWorkingDirectory = input.workingDirectory.trim();
  if (
    normalizedWorkingDirectory.length > SCRIPT_WORKING_DIRECTORY_MAX_CHARS ||
    (input.workingDirectory.length > 0 && normalizedWorkingDirectory.length === 0)
  ) {
    throw new Error("manifest.workingDirectory has an invalid length.");
  }
  assertScriptEnvironment(input.environment);
  assertScriptJsonSchema(input.inputSchema, "inputSchema");
  assertScriptJsonSchema(input.outputSchema, "outputSchema");
  if (!/^[a-z][a-z0-9_.-]{0,63}$/.test(input.runtime)) {
    throw new Error("runtime has an invalid format.");
  }
  if (input.entryCommand.length < 1 || input.entryCommand.length > 4_096) {
    throw new Error("entryCommand has an invalid length.");
  }
  const bounds = [
    [input.limits.timeoutMs, 100, 1_800_000],
    [input.limits.maxMemoryMb, 16, 32_768],
    [input.limits.maxCpuMillicores, 10, 16_000],
    [input.limits.maxOutputBytes, 1, 100_000_000]
  ] as const;
  if (bounds.some(([value, min, max]) => !Number.isInteger(value) || value < min || value > max)) {
    throw new Error("Script limits are outside the canonical bounds.");
  }
}
