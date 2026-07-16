import { createHash } from "node:crypto";
import Ajv2020 from "ajv/dist/2020.js";
import type { Script, ScriptVersion, SkillScript } from "@prisma/client";

export type LocalizedScriptText = { ru: string; en: string };
export type ScriptStatus = "draft" | "published" | "archived";
export type ScriptVersionStatus = "draft" | "published";
export type ScriptManifest = {
  schemaVersion: 1;
  workingDirectory: string | null;
  environment: Record<string, string>;
};
export type ScriptLimits = {
  timeoutMs: number;
  maxMemoryMb: number;
  maxCpuMillicores: number;
  maxOutputBytes: number;
};
export type ScriptCoreInput = {
  name: LocalizedScriptText;
  description: LocalizedScriptText;
  category: string;
  icon: string | null;
  color: string | null;
  displayOrder: number;
};
export type ScriptCreateInput = ScriptCoreInput & { key: string };
export type ScriptVersionWriteInput = {
  code: string;
  manifest: ScriptManifest;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  runtime: string;
  entryCommand: string;
  limits: ScriptLimits;
};
export type ScriptVersionUpdateInput = ScriptVersionWriteInput & { expectedRevision: number };
export type ScriptState = {
  id: string;
  key: string;
  name: LocalizedScriptText;
  description: LocalizedScriptText;
  status: ScriptStatus;
  category: string;
  icon: string | null;
  color: string | null;
  displayOrder: number;
  currentPublishedVersionId: string | null;
  createdByUserId: string;
  updatedByUserId: string | null;
  createdAt: string;
  updatedAt: string;
};
export type ScriptVersionState = {
  id: string;
  scriptId: string;
  version: number;
  status: ScriptVersionStatus;
  code: string;
  manifest: ScriptManifest;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  runtime: string;
  entryCommand: string;
  limits: ScriptLimits;
  contentHash: string | null;
  revision: number;
  createdByUserId: string;
  publishedByUserId: string | null;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
};
export type SkillScriptLinkState = {
  scriptId: string;
  displayOrder: number;
  createdAt: string;
  script: ScriptState;
};

const KEY_PATTERN = /^[a-z][a-z0-9_]{1,63}$/;
const RUNTIME_PATTERN = /^[a-z][a-z0-9_.-]{0,63}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_SCHEMA_BYTES = 65_536;
const MAX_SCHEMA_DEPTH = 16;
const ajv = new Ajv2020({
  strict: true,
  strictSchema: true,
  allErrors: true,
  validateSchema: true
});

export function parseScriptCreateInput(value: unknown): ScriptCreateInput {
  const row = object(value, "body");
  exact(row, ["key", "name", "description", "category", "icon", "color", "displayOrder"], "body");
  const key = text(row.key, "key", 2, 64);
  if (!KEY_PATTERN.test(key)) throw new Error("key has an invalid format.");
  return { key, ...parseCore(row) };
}

export function parseScriptUpdateInput(value: unknown): ScriptCoreInput {
  const row = object(value, "body");
  exact(row, ["name", "description", "category", "icon", "color", "displayOrder"], "body");
  return parseCore(row);
}

export function parseScriptVersionCreateInput(value: unknown): ScriptVersionWriteInput {
  const row = object(value, "body");
  exact(
    row,
    ["code", "manifest", "inputSchema", "outputSchema", "runtime", "entryCommand", "limits"],
    "body"
  );
  return parseVersionCore(row);
}

export function parseScriptVersionUpdateInput(value: unknown): ScriptVersionUpdateInput {
  const row = object(value, "body");
  exact(
    row,
    [
      "expectedRevision",
      "code",
      "manifest",
      "inputSchema",
      "outputSchema",
      "runtime",
      "entryCommand",
      "limits"
    ],
    "body"
  );
  return {
    expectedRevision: integer(row.expectedRevision, "expectedRevision", 1, 2_147_483_647),
    ...parseVersionCore(row)
  };
}

export function parseExpectedRevision(value: unknown): number {
  const row = object(value, "body");
  exact(row, ["expectedRevision"], "body");
  return integer(row.expectedRevision, "expectedRevision", 1, 2_147_483_647);
}

