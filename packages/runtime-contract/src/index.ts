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
  fileRef: string;
  file: RuntimeFileRef;
  kind: PersaiRuntimeAttachmentKind;
  sourceToolCode?: "image_generate" | "image_edit" | "video_generate" | "tts" | null;
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
  "delete",
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
    | "deleted"
    | "queued"
    | "skipped";
  reason: string | null;
  warning: string | null;
  item: RuntimeFilesToolItem | null;
  items: RuntimeFilesToolItem[];
  content: string | null;
  job: RuntimeSandboxJobResult | null;
  fileRefs: string[];
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

export const RUNTIME_ORDINARY_SOURCE_PRIORITY_MODES = [
  "personal_first",
  "product_first",
  "web_first",
  "mixed_ambiguous",
  "not_applicable"
] as const;
export type RuntimeOrdinarySourcePriorityMode =
  (typeof RUNTIME_ORDINARY_SOURCE_PRIORITY_MODES)[number];

export interface RuntimeRetrievalPlan {
  useSkills: boolean;
  selectedSkillIds: string[];
  useUserKnowledge: boolean;
  useProductKnowledge: boolean;
  useWeb: boolean;
  ordinarySourcePriorityMode: RuntimeOrdinarySourcePriorityMode;
  confidence: "low" | "medium" | "high";
  reasonCode: string;
}

export type RuntimeSkillRoutingConfidence = "low" | "medium" | "high";

export interface RuntimeSkillDecisionState {
  status: "inactive" | "active";
  activeSkillId: string | null;
  activeSkillName: string | null;
  topicSummary: string | null;
  confidence: RuntimeSkillRoutingConfidence;
  checkedAtMessageIndex: number;
}

export type RuntimeSkillBootstrapReason =
  | "new_chat"
  | "skills_enabled_after_chat_started"
  | "migration_repair";

export interface RuntimeSkillCadenceState {
  messageCountSinceCheck: number;
  backgroundCheckQueuedAtMessageIndex?: number | null;
  needsBootstrap: boolean;
  bootstrapReason?: RuntimeSkillBootstrapReason | null;
}

export interface RuntimeSkillRoutingRecentMessage {
  role: "user" | "assistant";
  text: string;
}

export type RuntimeSkillCheckReason =
  | "background_bootstrap"
  | "background_cadence"
  | "foreground_activation";

export interface RuntimeSkillStateContext {
  decision: RuntimeSkillDecisionState | null;
  cadence: RuntimeSkillCadenceState | null;
  currentUserMessageIndex: number;
  recentMessages: RuntimeSkillRoutingRecentMessage[];
  forceCheck?: boolean;
  checkReason?: RuntimeSkillCheckReason;
}

export type RuntimeRetrievedKnowledgeSourceLabel =
  | "skill_reference"
  | "user_document"
  | "product_kb"
  | "web_reference";

export interface RuntimeRetrievedKnowledgeContextItem {
  label: RuntimeRetrievedKnowledgeSourceLabel;
  referenceId: string;
  title: string | null;
  locator: string | null;
  content: string;
  score: number | null;
  metadata: Record<string, unknown> | null;
}

export interface RuntimeRetrievedKnowledgeContext {
  items: RuntimeRetrievedKnowledgeContextItem[];
  renderedBlock: string | null;
}

export type RuntimeRetrievalActivitySource = "skill" | "user" | "product" | "web";

export interface RuntimeRetrievalActivityEvent {
  type: "retrieval_activity";
  requestId: string;
  sessionId: string;
  source: RuntimeRetrievalActivitySource;
  phase: "start";
  resultCount: number;
  skillName?: string | null;
  skillIconEmoji?: string | null;
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
  /**
   * ADR-074 Slice L1 — per-turn hard cap on this tool's executions inside a
   * single runtime turn. Configurable per assistant via the bundle compile
   * pipeline, so different plans/models can ship different caps. Resolution
   * order in `ToolBudgetPolicy`:
   *
   *   tool policy `perTurnCap` (if set) →
   *   `TOOL_HARD_CAP_PER_TURN[toolCode]` code default (if listed) →
   *   no cap (still bounded by the per-mode loop limit).
   *
   * `null` (or omitted) means "no per-tool override on this policy"; the
   * code default for the well-known browse/media tools then applies. Set to
   * a positive number to override the default; set to `Number.MAX_SAFE_INTEGER`
   * to make a normally-capped tool effectively uncapped on this assistant.
   */
  perTurnCap?: number | null;
}

