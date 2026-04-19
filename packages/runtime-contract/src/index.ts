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
  fileRef?: string | null;
}

export interface RuntimeOutputArtifact {
  artifactId: string;
  kind: PersaiRuntimeAttachmentKind;
  objectKey: string;
  mimeType: string;
  filename: string | null;
  sizeBytes: number | null;
  voiceNote: boolean;
  caption?: string | null;
}

export const PERSAI_SANDBOX_FILE_ORIGINS = [
  "sandbox_output",
  "runtime_output",
  "uploaded_attachment"
] as const;

export type PersaiSandboxFileOrigin = (typeof PERSAI_SANDBOX_FILE_ORIGINS)[number];

export interface RuntimeFileRef {
  fileRef: string;
  origin: PersaiSandboxFileOrigin;
  sourceToolCode: string | null;
  objectKey: string;
  relativePath: string;
  displayName: string | null;
  mimeType: string;
  sizeBytes: number;
  logicalSizeBytes: number | null;
}

export interface RuntimeSandboxPolicy {
  enabled: boolean;
  maxSingleFileWriteBytes: number;
  maxWorkspaceBytesPerJob: number;
  maxPersistedArtifactsPerJob: number;
  maxFileCountPerJob: number;
  maxDirectoryCountPerJob: number;
  maxProcessRuntimeMs: number;
  maxCpuMsPerJob: number;
  maxMemoryBytesPerJob: number;
  maxConcurrentProcesses: number;
  maxStdoutBytes: number;
  maxStderrBytes: number;
  networkAccessEnabled: boolean;
  artifactMimeAllowlist: string[];
  webMaxOutboundBytes: number;
  telegramMaxOutboundBytes: number;
  sandboxJobsPerDay: number | null;
  maxArtifactSendCountPerTurn: number;
}

export const DEFAULT_RUNTIME_SANDBOX_POLICY: RuntimeSandboxPolicy = {
  enabled: false,
  maxSingleFileWriteBytes: 10 * 1024 * 1024,
  maxWorkspaceBytesPerJob: 25 * 1024 * 1024,
  maxPersistedArtifactsPerJob: 64,
  maxFileCountPerJob: 256,
  maxDirectoryCountPerJob: 128,
  maxProcessRuntimeMs: 15_000,
  maxCpuMsPerJob: 15_000,
  maxMemoryBytesPerJob: 256 * 1024 * 1024,
  maxConcurrentProcesses: 4,
  maxStdoutBytes: 128 * 1024,
  maxStderrBytes: 128 * 1024,
  networkAccessEnabled: false,
  artifactMimeAllowlist: [
    "text/plain",
    "text/markdown",
    "application/json",
    "application/pdf",
    "application/zip",
    "image/png",
    "image/jpeg",
    "audio/mpeg",
    "audio/ogg",
    "video/mp4"
  ],
  webMaxOutboundBytes: 25 * 1024 * 1024,
  telegramMaxOutboundBytes: 50 * 1024 * 1024,
  sandboxJobsPerDay: null,
  maxArtifactSendCountPerTurn: 4
};

export type RuntimeSandboxJobStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "blocked"
  | "cancelled";

export interface RuntimeSandboxProducedFile {
  relativePath: string;
  displayName: string | null;
  mimeType: string;
  sizeBytes: number;
  logicalSizeBytes: number | null;
  fileRef: RuntimeFileRef;
}

export interface RuntimeSandboxJobResult {
  jobId: string;
  status: RuntimeSandboxJobStatus;
  toolCode: string;
  reason: string | null;
  warning: string | null;
  violationCode: string | null;
  violationMessage: string | null;
  exitCode: number | null;
  stdout: string | null;
  stderr: string | null;
  content: string | null;
  files: RuntimeSandboxProducedFile[];
}

export interface RuntimeSandboxJobRequest {
  assistantId: string;
  workspaceId: string;
  runtimeRequestId: string | null;
  runtimeSessionId: string | null;
  toolCode: string;
  policy: RuntimeSandboxPolicy;
  args: Record<string, unknown>;
  mountedFileRefs?: string[];
}

export interface RuntimeSandboxToolResult {
  toolCode: string;
  executionMode: "sandbox";
  action: "completed" | "blocked" | "skipped";
  reason: string | null;
  warning: string | null;
  job: RuntimeSandboxJobResult | null;
  fileRefs: string[];
}

export const PERSAI_RUNTIME_FILES_TOOL_ACTIONS = [
  "list",
  "search",
  "get",
  "read",
  "write",
  "write_and_send",
  "edit",
  "send"
] as const;

export type RuntimeFilesToolAction = (typeof PERSAI_RUNTIME_FILES_TOOL_ACTIONS)[number];

export interface RuntimeFilesToolItem {
  fileRef: string;
  origin: PersaiSandboxFileOrigin;
  sourceToolCode: string | null;
  relativePath: string;
  displayName: string | null;
  mimeType: string;
  sizeBytes: number;
  logicalSizeBytes: number | null;
}

