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

export const PERSAI_RUNTIME_KNOWLEDGE_TOOL_CODES = ["knowledge_search", "knowledge_fetch"] as const;

export type PersaiRuntimeKnowledgeToolCode = (typeof PERSAI_RUNTIME_KNOWLEDGE_TOOL_CODES)[number];

export const PERSAI_RUNTIME_KNOWLEDGE_SOURCES = [
  "web",
  "memory",
  "document",
  "database",
  "vector",
  "internal"
] as const;

export type PersaiRuntimeKnowledgeSource = (typeof PERSAI_RUNTIME_KNOWLEDGE_SOURCES)[number];

export const PERSAI_RUNTIME_KNOWLEDGE_EXECUTION_MODES = ["inline", "worker"] as const;

export type PersaiRuntimeKnowledgeExecutionMode =
  (typeof PERSAI_RUNTIME_KNOWLEDGE_EXECUTION_MODES)[number];

export const PERSAI_RUNTIME_KNOWLEDGE_RAG_MODES = ["pattern_only"] as const;

export type PersaiRuntimeKnowledgeRagMode = (typeof PERSAI_RUNTIME_KNOWLEDGE_RAG_MODES)[number];

export interface RuntimeKnowledgeAccessSourceConfig {
  source: PersaiRuntimeKnowledgeSource;
  searchAliasToolCode: string | null;
  fetchAliasToolCode: string | null;
  searchCredentialToolCode: string | null;
  fetchCredentialToolCode: string | null;
}

export interface RuntimeKnowledgeAccessConfig {
  searchToolCode: "knowledge_search";
  fetchToolCode: "knowledge_fetch";
  executionModes: PersaiRuntimeKnowledgeExecutionMode[];
  ragMode: PersaiRuntimeKnowledgeRagMode;
  sources: RuntimeKnowledgeAccessSourceConfig[];
}

export interface RuntimeKnowledgeSearchRequest {
  toolCode: "knowledge_search";
  source: PersaiRuntimeKnowledgeSource;
  query: string;
  maxResults: number | null;
}

export interface RuntimeKnowledgeSearchHit {
  referenceId: string;
  source: PersaiRuntimeKnowledgeSource;
  title: string | null;
  locator: string | null;
  snippet: string | null;
  score: number | null;
  metadata: Record<string, unknown> | null;
}

export interface RuntimeKnowledgeSearchResult {
  toolCode: "knowledge_search";
  source: PersaiRuntimeKnowledgeSource;
  executionMode: PersaiRuntimeKnowledgeExecutionMode;
  hits: RuntimeKnowledgeSearchHit[];
}

export interface RuntimeKnowledgeFetchRequest {
  toolCode: "knowledge_fetch";
  source: PersaiRuntimeKnowledgeSource;
  referenceId: string;
}

export interface RuntimeKnowledgeDocument {
  referenceId: string;
  source: PersaiRuntimeKnowledgeSource;
  title: string | null;
  locator: string | null;
  content: string;
  snippet: string | null;
  metadata: Record<string, unknown> | null;
}

export interface RuntimeKnowledgeFetchResult {
  toolCode: "knowledge_fetch";
  source: PersaiRuntimeKnowledgeSource;
  executionMode: PersaiRuntimeKnowledgeExecutionMode;
  document: RuntimeKnowledgeDocument | null;
}

export interface RuntimeKnowledgeSearchToolResult extends RuntimeKnowledgeSearchResult {
  action: "results" | "skipped";
  reason: string | null;
}

export interface RuntimeKnowledgeFetchToolResult extends RuntimeKnowledgeFetchResult {
  action: "fetched" | "skipped";
  reason: string | null;
}

export const PERSAI_RUNTIME_WEB_SEARCH_PROVIDER_IDS = [
  "tavily",
  "brave",
  "perplexity",
  "google"
] as const;

