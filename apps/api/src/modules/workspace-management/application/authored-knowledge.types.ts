import type { ProductKnowledgeTextEntry, SkillKnowledgeCard } from "@prisma/client";
import type { AssistantKnowledgeSourceStatus } from "./assistant-knowledge-source.types";

export type KnowledgeLifecycleStatus = "draft" | "active" | "stale" | "archived";
export type KnowledgeAuthoringProvenanceKind =
  | "manual"
  | "assistant_generated"
  | "document_summary"
  | "imported";

export type SkillKnowledgeCardInput = {
  title: string;
  body: string;
  locale: string | null;
  tags: string[];
  lifecycleStatus: KnowledgeLifecycleStatus | null;
  provenanceKind: KnowledgeAuthoringProvenanceKind;
  provenanceMetadata: Record<string, unknown> | null;
};

export type ProductKnowledgeTextEntryInput = SkillKnowledgeCardInput & {
  category: string | null;
};

export type AuthoredKnowledgeProcessingState = {
  status: AssistantKnowledgeSourceStatus;
  currentVersion: number;
  chunkCount: number;
  processorProviderKey: string | null;
  processorMode: "auto" | "local" | "default_provider" | "high_quality_fallback" | null;
  processingQuality: Record<string, unknown> | null;
  lastIndexedAt: string | null;
  lastReindexRequestedAt: string | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
};

export type SkillKnowledgeCardState = AuthoredKnowledgeProcessingState & {
  id: string;
  skillId: string;
  title: string;
  body: string;
  locale: string | null;
  tags: string[];
  lifecycleStatus: KnowledgeLifecycleStatus;
  provenanceKind: KnowledgeAuthoringProvenanceKind;
  provenanceMetadata: Record<string, unknown> | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ProductKnowledgeTextEntryState = AuthoredKnowledgeProcessingState & {
  id: string;
  title: string;
  body: string;
  category: string | null;
  locale: string | null;
  tags: string[];
  lifecycleStatus: KnowledgeLifecycleStatus;
  provenanceKind: KnowledgeAuthoringProvenanceKind;
  provenanceMetadata: Record<string, unknown> | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

const MAX_TITLE_CHARS = 255;
const MAX_BODY_CHARS = 80_000;
const MAX_TAGS = 20;
const MAX_TAG_CHARS = 48;

export function parseSkillKnowledgeCardInput(body: unknown): SkillKnowledgeCardInput {
  const row = asObject(body, "Request body");
  return {
    title: parseBoundedString(row.title, "title", 1, MAX_TITLE_CHARS),
    body: parseBoundedString(row.body, "body", 1, MAX_BODY_CHARS),
    locale: parseNullableBoundedString(row.locale, "locale", 16),
    tags: parseStringList(row.tags, "tags", MAX_TAGS, MAX_TAG_CHARS),
    lifecycleStatus: parseNullableLifecycleStatus(row.lifecycleStatus, "lifecycleStatus"),
    provenanceKind: parseProvenanceKind(row.provenanceKind),
    provenanceMetadata: parseNullableRecord(row.provenanceMetadata, "provenanceMetadata")
  };
}

export function parseProductKnowledgeTextEntryInput(body: unknown): ProductKnowledgeTextEntryInput {
  const row = asObject(body, "Request body");
  return {
    title: parseBoundedString(row.title, "title", 1, MAX_TITLE_CHARS),
    body: parseBoundedString(row.body, "body", 1, MAX_BODY_CHARS),
    category: parseNullableBoundedString(row.category, "category", 128),
    locale: parseNullableBoundedString(row.locale, "locale", 16),
    tags: parseStringList(row.tags, "tags", MAX_TAGS, MAX_TAG_CHARS),
    lifecycleStatus: parseNullableLifecycleStatus(row.lifecycleStatus, "lifecycleStatus"),
    provenanceKind: parseProvenanceKind(row.provenanceKind),
    provenanceMetadata: parseNullableRecord(row.provenanceMetadata, "provenanceMetadata")
  };
}

export function toSkillKnowledgeCardState(row: SkillKnowledgeCard): SkillKnowledgeCardState {
  return {
    id: row.id,
    skillId: row.skillId,
    title: row.title,
    body: row.body,
    locale: row.locale,
    tags: normalizeStringArray(row.tags),
    lifecycleStatus: row.lifecycleStatus,
    provenanceKind: row.provenanceKind,
    provenanceMetadata: normalizeRecord(row.provenanceMetadata),
    ...toProcessingState(row),
    archivedAt: row.archivedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}

export function toProductKnowledgeTextEntryState(
  row: ProductKnowledgeTextEntry
): ProductKnowledgeTextEntryState {
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    category: row.category,
    locale: row.locale,
    tags: normalizeStringArray(row.tags),
    lifecycleStatus: row.lifecycleStatus,
    provenanceKind: row.provenanceKind,
    provenanceMetadata: normalizeRecord(row.provenanceMetadata),
    ...toProcessingState(row),
    archivedAt: row.archivedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}

function toProcessingState(row: SkillKnowledgeCard | ProductKnowledgeTextEntry) {
  return {
    status: row.status,
    currentVersion: row.currentVersion,
    chunkCount: row.chunkCount,
    processorProviderKey: row.processorProviderKey,
    processorMode: row.processorMode,
    processingQuality: normalizeRecord(row.processingQuality),
    lastIndexedAt: row.lastIndexedAt?.toISOString() ?? null,
    lastReindexRequestedAt: row.lastReindexRequestedAt?.toISOString() ?? null,
    lastErrorCode: row.lastErrorCode,
    lastErrorMessage: row.lastErrorMessage
  };
}

function parseNullableLifecycleStatus(
  value: unknown,
  path: string
): KnowledgeLifecycleStatus | null {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  if (value === "draft" || value === "active" || value === "stale" || value === "archived") {
    return value;
  }
  throw new Error(`${path} must be draft, active, stale, or archived.`);
}

function parseProvenanceKind(value: unknown): KnowledgeAuthoringProvenanceKind {
  if (value === undefined || value === null || value === "") {
    return "manual";
  }
  if (
    value === "manual" ||
    value === "assistant_generated" ||
    value === "document_summary" ||
    value === "imported"
  ) {
    return value;
  }
  throw new Error(
    "provenanceKind must be manual, assistant_generated, document_summary, or imported."
  );
}

function parseStringList(
  value: unknown,
  path: string,
  maxItems: number,
  maxChars: number
): string[] {
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value)) {
    throw new Error(`${path} must be an array.`);
  }
  const result: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const parsed = parseBoundedString(item, `${path} item`, 1, maxChars);
    const key = parsed.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      result.push(parsed);
    }
  }
  if (result.length > maxItems) {
    throw new Error(`${path} can contain at most ${String(maxItems)} items.`);
  }
  return result;
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
  if (trimmed.length < minChars) {
    throw new Error(`${path} is required.`);
  }
  if (trimmed.length > maxChars) {
    throw new Error(`${path} must be at most ${String(maxChars)} characters.`);
  }
  return trimmed;
}

function parseNullableRecord(value: unknown, path: string): Record<string, unknown> | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${path} must be an object when provided.`);
  }
  return value as Record<string, unknown>;
}

function asObject(value: unknown, path: string): Record<string, unknown> {
  if (value === null || value === undefined || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${path} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function normalizeStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function normalizeRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && value !== undefined && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
