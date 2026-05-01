import type {
  KnowledgeDocumentContent,
  KnowledgeDocumentProcessorMode,
  KnowledgeExtractionQuality,
  KnowledgeProcessingProviderKey
} from "./knowledge-processing.types";

export type KnowledgeDocumentProcessingPolicy = {
  defaultProvider: KnowledgeProcessingProviderKey;
  highQualityFallbackProvider: KnowledgeProcessingProviderKey;
  localFallbackEnabled: boolean;
  autoFallbackEnabled: boolean;
  needsReviewThreshold: number;
};

export type KnowledgeDocumentProviderAvailability = Record<
  KnowledgeProcessingProviderKey,
  {
    enabled: boolean;
    configured: boolean;
  }
>;

export type KnowledgeDocumentProcessorSelection = {
  processorMode: KnowledgeDocumentProcessorMode;
  providerKey: KnowledgeProcessingProviderKey;
  fallbackProviderKey: KnowledgeProcessingProviderKey | null;
  reasonCode: string;
};

export class KnowledgeDocumentProcessingPolicyError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly providerKey: KnowledgeProcessingProviderKey | null = null
  ) {
    super(message);
  }
}

export const DEFAULT_KNOWLEDGE_DOCUMENT_PROCESSING_POLICY: KnowledgeDocumentProcessingPolicy = {
  defaultProvider: "mistral",
  highQualityFallbackProvider: "llamaparse",
  localFallbackEnabled: true,
  autoFallbackEnabled: true,
  needsReviewThreshold: 0.65
};

export const LOCAL_ONLY_DOCUMENT_PROVIDER_AVAILABILITY: KnowledgeDocumentProviderAvailability = {
  local: { enabled: true, configured: true },
  mistral: { enabled: false, configured: false },
  llamaparse: { enabled: false, configured: false }
};

const SIMPLE_TEXT_MIME_TYPES = new Set([
  "application/json",
  "application/x-ndjson",
  "application/xml",
  "text/csv",
  "text/html",
  "text/markdown",
  "text/plain",
  "text/tab-separated-values"
]);

const SIMPLE_TEXT_EXTENSIONS = new Set([
  ".csv",
  ".json",
  ".jsonl",
  ".log",
  ".md",
  ".ndjson",
  ".txt",
  ".tsv",
  ".xml",
  ".yaml",
  ".yml"
]);

const COMPLEX_DOCUMENT_MIME_TYPES = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.ms-excel",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
]);

export function resolveKnowledgeDocumentProcessorSelection(params: {
  content: KnowledgeDocumentContent;
  requestedMode?: KnowledgeDocumentProcessorMode;
  policy?: KnowledgeDocumentProcessingPolicy;
  providerAvailability?: KnowledgeDocumentProviderAvailability;
}): KnowledgeDocumentProcessorSelection {
  const policy = params.policy ?? DEFAULT_KNOWLEDGE_DOCUMENT_PROCESSING_POLICY;
  const availability = params.providerAvailability ?? LOCAL_ONLY_DOCUMENT_PROVIDER_AVAILABILITY;
  const requestedMode = params.requestedMode ?? "auto";

  if (requestedMode === "local") {
    return assertProviderAvailable({
      providerKey: "local",
      processorMode: "local",
      fallbackProviderKey: null,
      reasonCode: "manual_local",
      availability
    });
  }

  if (requestedMode === "high_quality_fallback") {
    return assertProviderAvailable({
      providerKey: policy.highQualityFallbackProvider,
      processorMode: "high_quality_fallback",
      fallbackProviderKey: null,
      reasonCode: "manual_high_quality",
      availability
    });
  }

  if (requestedMode === "default_provider") {
    return selectConfiguredProviderOrFallback({
      providerKey: policy.defaultProvider,
      processorMode: "default_provider",
      fallbackProviderKey: policy.autoFallbackEnabled ? policy.highQualityFallbackProvider : null,
      reasonCode: "manual_default_provider",
      policy,
      availability
    });
  }

  if (isSimpleTextContent(params.content)) {
    return assertProviderAvailable({
      providerKey: "local",
      processorMode: "local",
      fallbackProviderKey: null,
      reasonCode: "simple_text_local",
      availability
    });
  }

  return selectConfiguredProviderOrFallback({
    providerKey: policy.defaultProvider,
    processorMode: "default_provider",
    fallbackProviderKey: policy.autoFallbackEnabled ? policy.highQualityFallbackProvider : null,
    reasonCode: isComplexDocumentContent(params.content)
      ? "complex_document_default_provider"
      : "unknown_document_default_provider",
    policy,
    availability
  });
}

