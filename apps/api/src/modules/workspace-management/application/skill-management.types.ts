import type {
  AssistantSkillAssignment,
  KnowledgeIndexingJob,
  Skill,
  SkillDocument
} from "@prisma/client";

export type SkillStatus = "draft" | "active" | "archived";
export type SkillLocalizedText = Record<string, string>;

export type SkillInstructionCardState = {
  title: string;
  body: string;
  guardrails: string[];
  examples: string[];
};

export type AdminSkillUpsertInput = {
  name: SkillLocalizedText;
  description: SkillLocalizedText;
  category: string;
  tags: string[];
  instructionCard: SkillInstructionCardState;
  iconEmoji: string | null;
  color: string | null;
  displayOrder: number | null;
  status: SkillStatus | null;
};

export type SkillDocumentUploadInput = {
  displayName: string | null;
  description: string | null;
};

export type SkillDocumentState = {
  id: string;
  skillId: string;
  displayName: string | null;
  description: string | null;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  status: "processing" | "ready" | "failed" | "needs_review";
  currentVersion: number;
  chunkCount: number;
  processorProviderKey: string | null;
  processorMode: "auto" | "local" | "default_provider" | "high_quality_fallback" | null;
  processingQuality: Record<string, unknown> | null;
  lastIndexedAt: string | null;
  lastReindexRequestedAt: string | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AdminSkillState = {
  id: string;
  status: SkillStatus;
  name: SkillLocalizedText;
  description: SkillLocalizedText;
  category: string;
  tags: string[];
  instructionCard: SkillInstructionCardState;
  iconEmoji: string | null;
  color: string | null;
  displayOrder: number;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  documents: SkillDocumentState[];
};

export type AssistantSkillAssignmentState = {
  id: string;
  skillId: string;
  status: "active" | "disabled" | "archived" | "plan_disabled";
  disabledReason: string | null;
  enabledAt: string | null;
  disabledAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AssistantSkillCatalogItemState = {
  skill: AdminSkillState;
  assignment: AssistantSkillAssignmentState | null;
  selectable: boolean;
  disabledReason: string | null;
};

export type AssistantSkillsState = {
  skills: AssistantSkillCatalogItemState[];
  assignedSkillIds: string[];
  limit: number | null;
};

export type KnowledgeIndexingJobState = {
  id: string;
  sourceType: "assistant_knowledge_source" | "global_knowledge_source" | "skill_document";
  sourceId: string;
  sourceVersion: number;
  status: "pending" | "in_progress" | "completed" | "failed" | "needs_review" | "cancelled";
  processorMode: "auto" | "local" | "default_provider" | "high_quality_fallback";
  selectedProviderKey: string | null;
  fallbackProviderKey: string | null;
  attemptCount: number;
  maxAttempts: number;
  retryAfterAt: string | null;
  extractionQuality: Record<string, unknown> | null;
  resultPayload: Record<string, unknown> | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

const MAX_LOCALIZED_TEXT_CHARS = 500;
const MAX_INSTRUCTION_TITLE_CHARS = 120;
const MAX_INSTRUCTION_BODY_CHARS = 1_200;
const MAX_INSTRUCTION_ITEM_CHARS = 240;
const MAX_TAGS = 12;
const MAX_TAG_CHARS = 40;

export function parseAdminSkillUpsertInput(body: unknown): AdminSkillUpsertInput {
  const row = asObject(body, "Request body");
  return {
    name: parseLocalizedText(row.name, "name"),
    description: parseLocalizedText(row.description, "description"),
    category: parseBoundedString(row.category, "category", 1, 64),
    tags: parseStringList(row.tags, "tags", MAX_TAGS, MAX_TAG_CHARS),
    instructionCard: parseInstructionCard(row.instructionCard),
    iconEmoji: parseNullableBoundedString(row.iconEmoji, "iconEmoji", 16),
    color: parseNullableBoundedString(row.color, "color", 32),
    displayOrder: parseNullableInteger(row.displayOrder, "displayOrder"),
    status: parseNullableStatus(row.status, "status")
  };
}

export function parseSkillDocumentUploadInput(body: unknown): SkillDocumentUploadInput {
  const row = body === null || body === undefined ? {} : asObject(body, "Request body");
  return {
    displayName: parseNullableBoundedString(row.displayName, "displayName", 255),
    description: parseNullableBoundedString(row.description, "description", 2_000)
  };
}

export function parseAssistantSkillAssignmentsInput(body: unknown): { skillIds: string[] } {
  const row = asObject(body, "Request body");
  if (!Array.isArray(row.skillIds)) {
    throw new Error("skillIds must be an array.");
  }
  const deduped = new Set<string>();
  for (const value of row.skillIds) {
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new Error("skillIds must contain non-empty strings.");
    }
    deduped.add(value.trim());
  }
  return { skillIds: [...deduped] };
}

export function toAdminSkillState(skill: Skill & { documents?: SkillDocument[] }): AdminSkillState {
  return {
    id: skill.id,
    status: skill.status,
    name: normalizeLocalizedTextState(skill.name),
    description: normalizeLocalizedTextState(skill.description),
    category: skill.category,
    tags: normalizeStringArray(skill.tags),
    instructionCard: normalizeInstructionCardState(skill.instructionCard),
    iconEmoji: skill.iconEmoji,
    color: skill.color,
    displayOrder: skill.displayOrder,
    archivedAt: skill.archivedAt?.toISOString() ?? null,
    createdAt: skill.createdAt.toISOString(),
    updatedAt: skill.updatedAt.toISOString(),
    documents: (skill.documents ?? []).map(toSkillDocumentState)
  };
}

export function toSkillDocumentState(document: SkillDocument): SkillDocumentState {
  return {
    id: document.id,
    skillId: document.skillId,
    displayName: document.displayName,
    description: document.description,
    originalFilename: document.originalFilename,
    mimeType: document.mimeType,
    sizeBytes: Number(document.sizeBytes),
    status: document.status,
    currentVersion: document.currentVersion,
    chunkCount: document.chunkCount,
    processorProviderKey: document.processorProviderKey,
    processorMode: document.processorMode,
    processingQuality: normalizeRecord(document.processingQuality),
    lastIndexedAt: document.lastIndexedAt?.toISOString() ?? null,
    lastReindexRequestedAt: document.lastReindexRequestedAt?.toISOString() ?? null,
    lastErrorCode: document.lastErrorCode,
    lastErrorMessage: document.lastErrorMessage,
    createdAt: document.createdAt.toISOString(),
    updatedAt: document.updatedAt.toISOString()
  };
}

export function toAssistantSkillAssignmentState(
  assignment: AssistantSkillAssignment
): AssistantSkillAssignmentState {
  return {
    id: assignment.id,
    skillId: assignment.skillId,
    status: assignment.status,
    disabledReason: assignment.disabledReason,
    enabledAt: assignment.enabledAt?.toISOString() ?? null,
    disabledAt: assignment.disabledAt?.toISOString() ?? null,
    createdAt: assignment.createdAt.toISOString(),
    updatedAt: assignment.updatedAt.toISOString()
  };
}

export function toKnowledgeIndexingJobState(job: KnowledgeIndexingJob): KnowledgeIndexingJobState {
  return {
    id: job.id,
    sourceType: job.sourceType,
    sourceId: job.sourceId,
    sourceVersion: job.sourceVersion,
    status: job.status,
    processorMode: job.processorMode,
    selectedProviderKey: job.selectedProviderKey,
    fallbackProviderKey: job.fallbackProviderKey,
    attemptCount: job.attemptCount,
    maxAttempts: job.maxAttempts,
    retryAfterAt: job.retryAfterAt?.toISOString() ?? null,
    extractionQuality: normalizeRecord(job.extractionQuality),
    resultPayload: normalizeRecord(job.resultPayload),
    lastErrorCode: job.lastErrorCode,
    lastErrorMessage: job.lastErrorMessage,
    startedAt: job.startedAt?.toISOString() ?? null,
    completedAt: job.completedAt?.toISOString() ?? null,
    createdAt: job.createdAt.toISOString(),
    updatedAt: job.updatedAt.toISOString()
  };
}

function parseLocalizedText(value: unknown, path: string): SkillLocalizedText {
  const row = asObject(value, path);
  const result: SkillLocalizedText = {};
  for (const [locale, textValue] of Object.entries(row)) {
    const localeKey = parseBoundedString(locale, `${path} locale`, 2, 16).toLowerCase();
    result[localeKey] = parseBoundedString(
      textValue,
      `${path}.${localeKey}`,
      1,
      MAX_LOCALIZED_TEXT_CHARS
    );
  }
  if (Object.keys(result).length === 0) {
    throw new Error(`${path} must contain at least one localized value.`);
  }
  return result;
}

function parseInstructionCard(value: unknown): SkillInstructionCardState {
  const row = asObject(value, "instructionCard");
  return {
    title: parseBoundedString(row.title, "instructionCard.title", 1, MAX_INSTRUCTION_TITLE_CHARS),
    body: parseBoundedString(row.body, "instructionCard.body", 1, MAX_INSTRUCTION_BODY_CHARS),
    guardrails: parseStringList(
      row.guardrails,
      "instructionCard.guardrails",
      8,
      MAX_INSTRUCTION_ITEM_CHARS
    ),
    examples: parseStringList(
      row.examples,
      "instructionCard.examples",
      8,
      MAX_INSTRUCTION_ITEM_CHARS
    )
  };
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
  const deduped = new Set<string>();
  for (const item of value) {
    const parsed = parseBoundedString(item, `${path}[]`, 1, maxItemChars);
    deduped.add(parsed);
    if (deduped.size > maxItems) {
      throw new Error(`${path} must contain at most ${String(maxItems)} items.`);
    }
  }
  return [...deduped];
}

function parseNullableStatus(value: unknown, path: string): SkillStatus | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (value === "draft" || value === "active" || value === "archived") {
    return value;
  }
  throw new Error(`${path} must be draft, active, or archived.`);
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
  if (containsControlCharacters(trimmed)) {
    throw new Error(`${path} contains invalid control characters.`);
  }
  return trimmed;
}

function asObject(value: unknown, path: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${path} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function containsControlCharacters(value: string): boolean {
  for (const char of value) {
    const code = char.codePointAt(0);
    if (code !== undefined && (code <= 0x1f || (code >= 0x7f && code <= 0x9f))) {
      return true;
    }
  }
  return false;
}

function normalizeLocalizedTextState(value: unknown): SkillLocalizedText {
  const row = normalizeRecord(value);
  const result: SkillLocalizedText = {};
  for (const [key, textValue] of Object.entries(row ?? {})) {
    if (typeof textValue === "string") {
      result[key] = textValue;
    }
  }
  return result;
}

function normalizeInstructionCardState(value: unknown): SkillInstructionCardState {
  const row = normalizeRecord(value);
  return {
    title: typeof row?.title === "string" ? row.title : "",
    body: typeof row?.body === "string" ? row.body : "",
    guardrails: normalizeStringArray(row?.guardrails),
    examples: normalizeStringArray(row?.examples)
  };
}

function normalizeStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function normalizeRecord(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}