export type PersaiRuntimeWebSearchProviderId =
  (typeof PERSAI_RUNTIME_WEB_SEARCH_PROVIDER_IDS)[number];

export interface RuntimeWebSearchRequest {
  toolCode: "web_search";
  query: string;
  count: number | null;
}

export interface RuntimeWebSearchHit {
  title: string | null;
  url: string;
  snippet: string | null;
  score: number | null;
  publishedAt: string | null;
}

export interface RuntimeWebSearchResult {
  toolCode: "web_search";
  executionMode: PersaiRuntimeToolExecutionMode;
  provider: PersaiRuntimeWebSearchProviderId | null;
  query: string;
  summary: string | null;
  hits: RuntimeWebSearchHit[];
  externalContent: {
    untrusted: true;
    source: "web_search";
    provider: PersaiRuntimeWebSearchProviderId;
  } | null;
}

export interface RuntimeWebSearchToolResult extends RuntimeWebSearchResult {
  action: "results" | "skipped";
  reason: string | null;
  warning: string | null;
}

export const PERSAI_RUNTIME_WEB_FETCH_EXTRACT_MODES = ["markdown", "text"] as const;

export type PersaiRuntimeWebFetchExtractMode =
  (typeof PERSAI_RUNTIME_WEB_FETCH_EXTRACT_MODES)[number];

export interface RuntimeWebFetchRequest {
  toolCode: "web_fetch";
  url: string;
  extractMode: PersaiRuntimeWebFetchExtractMode;
  maxChars: number | null;
}

export interface RuntimeWebFetchDocument {
  url: string;
  finalUrl: string | null;
  title: string | null;
  content: string;
  contentType: string | null;
  extractMode: PersaiRuntimeWebFetchExtractMode;
  provider: "firecrawl";
  status: number | null;
  truncated: boolean;
  fetchedAt: IsoTimestamp;
  tookMs: number;
  warning: string | null;
  externalContent: {
    untrusted: true;
    source: "web_fetch";
    provider: "firecrawl";
  };
}

export interface RuntimeWebFetchResult {
  toolCode: "web_fetch";
  executionMode: PersaiRuntimeToolExecutionMode;
  document: RuntimeWebFetchDocument | null;
}

