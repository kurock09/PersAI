export const ADMIN_KNOWLEDGE_RETRIEVAL_POLICY_SCHEMA = "persai.adminKnowledgeRetrievalPolicy.v1";

const MAX_MODEL_KEY_LENGTH = 255;

export type AdminKnowledgeRetrievalPolicyState = {
  schema: typeof ADMIN_KNOWLEDGE_RETRIEVAL_POLICY_SCHEMA;
  embeddingModelKey: string | null;
  retrievalModelKey: string | null;
  authoringModelKey: string | null;
  notes: string[];
};

export type UpdateAdminKnowledgeRetrievalPolicyInput = {
  embeddingModelKey: string | null;
  retrievalModelKey: string | null;
  authoringModelKey: string | null;
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
    authoringModelKey: normalizeOptionalModelKey(row.authoringModelKey, "authoringModelKey")
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
  return buildAdminKnowledgeRetrievalPolicyState({
    embeddingModelKey,
    retrievalModelKey,
    authoringModelKey
  });
}

export function buildAdminKnowledgeRetrievalPolicyState(input: {
  embeddingModelKey: string | null;
  retrievalModelKey: string | null;
  authoringModelKey: string | null;
}): AdminKnowledgeRetrievalPolicyState {
  return {
    schema: ADMIN_KNOWLEDGE_RETRIEVAL_POLICY_SCHEMA,
    embeddingModelKey: input.embeddingModelKey,
    retrievalModelKey: input.retrievalModelKey,
    authoringModelKey: input.authoringModelKey,
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
        : `Assistant-assisted admin authoring uses ${input.authoringModelKey}.`
    ]
  };
}

export function toAdminKnowledgeRetrievalPolicyRecord(
  policy: Pick<
    AdminKnowledgeRetrievalPolicyState,
    "embeddingModelKey" | "retrievalModelKey" | "authoringModelKey"
  >
): Record<string, string | null> {
  return {
    schema: ADMIN_KNOWLEDGE_RETRIEVAL_POLICY_SCHEMA,
    embeddingModelKey: policy.embeddingModelKey,
    retrievalModelKey: policy.retrievalModelKey,
    authoringModelKey: policy.authoringModelKey
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