export interface RuntimeFilesToolResult {
  toolCode: "files";
  executionMode: "inline";
  requestedAction: RuntimeFilesToolAction | null;
  action:
    | "listed"
    | "results"
    | "fetched"
    | "read"
    | "written"
    | "written_and_queued"
    | "edited"
    | "queued"
    | "skipped";
  reason: string | null;
  warning: string | null;
  item: RuntimeFilesToolItem | null;
  items: RuntimeFilesToolItem[];
  content: string | null;
  job: RuntimeSandboxJobResult | null;
  fileRefs: string[];
  artifactIds: string[];
  queuedArtifacts: number;
}

export interface RuntimeInboundMessage {
  text: string;
  attachments: RuntimeAttachmentRef[];
  locale: string | null;
  timezone: string | null;
  receivedAt: IsoTimestamp;
}

export const PERSAI_RUNTIME_MODEL_ROLES = [
  "normal_reply",
  "premium_reply",
  "reasoning",
  "system_tool",
  "retrieval",
  "tool_worker"
] as const;

export type PersaiRuntimeModelRole = (typeof PERSAI_RUNTIME_MODEL_ROLES)[number];

export interface RuntimeUsageSnapshot {
  providerKey: string | null;
  modelKey: string | null;
  inputTokens: number | null;
  cachedInputTokens?: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
}

export interface RuntimeUsageAccountingEntry {
  stepType: string;
  modelRole: PersaiRuntimeModelRole | null;
  providerKey: string | null;
  modelKey: string | null;
  inputTokens: number | null;
  cachedInputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  toolCode?: string | null;
}

export interface RuntimeUsageAccounting {
  inputTokens: number | null;
  cachedInputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  entries: RuntimeUsageAccountingEntry[];
}

