export const ADMIN_KNOWLEDGE_RETRIEVAL_POLICY_SCHEMA = "persai.adminKnowledgeRetrievalPolicy.v1";

const MAX_MODEL_KEY_LENGTH = 255;

/**
 * ADR-094 — admin-controlled hard ceilings and "form of response" knobs for
 * the smart `knowledge_search` and the flexible `knowledge_fetch`. These are
 * NOT per-tier volume caps (those live in the plan billing hints); they are
 * the upper bounds that no plan can override.
 */
export const DEFAULT_ADMIN_KNOWLEDGE_SMART_RETRIEVAL_LIMITS = {
  smartSearchEnabled: true,
  smartSearchLongDocSummaryChars: 800,
  fetchFullModeAbsoluteMaxChars: 100_000,
  fetchFullModeAbsoluteMaxChatMessages: 800
} as const;

export type AdminKnowledgeRetrievalPolicyState = {
  schema: typeof ADMIN_KNOWLEDGE_RETRIEVAL_POLICY_SCHEMA;
  embeddingModelKey: string | null;
  retrievalModelKey: string | null;
  authoringModelKey: string | null;
  smartSearchEnabled: boolean;
  smartSearchLongDocSummaryChars: number;
  fetchFullModeAbsoluteMaxChars: number;
  fetchFullModeAbsoluteMaxChatMessages: number;
  notes: string[];
};

export type UpdateAdminKnowledgeRetrievalPolicyInput = {
  embeddingModelKey: string | null;
  retrievalModelKey: string | null;
  authoringModelKey: string | null;
  smartSearchEnabled: boolean;
  smartSearchLongDocSummaryChars: number;
  fetchFullModeAbsoluteMaxChars: number;
  fetchFullModeAbsoluteMaxChatMessages: number;
};

export function parseUpdateAdminKnowledgeRetrievalPolicyInput(
  body: unknown
): UpdateAdminKnowledgeRetrievalPolicyInput {
  const row = asObject(body);
  if (row === null) {
    throw new Error("Request body must be an object.");
  }
  return {
    embeddingModelKey: normalizeOptionalModelKey(row.embeddingModelKey, "embeddingModelKey"),
    retrievalModelKey: normalizeOptionalModelKey(row.retrievalModelKey, "retrievalModelKey"),
    authoringModelKey: normalizeOptionalModelKey(row.authoringModelKey, "authoringModelKey"),
    smartSearchEnabled: normalizeOptionalBooleanWithDefault(
      row.smartSearchEnabled,
      "smartSearchEnabled",
      DEFAULT_ADMIN_KNOWLEDGE_SMART_RETRIEVAL_LIMITS.smartSearchEnabled
    ),
    smartSearchLongDocSummaryChars: normalizeOptionalPositiveIntWithDefault(
      row.smartSearchLongDocSummaryChars,
      "smartSearchLongDocSummaryChars",
      DEFAULT_ADMIN_KNOWLEDGE_SMART_RETRIEVAL_LIMITS.smartSearchLongDocSummaryChars
    ),
    fetchFullModeAbsoluteMaxChars: normalizeOptionalPositiveIntWithDefault(
      row.fetchFullModeAbsoluteMaxChars,
      "fetchFullModeAbsoluteMaxChars",
      DEFAULT_ADMIN_KNOWLEDGE_SMART_RETRIEVAL_LIMITS.fetchFullModeAbsoluteMaxChars
    ),
    fetchFullModeAbsoluteMaxChatMessages: normalizeOptionalPositiveIntWithDefault(
      row.fetchFullModeAbsoluteMaxChatMessages,
      "fetchFullModeAbsoluteMaxChatMessages",
      DEFAULT_ADMIN_KNOWLEDGE_SMART_RETRIEVAL_LIMITS.fetchFullModeAbsoluteMaxChatMessages
    )
  };
}

