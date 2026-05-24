import type { RuntimeTier } from "./runtime-assignment";
import type {
  RuntimeDeferredMediaJobSummary,
  RuntimeBillingFacts,
  RuntimeOutputArtifact,
  RuntimeTurnAutoCompactionState,
  RuntimeTurnToolInvocation,
  RuntimeUsageAccounting
} from "@persai/runtime-contract";

export type AssistantRuntimeErrorCode =
  | "runtime_unreachable"
  | "auth_failure"
  | "timeout"
  | "invalid_response"
  | "runtime_degraded"
  | "runtime_context_window_exceeded"
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
  sourceToolCode?: "image_generate" | "image_edit" | "video_generate" | "tts" | "document" | null;
  audioAsVoice?: boolean;
  caption?: string;
  billingFacts?: RuntimeBillingFacts | null;
}

export interface PersaiObjectStorageRuntimeMediaArtifact {
  source: "persai_object_storage";
  fileRef?: string | null;
  objectKey: string;
  type: RuntimeMediaArtifactType;
  sourceToolCode?: "image_generate" | "image_edit" | "video_generate" | "tts" | "document" | null;
  mimeType: string;
  filename: string | null;
  sizeBytes: number | null;
  audioAsVoice?: boolean;
  caption?: string;
  billingFacts?: RuntimeBillingFacts | null;
}

export type RuntimeMediaArtifact =
  | RuntimeUrlMediaArtifact
  | PersaiObjectStorageRuntimeMediaArtifact;

export interface AssistantRuntimeTurnRoutingSnapshot {
  mode: "shadow" | "active";
  executionMode: "normal" | "premium" | "reasoning";
  source: "precheck" | "llm" | "fallback";
  retrievalPlan?: {
    useSkills: boolean;
    selectedSkillIds: string[];
    useUserKnowledge: boolean;
    useProductKnowledge: boolean;
    useWeb: boolean;
    ordinarySourcePriorityMode:
      | "personal_first"
      | "product_first"
      | "web_first"
      | "mixed_ambiguous"
      | "not_applicable";
    confidence: "low" | "medium" | "high";
    reasonCode: string;
  };
  skillState?: {
    status: "inactive" | "active";
    activeSkillId: string | null;
    activeSkillName: string | null;
    topicSummary: string | null;
    confidence: "low" | "medium" | "high";
    checkedAtMessageIndex: number;
  } | null;
}

export interface AssistantRuntimeWebChatTurnResult {
  assistantMessage: string;
  respondedAt: string;
  media: RuntimeMediaArtifact[];
  usageAccounting?: RuntimeUsageAccounting;
  toolInvocations?: RuntimeTurnToolInvocation[];
  deferredMediaJobs?: RuntimeDeferredMediaJobSummary[];
  turnRouting?: AssistantRuntimeTurnRoutingSnapshot | null;
  autoCompaction?: RuntimeTurnAutoCompactionState;
  runtimeTrace?: {
    scope: string;
    status: string;
    totalMs: number;
    stages: Array<{ key: string; durationMs: number }>;
  };
  /** ADR-100 Piece 1 — canonical AssistantFile ids discovered this turn. */
  discoveredFileRefIds?: string[];
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
  type:
    | "delta"
    | "thinking"
    | "done"
    | "failed"
    | "media"
    | "compaction"
    | "tool"
    | "activity"
    | "project_activity"
    | "project_reasoning_summary";
  delta?: string;
  accumulated?: string;
  respondedAt?: string;
  usageAccounting?: RuntimeUsageAccounting;
  toolInvocations?: RuntimeTurnToolInvocation[];
  deferredMediaJobs?: RuntimeDeferredMediaJobSummary[];
  turnRouting?: AssistantRuntimeTurnRoutingSnapshot | null;
  /** ADR-100 Piece 1 — carried on the `done` chunk only. */
  discoveredFileRefIds?: string[];
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
  activitySource?: "skill" | "user" | "product" | "web";
  activityPhase?: "start";
  activityResultCount?: number;
  activitySkillName?: string | null;
  activitySkillIconEmoji?: string | null;
  projectStage?: "plan" | "gather" | "analyze" | "replan" | "synthesize";
  projectStatus?: "started" | "completed";
  projectSummary?: string;
  projectDetail?: string | null;
  projectSourceClass?: "files" | "skill" | "knowledge" | "web" | "tool" | null;
  projectResultCount?: number | null;
  projectReasoningKind?: "plan" | "check" | "gap" | "conflict" | "interim" | "replan" | "synthesis";
  projectReasoningSummary?: string;
  projectReasoningDetail?: string | null;
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
      fileRef: artifact.fileRef,
      type,
      ...(artifact.sourceToolCode === undefined || artifact.sourceToolCode === null
        ? {}
        : { sourceToolCode: artifact.sourceToolCode }),
      mimeType: artifact.mimeType,
      filename: artifact.filename,
      sizeBytes: artifact.sizeBytes,
      ...(artifact.billingFacts === undefined || artifact.billingFacts === null
        ? {}
        : { billingFacts: artifact.billingFacts }),
      ...(artifact.caption ? { caption: artifact.caption } : {}),
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
