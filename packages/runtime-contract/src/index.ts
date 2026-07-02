export * from "./prompt-budget";

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

export interface RuntimeTelegramChannelContext {
  schema: "persai.runtime.telegramContext.v1";
  /** Canonical PersAI assistant_chat.id for scope-aware files.* behavior. */
  chatId?: string;
  chat: {
    id: string;
    type: "private" | "group" | "supergroup" | "channel";
    title: string | null;
  };
  sender: {
    telegramUserId: string | null;
    username: string | null;
    firstName: string | null;
    lastName: string | null;
    displayName: string | null;
  };
  accessMode: "owner_only" | "group_members";
}

export interface RuntimeChannelContext {
  /** Canonical PersAI assistant_chat.id for scope-aware files.* behavior. */
  chatId?: string;
  telegram?: RuntimeTelegramChannelContext;
  /** Web chat UUID for session-scoped file visibility and manifest origin tagging. */
  web?: {
    chatId: string;
  };
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
  storagePath: string;
  mimeType: string;
  displayName: string | null;
  sizeBytes: number;
  aliases?: string[] | null;
}

export interface RuntimeOutputArtifact {
  artifactId: string;
  storagePath: string;
  kind: PersaiRuntimeAttachmentKind;
  sourceToolCode?: "image_generate" | "image_edit" | "video_generate" | "tts" | "document" | null;
  mimeType: string;
  filename: string | null;
  sizeBytes: number | null;
  voiceNote: boolean;
  caption?: string | null;
  downloadUrl?: string | null;
  billingFacts?: RuntimeBillingFacts | null;
}

export interface RuntimeDocumentSourceFile {
  attachmentId: string;
  filename: string | null;
  mimeType: string;
  sizeBytes: number;
  text: string | null;
  markdown: string | null;
  note: string | null;
  provider: {
    providerKey: "local" | "mistral" | "llamaparse";
    processorMode: "auto" | "local" | "default_provider" | "high_quality_fallback";
    attemptedProviderKeys: Array<"local" | "mistral" | "llamaparse">;
  } | null;
  quality: {
    status: "ok" | "poor" | "needs_review";
    score: number | null;
    reasonCodes: string[];
    textChars: number;
    metadata?: Record<string, unknown> | null;
  } | null;
}

export type RuntimeFileScopeTier = "chat" | "assistant" | "workspace_shared";

export interface RuntimeFileHandle {
  storagePath: string;
  mimeType: string;
  sizeBytes: number;
  displayName: string | null;
  workspaceId: string;
  aliases?: string[] | null;
  createdAt?: IsoTimestamp;
  authorLabel?: "user" | "model" | "sandbox";
  semanticSummaryHint?: string | null;
  sourceToolCode?: string | null;
  /** ADR-129 W9 — visibility tier for Working Files ordering. */
  scopeTier?: RuntimeFileScopeTier;
  /** Persisted manifest origin when known (hydration from API). */
  originChatId?: string | null;
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
  maxMemoryBytesPerJob: 1024 * 1024 * 1024,
  maxConcurrentProcesses: 4,
  maxStdoutBytes: 128 * 1024,
  maxStderrBytes: 128 * 1024,
  networkAccessEnabled: false,
  // "*/*" is the allow-all sentinel for sandbox delivery (files.send). The real
  // safety ceiling is the persist-time media validation in the API
  // (media-security-policy.ts: ALLOWED_MEDIA_MIMES + DANGEROUS_FILE_EXTENSIONS),
  // which runs on every produced artifact regardless of this list. Delivery is
  // therefore intentionally open so plans never hit a delivery-MIME wall, while
  // dangerous types are still blocked one layer down.
  artifactMimeAllowlist: ["*/*"],
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
  storagePath: string;
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
  /**
   * Workspace-unique handle that names this assistant's outbound directory
   * inside session pods (`/workspace/outbound/<handle>/`) and the corresponding
   * workspace GCS prefix.
   */
  assistantHandle: string;
  /**
   * Sibling assistant handles that share this workspace, so the sandbox can
   * rematerialise `outbound/<otherHandle>/` directories on session-pod
   * start. Empty array means no siblings.
   */
  siblingHandles: readonly string[];
  workspaceId: string;
  runtimeRequestId: string | null;
  runtimeSessionId: string | null;
  toolCode: string;
  policy: RuntimeSandboxPolicy;
  workspaceQuotaBytes?: number | null;
  sharedQuotaBytes?: number | null;
  args: Record<string, unknown>;
}

export interface RuntimeSandboxToolResult {
  toolCode: string;
  executionMode: "sandbox";
  action: "completed" | "blocked" | "skipped";
  reason: string | null;
  warning: string | null;
  job: RuntimeSandboxJobResult | null;
  paths: string[];
}

/**
 * Model-facing `files.*` actions — the canonical, path-driven surface. The
 * model addresses files exclusively by pod-absolute path; `fileRef` does not
 * appear on this contract. Chat delivery is a separate explicit action and
 * does not piggyback on `files.write`.
 */
export const PERSAI_RUNTIME_FILES_TOOL_ACTIONS = [
  "list",
  "read",
  "preview",
  "write",
  "delete",
  "attach"
] as const;

export type RuntimeFilesToolAction = (typeof PERSAI_RUNTIME_FILES_TOOL_ACTIONS)[number];

export const PERSAI_RUNTIME_FILE_CAPABILITIES = ["text", "visual"] as const;

export type RuntimeFileCapability = (typeof PERSAI_RUNTIME_FILE_CAPABILITIES)[number];

/**
 * The single model-visible item shape returned by `files.list`, `files.read`,
 * `files.preview`, `files.write`, and `files.delete`. There is no `fileRef`
 * field — addressing is by pod-absolute `path` only. After ADR-128 Slice 4
 * the workspace is flat and role-free; the previous `role` field is gone.
 */
export interface RuntimeFilesToolItem {
  /** Pod-absolute path under the single `/workspace/...` namespace. */
  path: string;
  type: "file" | "directory";
  sizeBytes: number;
  mimeType: string | null;
  modifiedAt: string | null;
  /**
   * Cached short description joined from `workspace_file_metadata.shortDescription`
   * (path-keyed by `(workspaceId, path)`) by the runtime after a sandbox list/read.
   * Always `null` until the upload pipeline populates it.
   */
  shortDescription?: string | null;
}

/** ADR-116 — model-visible document extraction quality on `files.read`. */
export type RuntimeFilesReadExtractionQuality = {
  status: "ok" | "poor" | "needs_review";
  score: number | null;
  reasonCodes: string[];
  textChars: number;
};

/**
 * Single result shape returned by every `files.*` action. The `action`
 * discriminant matches the requested action verbatim (one of the six
 * canonical values); `skipped` is the sole error/blocked outcome.
 */
export interface RuntimeFilesToolResult {
  toolCode: "files";
  executionMode: "inline";
  requestedAction: RuntimeFilesToolAction | null;
  action: "listed" | "read" | "previewed" | "written" | "deleted" | "attached" | "skipped";
  reason: string | null;
  warning: string | null;
  path: string | null;
  item?: RuntimeFilesToolItem | null;
  items?: RuntimeFilesToolItem[];
  content?: string | null;
  sizeBytes?: number | null;
  sha256?: string | null;
  truncated?: boolean;
  charCount?: number | null;
  contentTruncated?: boolean;
  extractionQuality?: RuntimeFilesReadExtractionQuality | null;
  /** Model-visible delivery metadata for `files.attach` (no internal `fileRef`). */
  displayName?: string | null;
  mimeType?: string | null;
  /**
   * Runtime/API-only attach identity — never surfaced to the model. Populated
   * after the control-plane row is created; stripped by model-facing sanitizers.
   */
  attachment?: {
    attachmentId: string;
    storagePath: string;
    sourcePath: string;
    displayName: string;
    sizeBytes: number;
    mimeType: string;
  } | null;
}

/** ADR-123 Slice 7 — single match entry returned by the inline `grep` tool. */
export interface RuntimeGrepMatch {
  /** Workspace-relative file path. */
  file: string;
  /** 1-based line number. */
  line: number;
  /** Matched line text (trimmed to fit output caps). */
  text: string;
}

/** ADR-123 Slice 7 — structured result returned by the inline `grep` tool. */
export interface RuntimeGrepToolResult {
  toolCode: "grep";
  executionMode: "inline";
  action: "matched" | "skipped";
  reason: string | null;
  warning: string | null;
  matches: RuntimeGrepMatch[];
  matchCount: number;
  /** True when output was capped and additional matches exist. */
  truncated: boolean;
}

