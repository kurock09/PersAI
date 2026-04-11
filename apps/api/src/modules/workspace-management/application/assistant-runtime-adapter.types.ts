import type { RuntimeTier } from "./runtime-assignment";
import type {
  AssistantRuntimeAvatarUploadInput,
  AssistantRuntimeAvatarUploadResult,
  AssistantRuntimeChannelCompactInput,
  AssistantRuntimeChannelCompactResult,
  AssistantRuntimeChannelSessionStateInput,
  AssistantRuntimeChannelSessionStateResult,
  AssistantRuntimeChannelTurnInput,
  AssistantRuntimeCronControlInput,
  AssistantRuntimeMediaDownloadResult,
  AssistantRuntimeMediaUploadInput,
  AssistantRuntimeMediaUploadResult,
  AssistantRuntimePreflightResult,
  AssistantRuntimeSetupPreviewTurnResult,
  AssistantRuntimeTranscribeResult,
  AssistantRuntimeWebChatCompactInput,
  AssistantRuntimeWebChatCompactResult,
  AssistantRuntimeWebChatSessionDeleteInput,
  AssistantRuntimeWebChatSessionStateInput,
  AssistantRuntimeWebChatSessionStateResult,
  AssistantRuntimeWebChatTurnInput,
  AssistantRuntimeWebChatTurnResult,
  AssistantRuntimeWebChatTurnStreamChunk,
  AssistantRuntimeWorkspaceStorageUsageResult
} from "./assistant-runtime.facade";

export type {
  AssistantRuntimeAvatarUploadInput,
  AssistantRuntimeAvatarUploadResult,
  AssistantRuntimeChannelCompactInput,
  AssistantRuntimeChannelCompactResult,
  AssistantRuntimeChannelSessionStateInput,
  AssistantRuntimeChannelSessionStateResult,
  AssistantRuntimeChannelTurnInput,
  AssistantRuntimeCronControlInput,
  AssistantRuntimeErrorCode,
  AssistantRuntimeMediaDownloadResult,
  AssistantRuntimeMediaUploadInput,
  AssistantRuntimeMediaUploadResult,
  AssistantRuntimePreflightResult,
  AssistantRuntimeSetupPreviewTurnResult,
  AssistantRuntimeTranscribeResult,
  AssistantRuntimeWebChatCompactInput,
  AssistantRuntimeWebChatCompactResult,
  AssistantRuntimeWebChatSessionDeleteInput,
  AssistantRuntimeWebChatSessionStateInput,
  AssistantRuntimeWebChatSessionStateResult,
  AssistantRuntimeWebChatTurnInput,
  AssistantRuntimeWebChatTurnResult,
  AssistantRuntimeWebChatTurnStreamChunk,
  AssistantRuntimeWorkspaceStorageUsageResult,
  RuntimeMediaArtifact
} from "./assistant-runtime.facade";
export { AssistantRuntimeError as AssistantRuntimeAdapterError } from "./assistant-runtime.facade";

export interface OpenClawRuntimeApplyInput {
  assistantId: string;
  publishedVersionId: string;
  runtimeTier?: RuntimeTier;
  contentHash: string;
  openclawBootstrap: unknown;
  openclawWorkspace: unknown;
  reapply: boolean;
}

export interface OpenClawRuntimeSetupPreviewTurnInput {
  assistantId: string;
  runtimeTier?: RuntimeTier;
  userMessage: string;
  openclawBootstrap: unknown;
  openclawWorkspace: unknown;
  userTimezone?: string;
  currentTimeIso?: string;
}

export interface OpenClawRuntimeBridge {
  preflight(runtimeTier?: RuntimeTier): Promise<AssistantRuntimePreflightResult>;
  applyMaterializedSpec(input: OpenClawRuntimeApplyInput): Promise<void>;
  cleanupWorkspace(assistantId: string): Promise<void>;
  consumeBootstrapWorkspace(assistantId: string, runtimeTier?: RuntimeTier): Promise<void>;
  resetWorkspace(assistantId: string): Promise<void>;
  resetMemoryWorkspace(assistantId: string): Promise<void>;
  deleteWebChatSession(input: AssistantRuntimeWebChatSessionDeleteInput): Promise<void>;
  getWebChatSessionState(
    input: AssistantRuntimeWebChatSessionStateInput
  ): Promise<AssistantRuntimeWebChatSessionStateResult>;
  getChannelSessionState(
    input: AssistantRuntimeChannelSessionStateInput
  ): Promise<AssistantRuntimeChannelSessionStateResult>;
  markChannelCompactionHintShown(
    input: AssistantRuntimeChannelSessionStateInput & { tokens: number }
  ): Promise<void>;
  compactWebChatSession(
    input: AssistantRuntimeWebChatCompactInput
  ): Promise<AssistantRuntimeWebChatCompactResult>;
  compactTelegramChannelSession(
    input: AssistantRuntimeChannelCompactInput
  ): Promise<AssistantRuntimeChannelCompactResult>;
  sendWebChatTurn(
    input: AssistantRuntimeWebChatTurnInput
  ): Promise<AssistantRuntimeWebChatTurnResult>;
  previewSetupTurn(
    input: OpenClawRuntimeSetupPreviewTurnInput
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
  getWorkspaceStorageUsage(
    assistantId: string,
    runtimeTier?: RuntimeTier
  ): Promise<AssistantRuntimeWorkspaceStorageUsageResult>;
  uploadWorkspaceAvatar(
    input: AssistantRuntimeAvatarUploadInput
  ): Promise<AssistantRuntimeAvatarUploadResult>;
  downloadWorkspaceAvatar(assistantId: string): Promise<AssistantRuntimeMediaDownloadResult | null>;
}

export const OPENCLAW_RUNTIME_BRIDGE = Symbol("OPENCLAW_RUNTIME_BRIDGE");