export interface RuntimeWebFetchToolResult extends RuntimeWebFetchResult {
  action: "fetched" | "skipped";
  reason: string | null;
  warning: string | null;
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

export interface ProviderGatewayToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface ProviderGatewayNamedToolChoice {
  type: "tool";
  name: string;
}

export type ProviderGatewayToolChoice = "auto" | "none" | ProviderGatewayNamedToolChoice;

export interface ProviderGatewayToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ProviderGatewayToolResult {
  toolCallId: string;
  name: string;
  content: string;
  isError: boolean;
}

export interface ProviderGatewayToolExchange {
  toolCall: ProviderGatewayToolCall;
  toolResult: ProviderGatewayToolResult;
}

export const PERSAI_PROVIDER_REQUEST_CLASSIFICATIONS = [
  "main_turn",
  "tool_loop_followup",
  "manual_compaction",
  "auto_compaction"
] as const;

export type ProviderGatewayRequestClassification =
  (typeof PERSAI_PROVIDER_REQUEST_CLASSIFICATIONS)[number];

export interface ProviderGatewayRequestMetadata {
  classification: ProviderGatewayRequestClassification;
  runtimeRequestId: string | null;
  runtimeSessionId: string | null;
  toolLoopIteration: number | null;
  compactionToolCode: PersaiRuntimeSharedCompactionToolCode | null;
}

export interface ProviderGatewayStructuredOutputSchema {
  name: string;
  description?: string;
  schema: Record<string, unknown>;
  strict?: boolean;
}

export interface ProviderGatewayTextGenerateRequest {
  provider: "openai" | "anthropic";
  model: string;
  systemPrompt: string | null;
  messages: ProviderGatewayTextMessage[];
  maxOutputTokens?: number;
  tools?: ProviderGatewayToolDefinition[];
  toolChoice?: ProviderGatewayToolChoice;
  toolHistory?: ProviderGatewayToolExchange[];
  requestMetadata?: ProviderGatewayRequestMetadata;
  outputSchema?: ProviderGatewayStructuredOutputSchema;
}

export interface ProviderGatewayTextGenerateResult {
  provider: "openai" | "anthropic";
  model: string;
  text: string | null;
  respondedAt: IsoTimestamp;
  usage: RuntimeUsageSnapshot | null;
  stopReason: "completed" | "tool_calls";
  toolCalls: ProviderGatewayToolCall[];
}

export interface ProviderGatewayAudioTranscriptionResult {
  provider: "openai";
  model: string;
  text: string;
  respondedAt: IsoTimestamp;
}

export interface ProviderGatewayWebSearchRequest {
  query: string;
  count: number | null;
  credential: {
    toolCode: "web_search";
    secretId: string;
    providerId: PersaiRuntimeWebSearchProviderId | null;
  };
}

export interface ProviderGatewayWebSearchResult {
  provider: PersaiRuntimeWebSearchProviderId;
  query: string;
  summary: string | null;
  hits: RuntimeWebSearchHit[];
  tookMs: number;
  warning: string | null;
  externalContent: {
    untrusted: true;
    source: "web_search";
    provider: PersaiRuntimeWebSearchProviderId;
  };
}

export interface ProviderGatewayWebFetchRequest {
  url: string;
  extractMode: PersaiRuntimeWebFetchExtractMode;
  maxChars: number | null;
  credential: {
    toolCode: "web_fetch";
    secretId: string;
    providerId: string | null;
  };
}

export interface ProviderGatewayWebFetchResult {
  provider: "firecrawl";
  url: string;
  finalUrl: string | null;
  title: string | null;
  content: string;
  contentType: string | null;
  extractMode: PersaiRuntimeWebFetchExtractMode;
  status: number | null;
  truncated: boolean;
  fetchedAt: IsoTimestamp;
  tookMs: number;
  warning: string | null;
  externalContent: {
    untrusted: true;
    source: "web_fetch";
    provider: "firecrawl";
  };
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

export interface ProviderGatewayTextToolCallsEvent {
  type: "tool_calls";
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
  | ProviderGatewayTextToolCallsEvent
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

export interface RuntimeToolStartedEvent {
  type: "tool_started";
  requestId: string;
  sessionId: string;
  toolCallId: string;
  toolName: string;
}

export interface RuntimeToolFinishedEvent {
  type: "tool_finished";
  requestId: string;
  sessionId: string;
  toolCallId: string;
  toolName: string;
  isError: boolean;
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
  | RuntimeToolStartedEvent
  | RuntimeToolFinishedEvent
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

export interface RuntimeSharedCompactionToolResultState {
  sessionId: string | null;
  currentTokens: number | null;
  compactionCount: number | null;
  summarizedMessageCount: number | null;
  preservedRecentMessageCount: number | null;
}

export interface RuntimeSharedCompactionToolResult {
  toolCode: PersaiRuntimeSharedCompactionToolCode;
  action: "summarized" | "compacted" | "skipped";
  reason: string | null;
  sessionId: string | null;
  compactionRecordId: string | null;
  before: RuntimeSharedCompactionToolResultState | null;
  after: RuntimeSharedCompactionToolResultState | null;
  preservedRecentTurns: number | null;
  summaryText: string | null;
  summaryPayload: Record<string, unknown> | null;
  reusableInLaterTurns: boolean;
}

export interface RuntimeCompactionResult {
  compacted: boolean;
  reason: string | null;
  tokensBefore: number | null;
  tokensAfter: number | null;
  session: RuntimeSessionSummary | null;
  toolResult: RuntimeSharedCompactionToolResult;
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