export function parseOrderedScriptIds(value: unknown): string[] {
  const row = object(value, "body");
  exact(row, ["scriptIds"], "body");
  if (!Array.isArray(row.scriptIds) || row.scriptIds.length > 100) {
    throw new Error("scriptIds must be an array with at most 100 entries.");
  }
  const seen = new Set<string>();
  return row.scriptIds.map((item) => {
    if (typeof item !== "string" || !UUID_PATTERN.test(item.trim())) {
      throw new Error("scriptIds must contain valid UUIDs.");
    }
    const normalized = item.trim().toLowerCase();
    if (seen.has(normalized)) throw new Error("scriptIds must not contain duplicates.");
    seen.add(normalized);
    return item.trim();
  });
}

export function validateExecutableContract(input: ScriptVersionWriteInput): void {
  validateJsonSchema(input.inputSchema, "inputSchema");
  validateJsonSchema(input.outputSchema, "outputSchema");
}

export function computeScriptContentHash(input: ScriptVersionWriteInput): string {
  return createHash("sha256").update(canonicalJson(input)).digest("hex");
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const row = value as Record<string, unknown>;
  return `{${Object.keys(row)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(row[key])}`)
    .join(",")}}`;
}

export function toScriptState(row: Script): ScriptState {
  return {
    id: row.id,
    key: row.key,
    name: localized(row.name),
    description: localized(row.description),
    status: row.status,
    category: row.category,
    icon: row.icon,
    color: row.color,
    displayOrder: row.displayOrder,
    currentPublishedVersionId: row.currentPublishedVersionId,
    createdByUserId: row.createdByUserId,
    updatedByUserId: row.updatedByUserId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}

export function toScriptVersionState(row: ScriptVersion): ScriptVersionState {
  return {
    id: row.id,
    scriptId: row.scriptId,
    version: row.version,
    status: row.status,
    code: row.code,
    manifest: row.manifest as ScriptManifest,
    inputSchema: row.inputSchema as Record<string, unknown>,
    outputSchema: row.outputSchema as Record<string, unknown>,
    runtime: row.runtime,
    entryCommand: row.entryCommand,
    limits: row.limits as ScriptLimits,
    contentHash: row.contentHash,
    revision: row.revision,
    createdByUserId: row.createdByUserId,
    publishedByUserId: row.publishedByUserId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    publishedAt: row.publishedAt?.toISOString() ?? null
  };
}

export function toSkillScriptLinkState(
  row: SkillScript & { script: Script }
): SkillScriptLinkState {
  return {
    scriptId: row.scriptId,
    displayOrder: row.displayOrder,
    createdAt: row.createdAt.toISOString(),
    script: toScriptState(row.script)
  };
}

function parseCore(row: Record<string, unknown>): ScriptCoreInput {
  return {
    name: localizedInput(row.name, "name", 500),
    description: localizedInput(row.description, "description", 2_000),
    category: text(row.category, "category", 1, 64),
    icon: nullableText(row.icon, "icon", 64),
    color: nullableText(row.color, "color", 32),
    displayOrder: integer(row.displayOrder, "displayOrder", -1_000_000, 1_000_000)
  };
}

function parseVersionCore(row: Record<string, unknown>): ScriptVersionWriteInput {
  const runtime = text(row.runtime, "runtime", 1, 64);
  if (!RUNTIME_PATTERN.test(runtime)) throw new Error("runtime has an invalid format.");
  const result = {
    code: text(row.code, "code", 1, 1_000_000, false),
    manifest: manifest(row.manifest),
    inputSchema: jsonObject(row.inputSchema, "inputSchema"),
    outputSchema: jsonObject(row.outputSchema, "outputSchema"),
    runtime,
    entryCommand: text(row.entryCommand, "entryCommand", 1, 4_096, false),
    limits: limits(row.limits)
  };
  validateExecutableContract(result);
  return result;
}

function manifest(value: unknown): ScriptManifest {
  const row = object(value, "manifest");
  exact(row, ["schemaVersion", "workingDirectory", "environment"], "manifest");
  if (row.schemaVersion !== 1) throw new Error("manifest.schemaVersion must be 1.");
  const environmentRow = object(row.environment, "manifest.environment");
  if (Object.keys(environmentRow).length > 64)
    throw new Error("manifest.environment is too large.");
  const environment: Record<string, string> = {};
  for (const [key, val] of Object.entries(environmentRow)) {
    if (!/^[A-Z_][A-Z0-9_]{0,127}$/.test(key))
      throw new Error("manifest environment key is invalid.");
    environment[key] = text(val, `manifest.environment.${key}`, 0, 4_096, false);
  }
  return {
    schemaVersion: 1,
    workingDirectory: nullableText(row.workingDirectory, "manifest.workingDirectory", 512),
    environment
  };
}

function limits(value: unknown): ScriptLimits {
  const row = object(value, "limits");
  exact(row, ["timeoutMs", "maxMemoryMb", "maxCpuMillicores", "maxOutputBytes"], "limits");
  return {
    timeoutMs: integer(row.timeoutMs, "limits.timeoutMs", 100, 1_800_000),
    maxMemoryMb: integer(row.maxMemoryMb, "limits.maxMemoryMb", 16, 32_768),
    maxCpuMillicores: integer(row.maxCpuMillicores, "limits.maxCpuMillicores", 10, 16_000),
    maxOutputBytes: integer(row.maxOutputBytes, "limits.maxOutputBytes", 1, 100_000_000)
  };
}

function validateJsonSchema(schema: Record<string, unknown>, path: string): void {
  const serialized = JSON.stringify(schema);
  if (Buffer.byteLength(serialized, "utf8") > MAX_SCHEMA_BYTES)
    throw new Error(`${path} is too large.`);
  if (depth(schema) > MAX_SCHEMA_DEPTH) throw new Error(`${path} is too deep.`);
  rejectRemoteRefs(schema, path);
  if (!ajv.validateSchema(schema)) {
    throw new Error(`${path} is not a valid JSON Schema Draft 2020-12 schema.`);
  }
  ajv.compile(schema);
}

function rejectRemoteRefs(value: unknown, path: string): void {
  if (Array.isArray(value)) return value.forEach((item) => rejectRemoteRefs(item, path));
  if (value === null || typeof value !== "object") return;
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (
      (key === "$ref" || key === "$dynamicRef") &&
      typeof item === "string" &&
      !item.startsWith("#")
    ) {
      throw new Error(`${path} must not contain remote references.`);
    }
    rejectRemoteRefs(item, path);
  }
}

function depth(value: unknown): number {
  if (value === null || typeof value !== "object") return 0;
  const values = Array.isArray(value) ? value : Object.values(value);
  return 1 + Math.max(0, ...values.map(depth));
}

function localizedInput(value: unknown, path: string, max: number): LocalizedScriptText {
  const row = object(value, path);
  exact(row, ["ru", "en"], path);
  return { ru: text(row.ru, `${path}.ru`, 1, max), en: text(row.en, `${path}.en`, 1, max) };
}

function localized(value: unknown): LocalizedScriptText {
  const row = object(value, "localized value");
  return {
    ru: typeof row.ru === "string" ? row.ru : "",
    en: typeof row.en === "string" ? row.en : ""
  };
}

function jsonObject(value: unknown, path: string): Record<string, unknown> {
  return object(value, path);
}

function object(value: unknown, path: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${path} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function exact(row: Record<string, unknown>, keys: readonly string[], path: string): void {
  const allowed = new Set(keys);
  const unknown = Object.keys(row).filter((key) => !allowed.has(key));
  const missing = keys.filter((key) => !Object.prototype.hasOwnProperty.call(row, key));
  if (unknown.length > 0)
    throw new Error(`${path} contains unknown fields: ${unknown.sort().join(", ")}.`);
  if (missing.length > 0) throw new Error(`${path} is missing fields: ${missing.join(", ")}.`);
}

function text(value: unknown, path: string, min: number, max: number, trim = true): string {
  if (typeof value !== "string") throw new Error(`${path} must be a string.`);
  const result = trim ? value.trim() : value;
  if (result.length < min || result.length > max) throw new Error(`${path} has an invalid length.`);
  return result;
}

function nullableText(value: unknown, path: string, max: number): string | null {
  return value === null ? null : text(value, path, 1, max);
}

function integer(value: unknown, path: string, min: number, max: number): number {
  if (!Number.isInteger(value) || (value as number) < min || (value as number) > max) {
    throw new Error(`${path} must be an integer between ${String(min)} and ${String(max)}.`);
  }
  return value as number;
}
