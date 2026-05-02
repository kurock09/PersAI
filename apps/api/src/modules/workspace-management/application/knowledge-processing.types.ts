export const KNOWLEDGE_PROCESSING_STATUSES = [
  "processing",
  "ready",
  "failed",
  "needs_review"
] as const;

export type KnowledgeProcessingStatus = (typeof KNOWLEDGE_PROCESSING_STATUSES)[number];

export const KNOWLEDGE_LIFECYCLE_GOVERNANCE_STATUSES = [
  "draft",
  "active",
  "stale",
  "archived"
] as const;

export type KnowledgeLifecycleGovernanceStatus =
  (typeof KNOWLEDGE_LIFECYCLE_GOVERNANCE_STATUSES)[number];

export const KNOWLEDGE_SOURCE_TYPES = [
  "assistant_knowledge_source",
  "global_knowledge_source",
  "skill_document",
  "skill_knowledge_card",
  "product_knowledge_text_entry"
] as const;

export type KnowledgeSourceType = (typeof KNOWLEDGE_SOURCE_TYPES)[number];

export type KnowledgeSourceOriginKind =
  | "uploaded_file"
  | "admin_product_document"
  | "skill_document"
  | "web"
  | "manual_entry"
  | "generated_summary";

export type KnowledgeSourceProvenance = {
  originKind: KnowledgeSourceOriginKind;
  title?: string | null;
  originalFilename?: string | null;
  mimeType?: string | null;
  url?: string | null;
  storagePath?: string | null;
  createdByUserId?: string | null;
  ingestedAt?: string | null;
  metadata?: Record<string, unknown> | null;
};

export type KnowledgeProcessingProviderKey = "local" | "mistral" | "llamaparse";

export type KnowledgeProcessingProviderTrace = {
  providerKey: KnowledgeProcessingProviderKey;
  processorMode: KnowledgeDocumentProcessorMode;
  attemptedProviderKeys: KnowledgeProcessingProviderKey[];
};

export type KnowledgeExtractionQuality = {
  status: "ok" | "poor" | "needs_review";
  score: number | null;
  reasonCodes: string[];
  textChars: number;
  metadata?: Record<string, unknown> | null;
};

export type NormalizedKnowledgeSource = {
  sourceType: KnowledgeSourceType;
  sourceId: string;
  sourceVersion: number;
  workspaceId: string;
  assistantId?: string | null;
  skillId?: string | null;
  provenance: KnowledgeSourceProvenance;
  metadata?: Record<string, unknown> | null;
};

export type NormalizedKnowledgeChunk = {
  chunkId?: string | null;
  sourceType: KnowledgeSourceType;
  sourceId: string;
  sourceVersion: number;
  workspaceId: string;
  assistantId?: string | null;
  skillId?: string | null;
  chunkIndex: number;
  locator: string | null;
  content: string;
  metadata?: Record<string, unknown> | null;
  provenance?: KnowledgeSourceProvenance | null;
  provider?: KnowledgeProcessingProviderTrace | null;
  quality?: KnowledgeExtractionQuality | null;
};

export type KnowledgeDocumentProcessorMode =
  | "auto"
  | "local"
  | "default_provider"
  | "high_quality_fallback";

export type KnowledgeDocumentContent =
  | {
      kind: "bytes";
      buffer: Buffer;
      mimeType: string;
      originalFilename: string;
      sizeBytes?: number | null;
    }
  | {
      kind: "text";
      text: string;
      mimeType?: string | null;
      title?: string | null;
      sizeBytes?: number | null;
    }
  | {
      kind: "external_reference";
      uri: string;
      mimeType?: string | null;
      title?: string | null;
      sizeBytes?: number | null;
    };

export type KnowledgeDocumentProcessingInput = {
  source: NormalizedKnowledgeSource;
  content: KnowledgeDocumentContent;
  requestedMode?: KnowledgeDocumentProcessorMode;
};

export type KnowledgeDocumentProcessingResult = {
  normalizedText: string;
  markdown?: string | null;
  provider: KnowledgeProcessingProviderTrace;
  quality: KnowledgeExtractionQuality;
  metadata?: Record<string, unknown> | null;
};

export interface KnowledgeDocumentProcessor {
  process(input: KnowledgeDocumentProcessingInput): Promise<KnowledgeDocumentProcessingResult>;
}
