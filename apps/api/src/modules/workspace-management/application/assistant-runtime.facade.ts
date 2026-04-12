import type { RuntimeTier } from "./runtime-assignment";

export type AssistantRuntimeErrorCode =
  | "runtime_unreachable"
  | "auth_failure"
  | "timeout"
  | "invalid_response"
  | "runtime_degraded"
  | "compaction_unavailable";

export class AssistantRuntimeError extends Error {
  constructor(
    public readonly code: AssistantRuntimeErrorCode,
    message: string
  ) {
    super(message);
    this.name = "AssistantRuntimeError";
  }
}

export interface AssistantRuntimePreflightResult {
  live: boolean;
  ready: boolean;
  checkedAt: string;
}

export interface AssistantRuntimeLegacyBridgePayload {
  bootstrap: unknown;
  workspace: unknown;
}

export interface AssistantRuntimeApplyInput {
  assistantId: string;
  publishedVersionId: string;
  runtimeTier?: RuntimeTier;
  runtimeBundle: unknown | null;
  legacyBridge: AssistantRuntimeLegacyBridgePayload & {
    contentHash: string;
  };
  reapply: boolean;
}

export interface AssistantRuntimeWebChatTurnInput {
  assistantId: string;
  publishedVersionId: string;
  runtimeTier?: RuntimeTier;
  providerOverride?: "openai" | "anthropic";
  modelOverride?: string;
  chatId: string;
  surfaceThreadKey: string;
  userMessageId: string;
  userMessage: string;
  userTimezone?: string;
  currentTimeIso?: string;
  overviewTraceId?: string;
}

export interface RuntimeMediaArtifact {
  url: string;
  type: "image" | "audio" | "video" | "document";
  audioAsVoice?: boolean;
}

export interface AssistantRuntimeWebChatTurnResult {
  assistantMessage: string;
  respondedAt: string;
  media: RuntimeMediaArtifact[];
  runtimeTrace?: {
    scope: string;
    status: string;
    totalMs: number;
    stages: Array<{ key: string; durationMs: number }>;
  };
}

export interface AssistantRuntimeSetupPreviewTurnInput {
  assistantId: string;
  runtimeTier?: RuntimeTier;
  userMessage: string;
  runtimeBundle: unknown | null;
  legacyBridge: AssistantRuntimeLegacyBridgePayload;
  userTimezone?: string;
  currentTimeIso?: string;
}

export interface AssistantRuntimeSetupPreviewTurnResult {
  assistantMessage: string;
  respondedAt: string;
  media: RuntimeMediaArtifact[];
}

export interface AssistantRuntimeWebChatTurnStreamChunk {
  type: "delta" | "thinking" | "done" | "failed" | "media" | "compaction";
  delta?: string;
  accumulated?: string;
  respondedAt?: string;
  code?: string;
  message?: string;
  media?: RuntimeMediaArtifact[];
  phase?: "start" | "end";
  completed?: boolean;
  willRetry?: boolean;
  runtimeTrace?: {
    scope: string;
    status: string;
    totalMs: number;
    stages: Array<{ key: string; durationMs: number }>;
  };
}

export interface AssistantRuntimeCronControlInput {
  runtimeTier?: RuntimeTier;
  action?: string;
  args?: Record<string, unknown>;
  sessionKey?: string;
  contextSessionKey?: string;
}

export interface AssistantRuntimeWebChatSessionDeleteInput {
  assistantId: string;
  chatId: string;
  surfaceThreadKey: string;
}

export interface AssistantRuntimeMediaDownloadResult {
  buffer: Buffer;
  contentType: string;
}

export interface AssistantRuntimeWorkspaceStorageUsageResult {
  usedBytes: number;
}

export interface AssistantRuntimeAvatarUploadInput {
  assistantId: string;
  fileBuffer: Buffer;
  mimeType: string;
  extension: string;
}

export interface AssistantRuntimeAvatarUploadResult {
  avatarUrl: string;
}

export interface AssistantRuntimeFacade {
  preflight(runtimeTier?: RuntimeTier): Promise<AssistantRuntimePreflightResult>;
  applyMaterializedSpec(input: AssistantRuntimeApplyInput): Promise<void>;
  cleanupWorkspace(assistantId: string): Promise<void>;
  consumeBootstrapWorkspace(assistantId: string, runtimeTier?: RuntimeTier): Promise<void>;
  resetWorkspace(assistantId: string): Promise<void>;
  resetMemoryWorkspace(assistantId: string): Promise<void>;
  deleteWebChatSession(input: AssistantRuntimeWebChatSessionDeleteInput): Promise<void>;
  sendWebChatTurn(
    input: AssistantRuntimeWebChatTurnInput
  ): Promise<AssistantRuntimeWebChatTurnResult>;
  previewSetupTurn(
    input: AssistantRuntimeSetupPreviewTurnInput
  ): Promise<AssistantRuntimeSetupPreviewTurnResult>;
  streamWebChatTurn(
    input: AssistantRuntimeWebChatTurnInput
  ): AsyncGenerator<AssistantRuntimeWebChatTurnStreamChunk>;
  controlCronJob(input: AssistantRuntimeCronControlInput): Promise<unknown>;
  downloadChatMedia(
    assistantId: string,
    storagePath: string,
    runtimeTier?: RuntimeTier
  ): Promise<AssistantRuntimeMediaDownloadResult | null>;
  listMemoryItems(assistantId: string, runtimeTier?: RuntimeTier): Promise<unknown>;
  addMemoryItem(assistantId: string, content: string, runtimeTier?: RuntimeTier): Promise<unknown>;
  editMemoryItem(
    assistantId: string,
    itemId: string,
    content: string,
    runtimeTier?: RuntimeTier
  ): Promise<unknown>;
  forgetMemoryItem(
    assistantId: string,
    itemId: string,
    runtimeTier?: RuntimeTier
  ): Promise<unknown>;
  searchMemory(assistantId: string, query: string, runtimeTier?: RuntimeTier): Promise<unknown>;
  getWorkspaceStorageUsage(
    assistantId: string,
    runtimeTier?: RuntimeTier
  ): Promise<AssistantRuntimeWorkspaceStorageUsageResult>;
  uploadWorkspaceAvatar(
    input: AssistantRuntimeAvatarUploadInput
  ): Promise<AssistantRuntimeAvatarUploadResult>;
  downloadWorkspaceAvatar(assistantId: string): Promise<AssistantRuntimeMediaDownloadResult | null>;
}

export const ASSISTANT_RUNTIME_FACADE = Symbol("ASSISTANT_RUNTIME_FACADE");