export function normalizeAdminKnowledgeRetrievalPolicyRecord(
  value: unknown
): AdminKnowledgeRetrievalPolicyState {
  const row = asObject(value);
  const embeddingModelKey =
    row === null ? null : normalizeStoredModelKey(row.embeddingModelKey, "embeddingModelKey");
  const retrievalModelKey =
    row === null ? null : normalizeStoredModelKey(row.retrievalModelKey, "retrievalModelKey");
  const authoringModelKey =
    row === null ? null : normalizeStoredModelKey(row.authoringModelKey, "authoringModelKey");
  const smartSearchEnabled =
    row === null
      ? DEFAULT_ADMIN_KNOWLEDGE_SMART_RETRIEVAL_LIMITS.smartSearchEnabled
      : normalizeStoredBoolean(
          row.smartSearchEnabled,
          DEFAULT_ADMIN_KNOWLEDGE_SMART_RETRIEVAL_LIMITS.smartSearchEnabled
        );
  const smartSearchLongDocSummaryChars =
    row === null
      ? DEFAULT_ADMIN_KNOWLEDGE_SMART_RETRIEVAL_LIMITS.smartSearchLongDocSummaryChars
      : normalizeStoredPositiveInt(
          row.smartSearchLongDocSummaryChars,
          DEFAULT_ADMIN_KNOWLEDGE_SMART_RETRIEVAL_LIMITS.smartSearchLongDocSummaryChars
        );
  const fetchFullModeAbsoluteMaxChars =
    row === null
      ? DEFAULT_ADMIN_KNOWLEDGE_SMART_RETRIEVAL_LIMITS.fetchFullModeAbsoluteMaxChars
      : normalizeStoredPositiveInt(
          row.fetchFullModeAbsoluteMaxChars,
          DEFAULT_ADMIN_KNOWLEDGE_SMART_RETRIEVAL_LIMITS.fetchFullModeAbsoluteMaxChars
        );
  const fetchFullModeAbsoluteMaxChatMessages =
    row === null
      ? DEFAULT_ADMIN_KNOWLEDGE_SMART_RETRIEVAL_LIMITS.fetchFullModeAbsoluteMaxChatMessages
      : normalizeStoredPositiveInt(
          row.fetchFullModeAbsoluteMaxChatMessages,
          DEFAULT_ADMIN_KNOWLEDGE_SMART_RETRIEVAL_LIMITS.fetchFullModeAbsoluteMaxChatMessages
        );
  return buildAdminKnowledgeRetrievalPolicyState({
    embeddingModelKey,
    retrievalModelKey,
    authoringModelKey,
    smartSearchEnabled,
    smartSearchLongDocSummaryChars,
    fetchFullModeAbsoluteMaxChars,
    fetchFullModeAbsoluteMaxChatMessages
  });
}

export function buildAdminKnowledgeRetrievalPolicyState(input: {
  embeddingModelKey: string | null;
  retrievalModelKey: string | null;
  authoringModelKey: string | null;
  smartSearchEnabled: boolean;
  smartSearchLongDocSummaryChars: number;
  fetchFullModeAbsoluteMaxChars: number;
  fetchFullModeAbsoluteMaxChatMessages: number;
}): AdminKnowledgeRetrievalPolicyState {
  return {
    schema: ADMIN_KNOWLEDGE_RETRIEVAL_POLICY_SCHEMA,
    embeddingModelKey: input.embeddingModelKey,
    retrievalModelKey: input.retrievalModelKey,
    authoringModelKey: input.authoringModelKey,
    smartSearchEnabled: input.smartSearchEnabled,
    smartSearchLongDocSummaryChars: input.smartSearchLongDocSummaryChars,
    fetchFullModeAbsoluteMaxChars: input.fetchFullModeAbsoluteMaxChars,
    fetchFullModeAbsoluteMaxChatMessages: input.fetchFullModeAbsoluteMaxChatMessages,
    notes: [
      "This policy applies to admin-owned Product KB documents and Skill documents.",
      "User-uploaded assistant knowledge continues to use the assistant plan retrieval slots.",
      input.embeddingModelKey === null
        ? "Admin-owned KB vector search is disabled until an embedding model is configured."
        : `Admin-owned KB vector search uses ${input.embeddingModelKey}.`,
      input.retrievalModelKey === null
        ? "Admin-owned KB helper rerank is disabled until a retrieval helper model is configured."
        : `Admin-owned KB helper rerank uses ${input.retrievalModelKey}.`,
      input.authoringModelKey === null
        ? "Assistant-assisted admin authoring uses the platform primary chat model."
        : `Assistant-assisted admin authoring uses ${input.authoringModelKey}.`,
      input.smartSearchEnabled
        ? `Smart search is enabled. Documents up to plan-level smartSearchShortDocChars are inlined whole; documents up to smartSearchMediumDocChars are inlined as a section; longer documents are returned as a section plus a heading summary capped at ${String(
            input.smartSearchLongDocSummaryChars
          )} characters.`
        : "Smart search is disabled. knowledge_search returns snippets only and the model must call knowledge_fetch for content.",
      `knowledge_fetch with mode = "full" is hard-capped at ${String(
        input.fetchFullModeAbsoluteMaxChars
      )} characters for documents and ${String(
        input.fetchFullModeAbsoluteMaxChatMessages
      )} messages for chat. No plan can exceed these ceilings.`
    ]
  };
}

