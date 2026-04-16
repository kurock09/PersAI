import type { RuntimeTier } from "./runtime-assignment";
import type { RuntimeTurnAutoCompactionState } from "@persai/runtime-contract";
import type { RuntimeOutputArtifact } from "@persai/runtime-contract";

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

export interface AssistantRuntimeAdapterPayload {
  assistantConfig: unknown;
  assistantWorkspace: unknown;
}

export interface AssistantRuntimeApplyInput {
  assistantId: string;
  publishedVersionId: string;
  runtimeTier?: RuntimeTier;
  runtimeBundle: unknown | null;
  adapterPayload: AssistantRuntimeAdapterPayload & {
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

export type RuntimeMediaArtifactType = "image" | "audio" | "video" | "document";

export interface RuntimeUrlMediaArtifact {
  source: "runtime_url";
  url: string;
  type: RuntimeMediaArtifactType;
  audioAsVoice?: boolean;
  caption?: string;
}

export interface PersaiObjectStorageRuntimeMediaArtifact {
  source: "persai_object_storage";
  objectKey: string;
  type: RuntimeMediaArtifactType;
  mimeType: string;
  filename: string | null;
  sizeBytes: number | null;
  audioAsVoice?: boolean;
  caption?: string;
}

export type RuntimeMediaArtifact =
  | RuntimeUrlMediaArtifact
  | PersaiObjectStorageRuntimeMediaArtifact;

export interface AssistantRuntimeWebChatTurnResult {
  assistantMessage: string;
  respondedAt: string;
  media: RuntimeMediaArtifact[];
  autoCompaction?: RuntimeTurnAutoCompactionState;
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
  adapterPayload: AssistantRuntimeAdapterPayload;
  userTimezone?: string;
  currentTimeIso?: string;
}

export interface AssistantRuntimeSetupPreviewTurnResult {
  assistantMessage: string;
  respondedAt: string;
  media: RuntimeMediaArtifact[];
}

export interface AssistantRuntimeWebChatTurnStreamChunk {
  type: "delta" | "thinking" | "done" | "failed" | "media" | "compaction" | "tool";
  delta?: string;
  accumulated?: string;
  respondedAt?: string;
  code?: string;
  message?: string;
  media?: RuntimeMediaArtifact[];
  phase?: "start" | "end";
  completed?: boolean;
  willRetry?: boolean;
  toolPhase?: "start" | "end";
  toolName?: string;
  toolCallId?: string;
  isError?: boolean;
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

export function runtimeOutputArtifactsToMediaArtifacts(
  artifacts: RuntimeOutputArtifact[]
): RuntimeMediaArtifact[] {
  const mediaArtifacts: RuntimeMediaArtifact[] = [];
  for (const artifact of artifacts) {
    const type = toRuntimeMediaArtifactType(artifact.kind);
    if (type === null) {
      continue;
    }
    mediaArtifacts.push({
      source: "persai_object_storage",
      objectKey: artifact.objectKey,
      type,
      mimeType: artifact.mimeType,
      filename: artifact.filename,
      sizeBytes: artifact.sizeBytes,
      ...(artifact.voiceNote ? { audioAsVoice: true } : {})
    });
  }
  return mediaArtifacts;
}

export function describeRuntimeMediaArtifact(artifact: RuntimeMediaArtifact): string {
  return artifact.source === "runtime_url" ? artifact.url : artifact.objectKey;
}

export function readRuntimeMediaArtifactFilename(artifact: RuntimeMediaArtifact): string | null {
  if (artifact.source === "persai_object_storage") {
    return artifact.filename;
  }
  const candidate = artifact.url.split("/").pop()?.trim() ?? "";
  return candidate.length > 0 ? candidate : null;
}

function toRuntimeMediaArtifactType(
  kind: RuntimeOutputArtifact["kind"]
): RuntimeMediaArtifactType | null {
  switch (kind) {
    case "image":
      return "image";
    case "audio":
      return "audio";
    case "video":
      return "video";
    case "file":
      return "document";
  }
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