/**
 * ADR-074 Slice L1 — per-assistant overrides for the tool-loop budget. Lives
 * on `AssistantRuntimeBundleRuntimeConfig.toolBudgets` so the API-side bundle
 * compile pipeline (plan policy + admin UI) can hand a different budget to
 * each assistant without a runtime code change. `null` on any leaf means
 * "fall back to the `TOOL_LOOP_LIMIT_BY_MODE` code default for that mode".
 *
 * Per-tool caps are not in this struct — they live on each `RuntimeToolPolicy`
 * via `perTurnCap` so the cap travels with the tool definition itself.
 */
export interface RuntimeToolBudgetsConfig {
  loopLimitByMode: {
    normal: number | null;
    premium: number | null;
    reasoning: number | null;
  } | null;
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
  /**
   * ADR-074 Slice M3 — cross-session continuity carry-over.
   *
   * Maximum age (in days) of a previous-session synopsis or unresolved
   * open-loop that is eligible for the turn-0 carry-over block. Older items
   * are silently dropped. Plan-policy tunable through the admin UI; the
   * top-N synopsis cap itself stays a hard-coded constant
   * (`MAX_CROSS_SESSION_CARRY_OVER_SYNOPSES`) per ADR-074 Principle 1
   * ("magic, not user-controlled").
   */
  crossSessionCarryOverTtlDays: number;
  /**
   * ADR-074 Slice M3.2 — long-idle re-trigger window.
   *
   * If the most recent stored user message in the current thread is older
   * than this many hours, the cross-session carry-over block fires again on
   * the next turn (subject to {@link crossSessionCarryOverCooldownHours}).
   * Plan-policy tunable; range 1..168 (1 hour … 7 days). The brand-new
   * thread sub-trigger is unaffected by this field.
   */
  crossSessionCarryOverIdleHours: number;
  /**
   * ADR-074 Slice M3.2 — per-thread cooldown between long-idle fires.
   *
   * After the carry-over block fires, the long-idle sub-trigger is muted
   * for this many hours per-thread, even if the idle window has otherwise
   * elapsed. Protects the user from frequent "магия каждые полдня" feel.
   * Plan-policy tunable; range 1..168. Does NOT apply to the brand-new
   * thread sub-trigger (a fresh thread always fires).
   */
  crossSessionCarryOverCooldownHours: number;
}

/**
 * ADR-074 Slice M3 — hard cap for the number of previous-session synopses
 * carried into the next conversation. Intentionally a constant (not plan-
 * tunable): per Principle 1 the magic happens with zero per-user knobs, and
 * three is the founder-confirmed sweet spot between continuity and prompt
 * weight. Open-loops are bounded separately by the carry-over service.
 */
export const MAX_CROSS_SESSION_CARRY_OVER_SYNOPSES = 3 as const;

export const MIN_CROSS_SESSION_CARRY_OVER_TTL_DAYS = 1 as const;
export const MAX_CROSS_SESSION_CARRY_OVER_TTL_DAYS = 90 as const;
export const DEFAULT_CROSS_SESSION_CARRY_OVER_TTL_DAYS = 7 as const;

export const MIN_CROSS_SESSION_CARRY_OVER_IDLE_HOURS = 1 as const;
export const MAX_CROSS_SESSION_CARRY_OVER_IDLE_HOURS = 168 as const;
export const DEFAULT_CROSS_SESSION_CARRY_OVER_IDLE_HOURS = 4 as const;

