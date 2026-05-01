import {
  DEFAULT_KNOWLEDGE_DOCUMENT_PROCESSING_POLICY,
  type KnowledgeDocumentProcessingPolicy
} from "./knowledge-document-processing-policy";
import type { PlatformRuntimeProviderKeyMetadata } from "./platform-runtime-provider-settings";
export const DOCUMENT_PROCESSING_SETTINGS_SCHEMA = "persai.adminDocumentProcessingSettings.v1";

export const DOCUMENT_PROCESSING_PROVIDER_SECRET_IDS = {
  mistral: "document-processing/mistral/api-key",
  llamaparse: "document-processing/llamaparse/api-key"
} as const;

export const DOCUMENT_PROCESSING_PROVIDER_SECRET_KEYS = {
  mistral: "document_processing_mistral",
  llamaparse: "document_processing_llamaparse"
} as const;

export type DocumentProcessingRemoteProviderKey =
  keyof typeof DOCUMENT_PROCESSING_PROVIDER_SECRET_IDS;

export const DOCUMENT_PROCESSING_PROVIDER_KEYS = ["local", "mistral", "llamaparse"] as const;

export type DocumentProcessingProviderKey = (typeof DOCUMENT_PROCESSING_PROVIDER_KEYS)[number];

export type DocumentProcessingProviderRole =
  | "local_fallback"
  | "default_provider"
  | "high_quality_fallback";

export type DocumentProcessingProviderState = {
  providerKey: DocumentProcessingProviderKey;
  enabled: boolean;
  configured: boolean;
  role: DocumentProcessingProviderRole;
  lastFour: string | null;
  updatedAt: string | null;
};

export type DocumentProcessingPolicyState = KnowledgeDocumentProcessingPolicy;

export type AdminDocumentProcessingSettingsState = {
  policy: DocumentProcessingPolicyState;
  providers: DocumentProcessingProviderState[];
  notes: string[];
};

export type AdminDocumentProcessingSettingsRequest = {
  policy: DocumentProcessingPolicyState;
  providerKeys: Partial<Record<DocumentProcessingRemoteProviderKey, string>>;
};

export type DocumentProcessingTestConnectionState = {
  providerKey: DocumentProcessingProviderKey;
  ok: boolean;
  message: string;
  checkedAt: string;
};

const MAX_PROVIDER_KEY_LENGTH = 512;

export function parseAdminDocumentProcessingSettingsRequest(
  body: unknown
): AdminDocumentProcessingSettingsRequest {
  const row = asObject(body, "Request body");
  const policy = parseDocumentProcessingPolicy(row.policy, "policy");
  const providerKeysRow = asObject(row.providerKeys, "providerKeys");
  const providerKeys: Partial<Record<DocumentProcessingRemoteProviderKey, string>> = {};
  for (const providerKey of ["mistral", "llamaparse"] as const) {
    const value = providerKeysRow[providerKey];
    if (value === undefined || value === null) {
      continue;
    }
    if (typeof value !== "string") {
      throw new Error(`providerKeys.${providerKey} must be a string when provided.`);
    }
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      continue;
    }
    if (trimmed.length > MAX_PROVIDER_KEY_LENGTH) {
      throw new Error(
        `providerKeys.${providerKey} must be at most ${String(MAX_PROVIDER_KEY_LENGTH)} characters.`
      );
    }
    if (containsControlCharacters(trimmed)) {
      throw new Error(`providerKeys.${providerKey} contains invalid control characters.`);
    }
    providerKeys[providerKey] = trimmed;
  }
  return { policy, providerKeys };
}

export function parseDocumentProcessingTestConnectionRequest(body: unknown): {
  providerKey: DocumentProcessingProviderKey;
} {
  const row = asObject(body, "Request body");
  return {
    providerKey: parseProviderKey(row.providerKey, "providerKey")
  };
}

export function buildAdminDocumentProcessingSettingsState(params: {
  policy: DocumentProcessingPolicyState;
  keyMetadata: Record<DocumentProcessingRemoteProviderKey, PlatformRuntimeProviderKeyMetadata>;
}): AdminDocumentProcessingSettingsState {
  const providers: DocumentProcessingProviderState[] = [
    {
      providerKey: "local",
      enabled: params.policy.localFallbackEnabled || params.policy.defaultProvider === "local",
      configured: true,
      role: "local_fallback",
      lastFour: null,
      updatedAt: null
    },
    {
      providerKey: "mistral",
      enabled:
        params.policy.defaultProvider === "mistral" ||
        params.policy.highQualityFallbackProvider === "mistral",
      configured: params.keyMetadata.mistral.configured,
      role:
        params.policy.highQualityFallbackProvider === "mistral"
          ? "high_quality_fallback"
          : "default_provider",
      lastFour: params.keyMetadata.mistral.lastFour,
      updatedAt: params.keyMetadata.mistral.updatedAt
    },
    {
      providerKey: "llamaparse",
      enabled:
        params.policy.defaultProvider === "llamaparse" ||
        params.policy.highQualityFallbackProvider === "llamaparse",
      configured: params.keyMetadata.llamaparse.configured,
      role:
        params.policy.defaultProvider === "llamaparse"
          ? "default_provider"
          : "high_quality_fallback",
      lastFour: params.keyMetadata.llamaparse.lastFour,
      updatedAt: params.keyMetadata.llamaparse.updatedAt
    }
  ];

  const notes = [
    "Document-processing keys are write-only and stored encrypted in PersAI-managed provider secret storage.",
    params.policy.localFallbackEnabled
      ? "Local parsing remains enabled as a cheap fallback for simple text-like sources."
      : "Local fallback is disabled; non-local providers must be configured for document processing.",
    params.policy.autoFallbackEnabled
      ? "Poor extraction can escalate to the configured high-quality fallback provider."
      : "Automatic high-quality fallback is disabled; admins can still request high-quality reprocessing in later Skill document flows."
  ];

  return {
    policy: params.policy,
    providers,
    notes
  };
}