/** ADR-123 Slice 7 — structured result returned by the inline `glob` tool. */
export interface RuntimeGlobToolResult {
  toolCode: "glob";
  executionMode: "inline";
  action: "found" | "skipped";
  reason: string | null;
  warning: string | null;
  /** Sorted workspace-relative file paths. */
  paths: string[];
  /** True when output was capped and additional paths exist. */
  truncated: boolean;
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

export const PERSAI_ROUTING_LEVELS = ["light", "medium", "heavy", "deep"] as const;
export type RoutingLevel = (typeof PERSAI_ROUTING_LEVELS)[number];

export interface RuntimeUsageSnapshot {
  providerKey: string | null;
  modelKey: string | null;
  inputTokens: number | null;
  cacheCreationInputTokens?: number | null;
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
  cacheCreationInputTokens: number | null;
  cachedInputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  toolCode?: string | null;
}

export interface RuntimeUsageAccounting {
  inputTokens: number | null;
  cacheCreationInputTokens: number | null;
  cachedInputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  entries: RuntimeUsageAccountingEntry[];
}

export const RUNTIME_BILLING_FACT_CAPABILITIES = [
  "chat",
  "image",
  "video",
  "speech_to_text",
  "text_to_speech",
  "ocr_or_document_parsing",
  "web_search",
  "web_fetch",
  "browser",
  "document_render"
] as const;
export type RuntimeBillingFactCapability = (typeof RUNTIME_BILLING_FACT_CAPABILITIES)[number];

export interface RuntimeTokenMeteredBillingFact {
  meteringKind: "token_metered";
  inputTokens: number | null;
  cacheCreationInputTokens: number | null;
  cachedInputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  dimensions?: Record<string, string | number | boolean | null> | null;
}

export interface RuntimeTimeMeteredBillingFact {
  meteringKind: "time_metered";
  durationMs: number;
  durationSeconds: number;
}

export interface RuntimeTextCharsMeteredBillingFact {
  meteringKind: "text_chars_metered";
  textChars: number;
}

export interface RuntimeOperationMeteredBillingFact {
  meteringKind: "operation_metered";
  operationCount: number;
  dimensions?: Record<string, string | number | boolean | null> | null;
}

export type RuntimeBillingFactMetering =
  | RuntimeTokenMeteredBillingFact
  | RuntimeTimeMeteredBillingFact
  | RuntimeTextCharsMeteredBillingFact
  | RuntimeOperationMeteredBillingFact;

export interface RuntimeBillingFacts {
  providerKey: string;
  modelKey: string;
  capability: RuntimeBillingFactCapability;
  occurredAt: IsoTimestamp;
  metering: RuntimeBillingFactMetering;
}

export function buildToolPathOperationBillingFacts(input: {
  capability: Extract<RuntimeBillingFactCapability, "web_search" | "web_fetch" | "document_render">;
  providerKey: string;
  operationCount?: number;
  dimensions?: Record<string, string | number | boolean | null> | null;
  occurredAt?: IsoTimestamp;
}): RuntimeBillingFacts {
  const providerKey = input.providerKey.trim();
  return {
    providerKey,
    modelKey: `${input.capability}:${providerKey}`,
    capability: input.capability,
    occurredAt: input.occurredAt ?? new Date().toISOString(),
    metering: {
      meteringKind: "operation_metered",
      operationCount: input.operationCount ?? 1,
      dimensions: input.dimensions ?? null
    }
  };
}

export function buildToolPathTimeBillingFacts(input: {
  providerKey: string;
  durationMs: number;
  occurredAt?: IsoTimestamp;
}): RuntimeBillingFacts {
  const providerKey = input.providerKey.trim();
  const safeDurationMs =
    Number.isFinite(input.durationMs) && input.durationMs > 0 ? input.durationMs : 0;
  const durationSeconds = safeDurationMs / 1000;
  return {
    providerKey,
    modelKey: `browser:${providerKey}`,
    capability: "browser",
    occurredAt: input.occurredAt ?? new Date().toISOString(),
    metering: {
      meteringKind: "time_metered",
      durationMs: safeDurationMs,
      durationSeconds
    }
  };
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

export interface RuntimeSkillDecisionState {
  status: "inactive" | "active";
  activeSkillId: string | null;
  activeSkillName: string | null;
  activeScenarioKey: string | null;
  activeScenarioDisplayName: string | null;
  topicSummary: string | null;
}

export interface RuntimeSkillStateContext {
  decision: RuntimeSkillDecisionState | null;
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

/** ADR-100 Slice 5 — project-mode stage activity (user-safe, bounded). */
export type RuntimeProjectStage = "plan" | "gather" | "analyze" | "replan" | "synthesize";

export type RuntimeProjectActivityStatus = "started" | "completed";

export type RuntimeProjectActivitySourceClass = "files" | "skill" | "knowledge" | "web" | "tool";

/** ADR-100 Slice 5 — visible reasoning summary kinds (not raw chain-of-thought). */
export type RuntimeProjectReasoningKind =
  | "plan"
  | "check"
  | "gap"
  | "conflict"
  | "interim"
  | "replan"
  | "synthesis";

export interface RuntimeProjectActivityEvent {
  type: "project_activity";
  requestId: string;
  sessionId: string;
  stage: RuntimeProjectStage;
  status: RuntimeProjectActivityStatus;
  summary: string;
  detail?: string | null;
  sourceClass?: RuntimeProjectActivitySourceClass | null;
  resultCount?: number | null;
}

export interface RuntimeProjectReasoningSummaryEvent {
  type: "project_reasoning_summary";
  requestId: string;
  sessionId: string;
  kind: RuntimeProjectReasoningKind;
  summary: string;
  detail?: string | null;
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
  /**
   * ADR-109 Slice 8 — plan-level talking-avatar toggle, materialised onto
   * the `video_generate` tool policy by the bundle compile pipeline. When
   * `true`, the LLM-facing JSON schema includes the talking-avatar fields
   * (`mode`, `speechText`, `speechLanguage`, `personaId`,
   * `portraitImageAlias`, `voiceKey`) and the runtime execution path for
   * `mode: "talking_avatar"` is permitted. Absent / `undefined` / `false`
   * means cinematic-only (pre-Slice-3 schema surface).
   */
  talkingVideoEnabled?: boolean;
  /**
   * When `true`, async `image_generate` / `image_edit` completion framing may
   * attach produced (and for edit, source) image bytes for one multimodal
   * review turn before delivery. Plan-gated via bundle materialization.
   */
  mediaCompletionVisionEnabled?: boolean;
  /**
   * ADR-116 — materialized effective max bytes for one `files.preview` or
   * current-turn attachment vision payload. Always a positive integer on the
   * `files` policy after bundle compile; omitted on other tools.
   */
  maxFilePreviewBytes?: number | null;
  /**
   * ADR-116 — materialized effective max image edge (px) for preview resize.
   * Omitted on non-`files` policies.
   */
  maxFilePreviewEdgePx?: number | null;
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

/**
 * ADR-121 Slice 4 — per-plan override of the thinking-token budget per
 * routing level. NULL on a leaf means "use the resolver built-in default
 * for that level" (DEFAULT_THINKING_BUDGET_BY_LEVEL). 0 = thinking off.
 */
export interface RuntimeThinkingBudgetByLevelConfig {
  byLevel: {
    light: number | null;
    medium: number | null;
    heavy: number | null;
    deep: number | null;
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
  "skill",
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
  /**
   * ADR-094 — present when smart search inlined the whole document for this
   * hit (single-hit short-doc branch). Multi-hit and chat/memory hits keep
   * `inlinedDocument` undefined and rely on `snippet`.
   */
  inlinedDocument?: RuntimeKnowledgeInlinedDocument;
  /**
   * ADR-094 — present when smart search inlined an extended section for this
   * hit (single-hit medium/long-doc branch).
   */
  inlinedSection?: RuntimeKnowledgeInlinedSection;
  /**
   * ADR-094 — present alongside `inlinedSection` for long documents. Holds a
   * heading-level summary of the rest of the document so the model can decide
   * whether to call `knowledge_fetch(mode = "full")` for more context.
   */
  documentSummary?: RuntimeKnowledgeDocumentSummary;
}

export interface RuntimeKnowledgeSearchResult {
  toolCode: "knowledge_search";
  source: PersaiRuntimeKnowledgeSource;
  executionMode: PersaiRuntimeKnowledgeExecutionMode;
  hits: RuntimeKnowledgeSearchHit[];
}

/**
 * ADR-094 — modes for the flexible `knowledge_fetch` tool. The model picks
 * the volume it actually needs:
 *   - "short"   — single chunk / short excerpt (cheap)
 *   - "section" — extended window of surrounding chunks or messages (default)
 *   - "full"    — entire document / entire chat thread, capped by plan policy
 * The default in the runtime tool layer is "section" — that is the permanent
 * contract default, not a legacy alias.
 */
export const PERSAI_RUNTIME_KNOWLEDGE_FETCH_MODES = ["short", "section", "full"] as const;

export type PersaiRuntimeKnowledgeFetchMode = (typeof PERSAI_RUNTIME_KNOWLEDGE_FETCH_MODES)[number];

export interface RuntimeKnowledgeFetchRequest {
  toolCode: "knowledge_fetch";
  source: PersaiRuntimeKnowledgeSource;
  referenceId: string;
  /** ADR-094 — required at the runtime layer; default supplied by the tool parser. */
  mode: PersaiRuntimeKnowledgeFetchMode;
  /** ADR-094 — only meaningful for `mode = "section"`. Plan policy clamps the value. */
  radius: number | null;
}

/**
 * ADR-094 — when the smart `knowledge_search` decides to inline content for
 * a single short hit, it fills `inlinedDocument`. When it inlines a section,
 * it fills `inlinedSection`. For long documents the search additionally fills
 * `documentSummary` so the model still sees the rest of the document as
 * heading bullets, capped by admin `smartSearchLongDocSummaryChars`.
 */
export interface RuntimeKnowledgeInlinedDocument {
  text: string;
  chars: number;
  truncated: boolean;
}

export interface RuntimeKnowledgeInlinedSection {
  text: string;
  chars: number;
  radius: number;
  truncated: boolean;
}

export interface RuntimeKnowledgeDocumentSummary {
  text: string;
  chars: number;
}

export interface RuntimeKnowledgeDocument {
  referenceId: string;
  source: PersaiRuntimeKnowledgeSource;
  title: string | null;
  locator: string | null;
  content: string;
  snippet: string | null;
  metadata: Record<string, unknown> | null;
  /** ADR-094 — present when the fetch returned content under the configured cap. */
  modeUsed?: PersaiRuntimeKnowledgeFetchMode;
  /** ADR-094 — true when the fetched volume was clamped by the cap. */
  truncated?: boolean;
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

export const PERSAI_RUNTIME_MEMORY_WRITE_LAYERS = ["long", "short"] as const;

export type PersaiRuntimeMemoryWriteLayer = (typeof PERSAI_RUNTIME_MEMORY_WRITE_LAYERS)[number];

export interface RuntimeMemoryWriteItem {
  id: string;
  summary: string;
  kind: PersaiRuntimeMemoryWriteKind;
  layer: PersaiRuntimeMemoryWriteLayer | null;
  confidence: number | null;
  sourceLabel: string | null;
  createdAt: IsoTimestamp;
  chatId: string | null;
}

/**
 * ADR-125 Slice 1 — `todo_write` native tool. The model owns a per-chat
 * hierarchical todo list; the server enforces invariants (single in_progress
 * per parent, no resurrection of completed items, child-before-parent
 * completion, soft 200 / hard 500 cap). The reinjection window
 * (`<persai_chat_plan>`) and the post-mutation response window both use the
 * same selection rule (`RUNTIME_CHAT_PLAN_WINDOW_MAX = 12`).
 */
export const PERSAI_RUNTIME_TODO_WRITE_ACTIONS = [
  "add",
  "update",
  "complete",
  "remove",
  "clear"
] as const;

export type PersaiRuntimeTodoWriteAction = (typeof PERSAI_RUNTIME_TODO_WRITE_ACTIONS)[number];

export const PERSAI_RUNTIME_TODO_WRITE_STATUSES = ["pending", "in_progress", "completed"] as const;

export type PersaiRuntimeTodoWriteStatus = (typeof PERSAI_RUNTIME_TODO_WRITE_STATUSES)[number];

/** ADR-125 — hard upper bound on items rendered in the volatile plan block and the post-mutation response window. */
export const RUNTIME_CHAT_PLAN_WINDOW_MAX = 12;

export interface RuntimeTodoItem {
  id: string;
  parentId: string | null;
  content: string;
  status: PersaiRuntimeTodoWriteStatus;
}

export interface RuntimeTodoWriteToolResult {
  toolCode: "todo_write";
  executionMode: "inline";
  action: "applied" | "skipped";
  reason: string | null;
  warning: string | null;
  /** Post-mutation visible window matching the reinjection window selection. */
  todos: RuntimeTodoItem[];
  /** True when the chat plan exceeds the window cap so the model knows the list was truncated. */
  windowed: boolean;
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
  displayName: string;
  activationStatus: string;
  dailyCallLimit: number | null;
  currentCount: number;
  percent: number | null;
  finiteLimit: boolean;
  warningThresholdPercent: number | null;
  warningThresholdReached: boolean;
  periodStartedAt: IsoTimestamp | null;
  periodEndsAt: IsoTimestamp | null;
  periodSource: "utc_day" | null;
  allowed: boolean;
}

export interface RuntimeQuotaStatusBucket {
  bucketCode: string;
  displayName: string;
  unit: "tokens" | "count" | "bytes";
  used: number | null;
  limit: number | null;
  percent: number | null;
  finiteLimit: boolean;
  usageAvailable: boolean;
  warningThresholdPercent: number | null;
  warningThresholdReached: boolean;
  status: "ok" | "limit_reached" | "usage_unavailable";
}

/**
 * ADR-108 Slice 7 — per-unit variant of the monthly tool quota row.
 * Used for `image_generate`, `image_edit`, and `document` which keep the
 * existing per-unit quota model. The `kind: "units"` discriminator allows
 * consumers to narrow away from the vcoin variant without breaking older
 * code that only reads unit-flavored fields.
 *
 * `effectiveLimitUnits` is an optional carry-over from the server-side
 * `AssistantMonthlyToolQuotaToolSnapshot` (base + bonus package units).
 * Consumers that only need the hard limit can fall back to `limitUnits`.
 */
export interface RuntimeMonthlyToolQuotaStatusToolRowUnits {
  kind: "units";
  toolCode: "image_generate" | "image_edit" | "document";
  displayName: string;
  usedUnits: number;
  reservedUnits: number;
  settledUnits: number;
  releasedUnits: number;
  reconciliationRequiredUnits: number;
  limitUnits: number | null;
  /** Effective limit = base + bonus package units. Null when base is null (unlimited). */
  effectiveLimitUnits?: number | null;
  remainingUnits: number | null;
  percent: number | null;
  finiteLimit: boolean;
  usageAvailable: boolean;
  warningThresholdPercent: number | null;
  warningThresholdReached: boolean;
  status: "ok" | "limit_reached" | "usage_unavailable";
}

/**
 * ADR-108 Slice 7 — vcoin variant of the monthly tool quota row.
 * Used exclusively for `video_generate`, which is priced in Vcoin (VC)
 * rather than per-unit quota. The `kind: "vcoin"` discriminator lets
 * consumers branch on the currency model without reading unit fields.
 */
export interface RuntimeMonthlyToolQuotaStatusToolRowVcoin {
  kind: "vcoin";
  toolCode: "video_generate";
  displayName: string;
  /** Current integer VC balance for the workspace. */
  balanceVc: number;
  /** Monthly VC grant from the active plan (0 when plan has no grant). */
  monthlyGrantVc: number;
  /**
   * Approximate VC cost of a typical video, derived from the rolling
   * 30-day workspace average duration (or the platform fallback of
   * `TYPICAL_VIDEO_SECONDS_FALLBACK = 5` when no history exists) combined
   * with the platform-average USD/sec across active time-metered catalog rows.
   * Null when no active video catalog pricing is available.
   */
  typicalVideoCostVc: number | null;
  /**
   * Rolling 30-day workspace average video duration in seconds used to
   * compute `typicalVideoCostVc`. Null when no workspace history exists
   * (in which case `typicalCostFromPlatformFallback` is true).
   */
  typicalVideoSeconds: number | null;
  /**
   * True when `typicalVideoCostVc` was derived from the platform fallback
   * constant rather than real workspace history.
   */
  typicalCostFromPlatformFallback: boolean;
  status: "ok" | "balance_exhausted";
}

/**
 * ADR-108 Slice 7 — discriminated union for monthly tool quota rows.
 * Non-video tools (`image_generate`, `image_edit`, `document`) produce
 * `kind: "units"` rows. `video_generate` produces `kind: "vcoin"` rows.
 * Narrow on `row.kind` before accessing kind-specific fields.
 */
export type RuntimeMonthlyToolQuotaStatusToolRow =
  | RuntimeMonthlyToolQuotaStatusToolRowUnits
  | RuntimeMonthlyToolQuotaStatusToolRowVcoin;

export interface RuntimeMonthlyToolQuotaStatus {
  planCode: string | null;
  periodStartedAt: IsoTimestamp;
  periodEndsAt: IsoTimestamp;
  periodSource: "subscription_period" | "calendar_month_fallback";
  tools: RuntimeMonthlyToolQuotaStatusToolRow[];
}

export interface RuntimeQuotaStatusCurrentPlan {
  code: string | null;
  displayName: string | null;
}

export interface RuntimeQuotaStatusAdvisories {
  warningThresholdPercent: number;
  isFreePlan: boolean;
  higherPaidPlanAvailable: boolean;
  highestVisiblePaidPlanCode: string | null;
  tokenBudget: {
    periodStartedAt: IsoTimestamp | null;
    periodEndsAt: IsoTimestamp | null;
    periodSource: "subscription_period" | "calendar_month_fallback" | null;
    paidLightModeEligible: boolean;
    paidLightModeActive: boolean;
    paidLightModeReason: "token_budget_limit_reached" | null;
  };
}

export interface RuntimeQuotaAdvisoryCandidate {
  dedupeKey: string | null;
  limitCode: string;
  displayName: string;
  thresholdCode: "warning_90_percent";
  warningThresholdPercent: number;
  currentPercent: number;
  finiteLimit: boolean;
  periodStartedAt: IsoTimestamp | null;
  periodEndsAt: IsoTimestamp | null;
  periodSource: "subscription_period" | "calendar_month_fallback" | "utc_day" | null;
  deliveryState: "eligible" | "already_sent";
  deliveredAt: IsoTimestamp | null;
}

export interface RuntimeQuotaStatusLocalizedText {
  ru: string | null;
  en: string | null;
}

export interface RuntimeQuotaStatusLocalizedTextList {
  ru: string[];
  en: string[];
}

export interface RuntimeQuotaStatusPackageOffer {
  id: string;
  toolCode: "image_generate" | "image_edit" | "video_generate" | "document";
  units: number;
  amountMinor: number;
  amountMajor: number;
  currency: string;
  displayOrder: number;
  highlighted: boolean;
  title: RuntimeQuotaStatusLocalizedText;
  subtitle: RuntimeQuotaStatusLocalizedText;
  ctaLabel: RuntimeQuotaStatusLocalizedText;
  priceLabel: RuntimeQuotaStatusLocalizedText;
}

export interface RuntimeQuotaStatusPackageToolOffers {
  toolCode: "image_generate" | "image_edit" | "video_generate" | "document";
  available: boolean;
  offerableNow: boolean;
  offerReason: "available" | "no_public_packages" | "tool_not_enabled_on_current_plan";
  preferredOfferKind: "none" | "package_only" | "plan_upgrade_only" | "plan_upgrade_or_package";
  preferredPackageIds: string[];
  preferredUpgradePlanCode: string | null;
  upgradePlanCodes: string[];
  offers: RuntimeQuotaStatusPackageOffer[];
}

export interface RuntimeQuotaStatusPackageOffers {
  packagesPurchase: {
    path: string;
    url: string | null;
    paymentMethodClasses: Array<"card" | "sbp_qr">;
  } | null;
  tools: RuntimeQuotaStatusPackageToolOffers[];
}

export interface RuntimeQuotaStatusVisiblePlanLimits {
  tokenBudgetLimit: number | null;
  activeWebChatsLimit: number | null;
  messagesPerChat: number | null;
  imageGenerateMonthlyUnitsLimit: number | null;
  imageEditMonthlyUnitsLimit: number | null;
  documentMonthlyUnitsLimit: number | null;
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

export interface RuntimeQuotaStatusSubscriptionUpdate {
  targetPlanCode: string;
  targetPlanDisplayName: string | null;
  effectiveAt: string | null;
  nextChargeAt: string | null;
  changeKind: "free" | "downgrade" | null;
}

export interface RuntimeQuotaStatusToolResult {
  toolCode: "quota_status";
  executionMode: "inline";
  requestedToolCode: string | null;
  planCode: string | null;
  currentPlan: RuntimeQuotaStatusCurrentPlan;
  visiblePlans: RuntimeQuotaStatusVisiblePlan[];
  advisories: RuntimeQuotaStatusAdvisories;
  advisoryCandidates: RuntimeQuotaAdvisoryCandidate[];
  tools: RuntimeQuotaStatusToolRow[];
  buckets: RuntimeQuotaStatusBucket[];
  monthlyToolQuotas: RuntimeMonthlyToolQuotaStatus | null;
  packagesAvailableByTool: Record<string, boolean>;
  packageOffers: RuntimeQuotaStatusPackageOffers;
  /**
   * Convenience CTA hint for the model. When at least one tool key in
   * `packagesAvailableByTool` is `true`, this carries the in-product path/url
   * the user should be sent to in order to buy media packages, plus the
   * list of tool codes the user can buy a package for right now. When no
   * tool currently allows package purchase, this is `null`.
   */
  packagesPurchase: {
    path: string;
    url: string;
    availableTools: string[];
    paymentMethodClasses: Array<"card" | "sbp_qr">;
  } | null;
  /**
   * Convenience CTA hint for the model for subscription/plan questions. This
   * carries the in-product pricing page the user should be sent to when they
   * ask to compare plans, open tariffs, upgrade, or choose a subscription.
   */
  pricingPage: {
    path: string;
    url: string;
  } | null;
  checkout: RuntimeQuotaStatusCheckout | null;
  subscriptionUpdate: RuntimeQuotaStatusSubscriptionUpdate | null;
  action: "reported" | "checkout_created" | "subscription_updated" | "skipped";
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
  billingFacts?: RuntimeBillingFacts | null;
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
// 10 = gpt-image-1 provider batch capability (maximum n per single API call).
// Serves as the absolute safety ceiling above which resolveImageCountCap clamps;
// the EFFECTIVE per-assistant ceiling is min(perTurnCap, 10), so for any plan cap
// ≤ 10 the model sees count.maximum == perTurnCap and a series runs as ONE job —
// no splitting into multiple jobs.
export const MAX_RUNTIME_IMAGE_GENERATE_COUNT = 10 as const;

export const MIN_RUNTIME_IMAGE_EDIT_COUNT = MIN_RUNTIME_IMAGE_GENERATE_COUNT;
export const MAX_RUNTIME_IMAGE_EDIT_COUNT = MAX_RUNTIME_IMAGE_GENERATE_COUNT;

// `image_edit` sends the source image plus optional reference images to the
// provider as one input set. OpenAI `images.edit` (gpt-image-1) accepts up to
// 16 input images total, so the source consumes one slot and up to 15
// additional reference images may accompany it.
export const MAX_RUNTIME_IMAGE_EDIT_INPUT_IMAGES = 16 as const;
// Source consumes one of the 16 input slots, leaving up to 15 reference images.
export const MAX_RUNTIME_IMAGE_EDIT_REFERENCE_IMAGES = 15 as const;

export interface RuntimePendingMediaDeliveryFacts {
  canSendFileNow: false;
  jobId: string;
  messageToUser: string;
  requestedCount: number | null;
  expectedResultCount: number | null;
}

export interface RuntimeImageGenerateRequest {
  toolCode: "image_generate";
  prompt: string;
  count: number;
  outputMode?: "variants" | "series" | null;
  seriesItems?: string[] | null;
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
  action: "generated" | "skipped" | "pending_delivery";
  reason: string | null;
  warning: string | null;
  guidance?: string | null;
  jobId?: string | null;
  canSendFileNow?: false;
  messageToUser?: string | null;
  expectedResultCount?: number | null;
}

export const PERSAI_RUNTIME_IMAGE_EDIT_PROVIDER_IDS = ["openai"] as const;

export type PersaiRuntimeImageEditProviderId =
  (typeof PERSAI_RUNTIME_IMAGE_EDIT_PROVIDER_IDS)[number];

export interface RuntimeImageEditRequest {
  toolCode: "image_edit";
  prompt: string;
  count: number;
  outputMode?: "variants" | "series" | null;
  seriesItems?: string[] | null;
  filename: string | null;
  size: PersaiRuntimeImageGenerateSize | null;
  background: PersaiRuntimeImageBackground;
  sourceImageAlias: string | null;
  /**
   * Sticky aliases of additional images used purely as visual style,
   * appearance, background, or composition references. Up to
   * `MAX_RUNTIME_IMAGE_EDIT_REFERENCE_IMAGES`. The edited output stays rooted
   * in `sourceImageAlias`. `null` means no separate reference images.
   */
  referenceImageAliases: string[] | null;
}

export interface RuntimeImageEditToolResult {
  toolCode: "image_edit";
  executionMode: "worker";
  provider: PersaiRuntimeImageEditProviderId | null;
  model: string | null;
  prompt: string | null;
  revisedPrompt: string | null;
  requestedCount: number | null;
  sourceImageAlias: string | null;
  referenceImageAliases: string[] | null;
  sourceFilename: string | null;
  referenceFilenames: (string | null)[] | null;
  size: PersaiRuntimeImageGenerateSize | null;
  artifacts: RuntimeOutputArtifact[];
  usage: RuntimeUsageSnapshot | null;
  action: "generated" | "skipped" | "pending_delivery";
  reason: string | null;
  warning: string | null;
  guidance?: string | null;
  jobId?: string | null;
  canSendFileNow?: false;
  messageToUser?: string | null;
  expectedResultCount?: number | null;
}

export const PERSAI_RUNTIME_VIDEO_GENERATE_PROVIDER_IDS = [
  "openai",
  "runway",
  "kling",
  "heygen"
] as const;

export type PersaiRuntimeVideoGenerateProviderId =
  (typeof PERSAI_RUNTIME_VIDEO_GENERATE_PROVIDER_IDS)[number];

export const PERSAI_RUNTIME_TALKING_AVATAR_VIDEO_PROVIDER_IDS = ["heygen"] as const;

export type PersaiRuntimeTalkingAvatarVideoProviderId =
  (typeof PERSAI_RUNTIME_TALKING_AVATAR_VIDEO_PROVIDER_IDS)[number];

export function isTalkingAvatarVideoProvider(providerId: string | null | undefined): boolean {
  return (PERSAI_RUNTIME_TALKING_AVATAR_VIDEO_PROVIDER_IDS as readonly string[]).includes(
    providerId ?? ""
  );
}

// ADR-109 Slice 3: distinguish cinematic video generation (current behavior) from
// the new talking-avatar mode (HeyGen). Routing uses this enum + provider catalog
// capability; no message-body parsing is involved (invariant #15).
export const RUNTIME_VIDEO_GENERATE_MODES = ["cinematic", "talking_avatar"] as const;

export type RuntimeVideoGenerateMode = (typeof RUNTIME_VIDEO_GENERATE_MODES)[number];

export function isRuntimeVideoGenerateMode(value: unknown): value is RuntimeVideoGenerateMode {
  return (
    typeof value === "string" && (RUNTIME_VIDEO_GENERATE_MODES as readonly string[]).includes(value)
  );
}

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

export const PERSAI_RUNTIME_VIDEO_ASPECT_RATIOS = ["16:9", "9:16", "1:1"] as const;

export type PersaiRuntimeVideoAspectRatio = (typeof PERSAI_RUNTIME_VIDEO_ASPECT_RATIOS)[number];

export interface RuntimeVideoDurationAllowedList {
  kind: "allowed_list";
  values: number[];
}

export interface RuntimeVideoDurationRange {
  kind: "range";
  min: number;
  max: number;
  step: number | null;
  preferredValues: number[] | null;
}

export type RuntimeVideoDurationConstraint =
  | RuntimeVideoDurationAllowedList
  | RuntimeVideoDurationRange;

export interface RuntimeVideoAspectRatioOption {
  aspectRatio: PersaiRuntimeVideoAspectRatio;
  size: PersaiRuntimeVideoGenerateSize;
  providerValue: string | null;
}

export interface RuntimeVideoProviderParameters {
  mode?: string | null;
  sound?: "on" | "off" | null;
  audio?: boolean | null;
  /**
   * ADR-109 cleanup — HeyGen-native video quality. Used only by the HeyGen
   * talking-avatar path; cinematic providers ignore it.
   */
  resolution?: "720p" | "1080p" | "4k" | null;
  /**
   * ADR-109 cleanup — HeyGen-native output aspect ratio. This is not the
   * PersAI cinematic `size` field; it maps directly to HeyGen v3
   * `aspect_ratio`.
   */
  aspectRatio?: "auto" | "16:9" | "9:16" | "1:1" | "4:5" | "5:4" | null;
  /**
   * ADR-109 cleanup — optional HeyGen engine selector, e.g. `avatar_v`.
   */
  engine?: "avatar_iv" | "avatar_v" | null;
}

export const RUNTIME_VIDEO_VOICE_GENDERS = ["male", "female", "neutral", "unknown"] as const;

export type RuntimeVideoVoiceGender = (typeof RUNTIME_VIDEO_VOICE_GENDERS)[number];

export const RUNTIME_VIDEO_VOICE_SOURCES = ["heygen", "elevenlabs", "gemini", "unknown"] as const;

export type RuntimeVideoVoiceSource = (typeof RUNTIME_VIDEO_VOICE_SOURCES)[number];

export const RUNTIME_VIDEO_VOICE_QUALITY_TAGS = ["professional", "natural", "lifelike"] as const;

export type RuntimeVideoVoiceQualityTag = (typeof RUNTIME_VIDEO_VOICE_QUALITY_TAGS)[number];

export interface RuntimeVideoVoiceCatalogEntry {
  voiceKey: string;
  providerVoiceId: string;
  displayName: string;
  locale: string | null;
  gender: RuntimeVideoVoiceGender;
  description: string | null;
  styleTags: string[];
  previewAudioUrl?: string | null;
  source?: RuntimeVideoVoiceSource;
  qualityTags?: RuntimeVideoVoiceQualityTag[];
  qualityRank?: number;
  previewAvailable?: boolean;
  localeControl?: boolean;
  pauseSupport?: boolean;
  providerVoiceType?: "public" | "private" | "unknown";
  multilingual?: boolean;
}

export interface RuntimeVideoVoiceCatalog {
  provider: "kling" | "heygen";
  fetchedAt: string;
  shortlist: RuntimeVideoVoiceCatalogEntry[];
}

// ADR-109 Slice 10: workspace persona shortlist materialized into the assistant bundle
// so the LLM can resolve natural-language character references to stable personaId UUIDs.
export interface RuntimeVideoPersonaCatalogEntry {
  personaId: string;
  displayName: string;
  /** Human-readable active voice label; never a raw provider voice/clone id. */
  voiceLabel: string;
  /** Preset HeyGen fallback voice label kept on the persona row. */
  presetVoiceLabel?: string | null;
  /** Linked cloned voice display name when a ready cloned voice is attached. */
  linkedClonedVoiceDisplayName?: string | null;
}

export interface RuntimeVideoPersonaCatalog {
  provider: "heygen";
  schema: "persai.runtimeVideoPersonaCatalog.v1";
  personas: RuntimeVideoPersonaCatalogEntry[];
}

export function isRuntimeVideoPersonaCatalog(value: unknown): value is RuntimeVideoPersonaCatalog {
  return (
    value !== null &&
    typeof value === "object" &&
    (value as Record<string, unknown>).provider === "heygen" &&
    (value as Record<string, unknown>).schema === "persai.runtimeVideoPersonaCatalog.v1" &&
    Array.isArray((value as Record<string, unknown>).personas)
  );
}

export const RUNTIME_VIDEO_AUDIO_CAPABILITIES = [
  "silent",
  "provider_native_audio",
  "voice_control"
] as const;

export type RuntimeVideoAudioCapability = (typeof RUNTIME_VIDEO_AUDIO_CAPABILITIES)[number];

export const RUNTIME_VIDEO_AUDIO_MODES = [
  "silent",
  "provider_native_audio",
  "voice_control"
] as const;

export type RuntimeVideoAudioMode = (typeof RUNTIME_VIDEO_AUDIO_MODES)[number];

export const RUNTIME_VIDEO_INPUT_CAPABILITIES = [
  "text",
  "single_reference_image",
  "multi_image",
  "omni"
] as const;

export type RuntimeVideoInputCapability = (typeof RUNTIME_VIDEO_INPUT_CAPABILITIES)[number];

export const RUNTIME_VIDEO_INPUT_MODES = [
  "text",
  "single_reference_image",
  "multi_image",
  "omni"
] as const;

export type RuntimeVideoInputMode = (typeof RUNTIME_VIDEO_INPUT_MODES)[number];

export interface RuntimeVideoModelParameters {
  duration: RuntimeVideoDurationConstraint;
  aspectRatios: RuntimeVideoAspectRatioOption[];
  referenceImageSupported: boolean;
  audioCapabilities: RuntimeVideoAudioCapability[];
  inputCapabilities: RuntimeVideoInputCapability[];
  providerParameters: RuntimeVideoProviderParameters | null;
}

export interface RuntimeVideoGenerateRequest {
  toolCode: "video_generate";
  prompt: string;
  filename: string | null;
  size: PersaiRuntimeVideoGenerateSize | null;
  seconds: number | null;
  audioMode?: RuntimeVideoAudioMode | null;
  inputMode?: RuntimeVideoInputMode | null;
  referenceImageAlias: string | null;
  referenceImageAliases?: string[] | null;
  voiceKeys?: string[] | null;
  voiceIds?: string[] | null;
  acceptedProviderTask?: RuntimeAcceptedVideoProviderTask | null;
  // ADR-109 Slice 3: talking-avatar fields. All optional; only meaningful when
  // mode === "talking_avatar". For mode === "cinematic" or absent, ignored.
  mode?: RuntimeVideoGenerateMode | null;
  speechText?: string | null;
  speechLanguage?: string | null;
  personaId?: string | null;
  portraitImageAlias?: string | null;
  voiceKey?: string | null;
  talkingAvatarAspectRatio?: PersaiRuntimeVideoAspectRatio | null;
}

export interface RuntimeVideoGenerateToolResult {
  toolCode: "video_generate";
  executionMode: "worker";
  provider: PersaiRuntimeVideoGenerateProviderId | null;
  model: string | null;
  prompt: string | null;
  requestedSeconds: number | null;
  requestedAudioMode?: RuntimeVideoAudioMode | null;
  requestedInputMode?: RuntimeVideoInputMode | null;
  size: PersaiRuntimeVideoGenerateSize | null;
  referenceImageAlias: string | null;
  referenceFilename: string | null;
  artifact: RuntimeOutputArtifact | null;
  usage: RuntimeUsageSnapshot | null;
  action: "generated" | "skipped" | "pending_delivery";
  reason: string | null;
  warning: string | null;
  providerStatus?: Record<string, unknown> | null;
  guidance?: string | null;
  jobId?: string | null;
  canSendFileNow?: false;
  messageToUser?: string | null;
  requestedCount?: number | null;
  expectedResultCount?: number | null;
  // ADR-109 Slice 3: symmetric echoes of the talking-avatar request fields, so
  // observability and diagnostics see exactly what the LLM asked for. Always
  // optional; populated only when the runtime parsed the corresponding field.
  requestedMode?: RuntimeVideoGenerateMode | null;
  requestedSpeechText?: string | null;
  requestedSpeechLanguage?: string | null;
  requestedPersonaId?: string | null;
  requestedPortraitImageAlias?: string | null;
  requestedVoiceKey?: string | null;
  requestedTalkingAvatarAspectRatio?: PersaiRuntimeVideoAspectRatio | null;
}

export interface RuntimeDocumentToolResult {
  toolCode: "document";
  executionMode: "worker" | "inline";
  requestedAction?: "inspect" | "render" | "convert" | null;
  descriptorMode:
    | "create_document"
    | "create_presentation"
    | "revise_document"
    | "export_or_redeliver"
    | null;
  documentType: "workspace_document" | "presentation" | null;
  provider: PersaiRuntimeDocumentProviderId | null;
  prompt: string | null;
  outputFormat: "pdf" | "pptx" | "xlsx" | "docx" | null;
  docId: string | null;
  requestedName: string | null;
  artifacts: RuntimeOutputArtifact[];
  usage: RuntimeUsageSnapshot | null;
  action: "generated" | "skipped" | "pending_delivery" | "inspected" | "rendered" | "converted";
  reason: string | null;
  warning: string | null;
  guidance?: string | null;
  jobId?: string | null;
  versionId?: string | null;
  canSendFileNow?: boolean;
  messageToUser?: string | null;
  inspection?: RuntimeDocumentInspectionSummary | null;
  render?: RuntimeDocumentRenderSummary | null;
  convert?: RuntimeDocumentConvertSummary | null;
  registration?: RuntimeDocumentVersionRegistrationSummary | null;
}

export interface RuntimeDocumentInspectionSummary {
  sourcePath: string;
  inspectPath: string;
  format: "pdf" | "xlsx" | "docx";
  counts: {
    pageCount: number | null;
    sheetCount: number | null;
    formulaCount: number | null;
    blankSheetCount: number | null;
    paragraphCount: number | null;
    headingCount: number | null;
    tableCount: number | null;
    textCharCount: number | null;
  };
  warnings: string[];
  suggestedReadPaths: string[];
  comparison?: RuntimeDocumentInspectionComparisonSummary | null;
}

export interface RuntimeDocumentInspectionComparisonSummary {
  comparisonKind: "imported_same_format_project_output";
  sourcePath: string;
  sourceFormat: "xlsx" | "docx";
  summary: string;
  warningCount: number;
  warnings: string[];
}

export interface RuntimeDocumentRenderSummary {
  outputPath: string;
  format: "pdf" | "xlsx" | "docx";
  sourceMarkdownPath: string;
  sizeBytes: number;
  mimeType: string;
}

export interface RuntimeDocumentConvertSummary {
  sourcePath: string;
  outputPath: string;
  targetFormat: "pdf" | "xlsx" | "docx";
  sizeBytes: number;
  mimeType: string;
}

export interface RuntimeDocumentVersionRegistrationSummary {
  docId: string;
  versionId: string;
  versionNumber: number;
  descriptorMode: "create_document" | "revise_document";
  documentType: "workspace_document";
  outputFormat: "pdf" | "xlsx" | "docx";
  outputPath: string;
  workspaceProjectPath: string | null;
  sourceManifestPath: string | null;
  inspectionPath: string | null;
}

export const PERSAI_RUNTIME_TTS_PROVIDER_IDS = ["elevenlabs", "yandex", "openai"] as const;

export type PersaiRuntimeTtsProviderId = (typeof PERSAI_RUNTIME_TTS_PROVIDER_IDS)[number];

export const PERSAI_RUNTIME_DOCUMENT_PROVIDER_IDS = ["sandbox", "gamma"] as const;

export type PersaiRuntimeDocumentProviderId = (typeof PERSAI_RUNTIME_DOCUMENT_PROVIDER_IDS)[number];

export const PERSAI_RUNTIME_PRESENTATION_VISUAL_STYLES = [
  "professional_modern",
  "bold_editorial",
  "minimal_clean",
  "illustrated_storytelling"
] as const;

export type PersaiRuntimePresentationVisualStyle =
  (typeof PERSAI_RUNTIME_PRESENTATION_VISUAL_STYLES)[number];

export const PERSAI_RUNTIME_PRESENTATION_IMAGE_POLICIES = [
  "ai_generated",
  "web_free_to_use",
  "pictographic",
  "text_only"
] as const;

export type PersaiRuntimePresentationImagePolicy =
  (typeof PERSAI_RUNTIME_PRESENTATION_IMAGE_POLICIES)[number];

export const PERSAI_RUNTIME_PRESENTATION_VISUAL_DENSITIES = [
  "balanced",
  "visual_heavy",
  "text_heavy"
] as const;

export type PersaiRuntimePresentationVisualDensity =
  (typeof PERSAI_RUNTIME_PRESENTATION_VISUAL_DENSITIES)[number];

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

export const PERSAI_RUNTIME_TTS_DELIVERY_STYLES = [
  "neutral",
  "calm",
  "warm",
  "confident",
  "playful",
  "dramatic",
  "whisper",
  "narrator"
] as const;

export type TtsDeliveryStyle = (typeof PERSAI_RUNTIME_TTS_DELIVERY_STYLES)[number];

export const PERSAI_RUNTIME_TTS_EMOTIONS = [
  "neutral",
  "happy",
  "sad",
  "excited",
  "serious",
  "curious"
] as const;

export type TtsEmotion = (typeof PERSAI_RUNTIME_TTS_EMOTIONS)[number];

export const PERSAI_RUNTIME_TTS_PACES = ["slow", "normal", "fast"] as const;

export type TtsPace = (typeof PERSAI_RUNTIME_TTS_PACES)[number];

export const PERSAI_RUNTIME_TTS_INTENSITIES = ["low", "medium", "high"] as const;

export type TtsIntensity = (typeof PERSAI_RUNTIME_TTS_INTENSITIES)[number];

export const PERSAI_RUNTIME_TTS_PAUSE_KINDS = ["none", "short", "long"] as const;

export type TtsPauseKind = (typeof PERSAI_RUNTIME_TTS_PAUSE_KINDS)[number];

export const PERSAI_RUNTIME_TTS_NONVERBALS = [
  "none",
  "laugh",
  "chuckle",
  "sigh",
  "clear_throat"
] as const;

export type TtsNonVerbal = (typeof PERSAI_RUNTIME_TTS_NONVERBALS)[number];

/**
 * TTS 2.0 (ADR-113) structured expressive delivery intent. The model chooses
 * enum-constrained fields; runtime/provider-gateway own translation into
 * conservative provider-native steering (ElevenLabs eleven_v3 audio tags via the
 * safe compiler, or a derived legacy tone for other providers). The model never
 * writes raw ElevenLabs tags directly.
 */
export interface RuntimeTtsDeliveryIntent {
  delivery: TtsDeliveryStyle;
  emotion: TtsEmotion;
  pace: TtsPace;
  intensity: TtsIntensity;
  pause: TtsPauseKind;
  nonVerbal: TtsNonVerbal;
}

export function createDefaultTtsDeliveryIntent(): RuntimeTtsDeliveryIntent {
  return {
    delivery: "neutral",
    emotion: "neutral",
    pace: "normal",
    intensity: "medium",
    pause: "none",
    nonVerbal: "none"
  };
}

/**
 * Derive the legacy {@link TtsToneTag} from a structured delivery intent so
 * non-eleven_v3 providers (Yandex / OpenAI) keep their existing tone-baseline
 * behavior while ElevenLabs eleven_v3 uses the safe tag compiler. Deterministic.
 */
export function mapTtsDeliveryIntentToToneTag(intent: RuntimeTtsDeliveryIntent): TtsToneTag {
  const base: TtsToneTag = (() => {
    switch (intent.delivery) {
      case "whisper":
        return "gentle";
      case "dramatic":
        return "confident";
      case "narrator":
        return "calm";
      case "calm":
        return "calm";
      case "warm":
        return "warm";
      case "confident":
        return "confident";
      case "playful":
        return "playful";
      case "neutral":
      default:
        return "neutral";
    }
  })();

  // Whisper/narrator are intentionally quiet; do not let emotion override them.
  if (intent.delivery === "whisper" || intent.delivery === "narrator") {
    return base;
  }
  if (intent.emotion === "excited" || intent.emotion === "happy") {
    return base === "neutral" || base === "warm" || base === "confident" || base === "playful"
      ? "cheerful"
      : base;
  }
  if (intent.emotion === "sad") {
    return "gentle";
  }
  if (intent.emotion === "serious") {
    return base === "neutral" ? "confident" : base;
  }
  return base;
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
  // ADR-113 TTS 2.0: structured expressive delivery intent. Legacy `toneTag` is
  // derived from `delivery` for non-eleven_v3 providers.
  delivery: RuntimeTtsDeliveryIntent;
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
  delivery: RuntimeTtsDeliveryIntent | null;
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
  billingFacts?: RuntimeBillingFacts | null;
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
  evaluationKind?: "background_task" | "quota_advisory";
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
    /** Per-evaluation unique id. When present, the runtime uses it as a suffix
     *  for `externalThreadKey` so each attempt runs in its own synthetic session
     *  and never conflicts with a parallel evaluation of the same task. */
    evaluationAttemptId?: string;
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
  billingFacts?: RuntimeBillingFacts | null;
  toolInvocations: RuntimeTurnToolInvocation[];
  rawText: string | null;
}

export interface RuntimeDocumentJobRunRequest {
  assistantId: string;
  workspaceId: string;
  runtimeTier: PersaiRuntimeTier;
  runtimeBundleDocument: string;
  // ADR-129 hard cutover: deferred document jobs are presentation-only.
  // Non-presentation document work (PDF/DOCX/XLSX) flows through the visible
  // workspace workflow and never reaches the runtime worker.
  job: {
    id: string;
    docId: string;
    versionId: string;
    surface: "web" | "telegram";
    chatId: string;
    provider: "gamma";
    outputFormat: "pdf" | "pptx";
    sourceUserMessageId: string;
    sourceUserMessageText: string;
    sourceUserMessageCreatedAt: string;
  };
  // Attachments from the user message that triggered this presentation job.
  // Mirrors the media path and remains available for trace/debug metadata.
  // Source extraction itself is API-owned and passed through sourceFiles.
  attachments: RuntimeAttachmentRef[];
  // API-extracted source payloads for presentation source attachments. These
  // are not persisted into Knowledge unless the user explicitly saves them.
  sourceFiles?: RuntimeDocumentSourceFile[];
  directToolExecution: {
    toolCode: "document";
    descriptorMode: "create_presentation" | "revise_document" | "export_or_redeliver";
    request: {
      prompt: string;
      instructions?: string | null;
      outputFormat?: "pdf" | "pptx" | "xlsx" | "docx" | null;
      docId?: string | null;
      /**
       * ADR-126 v3 — cross-chat revise via workspace path identity.
       *
       * Canonical chat-delivery identity for an existing chat attachment via its
       * `storagePath` (workspace path under `/workspace/...`). Mutually exclusive with `docId`. When present,
       * the API resolves to the latest `AssistantDocumentVersion` whose attachment
       * row has a matching `storagePath` for the assistant's workspace.
       */
      storagePath?: string | null;
      requestedName?: string | null;
      visualStyle?: PersaiRuntimePresentationVisualStyle | null;
      imagePolicy?: PersaiRuntimePresentationImagePolicy | null;
      visualDensity?: PersaiRuntimePresentationVisualDensity | null;
      gammaThemeId?: string | null;
      // Authoritative slide count for presentations. Validated and clamped on
      // the runtime side; null when the caller did not specify a target.
      targetSlideCount?: number | null;
      outline?: unknown;
      metadata?: Record<string, unknown> | null;
      /** Explicit create transfer mode — no lexical routing. */
      transferMode?: "verbatim" | "transform" | null;
      /**
       * Explicit content intent. Safe default is preserve_content when omitted.
       * Runtime uses this to decide whether content may be rewritten.
       */
      contentIntent?: "preserve_content" | "rewrite_content" | null;
      /**
       * Explicit revise operation. When omitted on structured_large documents,
       * the worker defaults to style_only unless contentIntent explicitly allows rewrite.
       */
      editOperation?: "style_only" | "content_patch" | "section_rewrite" | null;
      /** Optional stable section ids for targeted structured edits. */
      targetSectionIds?: string[] | null;
    };
  };
}

export interface RuntimeDocumentJobRunResult {
  assistantText: string | null;
  artifacts: RuntimeOutputArtifact[];
  usage: RuntimeUsageAccounting | RuntimeUsageSnapshot | null;
  toolInvocations: RuntimeTurnToolInvocation[];
  rawText: string | null;
  providerStatus?: Record<string, unknown> | null;
  billingFacts?: RuntimeBillingFacts | null;
}

export type RuntimeDocumentGammaCompanionOriginal =
  | {
      format: "pptx";
      status: "ready";
      generationId: string;
      gammaId: string;
      gammaUrl: string | null;
      exportUrl: string;
      filename: string | null;
      outputType: "pptx";
      updatedAt: IsoTimestamp | null;
    }
  | {
      format: "pptx";
      status: "unavailable";
      filename: string | null;
      errorCode?: string | null;
      message?: string | null;
      retryable?: boolean | null;
      providerFailure?: Record<string, unknown> | null;
    };

export interface RuntimeDocumentJobCompletionRequest {
  assistantId: string;
  workspaceId: string;
  runtimeTier: PersaiRuntimeTier;
  runtimeBundleDocument: string;
  job: {
    id: string;
    docId: string;
    versionId: string;
    surface: "web" | "telegram";
    chatId: string;
    outputFormat: "pdf" | "pptx" | "xlsx" | "docx";
    descriptorMode: "create_presentation" | "revise_document" | "export_or_redeliver";
    sourceUserMessageId: string;
    sourceUserMessageText: string;
    sourceUserMessageCreatedAt: string;
  };
  currentHistory: Array<{
    author: "user" | "assistant" | "system";
    content: string;
    createdAt: IsoTimestamp;
  }>;
  workerResult?: {
    assistantText: string | null;
    artifacts: Array<{
      type: RuntimeOutputArtifact["kind"];
      filename: string | null;
      storagePath: string | null;
    }>;
  };
  failure?: {
    code: string | null;
    message: string;
    attemptCount: number;
    maxAttempts: number;
    retryable: boolean;
    stage: "execution" | "delivery";
  };
}

export interface RuntimeDocumentJobCompletionResult {
  assistantText: string | null;
  usage: RuntimeUsageAccounting | RuntimeUsageSnapshot | null;
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
    toolCode?: "image_generate" | "image_edit" | null;
  };
  currentHistory: Array<{
    author: "user" | "assistant" | "system";
    content: string;
    createdAt: IsoTimestamp;
  }>;
  workerResult?: {
    assistantText: string | null;
    artifacts: Array<{
      type: RuntimeOutputArtifact["kind"];
      filename: string | null;
      storagePath: string | null;
      mimeType?: string | null;
      role?: "output" | "source_reference";
    }>;
  };
  failure?: {
    code: string | null;
    message: string;
    attemptCount: number;
    maxAttempts: number;
    retryable: boolean;
    stage: "execution" | "delivery";
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
  channelContext?: RuntimeChannelContext;
  message: RuntimeInboundMessage;
  openMediaJobs?: RuntimeOpenMediaJobContext[];
  openDocumentJobs?: RuntimeOpenDocumentJobContext[];
  jobDeliveryUpdates?: RuntimeJobDeliveryUpdate[];
  chatMode?: "normal" | "smart" | "project";
  deepMode?: boolean;
  modelRoleOverride?: PersaiRuntimeModelRole;
  providerOverride?: "openai" | "anthropic" | "deepseek";
  modelOverride?: string;
  skillStateContext?: RuntimeSkillStateContext;
}

export interface RuntimeOpenMediaJobContext {
  jobId: string;
  kind: "image" | "audio" | "video";
  toolCode: "image_generate" | "image_edit" | "video_generate" | "audio_generate";
  status: "queued" | "running";
  sourceSummary: string | null;
  requestedCount: number | null;
  expectedResultCount: number | null;
  createdAt: IsoTimestamp;
  startedAt: IsoTimestamp | null;
  updatedAt: IsoTimestamp;
}

export interface RuntimeOpenDocumentJobContext {
  jobId: string;
  descriptorMode: "create_presentation" | "revise_document" | "export_or_redeliver";
  documentType: "presentation";
  status: "queued" | "running";
  sourceSummary: string | null;
  createdAt: IsoTimestamp;
  startedAt: IsoTimestamp | null;
  updatedAt: IsoTimestamp;
}

export type RuntimeJobDeliveryUpdate =
  | RuntimeMediaJobDeliveryUpdate
  | RuntimeDocumentJobDeliveryUpdate;

export interface RuntimeMediaJobDeliveryUpdate {
  kind: "media";
  jobId: string;
  mediaKind: "image" | "audio" | "video";
  toolCode: "image_generate" | "image_edit" | "video_generate" | "audio_generate";
  deliveryStatus: "finalizing_delivery" | "delivered_recently";
  sourceSummary: string | null;
  requestedCount: number | null;
  expectedResultCount: number | null;
  createdAt: IsoTimestamp;
  startedAt: IsoTimestamp | null;
  completedAt: IsoTimestamp | null;
  updatedAt: IsoTimestamp;
  deliveredAt: IsoTimestamp | null;
}

export interface RuntimeDocumentJobDeliveryUpdate {
  kind: "document";
  jobId: string;
  descriptorMode: "create_presentation" | "revise_document" | "export_or_redeliver";
  documentType: "presentation";
  deliveryStatus: "finalizing_delivery" | "delivered_recently";
  sourceSummary: string | null;
  createdAt: IsoTimestamp;
  startedAt: IsoTimestamp | null;
  completedAt: IsoTimestamp | null;
  updatedAt: IsoTimestamp;
  deliveredAt: IsoTimestamp | null;
}

export interface RuntimeTurnRoutingSnapshot {
  mode: "shadow" | "active";
  executionMode: "normal" | "premium" | "reasoning";
  level?: RoutingLevel; // ADR-121 — semantic task-weight axis
  thinkingBudget?: number; // ADR-121 — inference-time thinking budget in tokens; 0/absent = off
  source: "precheck" | "llm" | "fallback";
  retrievalPlan?: RuntimeRetrievalPlan;
  skillState?: RuntimeSkillDecisionState | null;
}

export interface RuntimeTurnToolInvocation {
  name: string;
  iteration: number;
  ok: boolean;
  executionMode?: PersaiRuntimeToolExecutionMode;
  toolCallId?: string;
  billingFacts?: RuntimeBillingFacts | null;
}

export interface RuntimeDeferredMediaJobSummary {
  jobId: string;
  toolCode: "image_generate" | "image_edit" | "video_generate";
  kind: "image" | "video";
  action: "pending_delivery";
  canSendFileNow: false;
  messageToUser: string | null;
  requestedCount: number | null;
  expectedResultCount: number | null;
}

export interface RuntimeDeferredDocumentJobSummary {
  jobId: string;
  toolCode: "document";
  docId?: string | null;
  versionId?: string | null;
  descriptorMode: "create_presentation" | "revise_document" | "export_or_redeliver";
  documentType: "presentation";
}

export type RuntimeTurnMediaToolCode = "image_generate" | "image_edit" | "video_generate";

/** ADR-129 W9 — structural delivery truth emitted by runtime at turn completion. */
export interface RuntimeTurnDeliveryFacts {
  producedPaths: string[];
  attachedPaths: string[];
  pendingMediaJobIds: string[];
  pendingDocumentJobIds: string[];
  mediaToolCalls: RuntimeTurnMediaToolCode[];
}

export interface RuntimeTurnResult {
  requestId: string;
  sessionId: string;
  /**
   * Backward-compat full text: the cumulative corrected turn text, in which
   * every working note appears exactly once followed by the final answer.
   * Equals `answerText` when no tools ran. Telegram and non-web consumers
   * should continue using this field.
   */
  assistantText: string;
  /**
   * The texts the model produced BEFORE each tool call across the tool loop,
   * one entry per step (in order). Each entry is the provider text of that
   * iteration only — never the cumulative text — so a later step's note never
   * re-contains an earlier note. Empty array when no tools ran.
   */
  workingNotes?: string[];
  /**
   * The sanitised final answer after the last tool finished (or the entire
   * text when no tools ran). Contains no working notes. This is the
   * authoritative content to persist.
   */
  answerText?: string;
  artifacts: RuntimeOutputArtifact[];
  respondedAt: IsoTimestamp;
  usage: RuntimeUsageSnapshot | null;
  usageAccounting?: RuntimeUsageAccounting;
  turnRouting?: RuntimeTurnRoutingSnapshot;
  trace?: RuntimeTrace;
  autoCompaction?: RuntimeTurnAutoCompactionState;
  toolInvocations?: RuntimeTurnToolInvocation[];
  deferredMediaJobs?: RuntimeDeferredMediaJobSummary[];
  deferredDocumentJobs?: RuntimeDeferredDocumentJobSummary[];
  /**
   * ADR-100 Piece 1 / ADR-126 v3 — workspace storage paths discovered via
   * `files.list / read / preview` during this turn's tool loop.
   * Capped at 20, insertion order. API persists this on the assistant
   * message metadata so future turn hydration can surface them with
   * the stable Working Files aliases (`file #N` / `image #N`) assigned
   * in that chat.
   */
  discoveredFilePaths?: string[];
  /**
   * ADR-129 W9 — structural delivery facts for API-owned honesty correction.
   * Independent of model prose and stream artifact counts.
   */
  deliveryFacts?: RuntimeTurnDeliveryFacts;
  /**
   * ADR-122 Slice 3: true when the final provider call ended due to the
   * output-token ceiling. Propagated from ProviderGatewayTextGenerateResult.
   * API persists this as metadata.status="truncated" so the hydration guard
   * can mark the message and prevent the model from continuing it.
   */
  truncated?: boolean;
}

export interface RuntimeTurnAutoCompactionState {
  tokensBefore: number | null;
  tokensAfter: number | null;
}

// ADR-118 Slice 4 — scenario catalog shape in the materialized runtime bundle.

export interface RuntimeBundleSkillScenarioStep {
  number: number;
  directive: string;
  recommendedToolCall: string | null;
  mayBeSkippedIf: string | null;
  negativeGuards: string[];
  /** ADR-119 Slice 4 — what the model should expect the user to provide to satisfy this step. */
  expectedUserResponse?: string | null;
  /** ADR-119 Slice 4 — explicit transition condition; when true the model advances to the next step. */
  nextStepTrigger?: string | null;
  /** ADR-119 Slice 4 — guidance for recovering if the user's response is off-script. */
  recoveryGuidance?: string | null;
  /** ADR-119 Slice 10 — step 1 only: overrides auto-derived catalog first_step_preview (≤200 chars). */
  firstStepPreview?: string | null;
}

export interface RuntimeBundleSkillScenario {
  key: string;
  displayName: string;
  description: string;
  iconEmoji: string | null;
  intentExamples: string[];
  steps: RuntimeBundleSkillScenarioStep[];
  recommendedTools: string[];
  exitCondition: string;
  /** ADR-130 Slice 1 — lazy `skill.describe` detail kept out of the stable prefix. */
  guardrails?: string[];
  /** ADR-130 Slice 1 — lazy `skill.describe` detail kept out of the stable prefix. */
  examples?: string[];
  /** ADR-119 Slice 10 — override for the catalog <first_step_preview> tag; null = auto-derive from steps[0].directive. */
  firstStepPreview?: string | null;
}

export interface ProviderGatewayTextMessage {
  role: "user" | "assistant";
  content: ProviderGatewayMessageContent;
  /**
   * ADR-110 prompt-cache discipline: marks a per-turn, query-dependent context message that
   * providers MUST project OUTSIDE the cached prompt prefix. Such messages are repositioned by
   * the provider client next to the latest user message so their per-turn rotation can never
   * invalidate the stable system / history prompt-cache breakpoints. Omit (undefined) for normal
   * turn messages, which remain part of the cacheable prefix in their natural conversation order.
   */
  cacheRole?: "volatile_context";
  /**
   * ADR-118 Slice 4 — discriminates the volatile-context block kind so provider clients
   * can wrap content with the appropriate XML tag. "active_scenario" → the
   * `<persai_active_scenario>` wrapper. "system_reminder" (ADR-119 Slice 5) → the
   * `<system-reminder>` wrapper; used by `BuildSystemReminderBlocksService` to inject
   * mid-conversation reminder messages that reinforce system directives under recency bias.
   * "chat_plan" (ADR-125 Slice 1) → the `<persai_chat_plan>` wrapper; used by the chat-plan
   * reinjection block builder to surface the current model-owned todo window.
   * ADR-120 Slice 1 retired the always-on pushed contextual short-memory block, so the
   * `"memory"` / `<persai_memory>` volatile kind no longer exists (cross-chat recall is now
   * pull-only via the `knowledge_search` `memory` source). Ignored when `cacheRole` is not
   * "volatile_context".
   */
  volatileKind?: "active_scenario" | "system_reminder" | "chat_plan";
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
  /**
   * ADR-124 — provider-native chain-of-thought (DeepSeek `reasoning_content`)
   * produced by the assistant turn that emitted this tool call. DeepSeek V4
   * thinking mode REQUIRES this to be echoed back on the assistant tool-call
   * message in the next request; omitting it returns a 400. Ephemeral within a
   * single turn's tool loop and never persisted. Providers that do not use it
   * (OpenAI/Anthropic) ignore this field.
   */
  reasoningContent?: string | null;
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
  "quota_advisory_evaluation",
  "skill_state_classifier",
  "document_html_generation",
  "document_code_generation",
  "document_pdf_outline",
  "document_pdf_section_generation",
  "document_pdf_patch_revise",
  "document_style_patch",
  "document_section_patch_revise",
  "document_presentation_theme_picker",
  "document_job_completion",
  "media_job_completion",
  "media_job_completion_vision",
  "media_job_failure_explanation",
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

export const PERSAI_PROVIDER_TEXT_ERROR_KINDS = [
  "billing_quota",
  "rate_limit",
  "capacity",
  "provider_auth",
  "invalid_request",
  "timeout",
  "server_error",
  "unknown"
] as const;

export type ProviderGatewayTextErrorKind = (typeof PERSAI_PROVIDER_TEXT_ERROR_KINDS)[number];

export interface ProviderGatewayTextErrorDetails {
  providerErrorKind?: ProviderGatewayTextErrorKind | null;
  providerErrorCode?: string | null;
  providerErrorType?: string | null;
  providerErrorStatus?: number | null;
}

export const RETRYABLE_PROVIDER_GATEWAY_TEXT_ERROR_KINDS = [
  "billing_quota",
  "rate_limit",
  "capacity",
  "provider_auth",
  "timeout",
  "server_error"
] as const;

export function isRetryableProviderGatewayTextErrorKind(
  kind: ProviderGatewayTextErrorKind | null | undefined
): boolean {
  return (
    typeof kind === "string" &&
    (RETRYABLE_PROVIDER_GATEWAY_TEXT_ERROR_KINDS as readonly string[]).includes(kind)
  );
}

export interface ProviderGatewayPromptCacheConfig {
  key?: string;
  retention?: ProviderGatewayPromptCacheRetention;
  /**
   * Anthropic-only moving history breakpoint hint. When set to a positive integer, provider-gateway
   * may place one additional explicit cache breakpoint on a stable historical message block only
   * after the uncached tail behind that block grows past this approximate token threshold.
   *
   * This keeps the cheap stable system breakpoint always on, while allowing longer chats to
   * periodically advance the cache frontier without forcing a new cache write on every turn.
   */
  anthropicHistoryBreakpointMinTokens?: number;
}

export interface ProviderGatewayTextGenerateRequest {
  provider: "openai" | "anthropic" | "deepseek";
  model: string;
  systemPrompt: string | null;
  /**
   * ADR-074 P1: per-turn developer instructions appended OUTSIDE the cached system prefix.
   * This is the canonical place for content that must NOT invalidate provider prompt caching:
   * routing/execution-mode hints, per-turn developer-tail blocks, and time
   * awareness fields. Providers project this field provider-natively:
   *   - OpenAI Responses API: a `role: "developer"` input item appended after history.
   *   - Anthropic: normally a second text block appended to the `system` array (no
   *     `cache_control`); when moving history prompt-cache is enabled, a provider-native suffix
   *     message after history so volatile guidance cannot invalidate message-level cache
   *     breakpoints.
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
  /**
   * ADR-097 Slice 3 — optional per-request timeout hint for the provider LLM call.
   * When set to a positive integer, provider clients use min(600_000, timeoutMsHint)
   * as the effective timeout. Non-document calls omit this field and keep the default
   * PROVIDER_GATEWAY_REQUEST_TIMEOUT_MS (90s). Document classifications
   * (document_html_generation, document_pdf_outline, document_pdf_patch_revise) set
   * this to 240_000ms to accommodate large 64k-token output budgets.
   * The gateway enforces a hard cap of 600_000ms regardless of the hint value.
   */
  timeoutMsHint?: number;
  /**
   * ADR-116 — ephemeral multimodal user content appended after `toolHistory` on the
   * next provider call (e.g. `files.preview` pixels/PDF). Never persisted in tool-result JSON.
   */
  toolFollowUpUserContent?: ProviderGatewayMessageContent;
  /**
   * ADR-119 Slice 2: when true, the assistant has at least one enabled Skill.
   * Triggers `disable_parallel_tool_use` (Anthropic) / `parallel_tool_calls: false` (OpenAI)
   * to prevent the model from firing skill({engage}) and a media tool in the same response.
   * Default behaviour (undefined / false): unchanged — parallel tool calls allowed.
   */
  skillsEnabled?: boolean;
  /**
   * ADR-121 — inference-time thinking budget in tokens. Provider clients map this to
   * Anthropic `thinking.budget_tokens` (Extended Thinking) or OpenAI `reasoning_effort`.
   * 0 or absent means no thinking parameters are sent (current behavior preserved).
   * Plumbed in Slice 1; consumed by provider clients in Slice 3.
   */
  thinkingBudget?: number;
}

export interface ProviderGatewayTextGenerateResult {
  provider: "openai" | "anthropic" | "deepseek";
  model: string;
  text: string | null;
  respondedAt: IsoTimestamp;
  usage: RuntimeUsageSnapshot | null;
  stopReason: "completed" | "tool_calls";
  /**
   * ADR-122 Slice 3: true when the provider stopped due to reaching the
   * output-token ceiling (Anthropic stop_reason=max_tokens, OpenAI
   * incomplete_details.reason=max_output_tokens). Orthogonal to stopReason
   * — a truncated turn is still a terminal "completed" turn, just cut short.
   */
  truncated?: boolean;
  toolCalls: ProviderGatewayToolCall[];
  /**
   * ADR-124 — provider-native chain-of-thought (DeepSeek `reasoning_content`)
   * emitted alongside `tool_calls` in thinking mode. The runtime threads this
   * onto the resulting tool exchanges so it can be echoed back on the next
   * tool-loop request (DeepSeek rejects thinking-mode tool loops without it).
   * Null/absent for providers that do not surface reasoning content.
   */
  reasoningContent?: string | null;
}

export interface ProviderGatewayTextErrorResponse {
  error: {
    code: string | null;
    message: string;
    providerErrorKind?: ProviderGatewayTextErrorKind | null;
    providerErrorCode?: string | null;
    providerErrorType?: string | null;
    providerErrorStatus?: number | null;
  };
}

export interface ProviderGatewayAudioTranscriptionResult {
  provider: "openai";
  model: string;
  text: string;
  respondedAt: IsoTimestamp;
  billingFacts?: RuntimeBillingFacts | null;
}

export interface ProviderGatewaySpeechGenerateRequest {
  text: string;
  locale: string;
  toneTag: TtsToneTag;
  // ADR-113 TTS 2.0: structured expressive delivery intent. Optional for
  // backward compatibility; absent means "use derived tone / provider defaults".
  delivery?: RuntimeTtsDeliveryIntent | null;
  deliveryKind: PersaiRuntimeTtsDeliveryKind;
  assistantGender: string | null;
  traits: Record<string, number> | null;
  voiceProfile: RuntimeAssistantVoiceProfile;
  credential: {
    toolCode: "tts";
    secretId: string;
    providerId: PersaiRuntimeTtsProviderId | null;
    modelKey?: string | null;
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
  billingFacts?: RuntimeBillingFacts | null;
  warning: string | null;
}

export type ProviderGatewayDocumentGenerateRequest = {
  htmlContent: string;
  filename: string | null;
  timeoutMs?: number | null;
  credential: {
    toolCode: "document";
    secretId: string;
    providerId: "gamma";
  };
  providerOptions: {
    outputFormat: "pdf" | "pptx";
    presentationOptions?: {
      themeId?: string | null;
      textMode?: "generate" | "condense" | "preserve" | null;
      numCards?: number | null;
      cardSplit?: "auto" | "inputTextBreaks" | null;
      additionalInstructions?: string | null;
      textOptions?: {
        amount?: "brief" | "medium" | "detailed" | "extensive" | null;
        language?: string | null;
        tone?: string | null;
        audience?: string | null;
      } | null;
      imageOptions?: {
        source?:
          | "webAllImages"
          | "webFreeToUse"
          | "webFreeToUseCommercially"
          | "aiGenerated"
          | "pictographic"
          | "giphy"
          | "pexels"
          | "placeholder"
          | "noImages"
          | "themeAccent"
          | null;
        model?: string | null;
        style?: string | null;
        stylePreset?: "illustration" | "abstract" | "3D" | "lineArt" | "custom" | null;
      } | null;
      cardOptions?: {
        dimensions?: "16x9" | "4x3" | "fluid" | null;
      } | null;
    } | null;
  };
};

export type ProviderGatewayDocumentGenerateResult = {
  provider: "gamma";
  outputFormat: "pdf" | "pptx";
  documentId: string;
  templateId: null;
  filename: string | null;
  bytesBase64: string;
  mimeType: string;
  respondedAt: IsoTimestamp;
  warning: string | null;
  providerStatus: {
    provider: "gamma";
    state: "success";
    generationId: string;
    gammaId: string;
    gammaUrl: string | null;
    exportUrl: string;
    filename: string | null;
    outputType: "pdf" | "pptx";
    status: "completed";
    updatedAt: IsoTimestamp | null;
  };
  billingFacts?: RuntimeBillingFacts | null;
};

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
    requestContext?: {
      workspaceId?: string | null;
      runtimeRequestId?: string | null;
      runtimeSessionId?: string | null;
    } | null;
    reserveTransport?: {
      enabled: boolean;
      secretId: string;
      baseUrl: string;
    } | null;
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
  billingFacts?: RuntimeBillingFacts | null;
  warning: string | null;
}

export interface ProviderGatewayImageEditRequest {
  prompt: string;
  model: string | null;
  count: number;
  size: PersaiRuntimeImageGenerateSize | null;
  background: PersaiRuntimeImageBackground;
  timeoutMs?: number | null;
  sourceImage: {
    bytesBase64: string;
    mimeType: string;
    filename: string | null;
  };
  /**
   * Ordered reference images that accompany `sourceImage` as one provider
   * input set. Empty array (or `null`) means no separate references.
   */
  referenceImages:
    | {
        bytesBase64: string;
        mimeType: string;
        filename: string | null;
      }[]
    | null;
  credential: {
    toolCode: "image_edit";
    secretId: string;
    providerId: PersaiRuntimeImageEditProviderId | null;
    requestContext?: {
      workspaceId?: string | null;
      runtimeRequestId?: string | null;
      runtimeSessionId?: string | null;
    } | null;
    reserveTransport?: {
      enabled: boolean;
      secretId: string;
      baseUrl: string;
    } | null;
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
  billingFacts?: RuntimeBillingFacts | null;
  warning: string | null;
}

export interface ProviderGatewayVideoGenerateRequest {
  prompt: string;
  model: string | null;
  size: PersaiRuntimeVideoGenerateSize | null;
  seconds: number;
  referenceImage: {
    bytesBase64: string;
    mimeType: string;
    filename: string | null;
  } | null;
  referenceTailImage?: {
    bytesBase64: string;
    mimeType: string;
    filename: string | null;
  } | null;
  voiceIds?: string[] | null;
  acceptedTask?: RuntimeAcceptedVideoProviderTask | null;
  providerParameters?: RuntimeVideoProviderParameters | null;
  credential: {
    toolCode: "video_generate";
    secretId: string;
    providerId: PersaiRuntimeVideoGenerateProviderId | null;
  };
  // ADR-109 Slice 3: pass-through of talking-avatar fields. Slice 6 will wire
  // these into the HeyGen provider client; Slices 3-5 only carry them.
  mode?: RuntimeVideoGenerateMode | null;
  speechText?: string | null;
  speechLanguage?: string | null;
  personaId?: string | null;
  portraitImageAlias?: string | null;
  voiceKey?: string | null;
  talkingAvatarAspectRatio?: PersaiRuntimeVideoAspectRatio | null;
  // ADR-109 Slice 6: HeyGen-specific fields for talking-avatar execution.
  // Optional so Kling/Runway/OpenAI requests ignore them.
  /** @adr109-slice6 Non-null = use directly as HeyGen avatar_id (Scenario C cached). Null + personaId non-null = lazy-create avatar first (Scenario C lazy). Null + personaId null = ad-hoc Scenario A. */
  cachedHeygenAvatarId?: string | null;
  /** @adr109-slice6 Portrait image bytes (base64-encoded) for Scenario A (ad-hoc) and Scenario C lazy-create. Distinct from referenceImage which is for cinematic generation semantics. */
  portraitImageBytesBase64?: string | null;
  /** @adr109-slice6 MIME type companion to portraitImageBytesBase64 (e.g. "image/jpeg"). */
  portraitImageMimeType?: string | null;
  /** When set, provider-gateway checkpoints acceptedProviderTask to this media job immediately after submit. */
  mediaJobId?: string | null;
}

export interface RuntimeAcceptedVideoProviderTask {
  provider: PersaiRuntimeVideoGenerateProviderId;
  model: string | null;
  providerTaskId: string;
  acceptedAt: IsoTimestamp;
  providerStage: "accepted";
  taskKind?: string | null;
}

export interface ProviderGatewayGeneratedVideo {
  bytesBase64: string;
  mimeType: string;
  downloadUrl?: string | null;
}

export interface ProviderGatewayVideoGenerateResult {
  provider: PersaiRuntimeVideoGenerateProviderId;
  model: string;
  prompt: string;
  size: PersaiRuntimeVideoGenerateSize | null;
  seconds: number;
  video: ProviderGatewayGeneratedVideo;
  respondedAt: IsoTimestamp;
  usage: RuntimeUsageSnapshot | null;
  billingFacts?: RuntimeBillingFacts | null;
  warning: string | null;
  /** @adr109-slice6 Non-null only when Scenario C lazy avatar creation occurred. Slice 7 persists this onto the persona row. */
  lazyCreatedHeygenAvatarId?: string | null;
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
  billingFacts?: RuntimeBillingFacts | null;
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
  billingFacts?: RuntimeBillingFacts | null;
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
  billingFacts?: RuntimeBillingFacts | null;
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

export interface ProviderGatewayTextFailedEvent extends ProviderGatewayTextErrorDetails {
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
  fileHandles?: RuntimeFileHandle[];
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
  fileHandles?: RuntimeFileHandle[];
  trace?: RuntimeTrace;
}

export type RuntimeTurnStreamEvent =
  | RuntimeStreamStartedEvent
  | RuntimeTextDeltaEvent
  | RuntimeArtifactEvent
  | RuntimeRetrievalActivityEvent
  | RuntimeProjectActivityEvent
  | RuntimeProjectReasoningSummaryEvent
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
  billingFacts?: RuntimeBillingFacts | null;
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
    layer: PersaiRuntimeMemoryWriteLayer;
    confidence: number | null;
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

// ADR-109 Slice 5b — eager HeyGen photo avatar creation at persona POST (E12).

export interface ProviderGatewayHeyGenCreatePhotoAvatarRequest {
  schema: "persai.providerGatewayHeyGenCreatePhotoAvatarRequest.v1";
  credential: { secretId: string; providerId: "heygen" };
  name: string;
  portraitImageBytesBase64: string;
  portraitImageMimeType: string;
}

export interface ProviderGatewayHeyGenCreatePhotoAvatarResult {
  schema: "persai.providerGatewayHeyGenCreatePhotoAvatarResult.v1";
  provider: "heygen";
  avatarId: string;
  respondedAt: string;
}

// ADR-111 Slice 4a — HeyGen voice-clone submit/poll through provider-gateway.

export interface ProviderGatewayHeyGenCreateVoiceCloneRequest {
  schema: "persai.providerGatewayHeyGenCreateVoiceCloneRequest.v1";
  credential: { secretId: string; providerId: "heygen" };
  displayName: string;
  audioBytesBase64: string;
  audioMimeType: string;
  languageHint?: string | null;
  removeBackgroundNoise?: boolean;
}

export interface ProviderGatewayHeyGenCreateVoiceCloneResult {
  schema: "persai.providerGatewayHeyGenCreateVoiceCloneResult.v1";
  provider: "heygen";
  voiceCloneId: string;
  status: "complete";
  previewAudioUrl: string | null;
  respondedAt: string;
}

/**
 * Provider-facing prompt fragments for media generation tools.
 *
 * These constants and builders are appended to provider prompts ONLY — they are
 * never shown to the model/assistant. They enforce provider output hygiene
 * (anti-collage, standalone-image, and reference-guidance rules) and are the
 * single source of truth consumed by both `@persai/runtime` composers and
 * `@persai/provider-gateway` builders. Any wording change must be made here and
 * propagates to all consumers automatically.
 *
 * NOTE: these live directly in this index module (not a sibling file) because
 * `@persai/runtime-contract` is consumed as un-built TypeScript source at runtime
 * (`main` → `src/index.ts`, no build step). Node's type-stripping ESM loader
 * cannot resolve extensionless relative imports, so the package must stay a single
 * self-contained module. Do not split these into a separate file unless the package
 * gains a real build step (see ADR-117).
 */

/**
 * Rule A — prevents the provider from returning a multi-panel composition when
 * individual standalone images were requested. Uses the most complete gateway-
 * facing variant that names diptych/triptych so all composition types are covered.
 */
export const ANTI_COLLAGE_RULE =
  "Do not make a collage, grid, contact sheet, diptych, triptych, or multi-panel composition unless the user explicitly asked for that format.";

/**
 * Rule B — asserts that every image in a multi-image response is a self-contained
 * final result faithful to the overall request. Used in gateway-level prompts where
 * the cardinality framing precedes this sentence.
 */
export const STANDALONE_IMAGE_RULE =
  "Each returned image must be one standalone final image that stays faithful to the overall request.";

/**
 * Rule B variant for runtime series-item prompts (provider-facing, per-item) when
 * the tool is image_generate. Append ANTI_COLLAGE_RULE after this constant in the
 * series item prompt.
 */
export const STANDALONE_GENERATED_IMAGE_RULE = "Return one final image for this item only.";

/**
 * Rule B variant for runtime series-item prompts (provider-facing, per-item) when
 * the tool is image_edit. Append ANTI_COLLAGE_RULE after this constant in the
 * series item prompt.
 */
export const STANDALONE_EDITED_IMAGE_RULE = "Return one final edited image for this item only.";

/**
 * Rule C — communicates that reference images are styling guidance only; the
 * provider must keep the output rooted in the source image, not edit or reproduce
 * the reference image as its own output.
 *
 * @param opts.multiple - true when two or more reference images are provided.
 */
export function referenceGuidanceRule(opts: { multiple: boolean }): string {
  return opts.multiple
    ? "Use the additional reference images only as visual guidance for style, appearance, makeup, color palette, lighting, environment, background, or similar attributes unless the user explicitly asks to borrow a concrete object from them."
    : "Use the second/reference image only as visual guidance for style, appearance, makeup, color palette, lighting, environment, or similar attributes unless the user explicitly asks to borrow a concrete object from it.";
}

/**
 * Rule D header — the per-item label the runtime composers emit at the top of each
 * provider prompt for a series-mode multi-image job.
 *
 * @param index - 0-based item index.
 * @param total - total number of items in the series.
 */
export function seriesItemHeaderLine(index: number, total: number): string {
  return `Series item ${String(index + 1)} of ${String(total)}.`;
}

export const DOCUMENT_WORKSPACE_PROJECT_SCHEMA = "persai.document.project.v1" as const;

export const DOCUMENT_WORKSPACE_PROJECTS_ROOT = "/workspace/projects";

export const DOCUMENT_WORKSPACE_PROJECT_SOURCE_KINDS = [
  "imported_workspace_file",
  "authored_workspace_project"
] as const;

export type DocumentWorkspaceProjectSourceKind =
  (typeof DOCUMENT_WORKSPACE_PROJECT_SOURCE_KINDS)[number];

export const DOCUMENT_WORKSPACE_PROJECT_SOURCE_FORMATS = [
  "pdf",
  "docx",
  "xlsx",
  "csv",
  "text",
  "html",
  "python",
  "image",
  "other"
] as const;

export type DocumentWorkspaceProjectSourceFormat =
  (typeof DOCUMENT_WORKSPACE_PROJECT_SOURCE_FORMATS)[number];

export type DocumentWorkspaceProjectLayout = {
  projectPath: string;
  extractDir: string;
  renderDir: string;
  outputDir: string;
  projectManifestPath: string;
  defaultRenderEntrypoint: string;
  defaultPdfExportEntrypoint: string;
  defaultPdfOutputPath: string;
};

export function slugifyDocumentProjectStem(sourcePath: string): string {
  const basename = sourcePath.replace(/\\/g, "/").split("/").pop() ?? "document";
  const dot = basename.lastIndexOf(".");
  const stem = dot > 0 ? basename.slice(0, dot) : basename;
  const slug = stem
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase()
    .slice(0, 60);
  if (slug.length > 0 && /[a-z]/.test(slug)) {
    return slug;
  }
  let hash = 0;
  for (const char of sourcePath) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  return `doc-${hash.toString(16).slice(0, 8)}`;
}

export function buildDocumentWorkspaceProjectLayout(
  projectPath: string
): DocumentWorkspaceProjectLayout {
  const normalized = projectPath.replace(/\/+$/g, "");
  return {
    projectPath: normalized,
    extractDir: `${normalized}/extract`,
    renderDir: `${normalized}/render`,
    outputDir: `${normalized}/output`,
    projectManifestPath: `${normalized}/project.json`,
    defaultRenderEntrypoint: `${normalized}/render/report.html`,
    defaultPdfExportEntrypoint: `${normalized}/render/export_pdf.py`,
    defaultPdfOutputPath: `${normalized}/output/report.pdf`
  };
}

export function deriveDefaultDocumentProjectPath(sourcePath: string): string {
  return `${DOCUMENT_WORKSPACE_PROJECTS_ROOT}/${slugifyDocumentProjectStem(sourcePath)}`;
}

export function applyDocumentProjectPathSuffix(projectPath: string, suffix: number): string {
  if (suffix <= 1) {
    return projectPath;
  }
  const normalized = projectPath.replace(/\/+$/g, "");
  const lastSlash = normalized.lastIndexOf("/");
  const parent = lastSlash >= 0 ? normalized.slice(0, lastSlash) : DOCUMENT_WORKSPACE_PROJECTS_ROOT;
  const basename = lastSlash >= 0 ? normalized.slice(lastSlash + 1) : normalized;
  return `${parent}/${basename}-${String(suffix)}`;
}

export function buildDocumentProjectSourceCopyPath(
  layout: DocumentWorkspaceProjectLayout,
  sourcePath: string | null
): string | null {
  if (typeof sourcePath !== "string" || sourcePath.trim().length === 0) {
    return null;
  }
  const normalized = sourcePath.replace(/\\/g, "/");
  const basename = normalized.split("/").pop()?.trim() ?? "";
  if (basename.length === 0) {
    return null;
  }
  return `${layout.projectPath}/source/${basename}`;
}

export function buildDocumentProjectPythonRenderEntrypoint(
  layout: DocumentWorkspaceProjectLayout
): string {
  return `${layout.renderDir}/build.py`;
}

export function buildDocumentProjectPdfExportEntrypoint(
  layout: DocumentWorkspaceProjectLayout
): string {
  return layout.defaultPdfExportEntrypoint;
}

export function buildImportedOfficeRenderScaffold(input: {
  sourceFormat: "docx" | "xlsx";
  projectSourcePath: string;
}): string {
  if (input.sourceFormat === "docx") {
    return [
      "from pathlib import Path",
      "from docx import Document",
      "",
      `SOURCE_PATH = Path(${JSON.stringify(input.projectSourcePath)})`,
      "OUTPUT_PATH = Path(PERSAI_OUTPUT_PATH)",
      "",
      "def build() -> None:",
      "    document = Document(str(SOURCE_PATH))",
      "    # Edit the loaded DOCX deterministically before saving if needed.",
      "    document.save(str(OUTPUT_PATH))",
      "",
      'if __name__ == "__main__":',
      "    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)",
      "    build()"
    ].join("\n");
  }
  return [
    "from pathlib import Path",
    "from openpyxl import load_workbook",
    "",
    `SOURCE_PATH = Path(${JSON.stringify(input.projectSourcePath)})`,
    "OUTPUT_PATH = Path(PERSAI_OUTPUT_PATH)",
    "",
    "def build() -> None:",
    "    workbook = load_workbook(filename=str(SOURCE_PATH))",
    "    # Edit the loaded workbook deterministically before saving if needed.",
    "    workbook.save(str(OUTPUT_PATH))",
    "",
    'if __name__ == "__main__":',
    "    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)",
    "    build()"
  ].join("\n");
}

export function buildImportedOfficePdfExportScaffold(input: {
  sourceFormat: "docx" | "xlsx";
  projectSourcePath: string;
}): string {
  return [
    "import os",
    "from pathlib import Path",
    "import shutil",
    "import subprocess",
    "import tempfile",
    "",
    `SOURCE_PATH = Path(${JSON.stringify(input.projectSourcePath)})`,
    "DEFAULT_OUTPUT_PATH = SOURCE_PATH.parent.parent / 'output' / 'report.pdf'",
    "OUTPUT_PATH = Path(os.environ.get('PERSAI_OUTPUT_PATH') or str(DEFAULT_OUTPUT_PATH))",
    "",
    "def export_pdf() -> None:",
    '    with tempfile.TemporaryDirectory(prefix="persai-office-pdf-", dir="/tmp") as tmp_dir:',
    "        temp_root = Path(tmp_dir)",
    "        out_dir = temp_root / 'out'",
    "        out_dir.mkdir(parents=True, exist_ok=True)",
    "        # Keep LibreOffice first-run state in writable /tmp, not the read-only image layer.",
    "        profile_uri = (temp_root / 'libreoffice-profile').resolve().as_uri()",
    "        command = [",
    "            'soffice',",
    "            '--headless',",
    "            '--nologo',",
    "            '--nodefault',",
    "            '--norestore',",
    "            '--nolockcheck',",
    "            '--nofirststartwizard',",
    "            f'-env:UserInstallation={profile_uri}',",
    "            '--convert-to',",
    "            'pdf',",
    "            '--outdir',",
    "            str(out_dir),",
    "            str(SOURCE_PATH),",
    "        ]",
    "        completed = subprocess.run(command, capture_output=True, text=True)",
    "        if completed.returncode != 0:",
    `            raise RuntimeError(${JSON.stringify(
      `LibreOffice failed to export imported ${input.sourceFormat.toUpperCase()} to PDF`
    )} + f": {completed.stderr.strip() or completed.stdout.strip() or 'unknown error'}")`,
    "        exported = out_dir / f'{SOURCE_PATH.stem}.pdf'",
    "        if not exported.is_file():",
    "            pdf_candidates = sorted(out_dir.glob('*.pdf'))",
    "            if len(pdf_candidates) != 1:",
    `                raise FileNotFoundError(${JSON.stringify(
      `LibreOffice did not create the declared PDF for imported ${input.sourceFormat.toUpperCase()} export.`
    )})`,
    "            exported = pdf_candidates[0]",
    "        OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)",
    "        shutil.move(str(exported), str(OUTPUT_PATH))",
    "",
    "if __name__ == '__main__':",
    "    export_pdf()"
  ].join("\n");
}

export function resolveDocumentProjectDefaultRenderEntrypoint(input: {
  layout: DocumentWorkspaceProjectLayout;
  sourceKind: DocumentWorkspaceProjectSourceKind;
  sourceFormat: DocumentWorkspaceProjectSourceFormat;
}): string {
  if (
    input.sourceKind === "imported_workspace_file" &&
    (input.sourceFormat === "docx" || input.sourceFormat === "xlsx")
  ) {
    return buildDocumentProjectPythonRenderEntrypoint(input.layout);
  }
  if (input.sourceFormat === "python") {
    return `${input.layout.projectPath}/build.py`;
  }
  return input.layout.defaultRenderEntrypoint;
}

export function isWorkspacePathUnderPrefix(path: string, prefix: string): boolean {
  const normalizedPath = path.replace(/\\/g, "/").replace(/\/+$/g, "");
  const normalizedPrefix = prefix.replace(/\\/g, "/").replace(/\/+$/g, "");
  return normalizedPath === normalizedPrefix || normalizedPath.startsWith(`${normalizedPrefix}/`);
}

export function validateDocumentProjectRenderPaths(input: {
  layout: DocumentWorkspaceProjectLayout;
  projectPath: string;
  outputPath: string;
  entrypointPath: string;
}): string | null {
  const normalizedProjectPath = input.projectPath.replace(/\/+$/g, "");
  if (normalizedProjectPath !== input.layout.projectPath) {
    return `document.render projectPath must be ${input.layout.projectPath}, the active document project from document.extract.`;
  }
  if (!isWorkspacePathUnderPrefix(input.outputPath, input.layout.outputDir)) {
    return `document.render outputPath must stay under ${input.layout.outputDir}/.`;
  }
  if (!isWorkspacePathUnderPrefix(input.entrypointPath, input.layout.renderDir)) {
    return `document.render entrypoint must stay under ${input.layout.renderDir}/.`;
  }
  return null;
}

export function shouldScaffoldDocumentProjectRenderHtml(mimeType: string): boolean {
  const normalized = mimeType.toLowerCase().split(";")[0]?.trim() ?? "";
  return (
    normalized === "application/pdf" ||
    normalized === "application/x-pdf" ||
    normalized.startsWith("text/") ||
    normalized === "application/json" ||
    normalized === "application/xml" ||
    normalized === "application/yaml" ||
    normalized === "application/x-yaml"
  );
}

export function buildDocumentProjectManifest(input: {
  layout: DocumentWorkspaceProjectLayout;
  sourceKind: DocumentWorkspaceProjectSourceKind;
  sourcePath: string | null;
  projectSourcePath: string | null;
  sourceFormat: DocumentWorkspaceProjectSourceFormat;
  sourceMimeType: string | null;
  sourceDisplayName?: string | null;
  extractManifestPath: string | null;
  mimeType: string | null;
}): Record<string, unknown> {
  return {
    schema: DOCUMENT_WORKSPACE_PROJECT_SCHEMA,
    projectPath: input.layout.projectPath,
    sourcePath: input.sourcePath,
    projectSourcePath: input.projectSourcePath,
    sourceKind: input.sourceKind,
    sourceFormat: input.sourceFormat,
    sourceMimeType: input.sourceMimeType,
    sourceDisplayName: input.sourceDisplayName ?? null,
    extractDir: input.layout.extractDir,
    renderDir: input.layout.renderDir,
    outputDir: input.layout.outputDir,
    extractManifestPath: input.extractManifestPath,
    defaultRenderEntrypoint: resolveDocumentProjectDefaultRenderEntrypoint({
      layout: input.layout,
      sourceKind: input.sourceKind,
      sourceFormat: input.sourceFormat
    }),
    defaultPdfExportEntrypoint: buildDocumentProjectPdfExportEntrypoint(input.layout),
    defaultPdfOutputPath: input.layout.defaultPdfOutputPath,
    mimeType: input.mimeType
  };
}

function escapeDocumentProjectHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function extractedDocumentProjectTextToHtmlBody(extractedText: string): string {
  const paragraphs = extractedText.replace(/\r\n/g, "\n").split(/\n{2,}/);
  if (paragraphs.length === 0) {
    return "<p></p>";
  }
  return paragraphs
    .map((paragraph) => {
      const trimmed = paragraph.trim();
      if (trimmed.length === 0) {
        return "";
      }
      const lines = trimmed.split("\n").map((line) => escapeDocumentProjectHtml(line));
      return `<p>${lines.join("<br/>")}</p>`;
    })
    .filter((paragraph) => paragraph.length > 0)
    .join("\n");
}

export function buildDocumentProjectRenderScaffoldHtml(input: {
  sourcePath: string;
  extractedText: string;
}): string {
  const body = extractedDocumentProjectTextToHtmlBody(input.extractedText);
  return `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="utf-8"/>
  <title>Document render scaffold</title>
  <style>
    @page { size: A4; margin: 20mm 18mm 22mm 18mm; }
    body {
      font-family: "Times New Roman", Georgia, serif;
      font-size: 12pt;
      line-height: 1.45;
      color: #1f1f1f;
      background: #f7f3ea;
    }
    main { max-width: 100%; }
    h1.doc-title {
      font-size: 18pt;
      letter-spacing: 0.04em;
      margin: 0 0 12mm 0;
      color: #2f5496;
    }
    p { margin: 0 0 6pt 0; text-align: justify; }
  </style>
</head>
<body>
  <main>
    <h1 class="doc-title">${escapeDocumentProjectHtml(input.sourcePath.split("/").pop() ?? "Document")}</h1>
    ${body}
  </main>
</body>
</html>
`;
}
