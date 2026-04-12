export const PERSAI_RUNTIME_CONTRACT_SCHEMA = "persai.runtime.contract.v1" as const;

export const PERSAI_RUNTIME_TIERS = [
  "free_shared_restricted",
  "paid_shared_restricted",
  "paid_isolated"
] as const;

export type PersaiRuntimeTier = (typeof PERSAI_RUNTIME_TIERS)[number];

export const PERSAI_RUNTIME_CHANNELS = ["web", "telegram", "max_ru"] as const;

export type PersaiRuntimeChannel = (typeof PERSAI_RUNTIME_CHANNELS)[number];

export const PERSAI_RUNTIME_CONVERSATION_MODES = ["direct", "group"] as const;

export type PersaiRuntimeConversationMode = (typeof PERSAI_RUNTIME_CONVERSATION_MODES)[number];

export const PERSAI_RUNTIME_ATTACHMENT_KINDS = ["image", "audio", "video", "file"] as const;

export type PersaiRuntimeAttachmentKind = (typeof PERSAI_RUNTIME_ATTACHMENT_KINDS)[number];

export const PERSAI_RUNTIME_TRACE_SCOPES = [
  "create_turn",
  "stream_turn",
  "resolve_session",
  "compact_session"
] as const;

export type PersaiRuntimeTraceScope = (typeof PERSAI_RUNTIME_TRACE_SCOPES)[number];

export const PERSAI_RUNTIME_TRACE_STATUSES = ["ok", "degraded", "failed", "interrupted"] as const;

export type PersaiRuntimeTraceStatus = (typeof PERSAI_RUNTIME_TRACE_STATUSES)[number];

export const PERSAI_RUNTIME_TOOL_KINDS = ["system", "plan", "internal"] as const;

export type PersaiRuntimeToolKind = (typeof PERSAI_RUNTIME_TOOL_KINDS)[number];

export const PERSAI_RUNTIME_TOOL_EXECUTION_MODES = ["inline", "worker", "sandbox"] as const;

export type PersaiRuntimeToolExecutionMode = (typeof PERSAI_RUNTIME_TOOL_EXECUTION_MODES)[number];

export const PERSAI_RUNTIME_TOOL_USAGE_RULES = ["required", "allowed", "forbidden"] as const;

export type PersaiRuntimeToolUsageRule = (typeof PERSAI_RUNTIME_TOOL_USAGE_RULES)[number];

export type IsoTimestamp = string;

export interface AssistantScope {
  assistantId: string;
  workspaceId: string;
}

export interface RuntimeTraceStage {
  key: string;
  durationMs: number;
}

export interface RuntimeTrace {
  scope: PersaiRuntimeTraceScope;
  status: PersaiRuntimeTraceStatus;
  totalMs: number;
  stages: RuntimeTraceStage[];
}

export interface RuntimeConversationAddress extends AssistantScope {
  channel: PersaiRuntimeChannel;
  externalThreadKey: string;
  externalUserKey: string | null;
  mode: PersaiRuntimeConversationMode;
}

export interface RuntimeBundleRef extends AssistantScope {
  bundleId: string;
  publishedVersionId: string;
  bundleHash: string;
  compiledAt: IsoTimestamp;
}

export interface RuntimeAttachmentRef {
  attachmentId: string;
  kind: PersaiRuntimeAttachmentKind;
  objectKey: string;
  mimeType: string;
  filename: string | null;
  sizeBytes: number;
}

export interface RuntimeOutputArtifact {
  artifactId: string;
  kind: PersaiRuntimeAttachmentKind;
  objectKey: string;
  mimeType: string;
  filename: string | null;
  sizeBytes: number | null;
  voiceNote: boolean;
}

export interface RuntimeInboundMessage {
  text: string;
  attachments: RuntimeAttachmentRef[];
  locale: string | null;
  timezone: string | null;
  receivedAt: IsoTimestamp;
}

export interface RuntimeUsageSnapshot {
  providerKey: string | null;
  modelKey: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
}

export interface RuntimeToolPolicy {
  toolCode: string;
  displayName: string;
  description: string | null;
  kind: PersaiRuntimeToolKind;
  executionMode: PersaiRuntimeToolExecutionMode;
  usageRule: PersaiRuntimeToolUsageRule;
  enabled: boolean;
  visibleToModel: boolean;
  visibleInPlanEditor: boolean;
  dailyCallLimit: number | null;
}

export const PERSAI_RUNTIME_SHARED_COMPACTION_TOOL_CODES = [
  "summarize_context",
  "compact_context"
] as const;

export type PersaiRuntimeSharedCompactionToolCode =
  (typeof PERSAI_RUNTIME_SHARED_COMPACTION_TOOL_CODES)[number];

export const DEFAULT_RUNTIME_SHARED_COMPACTION_WEB_LATENCY_THRESHOLD_MS = 7_000 as const;

export interface RuntimeSharedCompactionConfig {
  summarizeToolCode: "summarize_context";
  compactToolCode: "compact_context";
  webSuggestionLatencyMs: number;
  reserveTokens: number;
  keepRecentTokens: number;
  recentTurnsPreserve: number;
  suggestByMessageCount: boolean;
  telegramAutoSummarizeEnabled: boolean;
}