export function resolveKnowledgeDocumentProcessorEscalation(params: {
  previousSelection: KnowledgeDocumentProcessorSelection;
  quality: KnowledgeExtractionQuality;
  policy?: KnowledgeDocumentProcessingPolicy;
  providerAvailability?: KnowledgeDocumentProviderAvailability;
}): KnowledgeDocumentProcessorSelection | null {
  const policy = params.policy ?? DEFAULT_KNOWLEDGE_DOCUMENT_PROCESSING_POLICY;
  if (!policy.autoFallbackEnabled) {
    return null;
  }
  if (params.previousSelection.processorMode === "high_quality_fallback") {
    return null;
  }
  if (!shouldEscalateKnowledgeExtraction(params.quality, policy)) {
    return null;
  }
  return assertProviderAvailable({
    providerKey: policy.highQualityFallbackProvider,
    processorMode: "high_quality_fallback",
    fallbackProviderKey: null,
    reasonCode: "poor_extraction_high_quality_fallback",
    availability: params.providerAvailability ?? LOCAL_ONLY_DOCUMENT_PROVIDER_AVAILABILITY
  });
}

export function shouldEscalateKnowledgeExtraction(
  quality: KnowledgeExtractionQuality,
  policy: KnowledgeDocumentProcessingPolicy = DEFAULT_KNOWLEDGE_DOCUMENT_PROCESSING_POLICY
): boolean {
  if (quality.status === "poor" || quality.status === "needs_review") {
    return true;
  }
  if (quality.textChars === 0) {
    return true;
  }
  return quality.score !== null && quality.score < policy.needsReviewThreshold;
}

function selectConfiguredProviderOrFallback(params: {
  providerKey: KnowledgeProcessingProviderKey;
  processorMode: KnowledgeDocumentProcessorMode;
  fallbackProviderKey: KnowledgeProcessingProviderKey | null;
  reasonCode: string;
  policy: KnowledgeDocumentProcessingPolicy;
  availability: KnowledgeDocumentProviderAvailability;
}): KnowledgeDocumentProcessorSelection {
  if (isProviderAvailable(params.providerKey, params.availability)) {
    return {
      processorMode: params.processorMode,
      providerKey: params.providerKey,
      fallbackProviderKey: params.fallbackProviderKey,
      reasonCode: params.reasonCode
    };
  }

  if (
    params.fallbackProviderKey !== null &&
    isProviderAvailable(params.fallbackProviderKey, params.availability)
  ) {
    return {
      processorMode: "high_quality_fallback",
      providerKey: params.fallbackProviderKey,
      fallbackProviderKey: null,
      reasonCode: "default_provider_unavailable_high_quality_fallback"
    };
  }

  if (params.policy.localFallbackEnabled && isProviderAvailable("local", params.availability)) {
    return {
      processorMode: "local",
      providerKey: "local",
      fallbackProviderKey: params.fallbackProviderKey,
      reasonCode: "provider_unavailable_local_fallback"
    };
  }

  throw new KnowledgeDocumentProcessingPolicyError(
    "needs_key",
    `Document processor provider '${params.providerKey}' is not configured.`,
    params.providerKey
  );
}

function assertProviderAvailable(params: {
  providerKey: KnowledgeProcessingProviderKey;
  processorMode: KnowledgeDocumentProcessorMode;
  fallbackProviderKey: KnowledgeProcessingProviderKey | null;
  reasonCode: string;
  availability: KnowledgeDocumentProviderAvailability;
}): KnowledgeDocumentProcessorSelection {
  if (!isProviderAvailable(params.providerKey, params.availability)) {
    throw new KnowledgeDocumentProcessingPolicyError(
      "needs_key",
      `Document processor provider '${params.providerKey}' is not configured.`,
      params.providerKey
    );
  }
  return {
    processorMode: params.processorMode,
    providerKey: params.providerKey,
    fallbackProviderKey: params.fallbackProviderKey,
    reasonCode: params.reasonCode
  };
}

function isProviderAvailable(
  providerKey: KnowledgeProcessingProviderKey,
  availability: KnowledgeDocumentProviderAvailability
): boolean {
  const provider = availability[providerKey];
  return provider.enabled && provider.configured;
}

function isSimpleTextContent(content: KnowledgeDocumentContent): boolean {
  if (content.kind === "text") {
    return true;
  }
  const mimeType = content.mimeType?.toLowerCase() ?? "";
  if (mimeType.startsWith("text/") || SIMPLE_TEXT_MIME_TYPES.has(mimeType)) {
    return true;
  }
  const filename = content.kind === "bytes" ? content.originalFilename : content.title;
  return filename === undefined || filename === null
    ? false
    : SIMPLE_TEXT_EXTENSIONS.has(extractLowerExtension(filename));
}

function isComplexDocumentContent(content: KnowledgeDocumentContent): boolean {
  const mimeType = content.mimeType?.toLowerCase() ?? "";
  return COMPLEX_DOCUMENT_MIME_TYPES.has(mimeType);
}

function extractLowerExtension(filename: string): string {
  const dotIndex = filename.lastIndexOf(".");
  return dotIndex === -1 ? "" : filename.slice(dotIndex).toLowerCase();
}
