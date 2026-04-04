import type { RuntimeTier } from "./runtime-assignment";

export type AssistantRuntimeErrorCode =
  | "runtime_unreachable"
  | "auth_failure"
  | "timeout"
  | "invalid_response"
  | "runtime_degraded";

export class AssistantRuntimeAdapterError extends Error {
  constructor(
    public readonly code: AssistantRuntimeErrorCode,
    message: string
  ) {
    super(message);
    this.name = "AssistantRuntimeAdapterError";
  }
}

export interface AssistantRuntimePreflightResult {
  live: boolean;
  ready: boolean;
  checkedAt: string;
}

export interface AssistantRuntimeApplyInput {
  assistantId: string;
  publishedVersionId: string;
  runtimeTier?: RuntimeTier;
  contentHash: string;
  openclawBootstrap: unknown;
  openclawWorkspace: unknown;
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
}

export interface AssistantRuntimeChannelTurnInput {
  assistantId: string;
  publishedVersionId: string;
  runtimeTier?: RuntimeTier;
  providerOverride?: "openai" | "anthropic";
  modelOverride?: string;
  surface: "telegram";
  threadId: string;
  userMessage: string;
  userTimezone?: string;
  currentTimeIso?: string;
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
}

export interface AssistantRuntimeSetupPreviewTurnInput {
  assistantId: string;
  runtimeTier?: RuntimeTier;
  userMessage: string;
  openclawBootstrap: unknown;
  openclawWorkspace: unknown;
  userTimezone?: string;
  currentTimeIso?: string;
}

export interface AssistantRuntimeSetupPreviewTurnResult {
  assistantMessage: string;
  respondedAt: string;
  media: RuntimeMediaArtifact[];
}

export interface AssistantRuntimeWebChatTurnStreamChunk {
  type: "delta" | "thinking" | "done" | "failed" | "media";
  delta?: string;
  accumulated?: string;
  respondedAt?: string;
  code?: string;
  message?: string;
  media?: RuntimeMediaArtifact[];
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

export interface AssistantRuntimeMediaUploadInput {
  assistantId: string;
  runtimeTier?: RuntimeTier;
  chatId: string;
  messageId: string;
  fileBuffer: Buffer;
  mimeType: string;
}

export interface AssistantRuntimeMediaUploadResult {
  storagePath: string;
  sizeBytes: number;
  mimeType: string;
}

export interface AssistantRuntimeMediaDownloadResult {
  buffer: Buffer;
  contentType: string;
}

export interface AssistantRuntimeTranscribeResult {
  text: string;
}

export interface AssistantRuntimeAdapter {
  preflight(runtimeTier?: RuntimeTier): Promise<AssistantRuntimePreflightResult>;
  applyMaterializedSpec(input: AssistantRuntimeApplyInput): Promise<void>;
  cleanupWorkspace(assistantId: string): Promise<void>;
  consumeBootstrapWorkspace(assistantId: string): Promise<void>;
  resetWorkspace(assistantId: string): Promise<void>;
  resetMemoryWorkspace(assistantId: string): Promise<void>;
  deleteWebChatSession(input: AssistantRuntimeWebChatSessionDeleteInput): Promise<void>;
  sendWebChatTurn(
    input: AssistantRuntimeWebChatTurnInput
  ): Promise<AssistantRuntimeWebChatTurnResult>;
  previewSetupTurn(
    input: AssistantRuntimeSetupPreviewTurnInput
  ): Promise<AssistantRuntimeSetupPreviewTurnResult>;
  sendChannelTurn(
    input: AssistantRuntimeChannelTurnInput
  ): Promise<AssistantRuntimeWebChatTurnResult>;
  streamWebChatTurn(
    input: AssistantRuntimeWebChatTurnInput
  ): AsyncGenerator<AssistantRuntimeWebChatTurnStreamChunk>;
  controlCronJob(input: AssistantRuntimeCronControlInput): Promise<unknown>;
  uploadChatMedia(
    input: AssistantRuntimeMediaUploadInput
  ): Promise<AssistantRuntimeMediaUploadResult>;
  downloadChatMedia(
    assistantId: string,
    storagePath: string,
    runtimeTier?: RuntimeTier
  ): Promise<AssistantRuntimeMediaDownloadResult | null>;
  deleteChatMedia(
    assistantId: string,
    storagePath: string,
    runtimeTier?: RuntimeTier
  ): Promise<void>;
  deleteChatMediaBatch(
    assistantId: string,
    chatId: string,
    runtimeTier?: RuntimeTier
  ): Promise<void>;
  transcribeMedia(
    assistantId: string,
    storagePath: string,
    runtimeTier?: RuntimeTier
  ): Promise<AssistantRuntimeTranscribeResult>;
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
}

export const ASSISTANT_RUNTIME_ADAPTER = Symbol("ASSISTANT_RUNTIME_ADAPTER");