export function normalizeDocumentProcessingPolicyRecord(
  value: unknown
): DocumentProcessingPolicyState {
  if (value === null || value === undefined) {
    return { ...DEFAULT_KNOWLEDGE_DOCUMENT_PROCESSING_POLICY };
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    return { ...DEFAULT_KNOWLEDGE_DOCUMENT_PROCESSING_POLICY };
  }
  try {
    return parseDocumentProcessingPolicy(value, "documentProcessingPolicy");
  } catch {
    return { ...DEFAULT_KNOWLEDGE_DOCUMENT_PROCESSING_POLICY };
  }
}

export function assertDocumentProcessingProviderKeysAvailable(params: {
  policy: DocumentProcessingPolicyState;
  keyMetadata: Record<DocumentProcessingRemoteProviderKey, PlatformRuntimeProviderKeyMetadata>;
  incomingProviderKeys: Partial<Record<DocumentProcessingRemoteProviderKey, string>>;
}): void {
  for (const providerKey of requiredRemoteProviders(params.policy)) {
    const hasExisting = params.keyMetadata[providerKey].configured;
    const hasIncoming =
      typeof params.incomingProviderKeys[providerKey] === "string" &&
      params.incomingProviderKeys[providerKey].trim().length > 0;
    if (!hasExisting && !hasIncoming) {
      throw new Error(`${providerLabel(providerKey)} API key is required for the selected policy.`);
    }
  }
}

export function toDocumentProcessingSecretStorageKey(
  providerKey: DocumentProcessingRemoteProviderKey
): string {
  return DOCUMENT_PROCESSING_PROVIDER_SECRET_KEYS[providerKey];
}

function parseDocumentProcessingPolicy(
  value: unknown,
  path: string
): DocumentProcessingPolicyState {
  const row = asObject(value, path);
  const policy: DocumentProcessingPolicyState = {
    defaultProvider: parseProviderKey(row.defaultProvider, `${path}.defaultProvider`),
    highQualityFallbackProvider: parseProviderKey(
      row.highQualityFallbackProvider,
      `${path}.highQualityFallbackProvider`
    ),
    localFallbackEnabled: parseBoolean(row.localFallbackEnabled, `${path}.localFallbackEnabled`),
    autoFallbackEnabled: parseBoolean(row.autoFallbackEnabled, `${path}.autoFallbackEnabled`),
    needsReviewThreshold: parseThreshold(row.needsReviewThreshold, `${path}.needsReviewThreshold`)
  };

  if (policy.highQualityFallbackProvider === "local") {
    throw new Error(`${path}.highQualityFallbackProvider must be a remote provider.`);
  }
  if (policy.defaultProvider === policy.highQualityFallbackProvider) {
    throw new Error(`${path}.defaultProvider and ${path}.highQualityFallbackProvider must differ.`);
  }
  return policy;
}

function parseProviderKey(value: unknown, path: string): DocumentProcessingProviderKey {
  if (value === "local" || value === "mistral" || value === "llamaparse") {
    return value;
  }
  throw new Error(`${path} must be one of: local, mistral, llamaparse.`);
}

function parseBoolean(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`${path} must be a boolean.`);
  }
  return value;
}

function parseThreshold(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${path} must be a number between 0 and 1.`);
  }
  return value;
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

function requiredRemoteProviders(
  policy: DocumentProcessingPolicyState
): DocumentProcessingRemoteProviderKey[] {
  const result = new Set<DocumentProcessingRemoteProviderKey>();
  if (policy.defaultProvider !== "local") {
    result.add(policy.defaultProvider);
  }
  if (policy.highQualityFallbackProvider !== "local") {
    result.add(policy.highQualityFallbackProvider);
  }
  return [...result];
}

function providerLabel(providerKey: DocumentProcessingRemoteProviderKey): string {
  return providerKey === "mistral" ? "Mistral OCR" : "LlamaParse";
}