export interface RuntimeToolPolicy {
  toolCode: string;
  displayName: string;
  description: string | null;
  usageGuidance?: string | null;
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
export const DEFAULT_RUNTIME_SHARED_COMPACTION_SUMMARY_BUDGET_RATIO = 0.04 as const;
export const MIN_RUNTIME_SHARED_COMPACTION_SUMMARY_BUDGET_TOKENS = 250 as const;
export const MAX_RUNTIME_SHARED_COMPACTION_SUMMARY_BUDGET_TOKENS = 1_000 as const;

export interface RuntimeSharedCompactionConfig {
  summarizeToolCode: "summarize_context";
  compactToolCode: "compact_context";
  webSuggestionLatencyMs: number;
  reserveTokens: number;
  keepRecentTokens: number;
  recentTurnsPreserve: number;
  telegramAutoSummarizeEnabled: boolean;
}

export const PERSAI_RUNTIME_CONTEXT_HYDRATION_PRESETS = [
  "lean",
  "balanced",
  "rich",
  "custom"
] as const;

export type PersaiRuntimeContextHydrationPreset =
  (typeof PERSAI_RUNTIME_CONTEXT_HYDRATION_PRESETS)[number];

export interface RuntimeContextHydrationConfig {
  preset: PersaiRuntimeContextHydrationPreset;
  targetContextBudget: number;
  compactionTriggerThreshold: number;
  keepRecentMinimum: number;
  knowledgeHydrationBudget: number;
  sharedCompactionSummaryBudgetTokens?: number;
  autoCompactionWeb: boolean;
  autoCompactionTelegram: boolean;
}

type RuntimeContextHydrationPresetDefaults = Omit<RuntimeContextHydrationConfig, "preset">;

export const PERSAI_RUNTIME_CONTEXT_HYDRATION_PRESET_DEFAULTS: Record<
  Exclude<PersaiRuntimeContextHydrationPreset, "custom">,
  RuntimeContextHydrationPresetDefaults
> = {
  lean: {
    targetContextBudget: 16_000,
    compactionTriggerThreshold: 6_000,
    keepRecentMinimum: 2,
    knowledgeHydrationBudget: 1_200,
    autoCompactionWeb: true,
    autoCompactionTelegram: true
  },
  balanced: {
    targetContextBudget: 24_000,
    compactionTriggerThreshold: 8_000,
    keepRecentMinimum: 4,
    knowledgeHydrationBudget: 2_400,
    autoCompactionWeb: false,
    autoCompactionTelegram: true
  },
  rich: {
    targetContextBudget: 32_000,
    compactionTriggerThreshold: 12_000,
    keepRecentMinimum: 6,
    knowledgeHydrationBudget: 3_600,
    autoCompactionWeb: false,
    autoCompactionTelegram: true
  }
};

export const DEFAULT_PERSAI_RUNTIME_CONTEXT_HYDRATION_PRESET = "balanced" as const;

export const DEFAULT_PERSAI_RUNTIME_CONTEXT_HYDRATION_CONFIG: RuntimeContextHydrationConfig = {
  preset: DEFAULT_PERSAI_RUNTIME_CONTEXT_HYDRATION_PRESET,
  ...PERSAI_RUNTIME_CONTEXT_HYDRATION_PRESET_DEFAULTS[
    DEFAULT_PERSAI_RUNTIME_CONTEXT_HYDRATION_PRESET
  ]
};

export function deriveRuntimeSharedCompactionSummaryBudgetTokens(
  targetContextBudget: number
): number {
  const derived = Math.floor(
    targetContextBudget * DEFAULT_RUNTIME_SHARED_COMPACTION_SUMMARY_BUDGET_RATIO
  );
  return Math.max(
    MIN_RUNTIME_SHARED_COMPACTION_SUMMARY_BUDGET_TOKENS,
    Math.min(MAX_RUNTIME_SHARED_COMPACTION_SUMMARY_BUDGET_TOKENS, derived)
  );
}

export function resolveRuntimeSharedCompactionSummaryBudgetTokens(
  config: Pick<
    RuntimeContextHydrationConfig,
    "targetContextBudget" | "sharedCompactionSummaryBudgetTokens"
  >
): number {
  const override = config.sharedCompactionSummaryBudgetTokens;
  if (Number.isInteger(override) && Number(override) > 0) {
    return Number(override);
  }
  return deriveRuntimeSharedCompactionSummaryBudgetTokens(config.targetContextBudget);
}

export const PERSAI_RUNTIME_KNOWLEDGE_TOOL_CODES = ["knowledge_search", "knowledge_fetch"] as const;

export type PersaiRuntimeKnowledgeToolCode = (typeof PERSAI_RUNTIME_KNOWLEDGE_TOOL_CODES)[number];

export const PERSAI_RUNTIME_KNOWLEDGE_SOURCES = [
  "web",
  "memory",
  "chat",
  "preset",
  "subscription",
  "global",
  "document",
  "database",
  "vector",
  "internal"
] as const;

export type PersaiRuntimeKnowledgeSource = (typeof PERSAI_RUNTIME_KNOWLEDGE_SOURCES)[number];

export const PERSAI_RUNTIME_KNOWLEDGE_EXECUTION_MODES = ["inline", "worker"] as const;

export type PersaiRuntimeKnowledgeExecutionMode =
  (typeof PERSAI_RUNTIME_KNOWLEDGE_EXECUTION_MODES)[number];

export const PERSAI_RUNTIME_KNOWLEDGE_RAG_MODES = ["pattern_only", "hybrid"] as const;

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

export const PERSAI_RUNTIME_MEMORY_WRITE_KINDS = ["fact", "preference", "open_loop"] as const;

export type PersaiRuntimeMemoryWriteKind = (typeof PERSAI_RUNTIME_MEMORY_WRITE_KINDS)[number];

export interface RuntimeMemoryWriteItem {
  id: string;
  summary: string;
  kind: PersaiRuntimeMemoryWriteKind;
  sourceLabel: string | null;
  createdAt: IsoTimestamp;
  chatId: string | null;
}

export interface RuntimeMemoryWriteToolResult {
  toolCode: "memory_write";
  executionMode: "inline";
  requestedKind: PersaiRuntimeMemoryWriteKind;
  item: RuntimeMemoryWriteItem | null;
  action: "remembered" | "skipped";
  reason: string | null;
  warning: string | null;
}

export interface RuntimeQuotaStatusToolRow {
  toolCode: string;
  activationStatus: string;
  dailyCallLimit: number | null;
  currentCount: number;
  allowed: boolean;
}

export interface RuntimeQuotaStatusBucket {
  bucketCode: string;
  displayName: string;
  unit: "tokens" | "count" | "bytes";
  used: number | null;
  limit: number | null;
  percent: number | null;
  usageAvailable: boolean;
  status: "ok" | "limit_reached" | "usage_unavailable";
}

export interface RuntimeQuotaStatusToolResult {
  toolCode: "quota_status";
  executionMode: "inline";
  requestedToolCode: string | null;
  planCode: string | null;
  tools: RuntimeQuotaStatusToolRow[];
  buckets: RuntimeQuotaStatusBucket[];
  action: "reported" | "skipped";
  reason: string | null;
  warning: string | null;
}

export const PERSAI_RUNTIME_WORKER_TOOL_FAMILIES = [
  "browser_interaction",
  "media_generation",
  "scheduled_action",
  "internal_scheduler"
] as const;

export type PersaiRuntimeWorkerToolFamily = (typeof PERSAI_RUNTIME_WORKER_TOOL_FAMILIES)[number];

export const PERSAI_RUNTIME_WORKER_OUTCOME_KINDS = [
  "structured_output",
  "artifact_refs",
  "state_mutation"
] as const;

export type PersaiRuntimeWorkerOutcomeKind = (typeof PERSAI_RUNTIME_WORKER_OUTCOME_KINDS)[number];

export const PERSAI_RUNTIME_WORKER_CONFIRMATION_RULES = ["none", "required_for_mutations"] as const;

export type PersaiRuntimeWorkerConfirmationRule =
  (typeof PERSAI_RUNTIME_WORKER_CONFIRMATION_RULES)[number];

export const PERSAI_RUNTIME_WORKER_FAILURE_BEHAVIORS = [
  "surface_error",
  "retry_then_surface_error"
] as const;

export type PersaiRuntimeWorkerFailureBehavior =
  (typeof PERSAI_RUNTIME_WORKER_FAILURE_BEHAVIORS)[number];

export interface RuntimeWorkerToolConfig {
  toolCode: string;
  family: PersaiRuntimeWorkerToolFamily;
  outcomeKind: PersaiRuntimeWorkerOutcomeKind;
  timeoutMs: number;
  confirmationRule: PersaiRuntimeWorkerConfirmationRule;
  supportsProviderRouting: boolean;
  failureBehavior: PersaiRuntimeWorkerFailureBehavior;
}

export interface RuntimeWorkerToolsConfig {
  tools: RuntimeWorkerToolConfig[];
}

export const PERSAI_RUNTIME_BROWSER_PROVIDER_IDS = ["browserless"] as const;

export type PersaiRuntimeBrowserProviderId = (typeof PERSAI_RUNTIME_BROWSER_PROVIDER_IDS)[number];

export const PERSAI_RUNTIME_BROWSER_ACTIONS = ["snapshot", "act"] as const;

export type PersaiRuntimeBrowserAction = (typeof PERSAI_RUNTIME_BROWSER_ACTIONS)[number];

export const DEFAULT_RUNTIME_BROWSER_MAX_CHARS = 12_000;
export const MIN_RUNTIME_BROWSER_MAX_CHARS = 500;
export const MAX_RUNTIME_BROWSER_MAX_CHARS = 20_000;
export const DEFAULT_RUNTIME_BROWSER_TIMEOUT_MS = 120_000;
export const MIN_RUNTIME_BROWSER_TIMEOUT_MS = 1_000;
export const MAX_RUNTIME_BROWSER_TIMEOUT_MS = 120_000;
export const MAX_RUNTIME_BROWSER_OPERATIONS = 6;
export const MAX_RUNTIME_BROWSER_WAIT_TIMEOUT_MS = 10_000;
export const MAX_RUNTIME_BROWSER_INTERACTIVE_ELEMENTS = 25;

export const PERSAI_RUNTIME_BROWSER_OPERATION_KINDS = [
  "click",
  "type",
  "press",
  "select_option",
  "wait_for_selector",
  "wait_for_timeout"
] as const;

export type PersaiRuntimeBrowserOperationKind =
  (typeof PERSAI_RUNTIME_BROWSER_OPERATION_KINDS)[number];

export interface RuntimeBrowserClickOperation {
  kind: "click";
  selector: string;
}

export interface RuntimeBrowserTypeOperation {
  kind: "type";
  selector: string;
  text: string;
}

export interface RuntimeBrowserPressOperation {
  kind: "press";
  key: string;
}

export interface RuntimeBrowserSelectOptionOperation {
  kind: "select_option";
  selector: string;
  value: string;
}

export interface RuntimeBrowserWaitForSelectorOperation {
  kind: "wait_for_selector";
  selector: string;
  timeoutMs: number | null;
}

export interface RuntimeBrowserWaitForTimeoutOperation {
  kind: "wait_for_timeout";
  timeoutMs: number;
}

export type RuntimeBrowserOperation =
  | RuntimeBrowserClickOperation
  | RuntimeBrowserTypeOperation
  | RuntimeBrowserPressOperation
  | RuntimeBrowserSelectOptionOperation
  | RuntimeBrowserWaitForSelectorOperation
  | RuntimeBrowserWaitForTimeoutOperation;

export interface RuntimeBrowserConfig {
  toolCode: "browser";
  executionMode: "worker";
  credentialToolCode: "browser";
  providerIds: PersaiRuntimeBrowserProviderId[];
  defaultProviderId: PersaiRuntimeBrowserProviderId;
  actions: PersaiRuntimeBrowserAction[];
  confirmationRequiredActions: PersaiRuntimeBrowserAction[];
}

export interface RuntimeBrowserRequest {
  toolCode: "browser";
  action: PersaiRuntimeBrowserAction;
  url: string;
  maxChars: number | null;
  operations: RuntimeBrowserOperation[];
}

export interface RuntimeBrowserInteractiveElement {
  selector: string;
  tagName: string;
  text: string | null;
  role: string | null;
  type: string | null;
  href: string | null;
  placeholder: string | null;
  disabled: boolean;
}

export interface RuntimeBrowserPage {
  initialUrl: string;
  finalUrl: string;
  title: string | null;
  content: string;
  truncated: boolean;
  elements: RuntimeBrowserInteractiveElement[];
  provider: PersaiRuntimeBrowserProviderId;
  observedAt: IsoTimestamp;
  tookMs: number;
  warning: string | null;
  externalContent: {
    untrusted: true;
    source: "browser";
    provider: PersaiRuntimeBrowserProviderId;
  };
}

export interface RuntimeBrowserResult {
  toolCode: "browser";
  executionMode: PersaiRuntimeToolExecutionMode;
  provider: PersaiRuntimeBrowserProviderId | null;
  requestedAction: PersaiRuntimeBrowserAction;
  page: RuntimeBrowserPage | null;
}

export interface RuntimeBrowserToolResult extends RuntimeBrowserResult {
  action: "snapshot" | "acted" | "skipped";
  reason: string | null;
  warning: string | null;
}

export const PERSAI_RUNTIME_IMAGE_GENERATE_PROVIDER_IDS = ["openai"] as const;

export type PersaiRuntimeImageGenerateProviderId =
  (typeof PERSAI_RUNTIME_IMAGE_GENERATE_PROVIDER_IDS)[number];

export const PERSAI_RUNTIME_IMAGE_GENERATE_SIZES = [
  "1024x1024",
  "1024x1536",
  "1536x1024",
  "auto"
] as const;

export type PersaiRuntimeImageGenerateSize = (typeof PERSAI_RUNTIME_IMAGE_GENERATE_SIZES)[number];

export const MIN_RUNTIME_IMAGE_GENERATE_COUNT = 1 as const;
export const MAX_RUNTIME_IMAGE_GENERATE_COUNT = 4 as const;

export interface RuntimeImageGenerateRequest {
  toolCode: "image_generate";
  prompt: string;
  count: number;
  filename: string | null;
  size: PersaiRuntimeImageGenerateSize | null;
}

export interface RuntimeImageGenerateToolResult {
  toolCode: "image_generate";
  executionMode: "worker";
  provider: PersaiRuntimeImageGenerateProviderId | null;
  model: string | null;
  prompt: string | null;
  revisedPrompt: string | null;
  requestedCount: number | null;
  size: PersaiRuntimeImageGenerateSize | null;
  artifacts: RuntimeOutputArtifact[];
  usage: RuntimeUsageSnapshot | null;
  action: "generated" | "skipped";
  reason: string | null;
  warning: string | null;
}

export const PERSAI_RUNTIME_IMAGE_EDIT_PROVIDER_IDS = ["openai"] as const;

export type PersaiRuntimeImageEditProviderId =
  (typeof PERSAI_RUNTIME_IMAGE_EDIT_PROVIDER_IDS)[number];

export interface RuntimeImageEditRequest {
  toolCode: "image_edit";
  prompt: string;
  filename: string | null;
  size: PersaiRuntimeImageGenerateSize | null;
  sourceImageIndex: number | null;
  referenceImageIndex: number | null;
}

export interface RuntimeImageEditToolResult {
  toolCode: "image_edit";
  executionMode: "worker";
  provider: PersaiRuntimeImageEditProviderId | null;
  model: string | null;
  prompt: string | null;
  revisedPrompt: string | null;
  sourceImageIndex: number | null;
  referenceImageIndex: number | null;
  sourceFilename: string | null;
  referenceFilename: string | null;
  size: PersaiRuntimeImageGenerateSize | null;
  artifacts: RuntimeOutputArtifact[];
  usage: RuntimeUsageSnapshot | null;
  action: "generated" | "skipped";
  reason: string | null;
  warning: string | null;
}

export const PERSAI_RUNTIME_VIDEO_GENERATE_PROVIDER_IDS = ["openai"] as const;

export type PersaiRuntimeVideoGenerateProviderId =
  (typeof PERSAI_RUNTIME_VIDEO_GENERATE_PROVIDER_IDS)[number];

export const PERSAI_RUNTIME_VIDEO_GENERATE_MODEL_KEYS = ["sora-2", "sora-2-pro"] as const;

export type PersaiRuntimeVideoGenerateModelKey =
  (typeof PERSAI_RUNTIME_VIDEO_GENERATE_MODEL_KEYS)[number];

export function isPersaiRuntimeVideoGenerateModelKey(
  value: string
): value is PersaiRuntimeVideoGenerateModelKey {
  return (PERSAI_RUNTIME_VIDEO_GENERATE_MODEL_KEYS as readonly string[]).includes(value);
}

export const PERSAI_RUNTIME_VIDEO_GENERATE_SIZES = [
  "720x1280",
  "1280x720",
  "1024x1792",
  "1792x1024"
] as const;

export type PersaiRuntimeVideoGenerateSize = (typeof PERSAI_RUNTIME_VIDEO_GENERATE_SIZES)[number];

export const PERSAI_RUNTIME_VIDEO_GENERATE_SECONDS = [4, 8, 12] as const;

export type PersaiRuntimeVideoGenerateSeconds =
  (typeof PERSAI_RUNTIME_VIDEO_GENERATE_SECONDS)[number];

export interface RuntimeVideoGenerateRequest {
  toolCode: "video_generate";
  prompt: string;
  filename: string | null;
  size: PersaiRuntimeVideoGenerateSize | null;
  seconds: PersaiRuntimeVideoGenerateSeconds;
  referenceImageIndex: number | null;
}

export interface RuntimeVideoGenerateToolResult {
  toolCode: "video_generate";
  executionMode: "worker";
  provider: PersaiRuntimeVideoGenerateProviderId | null;
  model: string | null;
  prompt: string | null;
  requestedSeconds: PersaiRuntimeVideoGenerateSeconds | null;
  size: PersaiRuntimeVideoGenerateSize | null;
  referenceImageIndex: number | null;
  referenceFilename: string | null;
  artifact: RuntimeOutputArtifact | null;
  usage: RuntimeUsageSnapshot | null;
  action: "generated" | "skipped";
  reason: string | null;
  warning: string | null;
}

export const PERSAI_RUNTIME_TTS_PROVIDER_IDS = ["elevenlabs", "yandex", "openai"] as const;

export type PersaiRuntimeTtsProviderId = (typeof PERSAI_RUNTIME_TTS_PROVIDER_IDS)[number];

export const PERSAI_RUNTIME_TTS_DELIVERY_KINDS = ["voice_note", "audio"] as const;

export type PersaiRuntimeTtsDeliveryKind = (typeof PERSAI_RUNTIME_TTS_DELIVERY_KINDS)[number];

export const PERSAI_RUNTIME_TTS_TONE_TAGS = [
  "neutral",
  "warm",
  "gentle",
  "calm",
  "cheerful",
  "playful",
  "confident"
] as const;

export type TtsToneTag = (typeof PERSAI_RUNTIME_TTS_TONE_TAGS)[number];

export const PERSAI_RUNTIME_TTS_DEFAULT_LOCALE = "ru-RU" as const;
export const MAX_RUNTIME_TTS_TEXT_CHARS = 4_000 as const;

export const PERSAI_RUNTIME_YANDEX_TTS_VOICES = [
  "marina",
  "jane",
  "ermil",
  "zahar",
  "lera",
  "masha",
  "dasha",
  "alexander",
  "kirill",
  "anton"
] as const;

export type PersaiRuntimeYandexTtsVoice = (typeof PERSAI_RUNTIME_YANDEX_TTS_VOICES)[number];

export const PERSAI_RUNTIME_YANDEX_TTS_ROLES = [
  "neutral",
  "good",
  "friendly",
  "strict",
  "whisper",
  "evil"
] as const;

export type PersaiRuntimeYandexTtsRole = (typeof PERSAI_RUNTIME_YANDEX_TTS_ROLES)[number];

export const PERSAI_RUNTIME_YANDEX_SUPPORTED_ROLES_BY_VOICE = {
  marina: ["neutral", "friendly", "whisper"],
  jane: ["neutral", "good", "evil"],
  ermil: ["neutral", "good"],
  zahar: ["neutral", "good"],
  lera: ["neutral", "friendly"],
  masha: ["neutral", "good", "friendly", "strict"],
  dasha: ["neutral", "good", "friendly"],
  alexander: ["neutral", "good"],
  kirill: ["neutral", "good", "strict"],
  anton: ["neutral", "good"]
} as const satisfies Record<PersaiRuntimeYandexTtsVoice, readonly PersaiRuntimeYandexTtsRole[]>;

export function isPersaiRuntimeYandexRoleAllowedForVoice(params: {
  voice: PersaiRuntimeYandexTtsVoice;
  role: PersaiRuntimeYandexTtsRole;
}): boolean {
  return (
    PERSAI_RUNTIME_YANDEX_SUPPORTED_ROLES_BY_VOICE[
      params.voice
    ] as readonly PersaiRuntimeYandexTtsRole[]
  ).includes(params.role);
}

export const PERSAI_RUNTIME_OPENAI_TTS_VOICES = [
  "alloy",
  "ash",
  "ballad",
  "coral",
  "echo",
  "fable",
  "onyx",
  "nova",
  "sage",
  "shimmer",
  "verse",
  "marin",
  "cedar"
] as const;

export type PersaiRuntimeOpenAITtsVoice = (typeof PERSAI_RUNTIME_OPENAI_TTS_VOICES)[number];

export interface RuntimeAssistantVoiceProfile {
  schema: "persai.assistantVoiceProfile.v1";
  defaultLocale: string;
  deliveryKind: PersaiRuntimeTtsDeliveryKind;
  elevenlabs: {
    voiceId: string | null;
  };
  yandex: {
    voice: PersaiRuntimeYandexTtsVoice | null;
    role: PersaiRuntimeYandexTtsRole | null;
  };
  openai: {
    voice: PersaiRuntimeOpenAITtsVoice | null;
  };
}

export interface RuntimeTtsRequest {
  toolCode: "tts";
  text: string;
  toneTag: TtsToneTag;
  deliveryKind: PersaiRuntimeTtsDeliveryKind | null;
}

export interface RuntimeTtsToolResult {
  toolCode: "tts";
  executionMode: "worker";
  provider: PersaiRuntimeTtsProviderId | null;
  model: string | null;
  requestedText: string | null;
  toneTag: TtsToneTag | null;
  deliveryKind: PersaiRuntimeTtsDeliveryKind | null;
  artifact: RuntimeOutputArtifact | null;
  attemptedProviders: PersaiRuntimeTtsProviderId[];
  usage: RuntimeUsageSnapshot | null;
  action: "generated" | "skipped";
  reason: string | null;
  warning: string | null;
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

export const PERSAI_RUNTIME_SCHEDULED_ACTION_ACTIONS = [
  "create",
  "list",
  "pause",
  "resume",
  "cancel"
] as const;

export type PersaiRuntimeScheduledActionAction =
  (typeof PERSAI_RUNTIME_SCHEDULED_ACTION_ACTIONS)[number];

export const PERSAI_RUNTIME_SCHEDULED_ACTION_AUDIENCES = ["user", "assistant"] as const;

export type PersaiRuntimeScheduledActionAudience =
  (typeof PERSAI_RUNTIME_SCHEDULED_ACTION_AUDIENCES)[number];

export const PERSAI_RUNTIME_SCHEDULED_ACTION_CONTROL_STATUSES = [
  "active",
  "disabled",
  "cancelled"
] as const;

export type PersaiRuntimeScheduledActionControlStatus =
  (typeof PERSAI_RUNTIME_SCHEDULED_ACTION_CONTROL_STATUSES)[number];

export interface RuntimeScheduledActionRequest {
  toolCode: "scheduled_action";
  action: PersaiRuntimeScheduledActionAction;
  audience?: PersaiRuntimeScheduledActionAudience;
  title?: string;
  reminderText?: string;
  actionType?: string;
  actionPayload?: Record<string, unknown>;
  taskId?: string;
  titleMatch?: string;
  runAt?: string;
  delayMs?: number;
  everyMs?: number;
  anchorAt?: string;
  cronExpr?: string;
  timezone?: string;
  contextMessages?: number;
}

export interface RuntimeScheduledActionItem {
  id: string | null;
  title: string;
  audience: PersaiRuntimeScheduledActionAudience;
  actionType: string | null;
  controlStatus: PersaiRuntimeScheduledActionControlStatus;
  nextRunAt: string | null;
}

export interface RuntimeScheduledActionToolResult {
  toolCode: "scheduled_action";
  executionMode: "worker";
  requestedAction: PersaiRuntimeScheduledActionAction | null;
  action: "created" | "listed" | "paused" | "resumed" | "cancelled" | "skipped";
  reason: string | null;
  warning: string | null;
  task: RuntimeScheduledActionItem | null;
  items: RuntimeScheduledActionItem[] | null;
}

export interface RuntimeTurnRequest {
  requestId: string;
  idempotencyKey: string;
  runtimeTier: PersaiRuntimeTier;
  bundle: RuntimeBundleRef;
  conversation: RuntimeConversationAddress;
  message: RuntimeInboundMessage;
  deepMode?: boolean;
  modelRoleOverride?: PersaiRuntimeModelRole;
  providerOverride?: "openai" | "anthropic";
  modelOverride?: string;
}

export interface RuntimeTurnRoutingSnapshot {
  mode: "shadow" | "active";
  executionMode: "normal" | "premium" | "reasoning";
  source: "precheck" | "llm" | "fallback";
}

export interface RuntimeTurnResult {
  requestId: string;
  sessionId: string;
  assistantText: string;
  artifacts: RuntimeOutputArtifact[];
  respondedAt: IsoTimestamp;
  usage: RuntimeUsageSnapshot | null;
  usageAccounting?: RuntimeUsageAccounting;
  turnRouting?: RuntimeTurnRoutingSnapshot;
  trace?: RuntimeTrace;
  autoCompaction?: RuntimeTurnAutoCompactionState;
}

export interface RuntimeTurnAutoCompactionState {
  tokensBefore: number | null;
  tokensAfter: number | null;
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
  "role_selection",
  "turn_routing",
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

export const PERSAI_PROVIDER_PROMPT_CACHE_RETENTIONS = ["in_memory", "24h"] as const;

export type ProviderGatewayPromptCacheRetention =
  (typeof PERSAI_PROVIDER_PROMPT_CACHE_RETENTIONS)[number];

export interface ProviderGatewayPromptCacheConfig {
  key?: string;
  retention?: ProviderGatewayPromptCacheRetention;
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
  promptCache?: ProviderGatewayPromptCacheConfig;
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

export interface ProviderGatewaySpeechGenerateRequest {
  text: string;
  locale: string;
  toneTag: TtsToneTag;
  deliveryKind: PersaiRuntimeTtsDeliveryKind;
  assistantGender: string | null;
  traits: Record<string, number> | null;
  voiceProfile: RuntimeAssistantVoiceProfile;
  credential: {
    toolCode: "tts";
    secretId: string;
    providerId: PersaiRuntimeTtsProviderId | null;
  };
}

export interface ProviderGatewaySpeechGenerateResult {
  provider: PersaiRuntimeTtsProviderId;
  model: string;
  deliveryKind: PersaiRuntimeTtsDeliveryKind;
  bytesBase64: string;
  mimeType: string;
  respondedAt: IsoTimestamp;
  usage: RuntimeUsageSnapshot | null;
  warning: string | null;
}

export interface ProviderGatewayImageGenerateRequest {
  prompt: string;
  count: number;
  size: PersaiRuntimeImageGenerateSize | null;
  credential: {
    toolCode: "image_generate";
    secretId: string;
    providerId: PersaiRuntimeImageGenerateProviderId | null;
  };
}

export interface ProviderGatewayGeneratedImage {
  bytesBase64: string;
  mimeType: string;
  revisedPrompt: string | null;
}

export interface ProviderGatewayImageGenerateResult {
  provider: PersaiRuntimeImageGenerateProviderId;
  model: string;
  prompt: string;
  size: PersaiRuntimeImageGenerateSize | null;
  images: ProviderGatewayGeneratedImage[];
  respondedAt: IsoTimestamp;
  usage: RuntimeUsageSnapshot | null;
  warning: string | null;
}

export interface ProviderGatewayImageEditRequest {
  prompt: string;
  size: PersaiRuntimeImageGenerateSize | null;
  sourceImage: {
    bytesBase64: string;
    mimeType: string;
    filename: string | null;
  };
  referenceImage: {
    bytesBase64: string;
    mimeType: string;
    filename: string | null;
  } | null;
  credential: {
    toolCode: "image_edit";
    secretId: string;
    providerId: PersaiRuntimeImageEditProviderId | null;
  };
}

export interface ProviderGatewayImageEditResult {
  provider: PersaiRuntimeImageEditProviderId;
  model: string;
  prompt: string;
  size: PersaiRuntimeImageGenerateSize | null;
  images: ProviderGatewayGeneratedImage[];
  respondedAt: IsoTimestamp;
  usage: RuntimeUsageSnapshot | null;
  warning: string | null;
}

export interface ProviderGatewayVideoGenerateRequest {
  prompt: string;
  model: PersaiRuntimeVideoGenerateModelKey | null;
  size: PersaiRuntimeVideoGenerateSize | null;
  seconds: PersaiRuntimeVideoGenerateSeconds;
  referenceImage: {
    bytesBase64: string;
    mimeType: string;
    filename: string | null;
  } | null;
  credential: {
    toolCode: "video_generate";
    secretId: string;
    providerId: PersaiRuntimeVideoGenerateProviderId | null;
  };
}

export interface ProviderGatewayGeneratedVideo {
  bytesBase64: string;
  mimeType: string;
}

export interface ProviderGatewayVideoGenerateResult {
  provider: PersaiRuntimeVideoGenerateProviderId;
  model: string;
  prompt: string;
  size: PersaiRuntimeVideoGenerateSize | null;
  seconds: PersaiRuntimeVideoGenerateSeconds;
  video: ProviderGatewayGeneratedVideo;
  respondedAt: IsoTimestamp;
  usage: RuntimeUsageSnapshot | null;
  warning: string | null;
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

export interface ProviderGatewayBrowserActionRequest {
  action: PersaiRuntimeBrowserAction;
  url: string;
  maxChars: number | null;
  operations: RuntimeBrowserOperation[];
  timeoutMs: number | null;
  credential: {
    toolCode: "browser";
    secretId: string;
    providerId: PersaiRuntimeBrowserProviderId | null;
  };
}

export interface ProviderGatewayBrowserActionResult {
  provider: PersaiRuntimeBrowserProviderId;
  action: PersaiRuntimeBrowserAction;
  initialUrl: string;
  finalUrl: string;
  title: string | null;
  content: string;
  truncated: boolean;
  elements: RuntimeBrowserInteractiveElement[];
  observedAt: IsoTimestamp;
  tookMs: number;
  warning: string | null;
  externalContent: {
    untrusted: true;
    source: "browser";
    provider: PersaiRuntimeBrowserProviderId;
  };
}

export interface ProviderGatewayTextDeltaEvent {
  type: "text_delta";
  delta: string;
  accumulatedText: string;
}

export interface ProviderGatewayTextKeepaliveEvent {
  type: "keepalive";
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
  | ProviderGatewayTextKeepaliveEvent
  | ProviderGatewayTextCompletedEvent
  | ProviderGatewayTextToolCallsEvent
  | ProviderGatewayTextFailedEvent;

export interface RuntimeStreamStartedEvent {
  type: "started";
  requestId: string;
  sessionId: string;
}

export type RuntimeTextDeltaSource = "provider_text_delta" | "provider_tool_calls_result_text";

export interface RuntimeTextDeltaEvent {
  type: "text_delta";
  requestId: string;
  sessionId: string;
  delta: string;
  accumulatedText: string;
  source?: RuntimeTextDeltaSource;
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
  usage: RuntimeUsageSnapshot | null;
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