export const MIN_CROSS_SESSION_CARRY_OVER_COOLDOWN_HOURS = 1 as const;
export const MAX_CROSS_SESSION_CARRY_OVER_COOLDOWN_HOURS = 168 as const;
export const DEFAULT_CROSS_SESSION_CARRY_OVER_COOLDOWN_HOURS = 12 as const;

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
    autoCompactionTelegram: true,
    crossSessionCarryOverTtlDays: DEFAULT_CROSS_SESSION_CARRY_OVER_TTL_DAYS,
    crossSessionCarryOverIdleHours: DEFAULT_CROSS_SESSION_CARRY_OVER_IDLE_HOURS,
    crossSessionCarryOverCooldownHours: DEFAULT_CROSS_SESSION_CARRY_OVER_COOLDOWN_HOURS
  },
  balanced: {
    targetContextBudget: 24_000,
    compactionTriggerThreshold: 8_000,
    keepRecentMinimum: 4,
    knowledgeHydrationBudget: 2_400,
    // ADR-074 Slice M2: web auto-compaction is now default-on. Compaction has
    // moved off the user-perceived request path into a durable background job
    // (apps/api PersaiBackgroundCompactionSchedulerService), so the latency
    // cost that previously argued for keeping this `false` no longer applies.
    autoCompactionWeb: true,
    autoCompactionTelegram: true,
    crossSessionCarryOverTtlDays: DEFAULT_CROSS_SESSION_CARRY_OVER_TTL_DAYS,
    crossSessionCarryOverIdleHours: DEFAULT_CROSS_SESSION_CARRY_OVER_IDLE_HOURS,
    crossSessionCarryOverCooldownHours: DEFAULT_CROSS_SESSION_CARRY_OVER_COOLDOWN_HOURS
  },
  rich: {
    targetContextBudget: 32_000,
    compactionTriggerThreshold: 12_000,
    keepRecentMinimum: 6,
    knowledgeHydrationBudget: 3_600,
    // ADR-074 Slice M2: see `balanced.autoCompactionWeb` rationale above.
    // The richer context budget benefits even more from a rolling background
    // synopsis once total tokens approach `compactionTriggerThreshold`.
    autoCompactionWeb: true,
    autoCompactionTelegram: true,
    crossSessionCarryOverTtlDays: DEFAULT_CROSS_SESSION_CARRY_OVER_TTL_DAYS,
    crossSessionCarryOverIdleHours: DEFAULT_CROSS_SESSION_CARRY_OVER_IDLE_HOURS,
    crossSessionCarryOverCooldownHours: DEFAULT_CROSS_SESSION_CARRY_OVER_COOLDOWN_HOURS
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
  /**
   * For `action: "remembered"` and `action: "skipped"` from a `write` call this
   * is the model-requested kind. For `action: "closed"` (ADR-074 Slice M3.1's
   * structured close-by-ref) and for `skipped` close-call validation errors
   * there is no kind and this is `null`.
   */
  requestedKind: PersaiRuntimeMemoryWriteKind | null;
  item: RuntimeMemoryWriteItem | null;
  action: "remembered" | "closed" | "skipped";
  reason: string | null;
  warning: string | null;
  /**
   * ADR-074 Slice M3.1 — when `action: "closed"`, this is the registry id the
   * runtime stamped `resolved_at` on (server-confirmed). `null` for any other
   * action.
   */
  closedItemRef: string | null;
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

export interface RuntimeMonthlyMediaQuotaStatusToolRow {
  toolCode: "image_generate" | "image_edit" | "video_generate";
  displayName: string;
  usedUnits: number;
  reservedUnits: number;
  settledUnits: number;
  releasedUnits: number;
  reconciliationRequiredUnits: number;
  limitUnits: number | null;
  remainingUnits: number | null;
  usageAvailable: boolean;
  status: "ok" | "limit_reached" | "usage_unavailable";
}

export interface RuntimeMonthlyMediaQuotaStatus {
  planCode: string | null;
  periodStartedAt: IsoTimestamp;
  periodEndsAt: IsoTimestamp;
  periodSource: "subscription_period" | "calendar_month_fallback";
  tools: RuntimeMonthlyMediaQuotaStatusToolRow[];
}

export interface RuntimeQuotaStatusCurrentPlan {
  code: string | null;
  displayName: string | null;
}

export interface RuntimeQuotaStatusLocalizedText {
  ru: string | null;
  en: string | null;
}

export interface RuntimeQuotaStatusLocalizedTextList {
  ru: string[];
  en: string[];
}

export interface RuntimeQuotaStatusVisiblePlanLimits {
  tokenBudgetLimit: number | null;
  activeWebChatsLimit: number | null;
  imageGenerateMonthlyUnitsLimit: number | null;
  imageEditMonthlyUnitsLimit: number | null;
  videoGenerateMonthlyUnitsLimit: number | null;
}

export interface RuntimeQuotaStatusVisiblePlan {
  code: string;
  displayName: string;
  description: string | null;
  highlighted: boolean;
  isCurrent: boolean;
  amountMinor: number | null;
  amountMajor: number | null;
  currency: string | null;
  billingPeriod: "month" | "year" | null;
  priceLabel: RuntimeQuotaStatusLocalizedText;
  enabledToolCodes: string[];
  title: RuntimeQuotaStatusLocalizedText;
  subtitle: RuntimeQuotaStatusLocalizedText;
  notes: RuntimeQuotaStatusLocalizedText;
  badge: RuntimeQuotaStatusLocalizedText;
  ctaLabel: RuntimeQuotaStatusLocalizedText;
  highlightItems: RuntimeQuotaStatusLocalizedTextList;
  limits: RuntimeQuotaStatusVisiblePlanLimits;
}

export interface RuntimeQuotaStatusCheckout {
  paymentIntentId: string;
  targetPlanCode: string;
  paymentMethodClass: "card" | "sbp_qr";
  checkoutMode: "embedded" | "redirect" | "payment_link" | "qr_code" | "manual_test" | null;
  recurringCheckoutKind: "one_time" | "recurring_start";
  recurringSupportedBySelectedMethod: boolean;
  recurringUnsupportedReason: string | null;
  checkoutPagePath: string;
  checkoutPageUrl: string | null;
  checkoutSignInUrl: string | null;
}

export interface RuntimeQuotaStatusToolResult {
  toolCode: "quota_status";
  executionMode: "inline";
  requestedToolCode: string | null;
  planCode: string | null;
  currentPlan: RuntimeQuotaStatusCurrentPlan;
  visiblePlans: RuntimeQuotaStatusVisiblePlan[];
  tools: RuntimeQuotaStatusToolRow[];
  buckets: RuntimeQuotaStatusBucket[];
  monthlyMediaQuotas: RuntimeMonthlyMediaQuotaStatus | null;
  checkout: RuntimeQuotaStatusCheckout | null;
  action: "reported" | "checkout_created" | "skipped";
  reason: string | null;
  warning: string | null;
}

export const PERSAI_RUNTIME_WORKER_TOOL_FAMILIES = [
  "browser_interaction",
  "media_generation",
  "scheduled_action",
  "background_task",
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

export const PERSAI_RUNTIME_IMAGE_BACKGROUNDS = ["auto", "transparent", "opaque"] as const;

export type PersaiRuntimeImageBackground = (typeof PERSAI_RUNTIME_IMAGE_BACKGROUNDS)[number];

export const MIN_RUNTIME_IMAGE_GENERATE_COUNT = 1 as const;
export const MAX_RUNTIME_IMAGE_GENERATE_COUNT = 4 as const;

export interface RuntimeImageGenerateRequest {
  toolCode: "image_generate";
  prompt: string;
  count: number;
  filename: string | null;
  size: PersaiRuntimeImageGenerateSize | null;
  background: PersaiRuntimeImageBackground;
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
  action: "generated" | "skipped" | "deferred";
  reason: string | null;
  warning: string | null;
  jobId?: string | null;
}

export const PERSAI_RUNTIME_IMAGE_EDIT_PROVIDER_IDS = ["openai"] as const;

export type PersaiRuntimeImageEditProviderId =
  (typeof PERSAI_RUNTIME_IMAGE_EDIT_PROVIDER_IDS)[number];

export interface RuntimeImageEditRequest {
  toolCode: "image_edit";
  prompt: string;
  filename: string | null;
  size: PersaiRuntimeImageGenerateSize | null;
  background: PersaiRuntimeImageBackground;
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
  action: "generated" | "skipped" | "deferred";
  reason: string | null;
  warning: string | null;
  jobId?: string | null;
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
  action: "generated" | "skipped" | "deferred";
  reason: string | null;
  warning: string | null;
  jobId?: string | null;
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

export const PERSAI_RUNTIME_SCHEDULED_ACTION_CREATE_KINDS = ["user_reminder"] as const;

export type PersaiRuntimeScheduledActionCreateKind =
  (typeof PERSAI_RUNTIME_SCHEDULED_ACTION_CREATE_KINDS)[number];

export const PERSAI_RUNTIME_SCHEDULED_ACTION_CONTROL_STATUSES = [
  "active",
  "disabled",
  "cancelled"
] as const;

export type PersaiRuntimeScheduledActionControlStatus =
  (typeof PERSAI_RUNTIME_SCHEDULED_ACTION_CONTROL_STATUSES)[number];

export interface RuntimeScheduledActionCreateSchedule {
  runAt?: string;
  delayMs?: number;
  everyMs?: number;
  anchorAt?: string;
  cronExpr?: string;
  timezone?: string;
  contextMessages?: number;
}

export interface RuntimeScheduledActionCreateUserReminderRequest extends RuntimeScheduledActionCreateSchedule {
  toolCode: "scheduled_action";
  action: "create";
  kind: "user_reminder";
  title: string;
  reminderText: string;
}

export interface RuntimeScheduledActionListRequest {
  toolCode: "scheduled_action";
  action: "list";
}

export interface RuntimeScheduledActionControlRequest {
  toolCode: "scheduled_action";
  action: "pause" | "resume" | "cancel";
  taskId?: string;
  titleMatch?: string;
}

export type RuntimeScheduledActionRequest =
  | RuntimeScheduledActionCreateUserReminderRequest
  | RuntimeScheduledActionListRequest
  | RuntimeScheduledActionControlRequest;

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

export const PERSAI_RUNTIME_BACKGROUND_TASK_ACTIONS = [
  "create",
  "list",
  "pause",
  "resume",
  "cancel"
] as const;

export type PersaiRuntimeBackgroundTaskAction =
  (typeof PERSAI_RUNTIME_BACKGROUND_TASK_ACTIONS)[number];

export const PERSAI_RUNTIME_BACKGROUND_TASK_CONTROL_STATUSES = [
  "active",
  "disabled",
  "completed",
  "failed",
  "cancelled"
] as const;

export type PersaiRuntimeBackgroundTaskControlStatus =
  (typeof PERSAI_RUNTIME_BACKGROUND_TASK_CONTROL_STATUSES)[number];

export const PERSAI_RUNTIME_BACKGROUND_TASK_RUN_STATUSES = [
  "running",
  "no_push",
  "pushed",
  "completed",
  "failed",
  "skipped"
] as const;

export type PersaiRuntimeBackgroundTaskRunStatus =
  (typeof PERSAI_RUNTIME_BACKGROUND_TASK_RUN_STATUSES)[number];

export interface RuntimeBackgroundTaskCreateSchedule {
  runAt?: string;
  delayMs?: number;
  everyMs?: number;
  anchorAt?: string;
  cronExpr?: string;
  timezone?: string;
}

export interface RuntimeBackgroundTaskCreateRequest extends RuntimeBackgroundTaskCreateSchedule {
  toolCode: "background_task";
  action: "create";
  title: string;
  brief: string;
  pushPolicy?: Record<string, unknown>;
}

export interface RuntimeBackgroundTaskListRequest {
  toolCode: "background_task";
  action: "list";
}

export interface RuntimeBackgroundTaskControlRequest {
  toolCode: "background_task";
  action: "pause" | "resume" | "cancel";
  taskId?: string;
  titleMatch?: string;
}

export type RuntimeBackgroundTaskRequest =
  | RuntimeBackgroundTaskCreateRequest
  | RuntimeBackgroundTaskListRequest
  | RuntimeBackgroundTaskControlRequest;

export interface RuntimeBackgroundTaskRunItem {
  id: string;
  status: PersaiRuntimeBackgroundTaskRunStatus;
  scheduledRunAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  pushText: string | null;
  deliveryTarget: string | null;
  errorMessage: string | null;
}

export interface RuntimeBackgroundTaskItem {
  id: string | null;
  title: string;
  brief: string;
  mode: "llm_evaluate";
  controlStatus: PersaiRuntimeBackgroundTaskControlStatus;
  nextRunAt: string | null;
  runCount: number;
  lastRunAt: string | null;
  lastRunStatus: PersaiRuntimeBackgroundTaskRunStatus | null;
  lastPushAt: string | null;
  lastErrorMessage: string | null;
  recentRuns: RuntimeBackgroundTaskRunItem[];
}

export interface RuntimeBackgroundTaskToolResult {
  toolCode: "background_task";
  executionMode: "worker";
  requestedAction: PersaiRuntimeBackgroundTaskAction | null;
  action: "created" | "listed" | "paused" | "resumed" | "cancelled" | "skipped";
  reason: string | null;
  warning: string | null;
  task: RuntimeBackgroundTaskItem | null;
  items: RuntimeBackgroundTaskItem[] | null;
}

export interface RuntimeBackgroundTaskEvaluationRequest {
  assistantId: string;
  workspaceId: string;
  runtimeTier: PersaiRuntimeTier;
  runtimeBundleDocument: string;
  task: {
    id: string;
    title: string;
    brief: string;
    scheduleJson: unknown;
    pushPolicyJson: unknown | null;
    scheduledRunAt: string;
    runCount: number;
    lastRunStatus: PersaiRuntimeBackgroundTaskRunStatus | null;
    lastRunAt: string | null;
  };
}

export interface RuntimeBackgroundTaskEvaluationResult {
  decision: "push" | "no_push" | "complete";
  pushText: string | null;
  rationale: string | null;
  confidence: "low" | "medium" | "high";
  toolRunText: string | null;
  artifacts: RuntimeOutputArtifact[];
  usage: RuntimeUsageSnapshot | null;
  rawText: string | null;
}

export interface RuntimeMediaJobRunRequest {
  assistantId: string;
  workspaceId: string;
  runtimeTier: PersaiRuntimeTier;
  runtimeBundleDocument: string;
  job: {
    id: string;
    surface: "web" | "telegram";
    kind: "image" | "audio" | "video";
    chatId: string;
    sourceUserMessageId: string;
    sourceUserMessageText: string;
    sourceUserMessageCreatedAt: string;
  };
  attachments: RuntimeAttachmentRef[];
  directToolExecution:
    | {
        toolCode: "image_generate";
        request: RuntimeImageGenerateRequest;
      }
    | {
        toolCode: "image_edit";
        request: RuntimeImageEditRequest;
      }
    | {
        toolCode: "video_generate";
        request: RuntimeVideoGenerateRequest;
      };
}

export interface RuntimeMediaJobRunResult {
  assistantText: string;
  artifacts: RuntimeOutputArtifact[];
  usage: RuntimeUsageAccounting | RuntimeUsageSnapshot | null;
  toolInvocations: RuntimeTurnToolInvocation[];
  rawText: string | null;
}

export interface RuntimeMediaJobCompletionRequest {
  assistantId: string;
  workspaceId: string;
  runtimeTier: PersaiRuntimeTier;
  runtimeBundleDocument: string;
  job: {
    id: string;
    surface: "web" | "telegram";
    kind: "image" | "audio" | "video";
    chatId: string;
    sourceUserMessageId: string;
    sourceUserMessageText: string;
    sourceUserMessageCreatedAt: string;
  };
  currentHistory: Array<{
    author: "user" | "assistant" | "system";
    content: string;
    createdAt: IsoTimestamp;
  }>;
  workerResult: {
    assistantText: string | null;
    artifacts: Array<{
      type: RuntimeOutputArtifact["kind"];
      filename: string | null;
      fileRef: string | null;
    }>;
  };
}

export interface RuntimeMediaJobCompletionResult {
  assistantText: string | null;
  usage: RuntimeUsageSnapshot | null;
  rawText: string | null;
}

export interface RuntimeTurnRequest {
  requestId: string;
  idempotencyKey: string;
  runtimeTier: PersaiRuntimeTier;
  bundle: RuntimeBundleRef;
  conversation: RuntimeConversationAddress;
  message: RuntimeInboundMessage;
  openMediaJobs?: RuntimeOpenMediaJobContext[];
  deepMode?: boolean;
  modelRoleOverride?: PersaiRuntimeModelRole;
  providerOverride?: "openai" | "anthropic";
  modelOverride?: string;
  skillStateContext?: RuntimeSkillStateContext;
}

export interface RuntimeOpenMediaJobContext {
  jobId: string;
  kind: "image" | "audio" | "video";
  toolCode: "image_generate" | "image_edit" | "video_generate" | "audio_generate";
  status: "queued" | "running" | "completion_pending";
  createdAt: IsoTimestamp;
  startedAt: IsoTimestamp | null;
  updatedAt: IsoTimestamp;
}

export interface RuntimeTurnRoutingSnapshot {
  mode: "shadow" | "active";
  executionMode: "normal" | "premium" | "reasoning";
  source: "precheck" | "llm" | "fallback";
  retrievalPlan?: RuntimeRetrievalPlan;
  skillState?: RuntimeSkillDecisionState | null;
}

export interface RuntimeTurnToolInvocation {
  name: string;
  iteration: number;
  ok: boolean;
  executionMode?: PersaiRuntimeToolExecutionMode;
}

export interface RuntimeDeferredMediaJobSummary {
  jobId: string;
  toolCode: "image_generate" | "image_edit" | "video_generate";
  kind: "image" | "video";
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
  toolInvocations?: RuntimeTurnToolInvocation[];
  deferredMediaJobs?: RuntimeDeferredMediaJobSummary[];
}

export interface RuntimeSkillStateCheckResult {
  requestId: string;
  skillState: RuntimeSkillDecisionState | null;
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
  "auto_compaction",
  // ADR-074 Slice M2 — second LLM pass following an auto-compaction event
  // that asks the model to extract durable human-voiced notes from the
  // compacted slice and writes them through the M1 memory_write path.
  "auto_extract_to_memory",
  "background_task_evaluation",
  "media_job_completion",
  "admin_authoring"
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
  /**
   * ADR-074 P1: per-turn developer instructions appended OUTSIDE the cached system prefix.
   * This is the canonical place for content that must NOT invalidate provider prompt caching:
   * routing/execution-mode hints, the per-turn heartbeat block, and (in later slices) time
   * awareness fields. Providers project this field provider-natively:
   *   - OpenAI Responses API: a `role: "developer"` input item appended after history.
   *   - Anthropic: a second text block appended to the `system` array (no `cache_control`).
   * The runtime owns assembly and must keep `systemPrompt` byte-stable across turns.
   */
  developerInstructions?: string | null;
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
  model: string | null;
  count: number;
  size: PersaiRuntimeImageGenerateSize | null;
  background: PersaiRuntimeImageBackground;
  timeoutMs?: number | null;
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
  model: string | null;
  size: PersaiRuntimeImageGenerateSize | null;
  background: PersaiRuntimeImageBackground;
  timeoutMs?: number | null;
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
  model: string | null;
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
  artifacts?: RuntimeOutputArtifact[];
  fileRefs?: RuntimeFileRef[];
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
  artifacts?: RuntimeOutputArtifact[];
  fileRefs?: RuntimeFileRef[];
  trace?: RuntimeTrace;
}

export type RuntimeTurnStreamEvent =
  | RuntimeStreamStartedEvent
  | RuntimeTextDeltaEvent
  | RuntimeArtifactEvent
  | RuntimeRetrievalActivityEvent
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

/**
 * ADR-074 Slice M2 — outcome of the human-voiced auto-extract pass that runs
 * immediately after each background compaction event. Surfaced in the runtime
 * compaction result so smoke harness traces can attribute "compaction wrote
 * N memories" without correlating timestamps by hand.
 */
export interface RuntimeCompactionAutoExtractResult {
  attempted: boolean;
  written: number;
  dedupSkipped: number;
  policySkipped: number;
  invalidSkipped: number;
  kindCounts: Record<PersaiRuntimeMemoryWriteKind, number>;
  entries: Array<{
    kind: PersaiRuntimeMemoryWriteKind;
    summary: string;
  }>;
  durationMs: number | null;
  reason: string | null;
  usage: RuntimeUsageSnapshot | null;
}

export interface RuntimeCompactionResult {
  compacted: boolean;
  reason: string | null;
  tokensBefore: number | null;
  tokensAfter: number | null;
  session: RuntimeSessionSummary | null;
  toolResult: RuntimeSharedCompactionToolResult;
  /**
   * ADR-074 Slice M2 — present whenever a compaction event ran (regardless of
   * whether auto-extract itself wrote anything). `null` when no compaction was
   * performed (manual `summarize_context` for example).
   */
  autoExtract?: RuntimeCompactionAutoExtractResult | null;
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
