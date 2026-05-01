export type AssistantKnowledgeSourceNamespace = "assistant_user_workspace";

export type AssistantKnowledgeSourceKind = "uploaded_file";

export type AssistantKnowledgeSourceStatus = "processing" | "ready" | "failed" | "needs_review";

export type GlobalKnowledgeSourceScope = "product";

export type AssistantKnowledgeSourceState = {
  id: string;
  namespace: AssistantKnowledgeSourceNamespace;
  sourceKind: AssistantKnowledgeSourceKind;
  displayName: string | null;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  status: AssistantKnowledgeSourceStatus;
  currentVersion: number;
  chunkCount: number;
  lastIndexedAt: string | null;
  lastReindexRequestedAt: string | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AssistantKnowledgeQuotaState = {
  usedBytes: number;
  limitBytes: number | null;
};

export type GlobalKnowledgeSourceState = {
  id: string;
  scope: GlobalKnowledgeSourceScope;
  displayName: string | null;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  status: AssistantKnowledgeSourceStatus;
  currentVersion: number;
  chunkCount: number;
  lastIndexedAt: string | null;
  lastReindexRequestedAt: string | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  createdAt: string;
  updatedAt: string;
};