export function toAdminKnowledgeRetrievalPolicyRecord(
  policy: Pick<
    AdminKnowledgeRetrievalPolicyState,
    | "embeddingModelKey"
    | "retrievalModelKey"
    | "authoringModelKey"
    | "smartSearchEnabled"
    | "smartSearchLongDocSummaryChars"
    | "fetchFullModeAbsoluteMaxChars"
    | "fetchFullModeAbsoluteMaxChatMessages"
  >
): Record<string, string | number | boolean | null> {
  return {
    schema: ADMIN_KNOWLEDGE_RETRIEVAL_POLICY_SCHEMA,
    embeddingModelKey: policy.embeddingModelKey,
    retrievalModelKey: policy.retrievalModelKey,
    authoringModelKey: policy.authoringModelKey,
    smartSearchEnabled: policy.smartSearchEnabled,
    smartSearchLongDocSummaryChars: policy.smartSearchLongDocSummaryChars,
    fetchFullModeAbsoluteMaxChars: policy.fetchFullModeAbsoluteMaxChars,
    fetchFullModeAbsoluteMaxChatMessages: policy.fetchFullModeAbsoluteMaxChatMessages
  };
}

function normalizeOptionalModelKey(value: unknown, path: string): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== "string") {
    throw new Error(`${path} must be a string or null.`);
  }
  const normalized = value.trim();
  if (normalized.length === 0) {
    return null;
  }
  if (normalized.length > MAX_MODEL_KEY_LENGTH) {
    throw new Error(`${path} must be at most ${String(MAX_MODEL_KEY_LENGTH)} characters.`);
  }
  if (containsControlCharacters(normalized)) {
    throw new Error(`${path} contains invalid control characters.`);
  }
  return normalized;
}

function normalizeStoredModelKey(value: unknown, path: string): string | null {
  try {
    return normalizeOptionalModelKey(value, path);
  } catch {
    return null;
  }
}

function normalizeOptionalBooleanWithDefault(
  value: unknown,
  path: string,
  defaultValue: boolean
): boolean {
  if (value === undefined || value === null) {
    return defaultValue;
  }
  if (typeof value !== "boolean") {
    throw new Error(`${path} must be a boolean.`);
  }
  return value;
}

function normalizeOptionalPositiveIntWithDefault(
  value: unknown,
  path: string,
  defaultValue: number
): number {
  if (value === undefined || value === null) {
    return defaultValue;
  }
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new Error(`${path} must be an integer greater than 0.`);
  }
  return value;
}

function normalizeStoredBoolean(value: unknown, defaultValue: boolean): boolean {
  return typeof value === "boolean" ? value : defaultValue;
}

function normalizeStoredPositiveInt(value: unknown, defaultValue: number): number {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : defaultValue;
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
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