export interface RuntimeTurnRequest {
  requestId: string;
  idempotencyKey: string;
  runtimeTier: PersaiRuntimeTier;
  bundle: RuntimeBundleRef;
  conversation: RuntimeConversationAddress;
  message: RuntimeInboundMessage;
  providerOverride?: "openai" | "anthropic";
  modelOverride?: string;
}

export interface RuntimeTurnResult {
  requestId: string;
  sessionId: string;
  assistantText: string;
  artifacts: RuntimeOutputArtifact[];
  respondedAt: IsoTimestamp;
  usage: RuntimeUsageSnapshot | null;
  trace?: RuntimeTrace;
}

export interface ProviderGatewayTextMessage {
  role: "user" | "assistant";
  content: ProviderGatewayMessageContent;
}

export interface ProviderGatewayTextContentBlock {
  type: "text";
  text: string;
}

export interface ProviderGatewayImageContentBlock {
  type: "image";
  mimeType: string;
  dataBase64: string;
  filename: string | null;
}

export interface ProviderGatewayPdfContentBlock {
  type: "pdf";
  mimeType: "application/pdf";
  dataBase64: string;
  filename: string | null;
}

export type ProviderGatewayMessageContentBlock =
  | ProviderGatewayTextContentBlock
  | ProviderGatewayImageContentBlock
  | ProviderGatewayPdfContentBlock;

export type ProviderGatewayMessageContent = string | ProviderGatewayMessageContentBlock[];

export interface ProviderGatewayTextGenerateRequest {
  provider: "openai" | "anthropic";
  model: string;
  systemPrompt: string | null;
  messages: ProviderGatewayTextMessage[];
  maxOutputTokens?: number;
}

export interface ProviderGatewayTextGenerateResult {
  provider: "openai" | "anthropic";
  model: string;
  text: string;
  respondedAt: IsoTimestamp;
  usage: RuntimeUsageSnapshot | null;
}

export interface ProviderGatewayAudioTranscriptionResult {
  provider: "openai";
  model: string;
  text: string;
  respondedAt: IsoTimestamp;
}

export interface ProviderGatewayTextDeltaEvent {
  type: "text_delta";
  delta: string;
  accumulatedText: string;
}

export interface ProviderGatewayTextCompletedEvent {
  type: "completed";
  result: ProviderGatewayTextGenerateResult;
}

export interface ProviderGatewayTextFailedEvent {
  type: "failed";
  code: string;
  message: string;
}

export type ProviderGatewayTextStreamEvent =
  | ProviderGatewayTextDeltaEvent
  | ProviderGatewayTextCompletedEvent
  | ProviderGatewayTextFailedEvent;

export interface RuntimeStreamStartedEvent {
  type: "started";
  requestId: string;
  sessionId: string;
}

export interface RuntimeTextDeltaEvent {
  type: "text_delta";
  requestId: string;
  sessionId: string;
  delta: string;
  accumulatedText: string;
}

export interface RuntimeArtifactEvent {
  type: "artifact";
  requestId: string;
  sessionId: string;
  artifact: RuntimeOutputArtifact;
}

export interface RuntimeCompletedEvent {
  type: "completed";
  result: RuntimeTurnResult;
}

export interface RuntimeInterruptedEvent {
  type: "interrupted";
  requestId: string;
  sessionId: string;
  assistantText: string;
  respondedAt: IsoTimestamp | null;
  trace?: RuntimeTrace;
}

export interface RuntimeFailedEvent {
  type: "failed";
  requestId: string;
  sessionId: string | null;
  code: string;
  message: string;
  willRetry: boolean;
  trace?: RuntimeTrace;
}

export type RuntimeTurnStreamEvent =
  | RuntimeStreamStartedEvent
  | RuntimeTextDeltaEvent
  | RuntimeArtifactEvent
  | RuntimeCompletedEvent
  | RuntimeInterruptedEvent
  | RuntimeFailedEvent;

export interface RuntimeMediaTranscriptionResult {
  provider: "openai";
  model: string;
  text: string;
  respondedAt: IsoTimestamp;
}

export interface RuntimeSessionResolveInput {
  runtimeTier: PersaiRuntimeTier;
  conversation: RuntimeConversationAddress;
}

export interface RuntimeSessionSummary {
  sessionId: string;
  conversation: RuntimeConversationAddress;
  currentTokens: number | null;
  totalTokensFresh: boolean;
  compactionCount: number;
  compactionHintTokens: number | null;
  providerKey: string | null;
  modelKey: string | null;
  updatedAt: IsoTimestamp | null;
}

export interface RuntimeSessionResolveResult {
  found: boolean;
  session: RuntimeSessionSummary | null;
  trace?: RuntimeTrace;
}

export interface RuntimeCompactionRequest {
  runtimeTier: PersaiRuntimeTier;
  conversation: RuntimeConversationAddress;
  instructions: string | null;
}

export interface RuntimeCompactionResult {
  compacted: boolean;
  reason: string | null;
  tokensBefore: number | null;
  tokensAfter: number | null;
  session: RuntimeSessionSummary | null;
  trace?: RuntimeTrace;
}

export interface RuntimeHealthStatus {
  checkedAt: IsoTimestamp;
  live: boolean;
  ready: boolean;
}

export interface RuntimeReadinessStatus {
  checkedAt: IsoTimestamp;
  ready: boolean;
  bundleCacheReady: boolean;
  providerCacheReady: boolean;
}
