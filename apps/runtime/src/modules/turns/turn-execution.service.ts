import { createHash } from "node:crypto";
import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  InternalServerErrorException,
  Logger,
  ServiceUnavailableException
} from "@nestjs/common";
import type {
  AssistantRuntimeBundle,
  AssistantRuntimeBundleToolCredentialRef
} from "@persai/runtime-bundle";
import {
  MAX_RUNTIME_IMAGE_EDIT_COUNT,
  MAX_RUNTIME_IMAGE_GENERATE_COUNT,
  MIN_RUNTIME_IMAGE_EDIT_COUNT,
  MIN_RUNTIME_IMAGE_GENERATE_COUNT,
  PERSAI_RUNTIME_MODEL_ROLES,
  PERSAI_RUNTIME_WEB_FETCH_EXTRACT_MODES,
  type PersaiRuntimeWebSearchProviderId,
  type PersaiRuntimeSharedCompactionToolCode,
  type ProviderGatewayPromptCacheConfig,
  type ProviderGatewayPromptCacheRetention,
  type ProviderGatewayRequestMetadata,
  type ProviderGatewayMessageContentBlock,
  type ProviderGatewayToolCall,
  type ProviderGatewayToolExchange,
  type ProviderGatewayTextMessage,
  type ProviderGatewayTextGenerateRequest,
  type ProviderGatewayTextGenerateResult,
  type ProviderGatewayTextStreamEvent,
  type PersaiRuntimeWebFetchExtractMode,
  type RuntimeKnowledgeFetchToolResult,
  type RuntimeKnowledgeSearchToolResult,
  type RuntimeAttachmentRef,
  type RuntimeMemoryWriteToolResult,
  type RuntimeTodoItem,
  type RuntimeTodoWriteToolResult,
  type RuntimeQuotaStatusToolResult,
  type RuntimeBrowserToolResult,
  type RuntimeDocumentToolResult,
  type RuntimeFilesToolResult,
  type RuntimeGrepToolResult,
  type RuntimeGlobToolResult,
  type RuntimeImageEditToolResult,
  type RuntimeImageGenerateToolResult,
  type RuntimeFileHandle,
  type RuntimeOutputArtifact,
  type RuntimeSandboxToolResult,
  type RuntimeScheduledActionToolResult,
  type RuntimeBackgroundTaskToolResult,
  type RuntimeSkillDecisionState,
  type RuntimeDeferredMediaJobSummary,
  type RuntimeDeferredDocumentJobSummary,
  type RuntimeSharedCompactionToolResult,
  type RuntimeTtsToolResult,
  type RuntimeVideoGenerateToolResult,
  type RuntimeToolPolicy,
  type RuntimeFailedEvent,
  type RuntimeInterruptedEvent,
  type RuntimeTextDeltaSource,
  type RuntimeTurnRequest,
  type RuntimeTurnResult,
  type RuntimeTurnRoutingSnapshot,
  type RuntimeTurnToolInvocation,
  type RuntimeTurnStreamEvent,
  type RuntimeBillingFacts,
  type RuntimeWebSearchToolResult,
  type RuntimeWebFetchToolResult,
  type RuntimeUsageAccounting,
  type RuntimeUsageAccountingEntry,
  type RuntimeUsageSnapshot,
  type PersaiRuntimeKnowledgeSource,
  type PersaiRuntimeModelRole,
  type RuntimeTrace
} from "@persai/runtime-contract";
import { RuntimeBundleRegistryService } from "../bundles/runtime-bundle-registry.service";
import { RuntimeObservabilityService } from "../observability/runtime-observability.service";
import type { RuntimeTurnReceiptSummary } from "./idempotency.service";
import {
  projectRuntimeNativeTools,
  type RuntimeNativeToolProjection
} from "./native-tool-projection";
import {
  createProjectModeBootstrapStreamEvents,
  createProjectModeReplanStreamEvents,
  createProjectModeSynthesisStreamEvents,
  isProjectChatMode,
  PROJECT_EXECUTION_DEVELOPER_CONTRACT
} from "./project-execution-profile";
import { PersaiInternalApiClientService } from "./persai-internal-api.client.service";
import { ProviderGatewayClientService } from "./provider-gateway.client.service";
import {
  isRetryableRuntimeTextFailure,
  isRetryableRuntimeTextStreamFailure,
  resolveRuntimeTextFallbackSelection,
  sameProviderSelection,
  type ProviderSelection
} from "./runtime-text-fallback";
import { RuntimeBrowserToolService } from "./runtime-browser-tool.service";
import { RuntimeDocumentToolService } from "./runtime-document-tool.service";
import { stringifyToolResultPayloadForModel } from "./sanitize-tool-result-for-model";
import { RuntimeFilesToolService } from "./runtime-files-tool.service";
import { RuntimeImageEditToolService } from "./runtime-image-edit-tool.service";
import { RuntimeImageGenerateToolService } from "./runtime-image-generate-tool.service";
import { RuntimeKnowledgeToolService } from "./runtime-knowledge-tool.service";
import { RuntimeMemoryWriteToolService } from "./runtime-memory-write-tool.service";
import { RuntimeTodoWriteToolService } from "./runtime-todo-write-tool.service";
import { BuildActiveScenarioBlockService } from "./build-active-scenario-block.service";
import { BuildSystemReminderBlocksService } from "./build-system-reminder-blocks.service";
import { RuntimeSkillToolService, type RuntimeSkillToolResult } from "./runtime-skill-tool.service";
import { RuntimeQuotaStatusToolService } from "./runtime-quota-status-tool.service";
import { RuntimeSandboxToolService } from "./runtime-sandbox-tool.service";
import { RuntimeGrepGlobToolService } from "./runtime-grep-glob-tool.service";
import { RuntimeBackgroundTaskToolService } from "./runtime-background-task-tool.service";
import { RuntimeScheduledActionToolService } from "./runtime-scheduled-action-tool.service";
import { RuntimeTtsToolService } from "./runtime-tts-tool.service";
import { RuntimeVideoGenerateToolService } from "./runtime-video-generate-tool.service";
import { OPENAI_PROMPT_CACHE_RETENTION_FALLBACK } from "./openai-prompt-cache-retention";
import {
  buildPromptCacheStableBlockToken,
  resolveLeadingHydratedPromptCacheStableBlockTokens
} from "./prompt-cache-stable-blocks";
import { resolveRuntimeContextHydrationConfig } from "./runtime-context-hydration-policy";
import { SessionCompactionService } from "./session-compaction.service";
import {
  ToolBudgetPolicy,
  createToolBudgetExhaustedResult,
  type ToolBudgetExecutionMode,
  type ToolBudgetSnapshot
} from "./tool-budget-policy";
import { TurnContextHydrationService } from "./turn-context-hydration.service";
import {
  providerAcceptsMultimodalInput,
  sanitizeMultimodalContentBlocks,
  sanitizeMultimodalMessages,
  type MultimodalBlockDescriber
} from "./runtime-text-only-multimodal-sanitizer";
import { TurnAcceptanceService, type AcceptedRuntimeTurn } from "./turn-acceptance.service";
import { TurnFinalizationService } from "./turn-finalization.service";
import { RuntimeBundleAutoRefreshService } from "./runtime-bundle-auto-refresh.service";
import { resolveExecutionProfile } from "./execution-profile-resolver";
import { TurnRoutingService, type TurnRouteDecision } from "./turn-routing.service";
import {
  RuntimeExecutionAdmissionService,
  classifyInteractiveExecutionClass
} from "./runtime-execution-admission.service";
import { resolveModelOutputBudget, APPROX_BYTES_PER_TOKEN } from "./model-output-budget";

type NativeManagedProvider = "openai" | "anthropic" | "deepseek";

/**
 * ADR-122 Slice 2 — Estimate the number of input tokens already present in an
 * assembled provider request. Uses the ≈3-bytes/token heuristic shared with
 * the model-output-budget module. The estimate is intentionally cheap (no
 * tokenizer call) and slightly generous (char count / 3 rounds up), which is
 * the correct direction: over-estimating input leaves a smaller ctxRoom,
 * keeping the safety reserve effective.
 */
function estimateProviderRequestInputTokens(req: {
  systemPrompt?: string | null;
  developerInstructions?: string | null;
  messages: unknown[];
  tools?: unknown[];
}): number {
  const systemLen = typeof req.systemPrompt === "string" ? req.systemPrompt.length : 0;
  const devLen =
    typeof req.developerInstructions === "string" ? req.developerInstructions.length : 0;
  const messagesLen = JSON.stringify(req.messages).length;
  const toolsLen = req.tools && req.tools.length > 0 ? JSON.stringify(req.tools).length : 0;
  return Math.ceil((systemLen + devLen + messagesLen + toolsLen) / APPROX_BYTES_PER_TOKEN);
}

const PROMPT_CACHE_KEY_BUCKETS = 8;
const PROMPT_CACHE_KEY_DIGEST_HEX_LENGTH = 32;
const ANTHROPIC_HISTORY_BREAKPOINT_MIN_TOKENS = 3_000;
const MAX_OPEN_MEDIA_JOB_CONTEXT_ITEMS = 4;
const MAX_OPEN_DOCUMENT_JOB_CONTEXT_ITEMS = 4;
const MAX_JOB_DELIVERY_UPDATE_ITEMS = 6;
const MAX_MODEL_VISIBLE_WORKING_FILES = 20;
const MAX_WORKING_FILE_MICRO_DESCRIPTION_CHARS = 120;
const POST_FINAL_SELF_CHECK_MAX_HOPS = 2;
const POST_FINAL_SELF_CHECK_MAX_OPEN_ROWS_RENDERED = 6;
const POST_FINAL_SELF_CHECK_TODO_TITLE_MAX = 80;

const VISIBLE_WORKING_NOTES_DEVELOPER_CONTRACT = [
  "## Visible working notes",
  "Before each real tool call, add one short natural-language working note that says what you are checking, reading, or gathering next.",
  "Write the note as a brief user-visible transition, not as hidden chain-of-thought, and keep it directly tied to the immediate next tool call.",
  "Do not skip these short pre-tool notes in ordinary chat, project chat, or any other user-visible turn that is about to call a tool.",
  "Keep each working note short and concrete. Do not format progress as long paragraphs, numbered status ladders, or repeated bullet prefixes.",
  "Avoid generic filler like 'continuing analysis' or 'doing another pass'; say the specific next action instead."
].join("\n");

type PreparedTurnExecution = {
  bundle: AssistantRuntimeBundle;
  projectedTools: RuntimeNativeToolProjection;
  runtimeTier: RuntimeTurnRequest["runtimeTier"];
  promptMode: "chat" | "background_worker";
  providerRequest: ProviderGatewayTextGenerateRequest;
  developerInstructionSections: DeveloperInstructionSection[];
  currentMessageAttachments: RuntimeTurnRequest["message"]["attachments"];
  availableWorkingFileHandles: RuntimeFileHandle[];
  deepModeEnabled: boolean;
  selectedModelRole: PersaiRuntimeModelRole;
  routeDecision: TurnRouteDecision;
  preludeUsageEntries: RuntimeUsageAccountingEntry[];
  // ADR-074 Slice T1: rendered presence developer-tail block, computed once
  // per `prepareTurnExecution`. `null` when the bundle has no presence
  // template (legacy bundle compiled before T1) or the channel doesn't have
  // a canonical chat row to ground the in-thread baseline.
  presenceBlock: string | null;
  // ADR-125 Amendment 2 — mid-loop volatile-prefix refresh state. The
  // volatile prefix (active scenario block + chat-plan block + <system-reminder>
  // blocks) is built once at turn prep, but any in-loop `skill.engage`,
  // `skill.release` or `todo_write` tool call mutates the underlying state.
  // We carry the prefix length + the current skill decision state on the
  // execution so a surgical refresh after such a tool call can swap the prefix
  // in place without re-hydrating the entire base history.
  volatilePrefixLength: number;
  currentSkillDecisionState: RuntimeSkillDecisionState | null;
  currentTurnHasUserAttachedImage: boolean;
  selfCheckHopsRemaining: number;
};

type TurnKnowledgeSourcePolicy = {
  searchSources: PersaiRuntimeKnowledgeSource[];
  fetchSources: PersaiRuntimeKnowledgeSource[];
};

type RuntimeStreamTraceCollector = {
  stage: (key: string) => void;
  build: (status: RuntimeTrace["status"]) => RuntimeTrace;
};

type TurnProviderRequestClassification = "main_turn" | "tool_loop_followup";

type TurnExecutionState = {
  sharedCompaction: {
    invoked: boolean;
    durableStatePersisted: boolean;
  };
  artifacts: RuntimeOutputArtifact[];
  fileHandles: RuntimeFileHandle[];
  usageEntries: RuntimeUsageAccountingEntry[];
  toolInvocations: RuntimeTurnToolInvocation[];
  deferredMediaJobs: RuntimeDeferredMediaJobSummary[];
  deferredDocumentJobs: RuntimeDeferredDocumentJobSummary[];
  closedOpenLoopRefs: string[];
  /**
   * ADR-100 Piece 1 / ADR-126 v3 — ordered set of workspace storage paths
   * discovered via `files.list / read / preview` during this turn's tool loop.
   * Capped at 20 (insertion order, deduplicated). Surfaced on the turn result
   * so the API can persist them on the assistant message metadata for
   * next-turn hydration.
   */
  discoveredFilePathSet: string[];
  /**
   * ADR-116 — ephemeral multimodal blocks from `files.preview` for the next
   * tool-loop provider call only.
   */
  pendingFilePreviewBlocks?: ProviderGatewayMessageContentBlock[];
};

type ToolExecutionOutcome = {
  exchange: ProviderGatewayToolExchange;
  payload:
    | RuntimeSharedCompactionToolResult
    | RuntimeKnowledgeSearchToolResult
    | RuntimeKnowledgeFetchToolResult
    | RuntimeMemoryWriteToolResult
    | RuntimeTodoWriteToolResult
    | RuntimeQuotaStatusToolResult
    | RuntimeBrowserToolResult
    | RuntimeDocumentToolResult
    | RuntimeFilesToolResult
    | RuntimeGrepToolResult
    | RuntimeGlobToolResult
    | RuntimeImageEditToolResult
    | RuntimeImageGenerateToolResult
    | RuntimeSandboxToolResult
    | RuntimeScheduledActionToolResult
    | RuntimeBackgroundTaskToolResult
    | RuntimeTtsToolResult
    | RuntimeVideoGenerateToolResult
    | RuntimeWebSearchToolResult
    | RuntimeWebFetchToolResult
    | Record<string, unknown>;
  artifacts?: RuntimeOutputArtifact[];
  /**
   * Files-tool registry-resolved refs that the model just discovered through
   * `files.list` / `files.read` / `files.preview`. The runtime
   * caller merges these into `turnState.fileHandles` so the next provider
   * iteration's Working Files developer block carries the same sticky
   * `file #N` / `image #N` labels as the rest of the turn instead of
   * recomputing recency-based ordinals.
   */
  discoveredFileHandles?: RuntimeFileHandle[];
  sharedCompaction?: {
    toolCode: PersaiRuntimeSharedCompactionToolCode;
    durableStatePersisted: boolean;
  };
  pendingFilePreviewBlocks?: ProviderGatewayMessageContentBlock[];
};

type PlannedToolExecution = {
  toolCall: ProviderGatewayToolCall;
  reservation: ReturnType<ToolBudgetPolicy["reserve"]>;
  reservedUnits: number;
  parallelSafe: boolean;
};

type ExecutedToolCallResult = {
  toolCall: ProviderGatewayToolCall;
  outcome?: ToolExecutionOutcome;
  error?: unknown;
};

class TurnExecutionError extends Error {
  constructor(
    readonly code: string,
    readonly exception: HttpException
  ) {
    super(exception.message);
  }
}

/**
 * ADR-074 Slice L1: the hard ceiling on native-tool-loop iterations is
 * `policy.loopLimit() + NATIVE_TOOL_LOOP_WRAP_UP_ITERATIONS`, where
 * `policy.loopLimit()` is mode-aware (`tool-budget-policy.ts`: normal=2,
 * premium=4, reasoning=8). The `+ 2` buys two extra provider round-trips
 * after the model has used up its real tool-execution budget: one substitute
 * round (any tool call still emitted is replaced with a
 * `tool_budget_exhausted` result via `policy.reserve(...)`) and one final
 * reply round (the model now sees the substituted results and is expected to
 * produce honest user-facing text). Only if the model also emits tool calls
 * in that final reply round do we fail the turn with
 * `native_tool_loop_exhausted` — exceedingly rare because the substituted
 * results carry an explicit `hint` telling the model to wrap up. Pre-L1 this
 * was a universal `MAX_NATIVE_TOOL_LOOP_ITERATIONS = 4` that hard-failed the
 * turn instead of giving the model a graceful exit; that constant is gone,
 * do not reintroduce it.
 */
const NATIVE_TOOL_LOOP_WRAP_UP_ITERATIONS = 2;
const BROWSER_TOOL_CODE = "browser";
const WEB_SEARCH_TOOL_CODE = "web_search";
const DEFAULT_NATIVE_WEB_SEARCH_PROVIDER_ID: PersaiRuntimeWebSearchProviderId = "tavily";
const WEB_SEARCH_MIN_COUNT = 1;
const WEB_SEARCH_MAX_COUNT = 20;
const WEB_FETCH_TOOL_CODE = "web_fetch";
const WEB_FETCH_DEFAULT_EXTRACT_MODE: PersaiRuntimeWebFetchExtractMode = "markdown";
const WEB_FETCH_MIN_MAX_CHARS = 100;
const WEB_FETCH_MAX_MAX_CHARS = 50_000;
const REFUNDABLE_TOOL_REQUEST_REJECTION_REASONS = new Set<string>([
  "invalid_arguments",
  "reference_image_alias_invalid",
  "portrait_alias_unavailable"
]);
const MEMORY_WRITE_TOOL_CODE = "memory_write";
const TODO_WRITE_TOOL_CODE = "todo_write";
const SKILL_TOOL_CODE = "skill";
const QUOTA_STATUS_TOOL_CODE = "quota_status";
const SCHEDULED_ACTION_TOOL_CODE = "scheduled_action";
const BACKGROUND_TASK_TOOL_CODE = "background_task";
const DOCUMENT_TOOL_CODE = "document";
const IMAGE_EDIT_TOOL_CODE = "image_edit";
const IMAGE_GENERATE_TOOL_CODE = "image_generate";
const VIDEO_GENERATE_TOOL_CODE = "video_generate";
const TTS_TOOL_CODE = "tts";
const FILES_TOOL_CODE = "files";
const GREP_TOOL_CODE = "grep";
const GLOB_TOOL_CODE = "glob";
const EXEC_TOOL_CODE = "exec";
const SHELL_TOOL_CODE = "shell";
const SAFE_PARALLEL_TOOL_CODES = new Set<string>([
  WEB_SEARCH_TOOL_CODE,
  WEB_FETCH_TOOL_CODE,
  "knowledge_search",
  "knowledge_fetch"
]);
const DELIVERY_HONESTY_CONTRACT =
  "Do not write markdown links to local or internal file paths, and do not state that a file, image, video, or document is attached, sent, uploaded, queued, accepted, in progress, or will arrive separately unless this same turn actually produced the corresponding structural result. Delivered files are shown to the user structurally by the interface. For pending media or documents, only say the item is being prepared and will arrive separately when this same turn actually returned action='pending_delivery' with canSendFileNow=false and a real jobId. If no such structural result exists, do not claim that anything was queued, accepted, started, or already being prepared.";
const LEGACY_TECHNICAL_ATTACHMENT_SUMMARY_PATTERNS = [
  /^Assistant sent (?:an? )?attachments?:\s+.+$/i,
  /^\[?Working files from user attachments:.*$/i
] as const;

type DeveloperInstructionSectionKey =
  | "project_execution_contract"
  | "visible_working_notes"
  | "channel_context"
  | "routing_hints"
  | "source_progression"
  | "open_loop_refs"
  | "working_files"
  | "open_media_jobs"
  | "open_document_jobs"
  | "job_delivery_updates"
  | "presence"
  | "delivery_contract"
  | "tool_follow_up"
  | "deferred_media_follow_up"
  | "deferred_document_follow_up";

type DeveloperInstructionSection = {
  key: DeveloperInstructionSectionKey;
  content: string;
};

const BACKGROUND_TASK_SYNTHETIC_TURN_EXCLUDED_TOOLS = new Set([
  BACKGROUND_TASK_TOOL_CODE,
  SCHEDULED_ACTION_TOOL_CODE,
  "summarize_context",
  "compact_context"
]);

/**
 * Assemble the multi-step working notes, the answer-only text, and the
 * backward-compatible full assistant text for a completed turn.
 *
 * Inputs (all already produced by the streaming loop / corrections):
 * - `toolStepTexts` — the text the model produced before EACH tool call across
 *   the tool loop, one entry per `tool_calls` step. Each entry is the provider
 *   text of that iteration ONLY (never the cumulative text), so a later step's
 *   note never re-contains an earlier note.
 * - `finalAnswerText` — the corrected text of the FINAL iteration only (the
 *   answer after the last tool). It must NOT be derived from the cumulative
 *   corrected text, which already contains every note; deriving it that way is
 *   the historical duplication bug this function exists to prevent.
 * - `fullAssistantText` — the cumulative corrected provider text (single copy
 *   of each note + the answer). Kept verbatim as the backward-compat
 *   `assistantText` for Telegram / non-web consumers.
 *
 * Contract:
 * - `workingNotes` = the trimmed, non-empty `toolStepTexts` in order (each note
 *   exactly once; whitespace-only steps dropped).
 * - `answerText` = `finalAnswerText` (the answer only, no notes).
 * - `assistantText` = `fullAssistantText` verbatim (never reconstructed from
 *   `notes + answer`, which would risk doubling notes).
 */
export function assembleWorkingNotesAndAnswer(input: {
  toolStepTexts: readonly string[];
  finalAnswerText: string;
  fullAssistantText: string;
}): { workingNotes: string[]; answerText: string; assistantText: string } {
  const workingNotes: string[] = [];
  for (const stepText of input.toolStepTexts) {
    const trimmed = stepText.trim();
    if (trimmed.length > 0) {
      workingNotes.push(trimmed);
    }
  }
  return {
    workingNotes,
    answerText: input.finalAnswerText,
    assistantText: input.fullAssistantText
  };
}

@Injectable()
export class TurnExecutionService {
  private readonly logger = new Logger(TurnExecutionService.name);

  constructor(
    private readonly runtimeBundleRegistryService: RuntimeBundleRegistryService,
    private readonly providerGatewayClientService: ProviderGatewayClientService,
    private readonly persaiInternalApiClientService: PersaiInternalApiClientService,
    private readonly runtimeBundleAutoRefreshService: RuntimeBundleAutoRefreshService,
    private readonly turnContextHydrationService: TurnContextHydrationService,
    private readonly turnAcceptanceService: TurnAcceptanceService,
    private readonly turnRoutingService: TurnRoutingService,
    private readonly turnFinalizationService: TurnFinalizationService,
    private readonly sessionCompactionService: SessionCompactionService,
    private readonly runtimeBrowserToolService: RuntimeBrowserToolService,
    private readonly runtimeDocumentToolService: RuntimeDocumentToolService,
    private readonly runtimeFilesToolService: RuntimeFilesToolService,
    private readonly runtimeImageEditToolService: RuntimeImageEditToolService,
    private readonly runtimeImageGenerateToolService: RuntimeImageGenerateToolService,
    private readonly runtimeKnowledgeToolService: RuntimeKnowledgeToolService,
    private readonly runtimeMemoryWriteToolService: RuntimeMemoryWriteToolService,
    private readonly runtimeTodoWriteToolService: RuntimeTodoWriteToolService,
    private readonly runtimeQuotaStatusToolService: RuntimeQuotaStatusToolService,
    private readonly runtimeSandboxToolService: RuntimeSandboxToolService,
    private readonly runtimeGrepGlobToolService: RuntimeGrepGlobToolService,
    private readonly runtimeBackgroundTaskToolService: RuntimeBackgroundTaskToolService,
    private readonly runtimeScheduledActionToolService: RuntimeScheduledActionToolService,
    private readonly runtimeTtsToolService: RuntimeTtsToolService,
    private readonly runtimeVideoGenerateToolService: RuntimeVideoGenerateToolService,
    private readonly runtimeSkillToolService: RuntimeSkillToolService,
    private readonly buildActiveScenarioBlockService: BuildActiveScenarioBlockService,
    private readonly buildSystemReminderBlocksService: BuildSystemReminderBlocksService,
    private readonly runtimeObservabilityService: RuntimeObservabilityService,
    private readonly runtimeExecutionAdmissionService: RuntimeExecutionAdmissionService
  ) {}

  async createTurn(input: RuntimeTurnRequest): Promise<RuntimeTurnResult> {
    this.assertSupportedTurnRequest(input, "createTurn");

    const acceptedTurn = await this.turnAcceptanceService.acceptTurn(input);
    switch (acceptedTurn.outcome) {
      case "busy":
        throw new ConflictException(
          `Session "${acceptedTurn.session.sessionId}" is already processing another turn.`
        );
      case "in_flight":
        throw new ConflictException(
          acceptedTurn.requestId === null
            ? "A matching turn is already in flight."
            : `Turn "${acceptedTurn.requestId}" is already in flight.`
        );
      case "replayed":
        return this.resolveReplayResult(acceptedTurn.receipt);
      case "accepted": {
        const execution = await this.prepareTurnExecution(input, {
          allowModelToolExposure: true
        });
        const executionClass = this.classifyInteractiveExecutionClass(input, execution);
        return this.runtimeExecutionAdmissionService.runWithAdmission(executionClass, async () => {
          const turnState = this.createTurnExecutionState();
          this.applyPreparedTurnExecutionState(turnState, execution);
          const result = await this.executeAcceptedTurn(acceptedTurn, execution, input, turnState);
          return this.finalizeAcceptedTurnWithPostTurnEffects({
            acceptedTurn,
            result,
            input,
            bundle: execution.bundle,
            turnState
          });
        });
      }
    }
  }

  async createBackgroundTaskToolRun(input: RuntimeTurnRequest): Promise<RuntimeTurnResult> {
    this.assertSupportedTurnRequest(input, "createBackgroundTaskToolRun");

    const acceptedTurn = await this.turnAcceptanceService.acceptTurn(input);
    switch (acceptedTurn.outcome) {
      case "busy":
        throw new ConflictException(
          `Background task session "${acceptedTurn.session.sessionId}" is already processing another turn.`
        );
      case "in_flight":
        throw new ConflictException(
          acceptedTurn.requestId === null
            ? "A matching background task turn is already in flight."
            : `Background task turn "${acceptedTurn.requestId}" is already in flight.`
        );
      case "replayed":
        return this.resolveReplayResult(acceptedTurn.receipt);
      case "accepted": {
        return this.runtimeExecutionAdmissionService.runWithAdmission("background", async () => {
          const execution = await this.prepareTurnExecution(input, {
            allowModelToolExposure: true,
            excludedToolNames: BACKGROUND_TASK_SYNTHETIC_TURN_EXCLUDED_TOOLS,
            promptMode: "background_worker"
          });
          const turnState = this.createTurnExecutionState();
          this.applyPreparedTurnExecutionState(turnState, execution);
          const result = await this.executeAcceptedTurn(acceptedTurn, execution, input, turnState);
          return this.finalizeAcceptedTurnWithPostTurnEffects({
            acceptedTurn,
            result,
            input,
            bundle: execution.bundle,
            turnState
          });
        });
      }
    }
  }

  async streamTurn(
    input: RuntimeTurnRequest,
    options?: { signal?: AbortSignal; traceEnabled?: boolean }
  ): Promise<AsyncGenerator<RuntimeTurnStreamEvent>> {
    this.assertSupportedTurnRequest(input, "streamTurn");

    const acceptedTurn = await this.turnAcceptanceService.acceptTurn(input);
    switch (acceptedTurn.outcome) {
      case "busy":
        throw new ConflictException(
          `Session "${acceptedTurn.session.sessionId}" is already processing another turn.`
        );
      case "in_flight":
        throw new ConflictException(
          acceptedTurn.requestId === null
            ? "A matching turn is already in flight."
            : `Turn "${acceptedTurn.requestId}" is already in flight.`
        );
      case "replayed":
        return this.replayStreamResult(acceptedTurn.receipt);
      case "accepted": {
        const trace = this.createRuntimeStreamTraceCollector();
        trace.stage("accepted");
        const execution = await this.prepareTurnExecution(input, {
          allowModelToolExposure: true,
          trace
        });
        const executionClass = this.classifyInteractiveExecutionClass(input, execution);
        return this.runtimeExecutionAdmissionService.runStreamWithAdmission(executionClass, () => {
          const turnState = this.createTurnExecutionState();
          this.applyPreparedTurnExecutionState(turnState, execution);
          return this.streamAcceptedTurn(
            acceptedTurn,
            execution,
            input,
            turnState,
            options?.signal,
            trace,
            options?.traceEnabled === true
          );
        });
      }
    }
  }

  private async executeAcceptedTurn(
    acceptedTurn: AcceptedRuntimeTurn,
    execution: PreparedTurnExecution,
    input: RuntimeTurnRequest,
    turnState: TurnExecutionState
  ): Promise<RuntimeTurnResult> {
    try {
      const providerResult = await this.executeProviderToolLoop(
        acceptedTurn,
        execution,
        input,
        turnState
      );
      return this.buildTurnResult(acceptedTurn, providerResult, turnState, execution.routeDecision);
    } catch (error) {
      await this.failAcceptedTurnQuietly(acceptedTurn, error, undefined, turnState);
      throw this.toHttpException(error);
    }
  }

  private async prepareTurnExecution(
    input: RuntimeTurnRequest,
    options?: {
      allowModelToolExposure?: boolean;
      excludedToolNames?: ReadonlySet<string>;
      promptMode?: "chat" | "background_worker";
      trace?: RuntimeStreamTraceCollector;
    }
  ): Promise<PreparedTurnExecution> {
    let bundleEntry = this.resolveBundleEntry(input.bundle);
    if (bundleEntry === null || !this.bundleEntryMatchesRequest(bundleEntry, input.bundle)) {
      const warmed = await this.runtimeBundleAutoRefreshService.ensureRequestedBundle({
        bundle: input.bundle,
        runtimeTier: input.runtimeTier
      });
      if (warmed) {
        bundleEntry = this.resolveBundleEntry(input.bundle);
      }
    }
    if (bundleEntry === null) {
      throw new TurnExecutionError(
        "runtime_bundle_missing",
        new ServiceUnavailableException(`Runtime bundle "${input.bundle.bundleId}" is not warmed.`)
      );
    }
    if (bundleEntry.bundle.bundleHash !== input.bundle.bundleHash) {
      throw new TurnExecutionError(
        "runtime_bundle_hash_mismatch",
        new ServiceUnavailableException(
          `Runtime bundle "${input.bundle.bundleId}" does not match the requested bundle hash.`
        )
      );
    }
    if (bundleEntry.bundle.publishedVersionId !== input.bundle.publishedVersionId) {
      throw new TurnExecutionError(
        "runtime_bundle_version_mismatch",
        new ServiceUnavailableException(
          `Runtime bundle "${input.bundle.bundleId}" does not match the requested published version.`
        )
      );
    }
    options?.trace?.stage("prepare.bundle_ready");

    const hydratedMessagesBase = await this.turnContextHydrationService.buildMessages(
      input,
      bundleEntry.parsedBundle
    );
    // ADR-118 Slice 4: inject the active scenario volatile block before the memory block.
    // Order: scenario first (what to do), memory second (what we know).
    const activeScenarioBlock = this.buildActiveScenarioBlockService.buildBlock({
      bundle: bundleEntry.parsedBundle,
      skillDecisionState: input.skillStateContext?.decision ?? null
    });
    // ADR-125 Slice 1: chat plan volatile block. Surfaces the current
    // windowed plan even when the most recent tool call did not touch it.
    // The hydrator returns both the rendered `<persai_chat_plan>` block and
    // the source `todos` so we can derive the per-turn lifecycle reminder
    // from the same single round-trip (no second `readChatPlanWindow` call).
    const chatPlan = await this.turnContextHydrationService.buildChatPlanBlock(input);
    // ADR-119 Slice 5 + ADR-125 follow-up: build system-reminder blocks using
    // an initial empty tool budget snapshot. The snapshot is empty at
    // turn-prep time (no tools used yet); budget-warning reminders fire only
    // when the snapshot is non-empty (e.g. across-iteration accumulation in
    // future). The chat-plan lifecycle reminder is derived from the windowed
    // todos returned above.
    const currentTurnHasUserAttachedImage = input.message.attachments.some((a) =>
      a.mimeType.startsWith("image/")
    );
    const initialBudgetSnapshot: ToolBudgetSnapshot = [];
    const reminderBlocks = this.buildSystemReminderBlocksService.buildBlocks({
      bundle: bundleEntry.parsedBundle,
      skillDecisionState: input.skillStateContext?.decision ?? null,
      currentTurnHasUserAttachedImage,
      toolBudgetSnapshot: initialBudgetSnapshot,
      chatPlanTodos: chatPlan?.todos ?? null
    });
    const volatilePrefix: ProviderGatewayTextMessage[] = [];
    if (activeScenarioBlock !== null) volatilePrefix.push(activeScenarioBlock);
    if (chatPlan !== null) volatilePrefix.push(chatPlan.block);
    if (reminderBlocks.length > 0) volatilePrefix.push(...reminderBlocks);
    const hydratedMessages: ProviderGatewayTextMessage[] =
      volatilePrefix.length > 0
        ? [...volatilePrefix, ...hydratedMessagesBase]
        : hydratedMessagesBase;
    options?.trace?.stage("prepare.context_hydrated");
    const presenceBlock = await this.turnContextHydrationService.computePresenceBlock(
      input,
      bundleEntry.parsedBundle
    );
    options?.trace?.stage("prepare.presence_computed");
    const openLoopRefsBlock =
      await this.turnContextHydrationService.computeOpenLoopRefsDeveloperBlock(input);
    options?.trace?.stage("prepare.open_loop_refs_computed");
    const baselineProjectedTools = this.applyExcludedToolNames(
      projectRuntimeNativeTools(bundleEntry.parsedBundle, {
        allowModelToolExposure: options?.allowModelToolExposure ?? true
      }),
      options?.excludedToolNames
    );
    options?.trace?.stage("prepare.tools_projected");
    const executionPlan = await this.resolveTurnExecutionPlan(
      bundleEntry.parsedBundle,
      input,
      hydratedMessages,
      baselineProjectedTools
    );
    options?.trace?.stage("prepare.execution_plan_ready");
    const knowledgeSourcePolicy = this.deriveTurnKnowledgeSourcePolicy(
      executionPlan.routeDecision,
      baselineProjectedTools
    );
    const projectedTools = this.applyExcludedToolNames(
      projectRuntimeNativeTools(bundleEntry.parsedBundle, {
        allowModelToolExposure: options?.allowModelToolExposure ?? true,
        allowedKnowledgeSearchSources: knowledgeSourcePolicy.searchSources,
        allowedKnowledgeFetchSources: knowledgeSourcePolicy.fetchSources
      }),
      options?.excludedToolNames
    );
    options?.trace?.stage("prepare.turn_policy_applied");
    const providerSelection = this.resolveProviderSelection(bundleEntry.parsedBundle, {
      modelRoleOverride: executionPlan.modelRole,
      ...(input.providerOverride === undefined ? {} : { providerOverride: input.providerOverride }),
      ...(input.modelOverride === undefined ? {} : { modelOverride: input.modelOverride })
    });
    options?.trace?.stage("prepare.provider_selected");
    const availableWorkingFileHandles =
      await this.turnContextHydrationService.listAvailableWorkingFileHandles({
        conversation: input.conversation,
        currentAttachments: input.message.attachments
      });
    const developerInstructionSections = this.buildBaseDeveloperInstructionSections({
      request: input,
      projectedTools,
      availableWorkingFileHandles,
      deepModeEnabled: input.deepMode === true,
      routeDecision: executionPlan.routeDecision,
      openLoopRefsBlock,
      presenceBlock,
      openMediaJobs: input.openMediaJobs,
      openDocumentJobs: input.openDocumentJobs,
      jobDeliveryUpdates: input.jobDeliveryUpdates
    });
    const promptMode = options?.promptMode ?? "chat";
    // ADR-122 Slice 2: resolve slot capability for the selected model role so
    // resolveModelOutputBudget can use admin-managed maxOutputTokens and
    // contextWindow fields populated by Slice 1.
    const slotCapability = this.resolveSlotCapability(
      bundleEntry.parsedBundle,
      executionPlan.modelRole
    );
    const promptCacheRetention = this.resolveSlotPromptCacheRetention(
      bundleEntry.parsedBundle,
      executionPlan.modelRole
    );
    // ADR-122 corrective: apply the route's thinking budget on the INITIAL main turn
    // (iteration 0), not just the tool-loop refresh path. This fixes an ADR-121 wiring
    // gap where turn 0 never received the thinking budget. Safe because the gateway
    // stream timeout is idle-based (resets on every provider stream event, including
    // thinking deltas — see anthropic-provider.client.ts createTimedSignal/reset) and
    // the cadence watchdogs are disabled. The resolver and the gateway receive the
    // SAME thinkingBudget so the answer+thinking math stays consistent on every path.
    const turnThinkingBudget =
      executionPlan.routeDecision.mode === "active"
        ? executionPlan.routeDecision.thinkingBudget
        : 0;
    const providerRequestBase = this.buildProviderRequest(
      bundleEntry.parsedBundle,
      providerSelection,
      hydratedMessages,
      projectedTools,
      input.deepMode === true,
      developerInstructionSections,
      promptMode,
      turnThinkingBudget,
      promptCacheRetention
    );
    // ADR-122 Slice 2 (D3+D4): set maxOutputTokens via the unified resolver so
    // the main chat turn (and every tool-loop continuation that spreads this
    // base request) carries an explicit, model-aware token ceiling rather than
    // falling through to the provider-client fallback literal. thinkingBudget here
    // matches what the gateway actually emits on this turn (answer+thinking math).
    const inputTokensEstimate = estimateProviderRequestInputTokens(providerRequestBase);
    const providerRequest = {
      ...providerRequestBase,
      maxOutputTokens: resolveModelOutputBudget(slotCapability, {
        inputTokensEstimate,
        thinkingBudget: turnThinkingBudget
      })
    };
    options?.trace?.stage("prepare.provider_request_built");
    return {
      bundle: bundleEntry.parsedBundle,
      projectedTools,
      runtimeTier: input.runtimeTier,
      promptMode,
      currentMessageAttachments: input.message.attachments,
      developerInstructionSections,
      availableWorkingFileHandles,
      deepModeEnabled: input.deepMode === true,
      selectedModelRole: executionPlan.modelRole,
      routeDecision: executionPlan.routeDecision,
      preludeUsageEntries: executionPlan.usageEntries,
      providerRequest,
      presenceBlock,
      volatilePrefixLength: volatilePrefix.length,
      currentSkillDecisionState: input.skillStateContext?.decision ?? null,
      currentTurnHasUserAttachedImage,
      selfCheckHopsRemaining: POST_FINAL_SELF_CHECK_MAX_HOPS
    };
  }

  private resolveBundleEntry(
    bundle: RuntimeTurnRequest["bundle"]
  ): ReturnType<RuntimeBundleRegistryService["getBundle"]> {
    const exactEntry = this.runtimeBundleRegistryService.getBundle(bundle.bundleId);
    if (exactEntry !== null && this.bundleEntryMatchesRequest(exactEntry, bundle)) {
      return exactEntry;
    }
    return this.runtimeBundleRegistryService.findBundleByAssistantVersion({
      assistantId: bundle.assistantId,
      publishedVersionId: bundle.publishedVersionId,
      bundleHash: bundle.bundleHash
    });
  }

  private applyExcludedToolNames(
    projectedTools: RuntimeNativeToolProjection,
    excludedToolNames?: ReadonlySet<string>
  ): RuntimeNativeToolProjection {
    if (excludedToolNames === undefined || excludedToolNames.size === 0) {
      return projectedTools;
    }
    return {
      ...projectedTools,
      tools: projectedTools.tools.filter((tool) => !excludedToolNames.has(tool.name))
    };
  }

  private deriveTurnKnowledgeSourcePolicy(
    routeDecision: TurnRouteDecision,
    projectedTools: RuntimeNativeToolProjection
  ): TurnKnowledgeSourcePolicy {
    const defaultSearchSources = projectedTools.knowledgeSearchSources.map(
      (source) => source.source
    );
    const defaultFetchSources = projectedTools.knowledgeFetchSources.map((source) => source.source);
    // ADR-120 Slice 5 — the Skill KB pull source is only ALLOWED when a Skill
    // is active/engaged for the turn. On every other turn it is dropped from
    // the projected source enum so the model cannot read Skill content outside
    // an active-skill context.
    if (!this.isActiveSkillRetrievalTurn(routeDecision)) {
      return {
        searchSources: defaultSearchSources.filter((source) => source !== "skill"),
        fetchSources: defaultFetchSources.filter((source) => source !== "skill")
      };
    }
    const allowedSkillTurnKnowledgeSources: PersaiRuntimeKnowledgeSource[] = [
      "skill",
      "document",
      "memory",
      "chat",
      ...(routeDecision.retrievalPlan.useProductKnowledge
        ? (["subscription", "global"] as const)
        : [])
    ];
    const allowed = new Set(allowedSkillTurnKnowledgeSources);
    return {
      searchSources: defaultSearchSources.filter((source) => allowed.has(source)),
      fetchSources: defaultFetchSources.filter((source) => allowed.has(source))
    };
  }

  private isActiveSkillRetrievalTurn(routeDecision: TurnRouteDecision): boolean {
    if (
      routeDecision.skillState?.status === "active" &&
      typeof routeDecision.skillState.activeSkillId === "string" &&
      routeDecision.skillState.activeSkillId.trim().length > 0
    ) {
      return true;
    }
    return (
      routeDecision.retrievalPlan.useSkills &&
      routeDecision.retrievalPlan.selectedSkillIds.some((skillId) => skillId.trim().length > 0)
    );
  }

  private bundleEntryMatchesRequest(
    bundleEntry: NonNullable<ReturnType<RuntimeBundleRegistryService["getBundle"]>>,
    bundle: RuntimeTurnRequest["bundle"]
  ): boolean {
    return (
      bundleEntry.bundle.bundleHash === bundle.bundleHash &&
      bundleEntry.bundle.publishedVersionId === bundle.publishedVersionId
    );
  }

  private async *streamAcceptedTurn(
    acceptedTurn: AcceptedRuntimeTurn,
    execution: PreparedTurnExecution,
    input: RuntimeTurnRequest,
    turnState: TurnExecutionState,
    signal?: AbortSignal,
    trace?: RuntimeStreamTraceCollector,
    traceEnabled = false
  ): AsyncGenerator<RuntimeTurnStreamEvent> {
    // Keep the fully assembled assistant text separate from the user-visible stream text.
    let assembledText = "";
    let deliveredText = "";
    const toolHistory: ProviderGatewayToolExchange[] = [];
    let completionFinalizationAttempted = false;
    let forceFinalTextOnly = false;
    let contextOverflowRetryAttempted = false;
    let projectSynthesisEventsEmitted = false;
    // Working notes: the text the model produced before EACH tool call across
    // the tool loop, captured per-iteration (one entry per tool_calls step).
    const toolStepTexts: string[] = [];

    yield {
      type: "started",
      requestId: acceptedTurn.receipt.requestId,
      sessionId: acceptedTurn.session.sessionId
    };
    trace?.stage("stream.started_emitted");
    const projectStreamIdentity = {
      requestId: acceptedTurn.receipt.requestId,
      sessionId: acceptedTurn.session.sessionId
    };
    const projectModeActive = isProjectChatMode(input);
    if (projectModeActive) {
      // ADR-120 Slice 5 — retrieval is pull-first; there is no pre-turn server
      // push to announce. The model gathers via the projected knowledge_search/
      // knowledge_fetch + files tools, whose own tool activity is streamed by
      // the native tool loop below.
      for (const event of createProjectModeBootstrapStreamEvents(projectStreamIdentity)) {
        yield event;
      }
    }

    const toolBudgetPolicy = this.createToolBudgetPolicy(execution);
    const maxToolLoopIterations =
      toolBudgetPolicy.loopLimit() + NATIVE_TOOL_LOOP_WRAP_UP_ITERATIONS;
    let previewFollowUpExtraIterations = 0;
    this.runtimeObservabilityService.beginStreamTurn();
    try {
      try {
        await this.sanitizeBaseRequestMultimodalForTextOnlyProvider(execution, acceptedTurn);
        for (
          let iteration = 0;
          iteration < maxToolLoopIterations + previewFollowUpExtraIterations;
          iteration += 1
        ) {
          if (projectModeActive && iteration > 0) {
            for (const projectEvent of createProjectModeReplanStreamEvents({
              identity: projectStreamIdentity,
              pass: iteration + 1
            })) {
              yield projectEvent;
            }
          }
          const iterationBaseText = assembledText;
          const pendingFilePreviewBlocks =
            await this.sanitizePreviewBlocksMultimodalForTextOnlyProvider(
              execution,
              acceptedTurn,
              turnState.pendingFilePreviewBlocks
            );
          delete turnState.pendingFilePreviewBlocks;
          let providerRequest = this.buildToolLoopProviderRequest(execution.providerRequest, {
            assistantText: iterationBaseText,
            baseDeveloperInstructionSections: execution.developerInstructionSections,
            toolHistory,
            availableToolNames: execution.projectedTools.tools.map((tool) => tool.name),
            availableWorkingFileHandles: execution.availableWorkingFileHandles,
            closedOpenLoopRefs: turnState.closedOpenLoopRefs,
            forceFinalTextOnly,
            deferredMediaJobs: turnState.deferredMediaJobs,
            deferredDocumentJobs: turnState.deferredDocumentJobs,
            ...(pendingFilePreviewBlocks === undefined ? {} : { pendingFilePreviewBlocks }),
            requestMetadata: this.createTurnProviderRequestMetadata({
              acceptedTurn,
              classification: iteration === 0 ? "main_turn" : "tool_loop_followup",
              toolLoopIteration: iteration
            })
          });
          let advancedToNextIteration = false;
          let providerOutputSeen = false;
          let streamFallbackAttempted = false;

          while (true) {
            this.logger.log(
              `[turn-stream] requestId=${acceptedTurn.receipt.requestId} iteration=${String(iteration)} classification=${providerRequest.requestMetadata?.classification ?? "unknown"} modelRole=${execution.selectedModelRole} provider=${providerRequest.provider} model=${providerRequest.model} toolCount=${String(providerRequest.tools?.length ?? 0)} toolHistoryCount=${String(providerRequest.toolHistory?.length ?? 0)}`
            );
            trace?.stage(`iter${String(iteration)}.provider_request_ready`);

            let providerStream: AsyncGenerator<ProviderGatewayTextStreamEvent>;
            try {
              providerStream = await this.providerGatewayClientService.streamText(
                providerRequest,
                this.buildProviderGatewayStreamOptions(signal, traceEnabled)
              );
            } catch (error) {
              const fallbackSelection = resolveRuntimeTextFallbackSelection(execution.bundle);
              if (
                !streamFallbackAttempted &&
                !providerOutputSeen &&
                isRetryableRuntimeTextFailure(error) &&
                fallbackSelection !== null &&
                !sameProviderSelection(
                  { provider: providerRequest.provider, model: providerRequest.model },
                  fallbackSelection
                )
              ) {
                streamFallbackAttempted = true;
                this.logger.warn(
                  `[runtime-text-fallback-primary-failed] surface=turn_stream requestId=${acceptedTurn.receipt.requestId} classification=${providerRequest.requestMetadata?.classification ?? "unknown"} attempt=tool_loop:${String(iteration)} role=${execution.selectedModelRole} provider=${providerRequest.provider} model=${providerRequest.model} fallbackProvider=${fallbackSelection.provider} fallbackModel=${fallbackSelection.model} error=${
                    error instanceof Error ? error.message : String(error)
                  }`
                );
                providerRequest = {
                  ...providerRequest,
                  provider: fallbackSelection.provider,
                  model: fallbackSelection.model
                };
                this.logger.log(
                  `[runtime-text-fallback-rerouted] surface=turn_stream requestId=${acceptedTurn.receipt.requestId} classification=${providerRequest.requestMetadata?.classification ?? "unknown"} attempt=tool_loop:${String(iteration)} role=${execution.selectedModelRole} provider=${providerRequest.provider} model=${providerRequest.model}`
                );
                continue;
              }
              throw error;
            }
            trace?.stage(`iter${String(iteration)}.provider_headers_received`);

            let restartProviderAttempt = false;
            for await (const event of providerStream) {
              if (signal?.aborted) {
                await this.interruptAcceptedTurnQuietly({
                  acceptedTurn,
                  event: this.toInterruptedEvent(
                    acceptedTurn,
                    deliveredText,
                    null,
                    trace?.build("interrupted"),
                    turnState
                  )
                });
                return;
              }

              if (event.type === "keepalive") {
                continue;
              }

              if (event.type === "text_delta" && event.delta !== undefined) {
                providerOutputSeen = true;
                assembledText = this.mergeAssistantTurnText(
                  iterationBaseText,
                  event.accumulatedText
                );
                if (deliveredText.length === 0) {
                  trace?.stage("stream.first_text_delta");
                }
                const deltaEvent = this.createVisibleTextDeltaStreamEvent({
                  acceptedTurn,
                  previousDeliveredText: deliveredText,
                  nextVisibleText: assembledText,
                  source: "provider_text_delta"
                });
                if (deltaEvent !== null) {
                  if (projectModeActive && !projectSynthesisEventsEmitted) {
                    projectSynthesisEventsEmitted = true;
                    for (const projectEvent of createProjectModeSynthesisStreamEvents(
                      projectStreamIdentity
                    )) {
                      yield projectEvent;
                    }
                  }
                  deliveredText = deltaEvent.accumulatedText;
                  yield deltaEvent;
                }
                continue;
              }

              if (event.type === "tool_calls") {
                providerOutputSeen = true;
                trace?.stage(`iter${String(iteration)}.tool_calls_received`);
                // Working note for THIS step: the text the provider generated in
                // this iteration before its tool call. Sourced per-iteration from
                // `event.result.text` (never the cumulative `assembledText`), so a
                // later step's note never re-contains an earlier note. Captured on
                // every iteration, not just iteration 0. Not retroactively
                // corrected by applyAssistantTextCorrections.
                const stepNote = (event.result.text ?? "").trim();
                if (stepNote.length > 0) {
                  toolStepTexts.push(stepNote);
                }
                this.recordUsageEntry(turnState, {
                  stepType: iteration === 0 ? "main_turn" : "tool_loop_followup",
                  modelRole: execution.selectedModelRole,
                  usage: event.result.usage
                });
                assembledText = this.resolveCompletedStreamAssistantText(
                  iterationBaseText,
                  assembledText,
                  event.result.text
                );
                forceFinalTextOnly = false;
                if (event.result.toolCalls.length === 0) {
                  throw new TurnExecutionError(
                    "native_tool_result_invalid",
                    new ServiceUnavailableException(
                      "Provider stream returned a tool-call stop without any tool calls."
                    )
                  );
                }

                const bufferedPrefixEvent = this.createVisibleTextDeltaStreamEvent({
                  acceptedTurn,
                  previousDeliveredText: deliveredText,
                  nextVisibleText: assembledText,
                  source: "provider_tool_calls_result_text"
                });
                if (bufferedPrefixEvent !== null) {
                  deliveredText = bufferedPrefixEvent.accumulatedText;
                  yield bufferedPrefixEvent;
                }

                let durableCompactionExecuted = false;
                let volatileRefreshNeeded = false;
                const plannedToolExecutions = this.planToolExecutions(
                  this.reorderToolCallsDocumentFirst(event.result.toolCalls),
                  toolBudgetPolicy,
                  iteration
                );
                for (
                  let batchStart = 0;
                  batchStart < plannedToolExecutions.length;
                  batchStart = this.findToolExecutionChunkEnd(plannedToolExecutions, batchStart)
                ) {
                  const batch = plannedToolExecutions.slice(
                    batchStart,
                    this.findToolExecutionChunkEnd(plannedToolExecutions, batchStart)
                  );
                  if (batch[0]?.parallelSafe) {
                    for (const entry of batch) {
                      yield this.createToolStartedStreamEvent(acceptedTurn, entry.toolCall);
                    }
                    const batchResults = await this.executeParallelToolChunk({
                      plannedToolExecutions: batch,
                      execution,
                      acceptedTurn,
                      input,
                      turnState,
                      availableWorkingFileHandles: execution.availableWorkingFileHandles,
                      trace,
                      iteration
                    });
                    let firstError: unknown = null;
                    for (const result of batchResults) {
                      if (result.outcome !== undefined) {
                        this.maybeRefundToolRequestRejectionReservation(
                          toolBudgetPolicy,
                          batch.find((entry) => entry.toolCall.id === result.toolCall.id) ?? null,
                          result.outcome
                        );
                        result.outcome.exchange.reasoningContent =
                          event.result.reasoningContent ?? null;
                        toolHistory.push(result.outcome.exchange);
                        this.applyToolExecutionOutcome(turnState, result.outcome, iteration);
                        this.maybeApplySkillStateMutationFromTool(execution, result.outcome);
                        if (this.toolMutatesVolatilePrefix(result.outcome.exchange.toolCall.name)) {
                          volatileRefreshNeeded = true;
                        }
                        durableCompactionExecuted =
                          durableCompactionExecuted ||
                          result.outcome.sharedCompaction?.durableStatePersisted === true;
                        yield this.createToolFinishedStreamEvent(
                          acceptedTurn,
                          result.toolCall,
                          result.outcome.exchange.toolResult.isError
                        );
                        if (result.outcome.artifacts !== undefined) {
                          for (const artifact of result.outcome.artifacts) {
                            yield this.createArtifactStreamEvent(acceptedTurn, artifact);
                          }
                        }
                        continue;
                      }
                      firstError ??= result.error;
                      yield this.createToolFinishedStreamEvent(acceptedTurn, result.toolCall, true);
                    }
                    if (firstError !== null) {
                      throw firstError;
                    }
                    continue;
                  }
                  for (const entry of batch) {
                    const toolCall = entry.toolCall;
                    yield this.createToolStartedStreamEvent(acceptedTurn, toolCall);
                    let outcome: ToolExecutionOutcome;
                    if (entry.reservation.exhausted) {
                      outcome = this.createToolBudgetExhaustedOutcome({
                        toolCall,
                        reservation: entry.reservation,
                        trace,
                        iteration,
                        acceptedTurn
                      });
                    } else {
                      try {
                        outcome = await this.executeProjectedToolCall(
                          execution,
                          acceptedTurn,
                          input,
                          toolCall,
                          input.idempotencyKey,
                          turnState.artifacts,
                          turnState.fileHandles,
                          execution.availableWorkingFileHandles
                        );
                      } catch (error) {
                        yield this.createToolFinishedStreamEvent(acceptedTurn, toolCall, true);
                        throw error;
                      }
                    }
                    this.maybeRefundToolRequestRejectionReservation(
                      toolBudgetPolicy,
                      entry,
                      outcome
                    );
                    outcome.exchange.reasoningContent = event.result.reasoningContent ?? null;
                    toolHistory.push(outcome.exchange);
                    this.applyToolExecutionOutcome(turnState, outcome, iteration);
                    this.maybeApplySkillStateMutationFromTool(execution, outcome);
                    if (this.toolMutatesVolatilePrefix(outcome.exchange.toolCall.name)) {
                      volatileRefreshNeeded = true;
                    }
                    durableCompactionExecuted =
                      durableCompactionExecuted ||
                      outcome.sharedCompaction?.durableStatePersisted === true;
                    yield this.createToolFinishedStreamEvent(
                      acceptedTurn,
                      toolCall,
                      outcome.exchange.toolResult.isError
                    );
                    if (outcome.artifacts !== undefined) {
                      for (const artifact of outcome.artifacts) {
                        yield this.createArtifactStreamEvent(acceptedTurn, artifact);
                      }
                    }
                  }
                }
                if (durableCompactionExecuted) {
                  const refreshStartedAtMs = Date.now();
                  execution.providerRequest = await this.refreshProviderRequestMessages(
                    execution,
                    input
                  );
                  // After a full refresh the volatile prefix was dropped — re-prepend it
                  // so the next iteration still carries the scenario block, chat plan,
                  // and `<system-reminder>` blocks with up-to-date state.
                  execution.volatilePrefixLength = 0;
                  await this.refreshVolatilePrefix(
                    execution,
                    input,
                    toolBudgetPolicy.getSnapshot()
                  );
                  const refreshElapsedMs = Date.now() - refreshStartedAtMs;
                  trace?.stage(`iter${String(iteration)}.provider_request_refreshed`);
                  if (traceEnabled) {
                    this.logger.log(
                      `[turn-stream-refresh] requestId=${acceptedTurn.receipt.requestId} iteration=${String(iteration)} refreshProviderRequestMessagesMs=${String(refreshElapsedMs)} reason=durable_compaction`
                    );
                  }
                } else if (volatileRefreshNeeded) {
                  await this.refreshVolatilePrefix(
                    execution,
                    input,
                    toolBudgetPolicy.getSnapshot()
                  );
                  trace?.stage(`iter${String(iteration)}.volatile_prefix_refreshed`);
                }

                previewFollowUpExtraIterations = this.reservePreviewFollowUpIterationIfNeeded({
                  turnState,
                  iteration,
                  maxToolLoopIterations,
                  previewFollowUpExtraIterations
                });

                advancedToNextIteration = true;
                break;
              }

              if (event.type === "completed" && event.result !== undefined) {
                providerOutputSeen = true;
                trace?.stage(`iter${String(iteration)}.completed_event`);
                const completedProviderResult = this.withAssistantText(
                  event.result,
                  this.resolveCompletedStreamAssistantText(
                    iterationBaseText,
                    assembledText,
                    event.result.text
                  )
                );
                if (
                  (completedProviderResult.text ?? "").trim().length === 0 &&
                  toolHistory.length > 0 &&
                  iteration + 1 < maxToolLoopIterations
                ) {
                  forceFinalTextOnly = true;
                  advancedToNextIteration = true;
                  trace?.stage(`iter${String(iteration)}.empty_tool_followup_retry`);
                  break;
                }
                const correctedAssistantText = this.applyAssistantTextCorrections({
                  assistantText: completedProviderResult.text ?? "",
                  artifacts: turnState.artifacts,
                  deferredMediaJobs: turnState.deferredMediaJobs,
                  deferredDocumentJobs: turnState.deferredDocumentJobs,
                  locale: input.message.locale ?? execution.bundle.userContext.locale ?? null
                });
                if (correctedAssistantText !== (completedProviderResult.text ?? "")) {
                  const correctionDeltaEvent = this.createVisibleTextDeltaStreamEvent({
                    acceptedTurn,
                    previousDeliveredText: deliveredText,
                    nextVisibleText: correctedAssistantText,
                    source: "provider_tool_calls_result_text"
                  });
                  if (correctionDeltaEvent !== null) {
                    deliveredText = correctionDeltaEvent.accumulatedText;
                    yield correctionDeltaEvent;
                  }
                }
                let correctedProviderResult = this.withAssistantText(
                  completedProviderResult,
                  correctedAssistantText
                );
                this.recordUsageEntry(turnState, {
                  stepType: iteration === 0 ? "main_turn" : "tool_loop_followup",
                  modelRole: execution.selectedModelRole,
                  usage: correctedProviderResult.usage
                });
                // Answer-only text = corrections applied to the FINAL iteration's
                // own provider text (`event.result.text`), never the cumulative
                // corrected text. The cumulative text already contains every
                // working note; deriving the answer from it would duplicate the
                // notes into the answer. Corrections here are
                // identity-or-full-replacement (deferred-media/document
                // acknowledgement), so they produce the same final answer whether
                // applied to the final-iteration text or the cumulative text.
                const correctedFinalAnswerText = this.applyAssistantTextCorrections({
                  assistantText: event.result.text ?? "",
                  artifacts: turnState.artifacts,
                  deferredMediaJobs: turnState.deferredMediaJobs,
                  deferredDocumentJobs: turnState.deferredDocumentJobs,
                  locale: input.message.locale ?? execution.bundle.userContext.locale ?? null
                });
                correctedProviderResult = await this.runPostFinalChatPlanSelfCheck({
                  acceptedTurn,
                  execution,
                  input,
                  turnState,
                  providerResult: correctedProviderResult
                });
                const selfCheckedAssistantText = correctedProviderResult.text ?? "";
                if (selfCheckedAssistantText !== correctedAssistantText) {
                  const selfCheckDeltaEvent = this.createVisibleTextDeltaStreamEvent({
                    acceptedTurn,
                    previousDeliveredText: deliveredText,
                    nextVisibleText: selfCheckedAssistantText,
                    source: "provider_tool_calls_result_text"
                  });
                  if (selfCheckDeltaEvent !== null) {
                    deliveredText = selfCheckDeltaEvent.accumulatedText;
                    yield selfCheckDeltaEvent;
                  }
                }
                const finalAnswerText =
                  selfCheckedAssistantText === correctedAssistantText
                    ? correctedFinalAnswerText
                    : selfCheckedAssistantText;
                const { workingNotes, answerText } = assembleWorkingNotesAndAnswer({
                  toolStepTexts,
                  finalAnswerText,
                  fullAssistantText: selfCheckedAssistantText
                });
                const result = this.buildTurnResult(
                  acceptedTurn,
                  correctedProviderResult,
                  turnState,
                  execution.routeDecision,
                  trace?.build("ok"),
                  { workingNotes, answerText }
                );
                completionFinalizationAttempted = true;
                const finalizedResult = await this.finalizeAcceptedTurnWithPostTurnEffects({
                  acceptedTurn,
                  result,
                  input,
                  bundle: execution.bundle,
                  turnState
                });
                yield {
                  type: "completed",
                  result: finalizedResult
                };
                return;
              }

              if (event.type === "failed") {
                trace?.stage(`iter${String(iteration)}.failed_event`);
                if (
                  !providerOutputSeen &&
                  !streamFallbackAttempted &&
                  isRetryableRuntimeTextStreamFailure(event)
                ) {
                  const fallbackSelection = resolveRuntimeTextFallbackSelection(execution.bundle);
                  if (
                    fallbackSelection !== null &&
                    !sameProviderSelection(
                      { provider: providerRequest.provider, model: providerRequest.model },
                      fallbackSelection
                    )
                  ) {
                    streamFallbackAttempted = true;
                    this.logger.warn(
                      `[runtime-text-fallback-primary-failed] surface=turn_stream requestId=${acceptedTurn.receipt.requestId} classification=${providerRequest.requestMetadata?.classification ?? "unknown"} attempt=tool_loop:${String(iteration)} role=${execution.selectedModelRole} provider=${providerRequest.provider} model=${providerRequest.model} fallbackProvider=${fallbackSelection.provider} fallbackModel=${fallbackSelection.model} errorCode=${event.code ?? "unknown"} errorMessage=${event.message ?? "Provider stream failed."}`
                    );
                    providerRequest = {
                      ...providerRequest,
                      provider: fallbackSelection.provider,
                      model: fallbackSelection.model
                    };
                    this.logger.log(
                      `[runtime-text-fallback-rerouted] surface=turn_stream requestId=${acceptedTurn.receipt.requestId} classification=${providerRequest.requestMetadata?.classification ?? "unknown"} attempt=tool_loop:${String(iteration)} role=${execution.selectedModelRole} provider=${providerRequest.provider} model=${providerRequest.model}`
                    );
                    restartProviderAttempt = true;
                    break;
                  }
                }
                if (
                  event.code === "provider_context_window_exceeded" &&
                  !contextOverflowRetryAttempted &&
                  deliveredText.trim().length === 0 &&
                  iteration + 1 < maxToolLoopIterations + previewFollowUpExtraIterations
                ) {
                  contextOverflowRetryAttempted = true;
                  this.restorePendingFilePreviewBlocksAfterOverflow(
                    turnState,
                    pendingFilePreviewBlocks
                  );
                  toolHistory.splice(0, toolHistory.length);
                  forceFinalTextOnly = true;
                  execution.providerRequest = this.buildContextOverflowRecoveryProviderRequest(
                    execution.providerRequest
                  );
                  advancedToNextIteration = true;
                  trace?.stage(`iter${String(iteration)}.context_overflow_retry`);
                  break;
                }
                if (deliveredText.trim().length > 0) {
                  const interrupted = this.toInterruptedEvent(
                    acceptedTurn,
                    deliveredText,
                    null,
                    trace?.build("interrupted"),
                    turnState
                  );
                  await this.interruptAcceptedTurnQuietly({
                    acceptedTurn,
                    event: interrupted
                  });
                  yield interrupted;
                  return;
                }

                const failed = await this.failAcceptedTurnQuietly(
                  acceptedTurn,
                  {
                    type: "failed",
                    requestId: acceptedTurn.receipt.requestId,
                    sessionId: acceptedTurn.session.sessionId,
                    code: event.code ?? "provider_stream_failed",
                    message: event.message ?? "Provider stream failed.",
                    willRetry: false,
                    ...(trace === undefined ? {} : { trace: trace.build("failed") })
                  },
                  undefined,
                  turnState
                );
                yield failed;
                return;
              }
            }

            if (!restartProviderAttempt) {
              break;
            }
          }

          if (advancedToNextIteration) {
            continue;
          }

          if (deliveredText.trim().length > 0) {
            const interrupted = this.toInterruptedEvent(
              acceptedTurn,
              deliveredText,
              null,
              trace?.build("interrupted"),
              turnState
            );
            await this.interruptAcceptedTurnQuietly({
              acceptedTurn,
              event: interrupted
            });
            yield interrupted;
            return;
          }

          const failed = await this.failAcceptedTurnQuietly(
            acceptedTurn,
            {
              type: "failed",
              requestId: acceptedTurn.receipt.requestId,
              sessionId: acceptedTurn.session.sessionId,
              code: "provider_stream_ended",
              message: "Provider stream ended before native turn completion.",
              willRetry: false,
              ...(trace === undefined ? {} : { trace: trace.build("failed") })
            },
            undefined,
            turnState
          );
          yield failed;
          return;
        }

        const exhausted = await this.failAcceptedTurnQuietly(
          acceptedTurn,
          {
            type: "failed",
            requestId: acceptedTurn.receipt.requestId,
            sessionId: acceptedTurn.session.sessionId,
            code: "native_tool_loop_exhausted",
            message: `Native tool loop exceeded ${String(maxToolLoopIterations)} iterations (mode=${toolBudgetPolicy.executionModeName()}, loopLimit=${String(toolBudgetPolicy.loopLimit())}, wrapUp=${String(NATIVE_TOOL_LOOP_WRAP_UP_ITERATIONS)}).`,
            willRetry: false,
            ...(trace === undefined ? {} : { trace: trace.build("failed") })
          },
          undefined,
          turnState
        );
        yield exhausted;
      } catch (error) {
        if (completionFinalizationAttempted) {
          throw this.toHttpException(error);
        }

        const errorDetail = this.formatLogError(error);
        const requestId = acceptedTurn.receipt.requestId;
        const providerLabel = `${execution.providerRequest.provider}:${execution.providerRequest.model}`;

        if (signal?.aborted || this.isAbortError(error)) {
          this.logger.warn(
            `[turn-stream-aborted] requestId=${requestId} provider=${providerLabel} deliveredTextLen=${String(deliveredText.length)} error=${errorDetail}`
          );
          await this.interruptAcceptedTurnQuietly({
            acceptedTurn,
            event: this.toInterruptedEvent(
              acceptedTurn,
              deliveredText,
              null,
              trace?.build("interrupted"),
              turnState
            )
          });
          return;
        }

        if (deliveredText.trim().length > 0) {
          this.logger.warn(
            `[turn-stream-interrupted-with-text] requestId=${requestId} provider=${providerLabel} deliveredTextLen=${String(deliveredText.length)} toolHistoryLen=${String(toolHistory.length)} error=${errorDetail}`
          );
          const interrupted = this.toInterruptedEvent(
            acceptedTurn,
            deliveredText,
            null,
            trace?.build("interrupted"),
            turnState
          );
          await this.interruptAcceptedTurnQuietly({
            acceptedTurn,
            event: interrupted
          });
          yield interrupted;
          return;
        }

        this.logger.warn(
          `[turn-stream-failed-empty] requestId=${requestId} provider=${providerLabel} toolHistoryLen=${String(toolHistory.length)} error=${errorDetail}`
        );
        const failed = await this.failAcceptedTurnQuietly(
          acceptedTurn,
          error,
          trace?.build("failed"),
          turnState
        );
        yield failed;
      }
    } finally {
      this.runtimeObservabilityService.endStreamTurn();
    }
  }

  private async replayStreamResult(
    receipt: RuntimeTurnReceiptSummary
  ): Promise<AsyncGenerator<RuntimeTurnStreamEvent>> {
    const result = this.resolveReplayResult(receipt);
    return (async function* (): AsyncGenerator<RuntimeTurnStreamEvent> {
      yield {
        type: "completed",
        result
      };
    })();
  }

  private classifyInteractiveExecutionClass(
    input: RuntimeTurnRequest,
    execution: PreparedTurnExecution
  ) {
    return classifyInteractiveExecutionClass({
      selectedModelRole: execution.selectedModelRole,
      deepModeEnabled: execution.deepModeEnabled,
      attachmentCount: input.message.attachments.length,
      openMediaJobCount: input.openMediaJobs?.length ?? 0,
      visibleToolPolicies: execution.bundle.governance.toolPolicies.filter(
        (policy) => policy.enabled === true && policy.visibleToModel === true
      )
    });
  }

  private createRuntimeStreamTraceCollector(): RuntimeStreamTraceCollector {
    const startedAtMs = Date.now();
    const points: Array<{ key: string; atMs: number }> = [{ key: "start", atMs: startedAtMs }];
    return {
      stage: (key: string) => {
        points.push({ key, atMs: Date.now() });
      },
      build: (status: RuntimeTrace["status"]) => {
        const finishedAtMs = Date.now();
        const finalizedPoints = [...points, { key: "finish", atMs: finishedAtMs }];
        const stages: RuntimeTrace["stages"] = [];
        for (let index = 1; index < finalizedPoints.length; index += 1) {
          const previous = finalizedPoints[index - 1];
          const point = finalizedPoints[index];
          if (previous === undefined || point === undefined) {
            continue;
          }
          stages.push({
            key: `${previous.key} -> ${point.key}`,
            durationMs: Math.max(0, point.atMs - previous.atMs)
          });
        }
        return {
          scope: "stream_turn",
          status,
          totalMs: Math.max(0, finishedAtMs - startedAtMs),
          stages
        };
      }
    };
  }

  private buildTurnResult(
    acceptedTurn: AcceptedRuntimeTurn,
    providerResult: ProviderGatewayTextGenerateResult,
    turnState: TurnExecutionState,
    routeDecision?: TurnRouteDecision,
    trace?: RuntimeTrace,
    workingNotesAndAnswer?: { workingNotes: readonly string[]; answerText: string }
  ): RuntimeTurnResult {
    if (providerResult.stopReason !== "completed") {
      throw new InternalServerErrorException(
        `Turn "${acceptedTurn.receipt.requestId}" did not finish with a completed text result.`
      );
    }
    // ADR-074 F2: provider may legitimately return text === null (model chose
    // silence per our proactive prompts; was previously cascading into 500s
    // from OpenAI/Anthropic clients before they were taught to accept empty
    // completions). We materialise an empty assistant turn here — upstream
    // chat surfaces will simply not render a bubble for "" — and emit a
    // single warn so we can still spot pathological patterns.
    if (providerResult.text === null) {
      this.logger.warn(
        `Turn "${acceptedTurn.receipt.requestId}" finished as empty completion (provider=${providerResult.provider} model=${providerResult.model}); rendering as empty assistant turn.`
      );
    }

    // `providerResult.text` is the final corrected FULL text (every working
    // note once + the answer). Use it directly as the backward-compat
    // `assistantText`. `workingNotes` and `answerText` are pre-assembled by the
    // streaming caller (per-step notes + the final-iteration answer only); when
    // absent (non-stream / Telegram path) there are no tool-loop notes and the
    // answer equals the full text.
    const assistantText = providerResult.text ?? "";
    const workingNotes = workingNotesAndAnswer ? [...workingNotesAndAnswer.workingNotes] : [];
    const answerText = workingNotesAndAnswer ? workingNotesAndAnswer.answerText : assistantText;

    const turnRouting =
      routeDecision === undefined ? null : this.toRuntimeTurnRoutingSnapshot(routeDecision);
    const result: RuntimeTurnResult = {
      requestId: acceptedTurn.receipt.requestId,
      sessionId: acceptedTurn.session.sessionId,
      assistantText,
      workingNotes,
      answerText,
      artifacts: [...turnState.artifacts],
      respondedAt: providerResult.respondedAt,
      usage: providerResult.usage,
      ...(trace === undefined ? {} : { trace }),
      ...(turnRouting === null ? {} : { turnRouting }),
      ...(turnState.usageEntries.length === 0
        ? {}
        : { usageAccounting: this.buildUsageAccounting(turnState.usageEntries) }),
      ...(turnState.toolInvocations.length === 0
        ? {}
        : { toolInvocations: [...turnState.toolInvocations] }),
      ...(turnState.deferredMediaJobs.length === 0
        ? {}
        : { deferredMediaJobs: [...turnState.deferredMediaJobs] }),
      ...(turnState.deferredDocumentJobs.length === 0
        ? {}
        : { deferredDocumentJobs: [...turnState.deferredDocumentJobs] }),
      ...(turnState.discoveredFilePathSet.length === 0
        ? {}
        : { discoveredFilePaths: [...turnState.discoveredFilePathSet] }),
      ...(providerResult.truncated === true ? { truncated: true } : {})
    };
    if (trace !== undefined) {
      this.runtimeObservabilityService.recordStreamTurn(trace);
    }
    return result;
  }

  private toRuntimeTurnRoutingSnapshot(
    routeDecision: TurnRouteDecision
  ): RuntimeTurnRoutingSnapshot | null {
    const source =
      routeDecision.source === "llm"
        ? "llm"
        : routeDecision.source === "precheck"
          ? "precheck"
          : routeDecision.source === "fallback"
            ? "fallback"
            : null;
    if (source === null) {
      return null;
    }
    return {
      mode: routeDecision.mode,
      executionMode: routeDecision.executionMode,
      level: routeDecision.level,
      thinkingBudget: routeDecision.thinkingBudget,
      source,
      retrievalPlan: routeDecision.retrievalPlan,
      skillState: routeDecision.skillState
    };
  }

  private async finalizeAcceptedTurnWithPostTurnEffects(input: {
    acceptedTurn: AcceptedRuntimeTurn;
    result: RuntimeTurnResult;
    input: RuntimeTurnRequest;
    bundle: AssistantRuntimeBundle;
    turnState: TurnExecutionState;
  }): Promise<RuntimeTurnResult> {
    const finalizedTurn = await this.turnFinalizationService.completeAcceptedTurn(
      input.acceptedTurn,
      input.result
    );
    // ADR-074 Slice M2 — auto-compaction is off-band, but we only enqueue it
    // after the user turn is durably finalized and its lease is released.
    // This keeps the background pass from competing with the just-finished
    // foreground turn and lets the scheduler read the latest token counters.
    this.fireBackgroundCompactionEnqueue(
      input.input,
      input.bundle,
      input.turnState,
      finalizedTurn.session
    );
    return input.result;
  }

  private fireBackgroundCompactionEnqueue(
    input: RuntimeTurnRequest,
    bundle: AssistantRuntimeBundle,
    turnState: TurnExecutionState,
    finalizedSession: AcceptedRuntimeTurn["session"]
  ): void {
    if (turnState.sharedCompaction.durableStatePersisted) {
      return;
    }
    const channel = input.conversation.channel;
    const contextHydration = resolveRuntimeContextHydrationConfig(bundle);
    const enabled =
      channel === "telegram"
        ? contextHydration.autoCompactionTelegram
        : channel === "web"
          ? contextHydration.autoCompactionWeb
          : false;
    if (!enabled) {
      return;
    }
    const tokenThreshold = Math.max(1, contextHydration.compactionTriggerThreshold);
    const freshCurrentTokens =
      finalizedSession.totalTokensFresh === true ? finalizedSession.currentTokens : null;
    if (freshCurrentTokens === null || freshCurrentTokens < tokenThreshold) {
      return;
    }
    void this.persaiInternalApiClientService
      .enqueueBackgroundCompaction({
        assistantId: input.conversation.assistantId,
        workspaceId: input.conversation.workspaceId,
        channel,
        externalThreadKey: input.conversation.externalThreadKey,
        externalUserKey: input.conversation.externalUserKey,
        runtimeTier: input.runtimeTier,
        trigger: "post_turn",
        enqueuedRequestId: input.requestId
      })
      .catch((error) => {
        this.logger.warn(
          `[bg-compaction] Fire-and-forget enqueue rejected for ${channel}:${input.conversation.externalThreadKey}: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      });
  }

  private resolveReplayResult(receipt: RuntimeTurnReceiptSummary): RuntimeTurnResult {
    switch (receipt.status) {
      case "completed":
        if (this.isRuntimeTurnResult(receipt.resultPayload)) {
          return receipt.resultPayload;
        }
        throw new InternalServerErrorException(
          `Completed turn "${receipt.requestId}" is missing a valid persisted result payload.`
        );
      case "failed":
        throw new ConflictException(
          `Turn "${receipt.requestId}" already failed for this idempotency key.`
        );
      case "interrupted":
        throw new ConflictException(
          `Turn "${receipt.requestId}" was interrupted for this idempotency key.`
        );
      default:
        throw new ConflictException(
          `Turn "${receipt.requestId}" is already accepted and still processing.`
        );
    }
  }

  private buildProviderRequest(
    bundle: AssistantRuntimeBundle,
    providerSelection: ProviderSelection,
    messages: ProviderGatewayTextMessage[],
    projectedTools: RuntimeNativeToolProjection,
    deepModeEnabled: boolean,
    developerInstructionSections: DeveloperInstructionSection[],
    promptMode: "chat" | "background_worker",
    thinkingBudget: number = 0,
    promptCacheRetention: ProviderGatewayPromptCacheRetention = OPENAI_PROMPT_CACHE_RETENTION_FALLBACK
  ): ProviderGatewayTextGenerateRequest {
    const promptCache = this.buildPromptCacheConfig({
      bundle,
      provider: providerSelection.provider,
      family:
        promptMode === "background_worker"
          ? "background_worker"
          : deepModeEnabled
            ? "deep_chat"
            : "ordinary_chat",
      promptCacheRetention,
      messages,
      deepModeEnabled,
      projectedTools
    });
    const developerInstructions = this.renderDeveloperInstructionSections(
      developerInstructionSections
    );
    // ADR-119: pass skillsEnabled so providers can apply parallel-tool-calls discipline.
    // Per-zone multi-block system cache markers are intentionally not used — see ADR-119 footer
    // for reasoning. Providers place a single cache marker on the whole system prompt.
    const skillsEnabled = (bundle.skills?.enabled.length ?? 0) > 0;
    return {
      provider: providerSelection.provider,
      model: providerSelection.model,
      systemPrompt: this.buildSystemPrompt(bundle, promptMode),
      ...(developerInstructions === null ? {} : { developerInstructions }),
      messages,
      ...(promptCache === undefined ? {} : { promptCache }),
      ...(projectedTools.tools.length === 0
        ? {}
        : {
            tools: projectedTools.tools,
            toolChoice: "auto" as const
          }),
      skillsEnabled,
      ...(thinkingBudget > 0 ? { thinkingBudget } : {})
    };
  }

  private buildSystemPrompt(
    bundle: AssistantRuntimeBundle,
    promptMode: "chat" | "background_worker"
  ): string | null {
    if (promptMode === "background_worker") {
      return [
        "You are a non-conversational PersAI background worker.",
        "Focus on tool use, evidence gathering, structured reasoning, and concise task results.",
        "Do not add chat-style greetings, relationship framing, or assistant-persona flourishes unless the explicit task output requires them."
      ].join(" ");
    }
    // ADR-074 P1: `systemPrompt` is the cached stable prefix only. Per-turn variability (routing
    // guidance, presence) is moved to `developerInstructions` so provider prompt caching stays
    // hot across turns for the same assistant + bundle.
    return this.normalizeOptionalText(bundle.promptConstructor.ordinary.systemPrompt);
  }

  private buildBaseDeveloperInstructionSections(input: {
    request?: RuntimeTurnRequest;
    projectedTools: RuntimeNativeToolProjection | undefined;
    availableWorkingFileHandles: RuntimeFileHandle[];
    deepModeEnabled: boolean;
    routeDecision: TurnRouteDecision | undefined;
    openLoopRefsBlock: string | null;
    presenceBlock: string | null;
    openMediaJobs: RuntimeTurnRequest["openMediaJobs"];
    openDocumentJobs: RuntimeTurnRequest["openDocumentJobs"];
    jobDeliveryUpdates: RuntimeTurnRequest["jobDeliveryUpdates"];
  }): DeveloperInstructionSection[] {
    const routingGuidance = this.buildTurnRoutingPrompt(
      input.projectedTools,
      input.routeDecision,
      input.deepModeEnabled
    );
    const workingFilesSection = this.buildWorkingFilesDeveloperSection(
      input.availableWorkingFileHandles
    );
    const openLoopRefsSection = this.normalizeOptionalText(input.openLoopRefsBlock);
    const openMediaJobsSection = this.buildOpenMediaJobsDeveloperSection(input.openMediaJobs);
    const openDocumentJobsSection = this.buildOpenDocumentJobsDeveloperSection(
      input.openDocumentJobs
    );
    const jobDeliveryUpdatesSection = this.buildJobDeliveryUpdatesDeveloperSection(
      input.jobDeliveryUpdates
    );
    // ADR-112 Slice 8: `promptDocuments.backgroundTaskEvaluation`
    // (legacy alias: `heartbeat`) is reserved for background-task evaluation.
    // It must never be appended to a normal user-visible chat turn; otherwise
    // the main assistant may return service decisions like `no_push` as chat text.
    const presenceSection = this.normalizeOptionalText(input.presenceBlock);
    const projectExecutionSection =
      input.request !== undefined && isProjectChatMode(input.request)
        ? PROJECT_EXECUTION_DEVELOPER_CONTRACT
        : null;
    const channelContextSection = this.buildChannelContextDeveloperSection(input.request);
    return this.createDeveloperInstructionSections([
      { key: "project_execution_contract", content: projectExecutionSection },
      { key: "visible_working_notes", content: VISIBLE_WORKING_NOTES_DEVELOPER_CONTRACT },
      { key: "channel_context", content: channelContextSection },
      { key: "routing_hints", content: routingGuidance },
      { key: "open_loop_refs", content: openLoopRefsSection },
      { key: "working_files", content: workingFilesSection },
      { key: "open_media_jobs", content: openMediaJobsSection },
      { key: "open_document_jobs", content: openDocumentJobsSection },
      { key: "job_delivery_updates", content: jobDeliveryUpdatesSection },
      { key: "presence", content: presenceSection },
      { key: "delivery_contract", content: DELIVERY_HONESTY_CONTRACT }
    ]);
  }

  private buildChannelContextDeveloperSection(
    request: RuntimeTurnRequest | undefined
  ): string | null {
    if (request?.conversation.channel !== "telegram") {
      return null;
    }
    const telegram = request.channelContext?.telegram;

    const lines = ["## Channel Context", "Channel: Telegram messenger."];
    if (telegram !== undefined) {
      const chatTitle =
        this.normalizeOptionalText(telegram.chat.title) ?? `Telegram chat ${telegram.chat.id}`;
      const senderName =
        this.normalizeOptionalText(telegram.sender.displayName) ??
        this.normalizeOptionalText(telegram.sender.username) ??
        (telegram.sender.telegramUserId === null
          ? "Unknown Telegram user"
          : `Telegram user ${telegram.sender.telegramUserId}`);
      const username = this.normalizeOptionalText(telegram.sender.username);
      const sender = username === null ? senderName : `${senderName} (@${username})`;
      lines.push(`Chat: ${chatTitle}`, `Sender: ${sender}`);
    }

    if (this.isTelegramVoiceLikeTurn(request)) {
      lines.push(
        "The user used voice/audio here; when TTS is available and a voice reply fits, prefer a concise voice reply."
      );
    }
    if (request.conversation.mode === "group") {
      lines.push(
        "This is a group conversation, not a private DM.",
        "Reply with awareness that multiple people may read the answer.",
        "Do not reveal private owner context to other group participants."
      );
    }
    return lines.join("\n");
  }

  private isTelegramVoiceLikeTurn(request: RuntimeTurnRequest): boolean {
    return request.message.attachments.some(
      (attachment) =>
        attachment.kind === "audio" || attachment.mimeType.toLowerCase().startsWith("audio/")
    );
  }

  private buildWorkingFilesDeveloperSection(
    availableWorkingFileHandles: RuntimeFileHandle[]
  ): string | null {
    const modelVisibleWorkingFiles = this.limitModelVisibleWorkingFiles(
      availableWorkingFileHandles
    );
    if (modelVisibleWorkingFiles.length === 0) {
      return null;
    }

    const lines = ["## Working Files"];
    const documentPriorityNote = this.buildWorkingFileDocumentPriorityNote(
      availableWorkingFileHandles
    );
    if (documentPriorityNote !== null) {
      lines.push("", ...documentPriorityNote);
    }

    const duplicateDisplayNames = this.collectDuplicateWorkingFileNames(modelVisibleWorkingFiles);
    const collisionCounters = new Map<string, number>();
    lines.push("", ...this.buildWorkingFileGeneralFileNote(availableWorkingFileHandles), "");
    for (const file of modelVisibleWorkingFiles) {
      const displayNameKey = this.resolveWorkingFileDisplayName(file).toLowerCase();
      let collisionIndex: number | null = null;
      if (duplicateDisplayNames.has(displayNameKey)) {
        const next = (collisionCounters.get(displayNameKey) ?? 0) + 1;
        collisionCounters.set(displayNameKey, next);
        collisionIndex = next;
      }
      lines.push(this.formatWorkingFileHistoryLine(file, duplicateDisplayNames, collisionIndex));
    }

    lines.push(
      "",
      "Address files by their pod-absolute path under `/workspace/` or `/workspace/`."
    );
    lines.push(
      "Recover a forgotten path with `files.list` or `files.read`; use `files.preview` for sampled content. Do not answer from this block alone."
    );
    lines.push(
      "Do not send files or claim delivery/preparation unless the user explicitly asks and the current turn returns the matching tool result."
    );
    return lines.join("\n");
  }

  private isCurrentSourceWorkingFile(file: RuntimeFileHandle): boolean {
    return file.authorLabel === "user" && this.isDocumentSourceWorkingFileMime(file.mimeType);
  }

  private isLastDeliveredDocumentResultWorkingFile(file: RuntimeFileHandle): boolean {
    return (
      this.isAssistantGeneratedWorkingFile(file) &&
      (this.isPdfWorkingFileMime(file.mimeType) || file.sourceToolCode === DOCUMENT_TOOL_CODE)
    );
  }

  private isDocumentRelatedWorkingFile(file: RuntimeFileHandle): boolean {
    return (
      this.isDocumentSourceWorkingFileMime(file.mimeType) ||
      this.isPdfWorkingFileMime(file.mimeType) ||
      file.sourceToolCode === DOCUMENT_TOOL_CODE
    );
  }

  private isDocumentSourceWorkingFileMime(mimeType: string): boolean {
    const normalized = mimeType.trim().toLowerCase();
    return (
      normalized.startsWith("text/") ||
      normalized === "application/pdf" ||
      normalized === "application/x-pdf" ||
      normalized === "application/json" ||
      normalized === "application/x-ndjson" ||
      normalized === "application/xml" ||
      normalized === "application/x-yaml" ||
      normalized === "application/yaml" ||
      normalized === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    );
  }

  private isPdfWorkingFileMime(mimeType: string): boolean {
    const normalized = mimeType.trim().toLowerCase();
    return normalized === "application/pdf" || normalized === "application/x-pdf";
  }

  private isAssistantGeneratedWorkingFile(file: RuntimeFileHandle): boolean {
    return (file.authorLabel ?? "model") !== "user";
  }

  private buildOpenMediaJobsDeveloperSection(
    openMediaJobs: RuntimeTurnRequest["openMediaJobs"]
  ): string | null {
    if (openMediaJobs === undefined || openMediaJobs.length === 0) {
      return null;
    }
    const lines = [
      "## Open Media Jobs",
      "Server truth: background media generation is already in progress in this chat.",
      "Use this status block for any progress reply in the current turn.",
      "Do not let older open jobs block a genuine new media request in the current user turn. If the current turn is asking for another image, image edit, or video task, you may start the matching new media tool call.",
      "These are older or already-open jobs. They are NOT proof that the current user turn started a new media job.",
      "Only say a new media request was accepted, queued, or in progress when this same turn actually returned a structural pending_delivery result with a real jobId.",
      ...openMediaJobs.slice(0, MAX_OPEN_MEDIA_JOB_CONTEXT_ITEMS).map((job, index) => {
        const ageLine =
          job.startedAt === null
            ? `created ${job.createdAt}, not started yet`
            : `created ${job.createdAt}, started ${job.startedAt}`;
        const sourceLine =
          job.sourceSummary === null ? "source unavailable" : `source: "${job.sourceSummary}"`;
        const countLine =
          job.requestedCount === null
            ? null
            : `requested ${String(job.requestedCount)} result unit(s)`;
        return `${index + 1}. ${job.toolCode} job is ${job.status}; ${sourceLine}; ${ageLine}${countLine === null ? "." : `; ${countLine}.`}`;
      })
    ];
    return lines.join("\n");
  }

  private buildJobDeliveryUpdatesDeveloperSection(
    jobDeliveryUpdates: RuntimeTurnRequest["jobDeliveryUpdates"]
  ): string | null {
    if (jobDeliveryUpdates === undefined || jobDeliveryUpdates.length === 0) {
      return null;
    }
    const lines = [
      "## Job Delivery Updates",
      "Server truth: these jobs already finished generation/rendering.",
      "Do not say they are still generating or still rendering.",
      "A finalizing_delivery item means worker/provider work is done and chat delivery is catching up.",
      "A delivered_recently item means delivery already finished recently and may already be visible in chat history.",
      "Async audio generation is not an active lane; voice replies use `tts` in-turn."
    ];
    for (const [index, job] of jobDeliveryUpdates
      .slice(0, MAX_JOB_DELIVERY_UPDATE_ITEMS)
      .entries()) {
      const sourceLine =
        job.sourceSummary === null ? "source unavailable" : `source: "${job.sourceSummary}"`;
      const completionLine =
        job.completedAt === null
          ? `latest update ${job.updatedAt}`
          : `completed ${job.completedAt}`;
      const deliveryLine =
        job.deliveryStatus === "delivered_recently"
          ? `delivered ${job.deliveredAt ?? job.updatedAt}`
          : "delivery not finished yet";
      const countLine =
        job.kind !== "media" || job.requestedCount === null
          ? null
          : `requested ${String(job.requestedCount)} result unit(s)`;
      const label =
        job.kind === "media"
          ? `${job.toolCode} ${job.mediaKind} job`
          : `${job.descriptorMode} (${job.documentType}) job`;
      lines.push(
        `${index + 1}. ${label} is ${job.deliveryStatus}; ${sourceLine}; ${completionLine}; ${deliveryLine}${
          countLine === null ? "." : `; ${countLine}.`
        }`
      );
    }
    return lines.join("\n");
  }

  private buildOpenDocumentJobsDeveloperSection(
    openDocumentJobs: RuntimeTurnRequest["openDocumentJobs"]
  ): string | null {
    if (openDocumentJobs === undefined || openDocumentJobs.length === 0) {
      return null;
    }
    const lines = [
      "## Open Document Jobs",
      "Server truth: background document rendering is already in progress in this chat.",
      "Use this status block for any progress reply in the current turn.",
      "Do not start a new document job unless the current user turn is clearly asking for a separate new document task.",
      "These are older or already-open jobs. They are NOT proof that the current user turn started a new document job.",
      "Only say a new document request was accepted, queued, or in progress when this same turn actually returned a structural pending_delivery result with a real jobId.",
      ...openDocumentJobs.slice(0, MAX_OPEN_DOCUMENT_JOB_CONTEXT_ITEMS).map((job, index) => {
        const ageLine =
          job.startedAt === null
            ? `created ${job.createdAt}, not started yet`
            : `created ${job.createdAt}, started ${job.startedAt}`;
        const sourceLine =
          job.sourceSummary === null ? "source unavailable" : `source: "${job.sourceSummary}"`;
        return `${index + 1}. ${job.descriptorMode} (${job.documentType}) job is ${job.status}; ${sourceLine}; ${ageLine}.`;
      })
    ];
    return lines.join("\n");
  }

  private buildTurnRoutingPrompt(
    projectedTools: RuntimeNativeToolProjection | undefined,
    routeDecision: TurnRouteDecision | undefined,
    deepModeEnabled: boolean
  ): string | null {
    if (routeDecision === undefined || routeDecision.mode !== "active") {
      return null;
    }
    const availableToolNames =
      projectedTools === undefined ? [] : projectedTools.tools.map((tool) => tool.name);
    const lines = [
      "## Early Routing Hints",
      deepModeEnabled
        ? "Deep mode is enabled for this turn. Stay on premium-or-stronger quality."
        : "Use the preselected execution mode for this turn unless user-visible evidence strongly contradicts it.",
      `Selected execution mode: ${routeDecision.executionMode}.`,
      routeDecision.clarifyNeeded
        ? "If required context is still missing, ask one short clarifying question before taking action."
        : null,
      routeDecision.retrievalHint && availableToolNames.includes("knowledge_search")
        ? "Assistant knowledge retrieval is likely needed before answering. Prefer knowledge_search first, then knowledge_fetch only for the exact excerpt you need."
        : null,
      routeDecision.retrievalPlan.useSkills && availableToolNames.includes("knowledge_search")
        ? `Retrieval plan selected enabled Skills: ${routeDecision.retrievalPlan.selectedSkillIds.join(", ")}. The Skill knowledge base is available via knowledge_search source "skill"; search to locate, then knowledge_fetch the exact excerpt you need.`
        : null,
      routeDecision.retrievalPlan.useUserKnowledge &&
      availableToolNames.includes("knowledge_search")
        ? "Retrieval plan says user-owned knowledge may be relevant."
        : null,
      routeDecision.retrievalPlan.useProductKnowledge &&
      availableToolNames.includes("knowledge_search")
        ? "Retrieval plan says PersAI product/reference knowledge may be relevant."
        : null,
      routeDecision.retrievalPlan.useWeb && availableToolNames.includes("web_search")
        ? "Retrieval plan says web freshness or external verification may be relevant."
        : null,
      routeDecision.retrievalHint &&
      availableToolNames.includes("knowledge_search") &&
      availableToolNames.includes("web_search")
        ? "Do not stop at the first local file or retrieved snippet. If the current local context does not directly answer the user's real question, continue with narrower lookup or external verification before synthesizing."
        : null,
      routeDecision.toolHints === "web" && availableToolNames.includes("web_search")
        ? "Fresh external information is likely needed. Prefer web_search before answering when recent facts or links matter."
        : null,
      routeDecision.toolHints === "browser" && availableToolNames.includes("browser")
        ? "Interactive browser work is likely needed. Prefer browser only when a real page interaction or inspection is necessary."
        : null,
      routeDecision.toolHints === "media" &&
      (availableToolNames.includes("image_generate") ||
        availableToolNames.includes("image_edit") ||
        availableToolNames.includes("video_generate") ||
        availableToolNames.includes("tts"))
        ? "Media tooling may be relevant for this turn. Use only the declared media tools that match the user's request."
        : null
    ];
    const prompt = lines.filter((line): line is string => line !== null).join("\n");
    return prompt.length === 0 ? null : prompt;
  }

  private resolveProviderSelection(
    bundle: AssistantRuntimeBundle,
    input: Pick<RuntimeTurnRequest, "modelRoleOverride" | "providerOverride" | "modelOverride">
  ): ProviderSelection {
    if (input.providerOverride !== undefined && input.modelOverride !== undefined) {
      return {
        provider: input.providerOverride,
        model: input.modelOverride.trim()
      };
    }

    const requestedModelRole = input.modelRoleOverride ?? "normal_reply";
    const resolved = this.resolveProviderSelectionForRole(bundle, requestedModelRole);
    if (resolved !== null) {
      return resolved;
    }

    throw new TurnExecutionError(
      "native_provider_selection_unavailable",
      new ServiceUnavailableException(
        "Runtime bundle does not declare a native managed provider/model for turn execution."
      )
    );
  }

  private resolveModelSlotSelection(
    routing: Record<string, unknown> | null,
    modelRole: PersaiRuntimeModelRole
  ): ProviderSelection | null {
    const modelSlots = this.asObject(routing?.modelSlots);
    const slotKey =
      modelRole === "premium_reply"
        ? "premiumReply"
        : modelRole === "reasoning"
          ? "reasoning"
          : modelRole === "system_tool"
            ? "systemTool"
            : modelRole === "retrieval"
              ? "retrieval"
              : "normalReply";
    const slot = this.asObject(modelSlots?.[slotKey]);
    const provider = this.asNativeManagedProvider(slot?.providerKey);
    const model = this.asNonEmptyString(slot?.modelKey);
    return provider !== null && model !== null ? { provider, model } : null;
  }

  /**
   * ADR-122 Slice 2 — Read the admin-managed capability fields from the
   * routing slot for the given model role. Falls back to the normalReply slot
   * when the role-specific slot is absent (mirrors resolveModelSlotSelection
   * fall-through). Returns null for both fields when no matching slot exists.
   */
  private resolveSlotCapability(
    bundle: AssistantRuntimeBundle,
    modelRole: PersaiRuntimeModelRole
  ): { maxOutputTokens: number | null; contextWindow: number | null } {
    const routing = this.asObject(bundle.runtime.runtimeProviderRouting);
    const modelSlots = this.asObject(routing?.modelSlots);
    const slotKey =
      modelRole === "premium_reply"
        ? "premiumReply"
        : modelRole === "reasoning"
          ? "reasoning"
          : modelRole === "system_tool"
            ? "systemTool"
            : modelRole === "retrieval"
              ? "retrieval"
              : "normalReply";
    let slot = this.asObject(modelSlots?.[slotKey]);
    if (slot === null && modelRole !== "normal_reply") {
      slot = this.asObject(modelSlots?.["normalReply"]);
    }
    if (slot === null) {
      return { maxOutputTokens: null, contextWindow: null };
    }
    const maxOutputTokens =
      typeof slot.maxOutputTokens === "number" && Number.isFinite(slot.maxOutputTokens)
        ? slot.maxOutputTokens
        : null;
    const contextWindow =
      typeof slot.contextWindow === "number" && Number.isFinite(slot.contextWindow)
        ? slot.contextWindow
        : null;
    return { maxOutputTokens, contextWindow };
  }

  private resolveSlotPromptCacheRetention(
    bundle: AssistantRuntimeBundle,
    modelRole: PersaiRuntimeModelRole
  ): ProviderGatewayPromptCacheRetention {
    const routing = this.asObject(bundle.runtime.runtimeProviderRouting);
    const modelSlots = this.asObject(routing?.modelSlots);
    const slotKey =
      modelRole === "premium_reply"
        ? "premiumReply"
        : modelRole === "reasoning"
          ? "reasoning"
          : modelRole === "system_tool"
            ? "systemTool"
            : modelRole === "retrieval"
              ? "retrieval"
              : "normalReply";
    let slot = this.asObject(modelSlots?.[slotKey]);
    if (slot === null && modelRole !== "normal_reply") {
      slot = this.asObject(modelSlots?.["normalReply"]);
    }
    return (
      this.asPromptCacheRetention(slot?.promptCacheRetention) ??
      OPENAI_PROMPT_CACHE_RETENTION_FALLBACK
    );
  }

  private resolveProviderSelectionForRole(
    bundle: AssistantRuntimeBundle,
    modelRole: PersaiRuntimeModelRole
  ): ProviderSelection | null {
    const routing = this.asObject(bundle.runtime.runtimeProviderRouting);
    const directSlot = this.resolveModelSlotSelection(routing, modelRole);
    if (directSlot !== null) {
      return directSlot;
    }
    if (modelRole !== "normal_reply") {
      const normalReplySlot = this.resolveModelSlotSelection(routing, "normal_reply");
      if (normalReplySlot !== null) {
        return normalReplySlot;
      }
    }
    return this.resolveDefaultProviderSelection(bundle);
  }

  private resolveDefaultProviderSelection(
    bundle: AssistantRuntimeBundle
  ): ProviderSelection | null {
    const routing = this.asObject(bundle.runtime.runtimeProviderRouting);
    const primaryPath = this.asObject(routing?.primaryPath);
    if (primaryPath !== null) {
      if (primaryPath.active === false) {
        throw new TurnExecutionError(
          "runtime_provider_routing_inactive",
          new BadRequestException(
            "Runtime bundle primary provider path is inactive for native turn execution."
          )
        );
      }
      const providerFromRouting = this.asNativeManagedProvider(primaryPath.providerKey);
      const modelFromRouting = this.asNonEmptyString(primaryPath.modelKey);
      if (providerFromRouting !== null && modelFromRouting !== null) {
        return {
          provider: providerFromRouting,
          model: modelFromRouting
        };
      }
    }

    const profile = this.asObject(bundle.runtime.runtimeProviderProfile);
    const primary = this.asObject(profile?.primary);
    const providerFromProfile = this.asNativeManagedProvider(primary?.provider);
    const modelFromProfile = this.asNonEmptyString(primary?.model);
    if (providerFromProfile !== null && modelFromProfile !== null) {
      return {
        provider: providerFromProfile,
        model: modelFromProfile
      };
    }
    return null;
  }

  private async resolveTurnExecutionPlan(
    bundle: AssistantRuntimeBundle,
    input: RuntimeTurnRequest,
    hydratedMessages: ProviderGatewayTextMessage[],
    projectedTools: RuntimeNativeToolProjection
  ): Promise<{
    modelRole: PersaiRuntimeModelRole;
    routeDecision: TurnRouteDecision;
    usageEntries: RuntimeUsageAccountingEntry[];
  }> {
    void hydratedMessages;

    const defaultLevel = input.deepMode === true ? "medium" : ("light" as const);
    const defaultProfile = resolveExecutionProfile(defaultLevel);
    const defaultRouteDecision: TurnRouteDecision = {
      level: defaultLevel,
      executionMode: defaultProfile.executionMode,
      thinkingBudget: defaultProfile.thinkingBudget,
      retrievalHint: false,
      toolHints: "none",
      confidence: "high",
      clarifyNeeded: false,
      fallbackMode: defaultProfile.executionMode,
      reasonCode: input.deepMode === true ? "deep_mode_default" : "default_normal",
      retrievalPlan: {
        useSkills: false,
        selectedSkillIds: [],
        useUserKnowledge: false,
        useProductKnowledge: false,
        useWeb: false,
        ordinarySourcePriorityMode: "not_applicable",
        confidence: "low",
        reasonCode: input.deepMode === true ? "deep_mode_default" : "default_normal"
      },
      source: "default",
      mode: "shadow",
      usage: null,
      skillState: input.skillStateContext?.decision ?? null
    };
    if (input.modelRoleOverride !== undefined) {
      return {
        modelRole: input.modelRoleOverride,
        routeDecision: defaultRouteDecision,
        usageEntries: []
      };
    }
    if (input.providerOverride !== undefined || input.modelOverride !== undefined) {
      return {
        modelRole: "normal_reply",
        routeDecision: defaultRouteDecision,
        usageEntries: []
      };
    }
    const routeDecision = await this.turnRoutingService.decide({
      bundle,
      request: input,
      projectedTools
    });
    const usageEntries = this.toTurnRoutingUsageEntries(routeDecision.usage);
    const modelRole =
      routeDecision.mode === "active"
        ? this.mapExecutionModeToModelRole(routeDecision.executionMode)
        : input.deepMode === true
          ? "premium_reply"
          : "normal_reply";
    return {
      modelRole,
      routeDecision,
      usageEntries
    };
  }

  private mapExecutionModeToModelRole(
    executionMode: TurnRouteDecision["executionMode"]
  ): PersaiRuntimeModelRole {
    switch (executionMode) {
      case "premium":
        return "premium_reply";
      case "reasoning":
        return "reasoning";
      default:
        return "normal_reply";
    }
  }

  private toTurnRoutingUsageEntries(
    usage: RuntimeUsageSnapshot | null
  ): RuntimeUsageAccountingEntry[] {
    if (usage === null) {
      return [];
    }
    return [
      {
        stepType: "turn_routing",
        modelRole: "system_tool",
        providerKey: usage.providerKey,
        modelKey: usage.modelKey,
        inputTokens: usage.inputTokens,
        cacheCreationInputTokens: usage.cacheCreationInputTokens ?? null,
        cachedInputTokens: usage.cachedInputTokens ?? null,
        outputTokens: usage.outputTokens,
        totalTokens: usage.totalTokens
      }
    ];
  }

  private assertSupportedTurnRequest(
    input: RuntimeTurnRequest,
    operation: "createTurn" | "streamTurn" | "createBackgroundTaskToolRun"
  ): void {
    if (input.message.text.trim().length === 0) {
      throw new BadRequestException(
        `message.text must be non-empty for native ${operation} execution.`
      );
    }
    const hasProviderOverride = input.providerOverride !== undefined;
    const hasModelOverride = input.modelOverride !== undefined;
    if (hasProviderOverride !== hasModelOverride) {
      throw new BadRequestException(
        `providerOverride and modelOverride must be provided together for native ${operation} execution.`
      );
    }
    if (input.modelOverride !== undefined && input.modelOverride.trim().length === 0) {
      throw new BadRequestException(
        "modelOverride must be a non-empty string when providerOverride is provided."
      );
    }
    if (
      input.modelRoleOverride !== undefined &&
      !PERSAI_RUNTIME_MODEL_ROLES.includes(input.modelRoleOverride)
    ) {
      throw new BadRequestException(
        `modelRoleOverride must be one of ${PERSAI_RUNTIME_MODEL_ROLES.join(", ")}.`
      );
    }
    for (const attachment of input.message.attachments) {
      if (attachment.storagePath.trim().length === 0) {
        throw new BadRequestException(
          `message.attachments[].storagePath must be non-empty for native ${operation} execution.`
        );
      }
    }
  }

  private async executeProviderToolLoop(
    acceptedTurn: AcceptedRuntimeTurn,
    execution: PreparedTurnExecution,
    input: RuntimeTurnRequest,
    turnState: TurnExecutionState
  ): Promise<ProviderGatewayTextGenerateResult> {
    const toolHistory: ProviderGatewayToolExchange[] = [];
    let accumulatedText = "";
    let forceFinalTextOnly = false;
    let contextOverflowRetryAttempted = false;
    const toolBudgetPolicy = this.createToolBudgetPolicy(execution);
    const maxToolLoopIterations =
      toolBudgetPolicy.loopLimit() + NATIVE_TOOL_LOOP_WRAP_UP_ITERATIONS;
    let previewFollowUpExtraIterations = 0;
    await this.sanitizeBaseRequestMultimodalForTextOnlyProvider(execution, acceptedTurn);
    for (
      let iteration = 0;
      iteration < maxToolLoopIterations + previewFollowUpExtraIterations;
      iteration += 1
    ) {
      let providerResult: ProviderGatewayTextGenerateResult;
      let availableWorkingFileHandles = execution.availableWorkingFileHandles;
      let pendingFilePreviewBlocks: ProviderGatewayMessageContentBlock[] | undefined;
      try {
        availableWorkingFileHandles =
          await this.turnContextHydrationService.listAvailableWorkingFileHandles({
            conversation: acceptedTurn.session.conversation,
            currentAttachments: execution.currentMessageAttachments,
            currentFileHandles: turnState.fileHandles,
            currentArtifacts: turnState.artifacts
          });
        pendingFilePreviewBlocks = await this.sanitizePreviewBlocksMultimodalForTextOnlyProvider(
          execution,
          acceptedTurn,
          turnState.pendingFilePreviewBlocks
        );
        delete turnState.pendingFilePreviewBlocks;
        const request = this.buildToolLoopProviderRequest(execution.providerRequest, {
          assistantText: accumulatedText,
          baseDeveloperInstructionSections: execution.developerInstructionSections,
          toolHistory,
          availableToolNames: execution.projectedTools.tools.map((tool) => tool.name),
          availableWorkingFileHandles,
          closedOpenLoopRefs: turnState.closedOpenLoopRefs,
          forceFinalTextOnly,
          deferredMediaJobs: turnState.deferredMediaJobs,
          deferredDocumentJobs: turnState.deferredDocumentJobs,
          ...(pendingFilePreviewBlocks === undefined ? {} : { pendingFilePreviewBlocks }),
          requestMetadata: this.createTurnProviderRequestMetadata({
            acceptedTurn,
            classification: iteration === 0 ? "main_turn" : "tool_loop_followup",
            toolLoopIteration: iteration
          })
        });
        providerResult = await this.generateTextWithRuntimeFallback({
          bundle: execution.bundle,
          request,
          modelRole: execution.selectedModelRole,
          telemetryContext: {
            surface: "turn_sync",
            requestId: acceptedTurn.receipt.requestId,
            classification: request.requestMetadata?.classification ?? "unknown",
            attemptKey: `tool_loop:${String(iteration)}`
          }
        });
      } catch (error) {
        if (
          this.isContextWindowExceededError(error) &&
          !contextOverflowRetryAttempted &&
          iteration + 1 < maxToolLoopIterations + previewFollowUpExtraIterations
        ) {
          contextOverflowRetryAttempted = true;
          this.restorePendingFilePreviewBlocksAfterOverflow(turnState, pendingFilePreviewBlocks);
          toolHistory.splice(0, toolHistory.length);
          forceFinalTextOnly = true;
          execution.providerRequest = this.buildContextOverflowRecoveryProviderRequest(
            execution.providerRequest
          );
          continue;
        }
        throw error;
      }
      this.recordUsageEntry(turnState, {
        stepType: iteration === 0 ? "main_turn" : "tool_loop_followup",
        modelRole: execution.selectedModelRole,
        usage: providerResult.usage
      });
      accumulatedText = this.mergeAssistantTurnText(accumulatedText, providerResult.text);
      if (providerResult.stopReason === "completed") {
        if (
          accumulatedText.trim().length === 0 &&
          toolHistory.length > 0 &&
          iteration + 1 < maxToolLoopIterations
        ) {
          forceFinalTextOnly = true;
          continue;
        }
        const correctedProviderResult = this.withAssistantText(
          providerResult,
          this.applyAssistantTextCorrections({
            assistantText: accumulatedText,
            artifacts: turnState.artifacts,
            deferredMediaJobs: turnState.deferredMediaJobs,
            deferredDocumentJobs: turnState.deferredDocumentJobs,
            locale: input.message.locale ?? execution.bundle.userContext.locale ?? null
          })
        );
        return this.runPostFinalChatPlanSelfCheck({
          acceptedTurn,
          execution,
          input,
          turnState,
          providerResult: correctedProviderResult
        });
      }
      if (providerResult.toolCalls.length === 0) {
        throw new TurnExecutionError(
          "native_tool_result_invalid",
          new ServiceUnavailableException(
            "Provider returned a tool-call stop without any tool calls."
          )
        );
      }
      forceFinalTextOnly = false;

      let durableCompactionExecuted = false;
      let volatileRefreshNeeded = false;
      const plannedToolExecutions = this.planToolExecutions(
        this.reorderToolCallsDocumentFirst(providerResult.toolCalls),
        toolBudgetPolicy,
        iteration
      );
      for (
        let batchStart = 0;
        batchStart < plannedToolExecutions.length;
        batchStart = this.findToolExecutionChunkEnd(plannedToolExecutions, batchStart)
      ) {
        const batch = plannedToolExecutions.slice(
          batchStart,
          this.findToolExecutionChunkEnd(plannedToolExecutions, batchStart)
        );
        if (batch[0]?.parallelSafe) {
          const batchResults = await this.executeParallelToolChunk({
            plannedToolExecutions: batch,
            execution,
            acceptedTurn,
            input,
            turnState,
            availableWorkingFileHandles,
            trace: undefined,
            iteration
          });
          let firstError: unknown = null;
          for (const result of batchResults) {
            if (result.outcome !== undefined) {
              this.maybeRefundToolRequestRejectionReservation(
                toolBudgetPolicy,
                batch.find((entry) => entry.toolCall.id === result.toolCall.id) ?? null,
                result.outcome
              );
              result.outcome.exchange.reasoningContent = providerResult.reasoningContent ?? null;
              toolHistory.push(result.outcome.exchange);
              this.applyToolExecutionOutcome(turnState, result.outcome, iteration);
              this.maybeApplySkillStateMutationFromTool(execution, result.outcome);
              if (this.toolMutatesVolatilePrefix(result.outcome.exchange.toolCall.name)) {
                volatileRefreshNeeded = true;
              }
              durableCompactionExecuted =
                durableCompactionExecuted ||
                result.outcome.sharedCompaction?.durableStatePersisted === true;
              continue;
            }
            firstError ??= result.error;
          }
          if (firstError !== null) {
            throw firstError;
          }
          continue;
        }
        for (const entry of batch) {
          const outcome = entry.reservation.exhausted
            ? this.createToolBudgetExhaustedOutcome({
                toolCall: entry.toolCall,
                reservation: entry.reservation,
                trace: undefined,
                iteration,
                acceptedTurn
              })
            : await this.executeProjectedToolCall(
                execution,
                acceptedTurn,
                input,
                entry.toolCall,
                input.idempotencyKey,
                turnState.artifacts,
                turnState.fileHandles,
                availableWorkingFileHandles
              );
          this.maybeRefundToolRequestRejectionReservation(toolBudgetPolicy, entry, outcome);
          outcome.exchange.reasoningContent = providerResult.reasoningContent ?? null;
          toolHistory.push(outcome.exchange);
          this.applyToolExecutionOutcome(turnState, outcome, iteration);
          this.maybeApplySkillStateMutationFromTool(execution, outcome);
          if (this.toolMutatesVolatilePrefix(outcome.exchange.toolCall.name)) {
            volatileRefreshNeeded = true;
          }
          durableCompactionExecuted =
            durableCompactionExecuted || outcome.sharedCompaction?.durableStatePersisted === true;
        }
      }
      if (durableCompactionExecuted) {
        execution.providerRequest = await this.refreshProviderRequestMessages(execution, input);
        // After a full refresh the volatile prefix was dropped — re-prepend it
        // so the next iteration still carries the scenario block, chat plan,
        // and `<system-reminder>` blocks with up-to-date state.
        execution.volatilePrefixLength = 0;
        await this.refreshVolatilePrefix(execution, input, toolBudgetPolicy.getSnapshot());
      } else if (volatileRefreshNeeded) {
        await this.refreshVolatilePrefix(execution, input, toolBudgetPolicy.getSnapshot());
      }
      previewFollowUpExtraIterations = this.reservePreviewFollowUpIterationIfNeeded({
        turnState,
        iteration,
        maxToolLoopIterations,
        previewFollowUpExtraIterations
      });
    }

    throw new TurnExecutionError(
      "native_tool_loop_exhausted",
      new ServiceUnavailableException(
        `Native tool loop exceeded ${String(maxToolLoopIterations)} iterations (mode=${toolBudgetPolicy.executionModeName()}, loopLimit=${String(toolBudgetPolicy.loopLimit())}, wrapUp=${String(NATIVE_TOOL_LOOP_WRAP_UP_ITERATIONS)}).`
      )
    );
  }

  private planToolExecutions(
    toolCalls: readonly ProviderGatewayToolCall[],
    toolBudgetPolicy: ToolBudgetPolicy,
    iteration: number
  ): PlannedToolExecution[] {
    return toolCalls.map((toolCall) => {
      const reservedUnits = this.resolveRequestedToolResultUnits(toolCall);
      return {
        toolCall,
        reservedUnits,
        reservation: toolBudgetPolicy.reserve(toolCall.name, iteration, reservedUnits),
        parallelSafe: SAFE_PARALLEL_TOOL_CODES.has(toolCall.name)
      };
    });
  }

  /**
   * ADR-105 Slice 2 — per-turn media budgeting counts requested **result
   * units**, not tool invocations. `image_generate`/`image_edit` reserve their
   * `count` argument (one structured request = one job of `count` artifacts);
   * `video_generate` reserves exactly one unit. Every other tool reserves one
   * unit per call. A count outside the contract bounds is clamped to the
   * per-job maximum so an oversized request is still measured (and rejected)
   * whole rather than silently under-counted.
   */
  private resolveRequestedToolResultUnits(toolCall: ProviderGatewayToolCall): number {
    if (toolCall.name === IMAGE_GENERATE_TOOL_CODE) {
      return this.readRequestedMediaCount(
        toolCall.arguments,
        MIN_RUNTIME_IMAGE_GENERATE_COUNT,
        MAX_RUNTIME_IMAGE_GENERATE_COUNT
      );
    }
    if (toolCall.name === IMAGE_EDIT_TOOL_CODE) {
      return this.readRequestedMediaCount(
        toolCall.arguments,
        MIN_RUNTIME_IMAGE_EDIT_COUNT,
        MAX_RUNTIME_IMAGE_EDIT_COUNT
      );
    }
    return 1;
  }

  private readRequestedMediaCount(
    rawArguments: Record<string, unknown>,
    minCount: number,
    maxCount: number
  ): number {
    const value = rawArguments.count;
    if (typeof value !== "number" || !Number.isInteger(value) || value < minCount) {
      return minCount;
    }
    return Math.min(value, maxCount);
  }

  /**
   * Stable reorder of a single provider tool-call batch: all `document` entries
   * precede all `files` entries. Only activates when the batch contains both;
   * otherwise returns the original array unchanged. Relative order is preserved
   * within the document group, within the files group, and among all other tools.
   */
  private reorderToolCallsDocumentFirst(
    toolCalls: readonly ProviderGatewayToolCall[]
  ): readonly ProviderGatewayToolCall[] {
    const hasDocument = toolCalls.some((tc) => tc.name === DOCUMENT_TOOL_CODE);
    const hasFiles = toolCalls.some((tc) => tc.name === FILES_TOOL_CODE);
    if (!hasDocument || !hasFiles) {
      return toolCalls;
    }
    const docCalls = toolCalls.filter((tc) => tc.name === DOCUMENT_TOOL_CODE);
    const otherCalls = toolCalls.filter(
      (tc) => tc.name !== DOCUMENT_TOOL_CODE && tc.name !== FILES_TOOL_CODE
    );
    const filesCalls = toolCalls.filter((tc) => tc.name === FILES_TOOL_CODE);
    return [...docCalls, ...otherCalls, ...filesCalls];
  }

  private findToolExecutionChunkEnd(
    plannedToolExecutions: readonly PlannedToolExecution[],
    startIndex: number
  ): number {
    const current = plannedToolExecutions[startIndex];
    if (current === undefined) {
      return startIndex;
    }
    if (!current.parallelSafe) {
      return startIndex + 1;
    }
    let endIndex = startIndex + 1;
    while (
      endIndex < plannedToolExecutions.length &&
      plannedToolExecutions[endIndex]?.parallelSafe === true
    ) {
      endIndex += 1;
    }
    return endIndex;
  }

  private async executeParallelToolChunk(params: {
    plannedToolExecutions: readonly PlannedToolExecution[];
    execution: PreparedTurnExecution;
    acceptedTurn: AcceptedRuntimeTurn;
    input: RuntimeTurnRequest;
    turnState: TurnExecutionState;
    availableWorkingFileHandles: RuntimeFileHandle[];
    trace: RuntimeStreamTraceCollector | undefined;
    iteration: number;
  }): Promise<ExecutedToolCallResult[]> {
    const currentArtifacts = [...params.turnState.artifacts];
    const currentFileHandles = [...params.turnState.fileHandles];
    return Promise.all(
      params.plannedToolExecutions.map(async (entry) => {
        if (entry.reservation.exhausted) {
          return {
            toolCall: entry.toolCall,
            outcome: this.createToolBudgetExhaustedOutcome({
              toolCall: entry.toolCall,
              reservation: entry.reservation,
              trace: params.trace,
              iteration: params.iteration,
              acceptedTurn: params.acceptedTurn
            })
          } satisfies ExecutedToolCallResult;
        }
        try {
          return {
            toolCall: entry.toolCall,
            outcome: await this.executeProjectedToolCall(
              params.execution,
              params.acceptedTurn,
              params.input,
              entry.toolCall,
              params.input.idempotencyKey,
              currentArtifacts,
              currentFileHandles,
              params.availableWorkingFileHandles
            )
          } satisfies ExecutedToolCallResult;
        } catch (error) {
          return {
            toolCall: entry.toolCall,
            error
          } satisfies ExecutedToolCallResult;
        }
      })
    );
  }

  private async executeProjectedToolCall(
    execution: PreparedTurnExecution,
    acceptedTurn: AcceptedRuntimeTurn,
    input: RuntimeTurnRequest,
    toolCall: ProviderGatewayToolCall,
    currentUserMessageId: string | null,
    currentArtifacts: RuntimeOutputArtifact[],
    currentFileHandles: RuntimeFileHandle[],
    availableWorkingFileHandles: RuntimeFileHandle[]
  ): Promise<ToolExecutionOutcome> {
    const allowedToolNames = new Set(
      execution.projectedTools.tools.map((toolDefinition) => toolDefinition.name)
    );
    if (!allowedToolNames.has(toolCall.name)) {
      return this.createToolExecutionOutcome(toolCall, {
        toolCode: toolCall.name,
        action: "skipped",
        reason: "tool_not_projected"
      });
    }

    switch (toolCall.name) {
      case execution.bundle.runtime.sharedCompaction.summarizeToolCode: {
        const instructions = this.readOptionalInstructions(toolCall.arguments);
        if (instructions instanceof Error) {
          return this.createToolExecutionOutcome(
            toolCall,
            {
              toolCode: toolCall.name,
              action: "skipped",
              reason: "invalid_arguments"
            },
            true
          );
        }
        const result = await this.sessionCompactionService.summarizeContext({
          runtimeTier: execution.runtimeTier,
          conversation: acceptedTurn.session.conversation,
          instructions,
          heldLease: acceptedTurn.lease,
          trigger: "manual_compaction",
          runtimeRequestId: acceptedTurn.receipt.requestId
        });
        return this.createToolExecutionOutcome(
          toolCall,
          result.toolResult,
          result.reason === "invalid_summary_output",
          {
            toolCode: "summarize_context",
            durableStatePersisted: false
          }
        );
      }
      case execution.bundle.runtime.sharedCompaction.compactToolCode: {
        const instructions = this.readOptionalInstructions(toolCall.arguments);
        if (instructions instanceof Error) {
          return this.createToolExecutionOutcome(
            toolCall,
            {
              toolCode: toolCall.name,
              action: "skipped",
              reason: "invalid_arguments"
            },
            true
          );
        }
        const result = await this.sessionCompactionService.compactSession({
          runtimeTier: execution.runtimeTier,
          conversation: acceptedTurn.session.conversation,
          instructions,
          heldLease: acceptedTurn.lease,
          trigger: "manual_compaction",
          runtimeRequestId: acceptedTurn.receipt.requestId
        });
        return this.createToolExecutionOutcome(
          toolCall,
          result.toolResult,
          result.reason === "invalid_summary_output",
          {
            toolCode: "compact_context",
            durableStatePersisted: result.compacted && result.toolResult.reusableInLaterTurns
          }
        );
      }
      case MEMORY_WRITE_TOOL_CODE: {
        const result = await this.runtimeMemoryWriteToolService.executeToolCall({
          bundle: execution.bundle,
          toolCall,
          conversation: acceptedTurn.session.conversation,
          currentUserMessageId,
          requestId: acceptedTurn.receipt.requestId
        });
        return this.createToolExecutionOutcome(toolCall, result.payload, result.isError);
      }
      case TODO_WRITE_TOOL_CODE: {
        // ADR-125 Slice 1: chat plan mutations. Inline, zero provider cost,
        // backed by the API `chat-todos/apply` endpoint.
        const result = await this.runtimeTodoWriteToolService.executeToolCall({
          bundle: execution.bundle,
          toolCall,
          conversation: acceptedTurn.session.conversation
        });
        return this.createToolExecutionOutcome(toolCall, result.payload, result.isError);
      }
      case SKILL_TOOL_CODE: {
        // ADR-118 Slice 2: model-owned Skill engage/release. Zero provider cost.
        const result = await this.runtimeSkillToolService.executeToolCall({
          bundle: execution.bundle,
          toolCall,
          conversation: acceptedTurn.session.conversation,
          requestId: acceptedTurn.receipt.requestId
        });
        return this.createToolExecutionOutcome(toolCall, result.payload, result.isError);
      }
      case QUOTA_STATUS_TOOL_CODE: {
        const result = await this.runtimeQuotaStatusToolService.executeToolCall({
          bundle: execution.bundle,
          toolCall,
          conversation: acceptedTurn.session.conversation,
          requestId: acceptedTurn.receipt.requestId,
          currentUserText: input.message.text
        });
        return this.createToolExecutionOutcome(toolCall, result.payload, result.isError);
      }
      case FILES_TOOL_CODE: {
        const result = await this.runtimeFilesToolService.executeToolCall({
          bundle: execution.bundle,
          toolCall,
          sessionId: acceptedTurn.session.sessionId,
          requestId: acceptedTurn.receipt.requestId,
          channel: acceptedTurn.session.conversation.channel,
          chatId: null,
          externalThreadKey: this.resolveSurfaceThreadKey(acceptedTurn.session.conversation),
          messageId: null
        });
        return this.createToolExecutionOutcome(
          toolCall,
          result.payload,
          result.isError,
          undefined,
          result.artifacts,
          result.discoveredFileHandles
        );
      }
      case EXEC_TOOL_CODE:
      case SHELL_TOOL_CODE: {
        const result = await this.runtimeSandboxToolService.executeToolCall({
          bundle: execution.bundle,
          toolCall,
          sessionId: acceptedTurn.session.sessionId,
          requestId: acceptedTurn.receipt.requestId
        });
        return this.createToolExecutionOutcome(toolCall, result.payload, result.isError);
      }
      case GREP_TOOL_CODE: {
        const result = await this.runtimeGrepGlobToolService.executeGrepToolCall({
          bundle: execution.bundle,
          toolCall,
          sessionId: acceptedTurn.session.sessionId,
          requestId: acceptedTurn.receipt.requestId
        });
        return this.createToolExecutionOutcome(toolCall, result.payload, result.isError);
      }
      case GLOB_TOOL_CODE: {
        const result = await this.runtimeGrepGlobToolService.executeGlobToolCall({
          bundle: execution.bundle,
          toolCall,
          sessionId: acceptedTurn.session.sessionId,
          requestId: acceptedTurn.receipt.requestId
        });
        return this.createToolExecutionOutcome(toolCall, result.payload, result.isError);
      }
      case WEB_SEARCH_TOOL_CODE:
        return this.executeWebSearchTool(execution, toolCall);
      case WEB_FETCH_TOOL_CODE:
        return this.executeWebFetchTool(execution, toolCall);
      case BROWSER_TOOL_CODE: {
        const result = await this.runtimeBrowserToolService.executeToolCall({
          bundle: execution.bundle,
          toolCall
        });
        return this.createToolExecutionOutcome(toolCall, result.payload, result.isError);
      }
      case DOCUMENT_TOOL_CODE: {
        const documentSourceAttachments = this.mergeWorkingFileDocumentSourceAttachments(
          execution.currentMessageAttachments
            .filter((attachment) => this.isDocumentSourceWorkingFileMime(attachment.mimeType))
            .map((attachment) => ({ ...attachment, aliases: attachment.aliases ?? null })),
          availableWorkingFileHandles
        );
        const result = await this.runtimeDocumentToolService.executeToolCall({
          bundle: execution.bundle,
          toolCall,
          sessionId: acceptedTurn.session.sessionId,
          requestId: acceptedTurn.receipt.requestId,
          deferToAsyncDocumentJob: {
            sourceUserMessageId: input.idempotencyKey,
            sourceUserMessageText: input.message.text,
            currentAttachments: execution.currentMessageAttachments,
            availableAttachments: documentSourceAttachments
          }
        });
        return this.createToolExecutionOutcome(
          toolCall,
          result.payload,
          result.isError,
          undefined,
          result.artifacts
        );
      }
      case IMAGE_EDIT_TOOL_CODE: {
        const availableImageAttachments = await this.resolveAvailableImageToolAttachments(
          execution.currentMessageAttachments,
          availableWorkingFileHandles,
          currentArtifacts,
          currentFileHandles
        );
        const result = await this.runtimeImageEditToolService.executeToolCall({
          bundle: execution.bundle,
          toolCall,
          availableAttachments: availableImageAttachments,
          sessionId: acceptedTurn.session.sessionId,
          requestId: acceptedTurn.receipt.requestId,
          ...(this.shouldDeferMediaToolExecution(input)
            ? {
                deferToAsyncMediaJob: {
                  sourceUserMessageId: input.idempotencyKey,
                  sourceUserMessageText: input.message.text
                }
              }
            : {})
        });
        return this.createToolExecutionOutcome(
          toolCall,
          result.payload,
          result.isError,
          undefined,
          result.artifacts
        );
      }
      case IMAGE_GENERATE_TOOL_CODE: {
        const availableImageAttachments = await this.resolveAvailableImageToolAttachments(
          execution.currentMessageAttachments,
          availableWorkingFileHandles,
          currentArtifacts,
          currentFileHandles
        );
        const result = await this.runtimeImageGenerateToolService.executeToolCall({
          bundle: execution.bundle,
          toolCall,
          availableAttachments: availableImageAttachments,
          sessionId: acceptedTurn.session.sessionId,
          requestId: acceptedTurn.receipt.requestId,
          ...(this.shouldDeferMediaToolExecution(input)
            ? {
                deferToAsyncMediaJob: {
                  sourceUserMessageId: input.idempotencyKey,
                  sourceUserMessageText: input.message.text
                }
              }
            : {})
        });
        return this.createToolExecutionOutcome(
          toolCall,
          result.payload,
          result.isError,
          undefined,
          result.artifacts
        );
      }
      case VIDEO_GENERATE_TOOL_CODE: {
        const availableImageAttachments = await this.resolveAvailableImageToolAttachments(
          execution.currentMessageAttachments,
          availableWorkingFileHandles,
          currentArtifacts,
          currentFileHandles
        );
        const result = await this.runtimeVideoGenerateToolService.executeToolCall({
          bundle: execution.bundle,
          toolCall,
          availableAttachments: availableImageAttachments,
          sessionId: acceptedTurn.session.sessionId,
          requestId: acceptedTurn.receipt.requestId,
          ...(this.shouldDeferMediaToolExecution(input)
            ? {
                deferToAsyncMediaJob: {
                  sourceUserMessageId: input.idempotencyKey,
                  sourceUserMessageText: input.message.text
                }
              }
            : {})
        });
        return this.createToolExecutionOutcome(
          toolCall,
          result.payload,
          result.isError,
          undefined,
          result.artifacts
        );
      }
      case TTS_TOOL_CODE: {
        const result = await this.runtimeTtsToolService.executeToolCall({
          bundle: execution.bundle,
          toolCall,
          sessionId: acceptedTurn.session.sessionId,
          requestId: acceptedTurn.receipt.requestId
        });
        return this.createToolExecutionOutcome(
          toolCall,
          result.payload,
          result.isError,
          undefined,
          result.artifacts
        );
      }
      case SCHEDULED_ACTION_TOOL_CODE: {
        const result = await this.runtimeScheduledActionToolService.executeToolCall({
          bundle: execution.bundle,
          toolCall,
          conversation: acceptedTurn.session.conversation
        });
        return this.createToolExecutionOutcome(toolCall, result.payload, result.isError);
      }
      case BACKGROUND_TASK_TOOL_CODE: {
        const result = await this.runtimeBackgroundTaskToolService.executeToolCall({
          bundle: execution.bundle,
          toolCall,
          conversation: acceptedTurn.session.conversation
        });
        return this.createToolExecutionOutcome(toolCall, result.payload, result.isError);
      }
      case execution.bundle.runtime.knowledgeAccess.searchToolCode:
        return this.executeKnowledgeSearchTool(execution, toolCall);
      case execution.bundle.runtime.knowledgeAccess.fetchToolCode:
        return this.executeKnowledgeFetchTool(execution, toolCall);
      default:
        return this.createToolExecutionOutcome(toolCall, {
          toolCode: toolCall.name,
          action: "skipped",
          reason: "tool_not_supported"
        });
    }
  }

  private executeKnowledgeSearchTool(
    execution: PreparedTurnExecution,
    toolCall: ProviderGatewayToolCall
  ): Promise<ToolExecutionOutcome> {
    return this.runtimeKnowledgeToolService
      .executeSearchToolCall({
        bundle: execution.bundle,
        toolCall,
        allowedSources: execution.projectedTools.knowledgeSearchSources,
        availableSources: execution.bundle.runtime.knowledgeAccess.sources
      })
      .then((result) => this.createToolExecutionOutcome(toolCall, result.payload, result.isError));
  }

  private resolveAvailableImageToolAttachments(
    currentMessageAttachments: RuntimeAttachmentRef[],
    availableWorkingFileHandles: RuntimeFileHandle[],
    currentArtifacts: RuntimeOutputArtifact[],
    currentFileHandles: RuntimeFileHandle[]
  ): Promise<RuntimeAttachmentRef[]> {
    const aliasByStoragePath = new Map<string, string[]>();
    for (const fileHandle of [...availableWorkingFileHandles, ...currentFileHandles]) {
      if ((fileHandle.aliases ?? []).length === 0) {
        continue;
      }
      aliasByStoragePath.set(fileHandle.storagePath, fileHandle.aliases ?? []);
    }
    const withWorkingFileAliases = (
      attachment: RuntimeAttachmentRef
    ): RuntimeAttachmentRef | null => {
      const workingFileAliases = aliasByStoragePath.get(attachment.storagePath) ?? null;
      if (workingFileAliases === null) {
        return null;
      }
      return {
        ...attachment,
        aliases: workingFileAliases
      };
    };
    const currentImageAttachments = currentMessageAttachments
      .filter((attachment) => attachment.kind === "image")
      .map(withWorkingFileAliases)
      .filter((attachment): attachment is RuntimeAttachmentRef => attachment !== null);
    const generatedImageAttachments = currentArtifacts
      .filter((artifact) => artifact.kind === "image")
      .map((artifact) => ({
        attachmentId: artifact.artifactId,
        kind: "image" as const,
        storagePath: artifact.storagePath,
        mimeType: artifact.mimeType,
        displayName: artifact.filename,
        sizeBytes: artifact.sizeBytes ?? 0,
        aliases: null
      }))
      .map(withWorkingFileAliases)
      .filter((attachment): attachment is RuntimeAttachmentRef => attachment !== null);
    const workingFileImageAttachments = [...availableWorkingFileHandles, ...currentFileHandles]
      .filter((fileHandle) => fileHandle.mimeType.startsWith("image/"))
      .map((fileHandle) => ({
        attachmentId: `file:${fileHandle.storagePath}`,
        kind: "image" as const,
        storagePath: fileHandle.storagePath,
        mimeType: fileHandle.mimeType,
        displayName: fileHandle.displayName ?? null,
        sizeBytes: fileHandle.sizeBytes ?? 0,
        aliases: fileHandle.aliases ?? null
      }));
    return Promise.resolve(
      this.dedupeRuntimeAttachmentsByStorage([
        ...currentImageAttachments,
        ...generatedImageAttachments,
        ...workingFileImageAttachments
      ])
    );
  }

  private mergeWorkingFileDocumentSourceAttachments(
    attachments: RuntimeAttachmentRef[],
    availableWorkingFileHandles: RuntimeFileHandle[]
  ): RuntimeAttachmentRef[] {
    const merged = new Map<string, RuntimeAttachmentRef>();
    const upsert = (attachment: RuntimeAttachmentRef): void => {
      const key = this.buildRuntimeAttachmentDedupeKey(attachment);
      const existing = merged.get(key);
      if (existing === undefined) {
        merged.set(key, attachment);
        return;
      }
      merged.set(key, {
        ...existing,
        aliases: this.mergeFileRefAliases(existing.aliases ?? [], attachment.aliases ?? [])
      });
    };
    for (const attachment of attachments) {
      upsert(attachment);
    }
    for (const fileHandle of availableWorkingFileHandles) {
      if (!this.isDocumentSourceWorkingFileMime(fileHandle.mimeType)) {
        continue;
      }
      upsert({
        attachmentId: `file:${fileHandle.storagePath}`,
        kind: "file",
        storagePath: fileHandle.storagePath,
        mimeType: fileHandle.mimeType,
        displayName: fileHandle.displayName ?? null,
        sizeBytes: fileHandle.sizeBytes ?? 0,
        aliases: fileHandle.aliases ?? null
      });
    }
    return [...merged.values()];
  }

  private buildRuntimeAttachmentDedupeKey(attachment: RuntimeAttachmentRef): string {
    return `storage:${attachment.storagePath}`;
  }

  private dedupeRuntimeAttachmentsByStorage(
    attachments: RuntimeAttachmentRef[]
  ): RuntimeAttachmentRef[] {
    const merged = new Map<string, RuntimeAttachmentRef>();
    for (const attachment of attachments) {
      const key = this.buildRuntimeAttachmentDedupeKey(attachment);
      if (!merged.has(key)) {
        merged.set(key, attachment);
      }
    }
    return [...merged.values()];
  }

  private executeKnowledgeFetchTool(
    execution: PreparedTurnExecution,
    toolCall: ProviderGatewayToolCall
  ): Promise<ToolExecutionOutcome> {
    return this.runtimeKnowledgeToolService
      .executeFetchToolCall({
        bundle: execution.bundle,
        toolCall,
        allowedSources: execution.projectedTools.knowledgeFetchSources,
        availableSources: execution.bundle.runtime.knowledgeAccess.sources
      })
      .then((result) => this.createToolExecutionOutcome(toolCall, result.payload, result.isError));
  }

  private async executeWebSearchTool(
    execution: PreparedTurnExecution,
    toolCall: ProviderGatewayToolCall
  ): Promise<ToolExecutionOutcome> {
    const request = this.readWebSearchArguments(toolCall.arguments);
    if (request instanceof Error) {
      return this.createToolExecutionOutcome(
        toolCall,
        {
          toolCode: WEB_SEARCH_TOOL_CODE,
          executionMode: "inline",
          provider: null,
          query: this.asNonEmptyString(toolCall.arguments.query) ?? "",
          summary: null,
          hits: [],
          externalContent: null,
          action: "skipped",
          reason: "invalid_arguments",
          warning: request.message
        },
        true
      );
    }

    const policy = this.resolveAllowedInlineToolPolicy(execution.bundle, WEB_SEARCH_TOOL_CODE);
    if (policy === null) {
      return this.createToolExecutionOutcome(toolCall, {
        toolCode: WEB_SEARCH_TOOL_CODE,
        executionMode: "inline",
        provider: null,
        query: request.query,
        summary: null,
        hits: [],
        externalContent: null,
        action: "skipped",
        reason: "tool_unavailable",
        warning: null
      });
    }

    const credential = this.resolveConfiguredCredentialRef(execution.bundle, WEB_SEARCH_TOOL_CODE);
    if (credential === null) {
      return this.createToolExecutionOutcome(toolCall, {
        toolCode: WEB_SEARCH_TOOL_CODE,
        executionMode: "inline",
        provider: null,
        query: request.query,
        summary: null,
        hits: [],
        externalContent: null,
        action: "skipped",
        reason: "credential_not_configured",
        warning: null
      });
    }

    const providerId = this.resolveCurrentNativeWebSearchProviderId(credential.providerId ?? null);
    if (providerId === null) {
      return this.createToolExecutionOutcome(toolCall, {
        toolCode: WEB_SEARCH_TOOL_CODE,
        executionMode: "inline",
        provider: null,
        query: request.query,
        summary: null,
        hits: [],
        externalContent: null,
        action: "skipped",
        reason: "provider_unavailable",
        warning: "Selected web_search provider is not supported by the current native runtime."
      });
    }

    try {
      // ADR-074 L1.1 — always count for observability.
      const quotaOutcome = await this.persaiInternalApiClientService.consumeToolDailyLimit({
        assistantId: execution.bundle.metadata.assistantId,
        toolCode: WEB_SEARCH_TOOL_CODE,
        dailyCallLimit: policy.dailyCallLimit
      });
      if (!quotaOutcome.allowed) {
        return this.createToolExecutionOutcome(toolCall, {
          toolCode: WEB_SEARCH_TOOL_CODE,
          executionMode: "inline",
          provider: providerId,
          query: request.query,
          summary: null,
          hits: [],
          externalContent: null,
          action: "skipped",
          reason: quotaOutcome.code,
          warning: quotaOutcome.message
        });
      }

      const providerResult = await this.providerGatewayClientService.webSearch({
        query: request.query,
        count: request.count,
        credential: {
          toolCode: WEB_SEARCH_TOOL_CODE,
          secretId: credential.secretRef.id,
          providerId
        }
      });
      return this.createToolExecutionOutcome(toolCall, {
        toolCode: WEB_SEARCH_TOOL_CODE,
        executionMode: "inline",
        provider: providerResult.provider,
        query: providerResult.query,
        summary: providerResult.summary,
        hits: providerResult.hits,
        externalContent: providerResult.externalContent,
        action: "results",
        reason: null,
        warning: providerResult.warning,
        billingFacts: providerResult.billingFacts ?? null
      });
    } catch (error) {
      if (error instanceof HttpException) {
        return this.createToolExecutionOutcome(
          toolCall,
          {
            toolCode: WEB_SEARCH_TOOL_CODE,
            executionMode: "inline",
            provider: providerId,
            query: request.query,
            summary: null,
            hits: [],
            externalContent: null,
            action: "skipped",
            reason: "search_failed",
            warning: error.message
          },
          true
        );
      }
      throw error;
    }
  }

  private async executeWebFetchTool(
    execution: PreparedTurnExecution,
    toolCall: ProviderGatewayToolCall
  ): Promise<ToolExecutionOutcome> {
    const request = this.readWebFetchArguments(toolCall.arguments);
    if (request instanceof Error) {
      return this.createToolExecutionOutcome(
        toolCall,
        {
          toolCode: WEB_FETCH_TOOL_CODE,
          executionMode: "inline",
          document: null,
          action: "skipped",
          reason: "invalid_arguments",
          warning: request.message
        },
        true
      );
    }

    const policy = this.resolveAllowedInlineToolPolicy(execution.bundle, WEB_FETCH_TOOL_CODE);
    if (policy === null) {
      return this.createToolExecutionOutcome(toolCall, {
        toolCode: WEB_FETCH_TOOL_CODE,
        executionMode: "inline",
        document: null,
        action: "skipped",
        reason: "tool_unavailable",
        warning: null
      });
    }

    const credential = this.resolveConfiguredCredentialRef(execution.bundle, WEB_FETCH_TOOL_CODE);
    if (credential === null) {
      return this.createToolExecutionOutcome(toolCall, {
        toolCode: WEB_FETCH_TOOL_CODE,
        executionMode: "inline",
        document: null,
        action: "skipped",
        reason: "credential_not_configured",
        warning: null
      });
    }

    try {
      // ADR-074 L1.1 — always count for observability.
      const quotaOutcome = await this.persaiInternalApiClientService.consumeToolDailyLimit({
        assistantId: execution.bundle.metadata.assistantId,
        toolCode: WEB_FETCH_TOOL_CODE,
        dailyCallLimit: policy.dailyCallLimit
      });
      if (!quotaOutcome.allowed) {
        return this.createToolExecutionOutcome(toolCall, {
          toolCode: WEB_FETCH_TOOL_CODE,
          executionMode: "inline",
          document: null,
          action: "skipped",
          reason: quotaOutcome.code,
          warning: quotaOutcome.message
        });
      }

      const providerResult = await this.providerGatewayClientService.webFetch({
        url: request.url,
        extractMode: request.extractMode,
        maxChars: request.maxChars,
        credential: {
          toolCode: WEB_FETCH_TOOL_CODE,
          secretId: credential.secretRef.id,
          providerId: credential.providerId ?? null
        }
      });
      return this.createToolExecutionOutcome(toolCall, {
        toolCode: WEB_FETCH_TOOL_CODE,
        executionMode: "inline",
        document: {
          url: providerResult.url,
          finalUrl: providerResult.finalUrl,
          title: providerResult.title,
          content: providerResult.content,
          contentType: providerResult.contentType,
          extractMode: providerResult.extractMode,
          provider: providerResult.provider,
          status: providerResult.status,
          truncated: providerResult.truncated,
          fetchedAt: providerResult.fetchedAt,
          tookMs: providerResult.tookMs,
          warning: providerResult.warning,
          externalContent: providerResult.externalContent
        },
        action: "fetched",
        reason: null,
        warning: providerResult.warning,
        billingFacts: providerResult.billingFacts ?? null
      });
    } catch (error) {
      if (error instanceof HttpException) {
        return this.createToolExecutionOutcome(
          toolCall,
          {
            toolCode: WEB_FETCH_TOOL_CODE,
            executionMode: "inline",
            document: null,
            action: "skipped",
            reason: "fetch_failed",
            warning: error.message
          },
          true
        );
      }
      throw error;
    }
  }

  private createToolExecutionOutcome(
    toolCall: ProviderGatewayToolCall,
    payload:
      | RuntimeSharedCompactionToolResult
      | RuntimeKnowledgeSearchToolResult
      | RuntimeKnowledgeFetchToolResult
      | RuntimeMemoryWriteToolResult
      | RuntimeTodoWriteToolResult
      | RuntimeQuotaStatusToolResult
      | RuntimeBrowserToolResult
      | RuntimeDocumentToolResult
      | RuntimeFilesToolResult
      | RuntimeGrepToolResult
      | RuntimeGlobToolResult
      | RuntimeImageEditToolResult
      | RuntimeImageGenerateToolResult
      | RuntimeSandboxToolResult
      | RuntimeScheduledActionToolResult
      | RuntimeBackgroundTaskToolResult
      | RuntimeTtsToolResult
      | RuntimeVideoGenerateToolResult
      | RuntimeWebSearchToolResult
      | RuntimeWebFetchToolResult
      | Record<string, unknown>,
    isError = false,
    sharedCompaction?: ToolExecutionOutcome["sharedCompaction"],
    artifacts?: RuntimeOutputArtifact[],
    discoveredFileHandles?: RuntimeFileHandle[],
    pendingFilePreviewBlocks?: ProviderGatewayMessageContentBlock[]
  ): ToolExecutionOutcome {
    return {
      exchange: {
        toolCall,
        toolResult: {
          toolCallId: toolCall.id,
          name: toolCall.name,
          // FIX 2 — strip presentation-only fields (`filename`, `objectKey`,
          // `artifactId`, `sizeBytes`) from `RuntimeOutputArtifact`-shaped
          // entries in the LLM-visible JSON. The model used to quote
          // `filename` back into its assistant text (e.g., the bug case
          // "interesting_scene.png" appearing both as inline text AND as
          // the attached image label). The internal `payload` and
          // `outcome.artifacts` continue to carry full metadata for
          // observability and for the API/storage attachment pipeline.
          content: stringifyToolResultPayloadForModel(payload),
          isError
        }
      },
      payload,
      ...(artifacts === undefined ? {} : { artifacts }),
      ...(discoveredFileHandles === undefined || discoveredFileHandles.length === 0
        ? {}
        : { discoveredFileHandles }),
      ...(sharedCompaction === undefined ? {} : { sharedCompaction }),
      ...(pendingFilePreviewBlocks === undefined || pendingFilePreviewBlocks.length === 0
        ? {}
        : { pendingFilePreviewBlocks })
    };
  }

  private buildToolLoopProviderRequest(
    baseRequest: ProviderGatewayTextGenerateRequest,
    input: {
      assistantText: string;
      baseDeveloperInstructionSections: DeveloperInstructionSection[];
      toolHistory: ProviderGatewayToolExchange[];
      availableToolNames: string[];
      availableWorkingFileHandles: RuntimeFileHandle[];
      closedOpenLoopRefs: string[];
      forceFinalTextOnly?: boolean;
      deferredMediaJobs?: RuntimeDeferredMediaJobSummary[];
      deferredDocumentJobs?: TurnExecutionState["deferredDocumentJobs"];
      pendingFilePreviewBlocks?: ProviderGatewayMessageContentBlock[];
      requestMetadata: ProviderGatewayRequestMetadata;
    }
  ): ProviderGatewayTextGenerateRequest {
    const assistantText = this.normalizeOptionalText(input.assistantText);
    const developerInstructions = this.buildToolLoopDeveloperInstructions(
      input.baseDeveloperInstructionSections,
      input.availableWorkingFileHandles,
      input.closedOpenLoopRefs,
      input.toolHistory.length > 0,
      input.toolHistory,
      input.availableToolNames,
      input.forceFinalTextOnly === true,
      input.deferredMediaJobs ?? [],
      input.deferredDocumentJobs ?? []
    );
    const pendingFilePreviewBlocks = input.pendingFilePreviewBlocks ?? [];
    return {
      ...baseRequest,
      ...(developerInstructions === null ? {} : { developerInstructions }),
      messages:
        assistantText === null
          ? baseRequest.messages
          : [
              ...baseRequest.messages,
              {
                role: "assistant",
                content: assistantText
              }
            ],
      ...(input.toolHistory.length === 0 ? {} : { toolHistory: input.toolHistory }),
      ...(pendingFilePreviewBlocks.length === 0
        ? {}
        : { toolFollowUpUserContent: pendingFilePreviewBlocks }),
      ...(input.forceFinalTextOnly === true ? { tools: [], toolChoice: "none" as const } : {}),
      requestMetadata: input.requestMetadata
    };
  }

  private buildContextOverflowRecoveryProviderRequest(
    baseRequest: ProviderGatewayTextGenerateRequest
  ): ProviderGatewayTextGenerateRequest {
    const recoveryInstruction =
      "The previous provider call exceeded the model context window. Do not call tools again. Answer the user honestly and concisely: explain that the available Skill/knowledge context was too large for one pass, summarize what can be answered from the current visible request, and ask for a narrower follow-up if exact source detail is needed.";
    const existingDeveloperInstructions = baseRequest.developerInstructions ?? "";
    const developerInstructions =
      existingDeveloperInstructions.trim().length === 0
        ? recoveryInstruction
        : `${existingDeveloperInstructions}\n\n${recoveryInstruction}`;
    return {
      ...baseRequest,
      developerInstructions,
      tools: [],
      toolChoice: "none"
    };
  }

  private buildToolLoopDeveloperInstructions(
    baseSections: DeveloperInstructionSection[],
    availableWorkingFileHandles: RuntimeFileHandle[],
    closedOpenLoopRefs: string[],
    hasToolHistory: boolean,
    toolHistory: ProviderGatewayToolExchange[],
    availableToolNames: string[],
    forceFinalTextOnly: boolean,
    deferredMediaJobs: RuntimeDeferredMediaJobSummary[],
    deferredDocumentJobs: TurnExecutionState["deferredDocumentJobs"]
  ): string | null {
    let sections = this.replaceDeveloperInstructionSection(
      baseSections,
      "working_files",
      this.buildWorkingFilesDeveloperSection(availableWorkingFileHandles)
    );
    sections = this.replaceDeveloperInstructionSection(
      sections,
      "open_loop_refs",
      this.turnContextHydrationService.pruneClosedOpenLoopRefsDeveloperBlock(
        this.resolveDeveloperInstructionSectionContent(baseSections, "open_loop_refs"),
        closedOpenLoopRefs
      )
    );
    if (!hasToolHistory) {
      return this.renderDeveloperInstructionSections(sections);
    }
    sections = this.replaceDeveloperInstructionSection(
      sections,
      "source_progression",
      this.buildSourceProgressionDeveloperSection(toolHistory, availableToolNames)
    );
    sections = this.replaceDeveloperInstructionSection(
      sections,
      "tool_follow_up",
      forceFinalTextOnly
        ? "A previous tool follow-up returned no visible answer. Do not call any more tools. Return a concise final user-visible answer now, based only on the tool results already provided."
        : "After using tools, always return a concise final user-visible answer. Do not finish the turn with empty output."
    );
    sections = this.replaceDeveloperInstructionSection(
      sections,
      "deferred_media_follow_up",
      deferredMediaJobs.length > 0
        ? this.buildDeferredMediaFollowUpInstruction(deferredMediaJobs)
        : null
    );
    sections = this.replaceDeveloperInstructionSection(
      sections,
      "deferred_document_follow_up",
      deferredDocumentJobs.length > 0
        ? this.buildDeferredDocumentFollowUpInstruction(deferredDocumentJobs)
        : null
    );
    return this.renderDeveloperInstructionSections(sections);
  }

  private buildSourceProgressionDeveloperSection(
    toolHistory: readonly ProviderGatewayToolExchange[],
    availableToolNames: readonly string[]
  ): string | null {
    const usedToolNames = new Set(toolHistory.map((exchange) => exchange.toolCall.name));
    const availableToolNameSet = new Set(availableToolNames);
    const usedLocalContext =
      usedToolNames.has("knowledge_search") ||
      usedToolNames.has("knowledge_fetch") ||
      usedToolNames.has("files");
    const usedExternalContext =
      usedToolNames.has("web_search") ||
      usedToolNames.has("web_fetch") ||
      usedToolNames.has("browser");
    const canUseExternalContext =
      availableToolNameSet.has("web_search") ||
      availableToolNameSet.has("web_fetch") ||
      availableToolNameSet.has("browser");
    const canUseLocalContext =
      availableToolNameSet.has("knowledge_search") ||
      availableToolNameSet.has("knowledge_fetch") ||
      availableToolNameSet.has("files");
    if (!usedLocalContext && !usedExternalContext) {
      return null;
    }
    const lines = ["## Source progression"];
    if (usedLocalContext && !usedExternalContext && canUseExternalContext) {
      lines.push(
        "You have already checked local or project context. If it still does not directly answer the task, continue to external verification before finalizing."
      );
      lines.push(
        "Prefer the next missing source, not another generic summary of the same local evidence."
      );
      return lines.join("\n");
    }
    if (usedExternalContext && canUseLocalContext) {
      lines.push(
        "You already pulled external context. Compare it back against the local files, Skills, or retrieved knowledge before giving the final answer."
      );
      lines.push(
        "If the sources still disagree or stay partial, do one narrower follow-up pass instead of concluding early."
      );
      return lines.join("\n");
    }
    if (usedLocalContext) {
      lines.push(
        "Do not conclude from partial local evidence alone. Keep gathering until the current source actually answers the task."
      );
      return lines.join("\n");
    }
    return null;
  }

  private createDeveloperInstructionSections(
    sections: Array<{ key: DeveloperInstructionSectionKey; content: string | null }>
  ): DeveloperInstructionSection[] {
    return sections.flatMap((section) => {
      const content = this.normalizeOptionalText(section.content);
      return content === null ? [] : [{ key: section.key, content }];
    });
  }

  private renderDeveloperInstructionSections(
    sections: DeveloperInstructionSection[]
  ): string | null {
    const rendered = sections
      .map((section) => this.normalizeOptionalText(section.content))
      .filter((section): section is string => section !== null)
      .join("\n\n");
    return rendered.length === 0 ? null : rendered;
  }

  private replaceDeveloperInstructionSection(
    sections: DeveloperInstructionSection[],
    key: DeveloperInstructionSectionKey,
    content: string | null
  ): DeveloperInstructionSection[] {
    const normalized = this.normalizeOptionalText(content);
    const next: DeveloperInstructionSection[] = [];
    let replaced = false;
    for (const section of sections) {
      if (section.key !== key) {
        next.push(section);
        continue;
      }
      replaced = true;
      if (normalized !== null) {
        next.push({ key, content: normalized });
      }
    }
    if (!replaced && normalized !== null) {
      next.push({ key, content: normalized });
    }
    return next;
  }

  private resolveDeveloperInstructionSectionContent(
    sections: DeveloperInstructionSection[],
    key: DeveloperInstructionSectionKey
  ): string | null {
    const match = sections.find((section) => section.key === key);
    return match?.content ?? null;
  }

  private formatWorkingFileHistoryLine(
    file: RuntimeFileHandle,
    duplicateDisplayNames: Set<string>,
    collisionIndex: number | null = null
  ): string {
    const createdAt = this.formatWorkingFileCreatedAt(file.createdAt);
    const author = file.authorLabel ?? "model";
    const alias = this.describeWorkingFileStickyLabel(file);
    const filename = this.formatWorkingFileDisplayName(file, duplicateDisplayNames, collisionIndex);
    const markers = this.formatWorkingFileMarkers(file);
    const microDescription = this.formatWorkingFileMicroDescription(file.semanticSummaryHint);
    return `- ${createdAt} | ${author} | ${alias} | ${filename} | ${markers} | ${microDescription}`;
  }

  private buildWorkingFileDocumentPriorityNote(files: RuntimeFileHandle[]): string[] | null {
    const { currentSource, lastDelivered } = this.selectWorkingFileDocumentPriorityAnchors(files);
    const hasDocumentContext =
      currentSource !== null ||
      lastDelivered !== null ||
      files.some((file) => this.isDocumentRelatedWorkingFile(file));
    if (!hasDocumentContext) {
      return null;
    }
    return [
      "Document-tool PDF anchors (not general file recency):",
      `- DOC_CURRENT_SOURCE = ${this.describeWorkingFilePriorityAnchor(currentSource)}`,
      `- DOC_LAST_DELIVERED_PDF = ${this.describeWorkingFilePriorityAnchor(lastDelivered)}`,
      "- Use DOC_CURRENT_SOURCE for new document creation; use DOC_LAST_DELIVERED_PDF only for an explicit PDF revise/redeliver request.",
      "- Older history or discovery entries do not outrank those anchors unless the user explicitly points to them."
    ];
  }

  private buildWorkingFileGeneralFileNote(files: RuntimeFileHandle[]): string[] {
    const lastDeliveredFile = this.selectLastDeliveredWorkingFile(files);
    return [
      "Chat files visible to tools (documents, media, and attachments):",
      `- LAST_DELIVERED_FILE = ${this.describeWorkingFilePriorityAnchor(lastDeliveredFile)}`
    ];
  }

  private selectLastDeliveredWorkingFile(files: RuntimeFileHandle[]): RuntimeFileHandle | null {
    return this.sortWorkingFilesByCreatedAt(files)[0] ?? null;
  }

  private describeWorkingFilePriorityAnchor(file: RuntimeFileHandle | null): string {
    if (file === null) {
      return "none";
    }
    return `${this.resolvePrimaryWorkingFileAlias(file)} | ${this.formatWorkingFileDisplayName(
      file,
      new Set<string>()
    )}`;
  }

  private collectDuplicateWorkingFileNames(files: RuntimeFileHandle[]): Set<string> {
    const counts = new Map<string, number>();
    for (const file of files) {
      const displayName = this.resolveWorkingFileDisplayName(file).toLowerCase();
      counts.set(displayName, (counts.get(displayName) ?? 0) + 1);
    }
    return new Set(
      [...counts.entries()].filter(([, count]) => count > 1).map(([displayName]) => displayName)
    );
  }

  private resolvePrimaryWorkingFileAlias(file: RuntimeFileHandle): string {
    const aliases = (file.aliases ?? [])
      .map((alias) => alias.trim())
      .filter((alias) => alias.length > 0);
    if (aliases.length === 0) {
      return "unaliased file";
    }
    const imageAlias = aliases.find((alias) => /^image #\d+$/i.test(alias));
    if (imageAlias !== undefined) {
      return imageAlias;
    }
    const fileAlias = aliases.find((alias) => /^file #\d+$/i.test(alias));
    if (fileAlias !== undefined) {
      return fileAlias;
    }
    return aliases[0] ?? "unaliased file";
  }

  private resolveStickyFileAlias(file: RuntimeFileHandle): string | null {
    return (file.aliases ?? []).find((alias) => /^file #\d+$/i.test(alias.trim()))?.trim() ?? null;
  }

  private resolveStickyImageAlias(file: RuntimeFileHandle): string | null {
    return (file.aliases ?? []).find((alias) => /^image #\d+$/i.test(alias.trim()))?.trim() ?? null;
  }

  private describeWorkingFileStickyLabel(file: RuntimeFileHandle): string {
    const imageAlias = this.resolveStickyImageAlias(file);
    const fileAlias = this.resolveStickyFileAlias(file);
    if (imageAlias !== null && fileAlias !== null) {
      return `${imageAlias} (${fileAlias})`;
    }
    return imageAlias ?? fileAlias ?? this.resolvePrimaryWorkingFileAlias(file);
  }

  private formatWorkingFileMarkers(file: RuntimeFileHandle): string {
    const markers: string[] = [];
    if (this.isCurrentSourceWorkingFile(file)) {
      markers.push("current source");
    }
    if (this.isLastDeliveredDocumentResultWorkingFile(file)) {
      markers.push("last delivered result");
    }
    if (this.isRecentWorkingFile(file)) {
      markers.push("recent");
    }
    return markers.length === 0 ? "-" : markers.join(", ");
  }

  private isRecentWorkingFile(file: RuntimeFileHandle): boolean {
    const createdAtMs = this.parseWorkingFileCreatedAtMs(file.createdAt);
    if (createdAtMs === 0) {
      return false;
    }
    return Date.now() - createdAtMs <= 1000 * 60 * 60 * 24 * 7;
  }

  private resolveWorkingFileDisplayName(file: RuntimeFileHandle): string {
    return file.displayName ?? file.storagePath.split("/").pop() ?? "file";
  }

  private formatWorkingFileDisplayName(
    file: RuntimeFileHandle,
    duplicateDisplayNames: Set<string>,
    collisionIndex: number | null = null
  ): string {
    const displayName = this.resolveWorkingFileDisplayName(file);
    if (!duplicateDisplayNames.has(displayName.toLowerCase()) || collisionIndex === null) {
      return displayName;
    }
    return `${displayName} [#${collisionIndex}]`;
  }

  private formatWorkingFileMicroDescription(summary: string | null | undefined): string {
    const normalized = summary?.replace(/\s+/g, " ").trim() ?? "";
    if (normalized.length === 0) {
      return "-";
    }
    return normalized.slice(0, MAX_WORKING_FILE_MICRO_DESCRIPTION_CHARS);
  }

  private resolveWorkingFileAuthorLabel(
    authorLabel: RuntimeFileHandle["authorLabel"]
  ): NonNullable<RuntimeFileHandle["authorLabel"]> {
    return authorLabel ?? "model";
  }

  private formatWorkingFileCreatedAt(createdAt: string | undefined): string {
    if (typeof createdAt !== "string" || createdAt.trim().length === 0) {
      return "unknown";
    }
    const parsed = new Date(createdAt);
    if (Number.isNaN(parsed.getTime())) {
      return "unknown";
    }
    const year = String(parsed.getUTCFullYear());
    const month = String(parsed.getUTCMonth() + 1).padStart(2, "0");
    const day = String(parsed.getUTCDate()).padStart(2, "0");
    const hours = String(parsed.getUTCHours()).padStart(2, "0");
    const minutes = String(parsed.getUTCMinutes()).padStart(2, "0");
    return `${year}-${month}-${day} ${hours}:${minutes}`;
  }

  private limitModelVisibleWorkingFiles(
    availableWorkingFileHandles: RuntimeFileHandle[]
  ): RuntimeFileHandle[] {
    const sorted = this.sortWorkingFilesByCreatedAt(availableWorkingFileHandles);
    if (sorted.length <= MAX_MODEL_VISIBLE_WORKING_FILES) {
      return sorted;
    }
    const { currentSource, lastDelivered } = this.selectWorkingFileDocumentPriorityAnchors(sorted);
    const requiredFileRefs = new Set(
      [currentSource, lastDelivered]
        .filter((file): file is RuntimeFileHandle => file !== null)
        .map((file) => file.storagePath)
    );
    const visible = [...sorted.slice(0, MAX_MODEL_VISIBLE_WORKING_FILES)];
    const visibleFileRefs = new Set(visible.map((file) => file.storagePath));
    for (const file of [currentSource, lastDelivered]) {
      if (file !== null && !visibleFileRefs.has(file.storagePath)) {
        visible.push(file);
        visibleFileRefs.add(file.storagePath);
      }
    }
    const ordered = this.sortWorkingFilesByCreatedAt(visible);
    while (ordered.length > MAX_MODEL_VISIBLE_WORKING_FILES) {
      const removableIndex = [...ordered]
        .reverse()
        .findIndex((file) => !requiredFileRefs.has(file.storagePath));
      if (removableIndex === -1) {
        break;
      }
      const actualIndex = ordered.length - 1 - removableIndex;
      ordered.splice(actualIndex, 1);
    }
    return ordered;
  }

  private parseWorkingFileCreatedAtMs(createdAt: string | undefined): number {
    if (typeof createdAt !== "string" || createdAt.trim().length === 0) {
      return 0;
    }
    const parsed = Date.parse(createdAt);
    return Number.isNaN(parsed) ? 0 : parsed;
  }

  private sortWorkingFilesByCreatedAt(files: RuntimeFileHandle[]): RuntimeFileHandle[] {
    return [...files].sort((left, right) => {
      const createdAtDiff =
        this.parseWorkingFileCreatedAtMs(right.createdAt) -
        this.parseWorkingFileCreatedAtMs(left.createdAt);
      if (createdAtDiff !== 0) {
        return createdAtDiff;
      }
      return right.storagePath.localeCompare(left.storagePath);
    });
  }

  private selectWorkingFileDocumentPriorityAnchors(files: RuntimeFileHandle[]): {
    currentSource: RuntimeFileHandle | null;
    lastDelivered: RuntimeFileHandle | null;
  } {
    const sorted = this.sortWorkingFilesByCreatedAt(files);
    return {
      currentSource: sorted.find((file) => this.isCurrentSourceWorkingFile(file)) ?? null,
      lastDelivered:
        sorted.find((file) => this.isLastDeliveredDocumentResultWorkingFile(file)) ?? null
    };
  }

  private sanitizeLegacyTechnicalAttachmentSummary(assistantText: string | null): string | null {
    if (assistantText === null || assistantText.trim().length === 0) {
      return null;
    }
    const sanitized = assistantText
      .split("\n")
      .filter((line) => {
        const trimmed = line.trim();
        return !LEGACY_TECHNICAL_ATTACHMENT_SUMMARY_PATTERNS.some((pattern) =>
          pattern.test(trimmed)
        );
      })
      .join("\n")
      .replace(/\n{3,}/g, "\n\n");
    return sanitized.trim().length === 0 ? null : sanitized;
  }

  private mergeAssistantTurnText(existingText: string, nextText: string | null): string {
    const sanitizedNextText = this.sanitizeLegacyTechnicalAttachmentSummary(nextText);
    if (
      sanitizedNextText === null ||
      sanitizedNextText.length === 0 ||
      sanitizedNextText.trim().length === 0
    ) {
      return existingText;
    }
    if (existingText.length === 0) {
      return sanitizedNextText;
    }
    if (sanitizedNextText === existingText) {
      return existingText;
    }
    if (sanitizedNextText.startsWith(existingText)) {
      return sanitizedNextText;
    }
    if (existingText.startsWith(sanitizedNextText)) {
      return existingText;
    }
    const needsSegmentSeparator =
      !/\n\s*$/.test(existingText) &&
      !/^\s*\n/.test(sanitizedNextText) &&
      !/^[,.;:!?)]/.test(sanitizedNextText);
    return needsSegmentSeparator
      ? `${existingText}\n\n${sanitizedNextText.trimStart()}`
      : `${existingText}${sanitizedNextText}`;
  }

  private withAssistantText(
    providerResult: ProviderGatewayTextGenerateResult,
    assistantText: string
  ): ProviderGatewayTextGenerateResult {
    return {
      ...providerResult,
      text: this.normalizeOptionalText(assistantText)
    };
  }

  private applyAssistantTextCorrections(input: {
    assistantText: string;
    artifacts: RuntimeOutputArtifact[];
    deferredMediaJobs: RuntimeDeferredMediaJobSummary[];
    deferredDocumentJobs: TurnExecutionState["deferredDocumentJobs"];
    locale: string | null;
  }): string {
    const normalizedText = this.normalizeOptionalText(input.assistantText) ?? "";
    const deferredCorrected = this.applyDeferredMediaAcknowledgementCorrection(
      normalizedText,
      input.artifacts,
      input.deferredMediaJobs,
      input.locale
    );
    return this.applyDeferredDocumentAcknowledgementCorrection(
      deferredCorrected,
      input.artifacts,
      input.deferredDocumentJobs,
      input.locale
    );
  }

  /**
   * Model-owned-reply policy for deferred background jobs (image_generate,
   * image_edit, video_generate, and every document job): when the model
   * produced any non-empty text alongside a deferred job we preserve it
   * verbatim. Honesty about the pending delivery is enforced upstream by the
   * developer-tail `buildDeferredMediaFollowUpInstruction` /
   * `buildDeferredDocumentFollowUpInstruction` and by the global
   * DELIVERY_HONESTY_CONTRACT — both forbid the model from claiming
   * attachment/upload/delivery in prose. The canonical acknowledgement is
   * kept strictly as a fallback for the empty-reply case so the user always
   * sees an explicit "request accepted" line. Web stream, web sync, and
   * Telegram all share this single code path.
   */
  private applyDeferredMediaAcknowledgementCorrection(
    assistantText: string,
    artifacts: RuntimeOutputArtifact[],
    deferredMediaJobs: RuntimeDeferredMediaJobSummary[],
    locale: string | null
  ): string {
    const normalizedText = this.normalizeOptionalText(assistantText) ?? "";
    if (deferredMediaJobs.length === 0 || artifacts.length > 0) {
      return normalizedText;
    }
    if (normalizedText.length > 0) {
      return normalizedText;
    }
    return this.buildDeferredMediaAcknowledgement(locale, deferredMediaJobs);
  }

  private applyDeferredDocumentAcknowledgementCorrection(
    assistantText: string,
    artifacts: RuntimeOutputArtifact[],
    deferredDocumentJobs: TurnExecutionState["deferredDocumentJobs"],
    locale: string | null
  ): string {
    const normalizedText = this.normalizeOptionalText(assistantText) ?? "";
    if (deferredDocumentJobs.length === 0 || artifacts.length > 0) {
      return normalizedText;
    }
    if (normalizedText.length > 0) {
      return normalizedText;
    }
    return this.buildDeferredDocumentAcknowledgement(locale, deferredDocumentJobs);
  }

  private buildDeferredMediaAcknowledgement(
    locale: string | null,
    deferredMediaJobs: RuntimeDeferredMediaJobSummary[]
  ): string {
    const primaryToolCode = deferredMediaJobs[0]?.toolCode ?? null;
    const hasMixedTools = deferredMediaJobs.some((job) => job.toolCode !== primaryToolCode);
    if (locale?.toLowerCase().startsWith("ru")) {
      if (hasMixedTools || primaryToolCode === null) {
        return "Запрос принят. Готовлю медиа и пришлю результат отдельно, когда всё будет готово.";
      }
      switch (primaryToolCode) {
        case IMAGE_EDIT_TOOL_CODE:
          return "Запрос принят. Редактирую изображение и пришлю его отдельно, когда оно будет готово.";
        case VIDEO_GENERATE_TOOL_CODE:
          return "Запрос принят. Готовлю видео и пришлю его отдельно, когда оно будет готово.";
        case IMAGE_GENERATE_TOOL_CODE:
        default:
          return "Запрос принят. Делаю изображение и пришлю его отдельно, когда оно будет готово.";
      }
    }
    if (hasMixedTools || primaryToolCode === null) {
      return "Request accepted. I am preparing the media and will send the result separately when it is ready.";
    }
    switch (primaryToolCode) {
      case IMAGE_EDIT_TOOL_CODE:
        return "Request accepted. I am editing the image and will send it separately when it is ready.";
      case VIDEO_GENERATE_TOOL_CODE:
        return "Request accepted. I am preparing the video and will send it separately when it is ready.";
      case IMAGE_GENERATE_TOOL_CODE:
      default:
        return "Request accepted. I am generating the image and will send it separately when it is ready.";
    }
  }

  private buildDeferredDocumentAcknowledgement(
    locale: string | null,
    deferredDocumentJobs: TurnExecutionState["deferredDocumentJobs"]
  ): string {
    const primaryDescriptorMode = deferredDocumentJobs[0]?.descriptorMode ?? null;
    const hasMixedModes = deferredDocumentJobs.some(
      (job) => job.descriptorMode !== primaryDescriptorMode
    );
    if (locale?.toLowerCase().startsWith("ru")) {
      if (hasMixedModes || primaryDescriptorMode === null) {
        return "Запрос принят. Готовлю документ и пришлю его отдельно, когда он будет готов.";
      }
      switch (primaryDescriptorMode) {
        case "create_presentation":
          return "Запрос принят. Готовлю презентацию и пришлю её отдельно, когда она будет готова.";
        case "revise_document":
          return "Запрос принят. Обновляю документ и пришлю новую версию отдельно, когда она будет готова.";
        case "export_or_redeliver":
          return "Запрос принят. Готовлю документ и пришлю его отдельно, когда он будет готов.";
        case "create_pdf_document":
        default:
          return "Запрос принят. Готовлю документ и пришлю его отдельно, когда он будет готов.";
      }
    }
    if (hasMixedModes || primaryDescriptorMode === null) {
      return "Request accepted. I am preparing the document and will send it separately when it is ready.";
    }
    switch (primaryDescriptorMode) {
      case "create_presentation":
        return "Request accepted. I am preparing the presentation and will send it separately when it is ready.";
      case "revise_document":
        return "Request accepted. I am revising the document and will send the updated version separately when it is ready.";
      case "export_or_redeliver":
        return "Request accepted. I am preparing the document and will send it separately when it is ready.";
      case "create_pdf_document":
      default:
        return "Request accepted. I am preparing the document and will send it separately when it is ready.";
    }
  }

  private buildDeferredMediaFollowUpInstruction(
    deferredMediaJobs: RuntimeDeferredMediaJobSummary[]
  ): string {
    const subject =
      deferredMediaJobs.length === 1
        ? deferredMediaJobs[0]?.toolCode === IMAGE_EDIT_TOOL_CODE
          ? "The image edit"
          : deferredMediaJobs[0]?.toolCode === VIDEO_GENERATE_TOOL_CODE
            ? "The video request"
            : "The image request"
        : "The media requests";
    return [
      `${subject} from this same turn was accepted for async background processing.`,
      "Do not describe the final media as already generated, ready, visible in chat, attached, uploaded, or sent.",
      "Acknowledge in your reply that the request is in progress and the final media will arrive separately when ready.",
      "You may continue with other independent work in the same turn — call other tools, advance other plan steps, or queue additional media jobs. Do not stop just to wait for user confirmation between independent background jobs.",
      "Do not print raw tool JSON, job ids, filenames, or imagined result details."
    ].join(" ");
  }

  private buildDeferredDocumentFollowUpInstruction(
    deferredDocumentJobs: TurnExecutionState["deferredDocumentJobs"]
  ): string {
    const subject =
      deferredDocumentJobs.length === 1
        ? deferredDocumentJobs[0]?.descriptorMode === "create_presentation"
          ? "The presentation request"
          : deferredDocumentJobs[0]?.descriptorMode === "revise_document"
            ? "The document revision"
            : "The document request"
        : "The document requests";
    return [
      `${subject} from this same turn was accepted for async background processing.`,
      "The document tool result is pending_delivery with canSendFileNow=false until backend delivery completes.",
      "Do not describe the final document as already generated, ready, visible in chat, attached, uploaded, or sent.",
      "Do not attempt to deliver this document or any file from this turn via the files tool.",
      "Acknowledge in your reply that the request is in progress and the final document will arrive separately when ready.",
      "You may continue with other independent work in the same turn — call other tools, advance other plan steps, or queue additional document jobs. Do not stop just to wait for user confirmation between independent background jobs.",
      "Do not print raw tool JSON, job ids, filenames, or imagined result details."
    ].join(" ");
  }

  private resolveCompletedStreamAssistantText(
    iterationBaseText: string,
    accumulatedText: string,
    providerText: string | null
  ): string {
    const candidateText = this.mergeAssistantTurnText(iterationBaseText, providerText);
    if (candidateText.length === 0) {
      return accumulatedText;
    }
    if (accumulatedText.length === 0) {
      return candidateText;
    }
    if (candidateText === accumulatedText) {
      return accumulatedText;
    }
    if (candidateText.startsWith(accumulatedText)) {
      return candidateText;
    }
    if (accumulatedText.startsWith(candidateText)) {
      return accumulatedText;
    }
    return candidateText;
  }

  private createVisibleTextDeltaStreamEvent(input: {
    acceptedTurn: AcceptedRuntimeTurn;
    previousDeliveredText: string;
    nextVisibleText: string;
    source: RuntimeTextDeltaSource;
  }): Extract<RuntimeTurnStreamEvent, { type: "text_delta" }> | null {
    const delta = this.resolveVisibleTextDelta(input.previousDeliveredText, input.nextVisibleText);
    if (delta === null) {
      return null;
    }
    return {
      type: "text_delta",
      requestId: input.acceptedTurn.receipt.requestId,
      sessionId: input.acceptedTurn.session.sessionId,
      delta,
      accumulatedText: input.nextVisibleText,
      source: input.source
    };
  }

  private resolveVisibleTextDelta(previousText: string, nextText: string): string | null {
    if (nextText.length === 0 || nextText === previousText) {
      return null;
    }
    if (previousText.length === 0) {
      return nextText;
    }
    if (!nextText.startsWith(previousText)) {
      return null;
    }
    const delta = nextText.slice(previousText.length);
    return delta.length > 0 ? delta : null;
  }

  private createToolStartedStreamEvent(
    acceptedTurn: AcceptedRuntimeTurn,
    toolCall: ProviderGatewayToolCall
  ): RuntimeTurnStreamEvent {
    return {
      type: "tool_started",
      requestId: acceptedTurn.receipt.requestId,
      sessionId: acceptedTurn.session.sessionId,
      toolCallId: toolCall.id,
      toolName: toolCall.name
    };
  }

  /**
   * ADR-074 Slice L1: build a per-turn `ToolBudgetPolicy` from the routing
   * decision's resolved execution mode plus per-assistant overrides sourced
   * from the runtime bundle. The policy captures the loop limit (defaults
   * normal=2 / premium=4 / reasoning=8) and tracks per-tool counts within
   * the turn so subsequent calls can be substituted with
   * `tool_budget_exhausted` results once a cap is reached.
   *
   * Resolution order:
   *
   *   - Loop limit per mode: `bundle.runtime.toolBudgets.loopLimitByMode[mode]`
   *     (per-assistant override) → `TOOL_LOOP_LIMIT_BY_MODE[mode]` code
   *     default. Non-positive overrides are ignored so a misconfigured
   *     bundle cannot accidentally turn the loop off.
   *   - Per-tool cap: `RuntimeToolPolicy.perTurnCap` (per-tool override on
   *     the assistant's tool policy) → `TOOL_HARD_CAP_PER_TURN[toolCode]`
   *     code default → uncapped (still bounded by the loop limit).
   */
  private createToolBudgetPolicy(execution: PreparedTurnExecution): ToolBudgetPolicy {
    const mode = execution.routeDecision.executionMode satisfies ToolBudgetExecutionMode;
    const loopLimitOverrides = execution.bundle.runtime.toolBudgets?.loopLimitByMode ?? null;
    const perToolCapOverrides = this.collectPerToolCapOverrides(execution);
    return new ToolBudgetPolicy(mode, {
      loopLimitOverrides,
      perToolCapOverrides
    });
  }

  /**
   * ADR-074 Slice L1: collect every `RuntimeToolPolicy.perTurnCap` that is
   * explicitly set on this assistant's bundle into a single map for the
   * `ToolBudgetPolicy`. Tool policies without an explicit `perTurnCap` are
   * skipped so the code default (`TOOL_HARD_CAP_PER_TURN[toolCode]`) keeps
   * applying. Returns `null` when no overrides are present, so the policy
   * can short-circuit the lookup.
   */
  private collectPerToolCapOverrides(
    execution: PreparedTurnExecution
  ): ReadonlyMap<string, number | null> | null {
    const overrides = new Map<string, number | null>();
    for (const policy of execution.bundle.governance.toolPolicies) {
      const cap = policy.perTurnCap;
      if (cap === undefined || cap === null) {
        continue;
      }
      overrides.set(policy.toolCode, cap);
    }
    return overrides.size === 0 ? null : overrides;
  }

  /**
   * ADR-074 Slice L1: when the budget rejects a tool call, build the
   * structured `tool_budget_exhausted` outcome that flows through the same
   * `toolHistory` / `applyToolExecutionOutcome` pipeline as a real tool
   * result. The model reads it on the next iteration and is expected to
   * wrap up with an honest text reply. Also emits a WARN log line and a
   * trace stage so the smoke harness (S0) and live operators can detect the
   * exhaustion event without parsing tool result bodies.
   */
  private createToolBudgetExhaustedOutcome(input: {
    toolCall: ProviderGatewayToolCall;
    reservation: Extract<ReturnType<ToolBudgetPolicy["reserve"]>, { exhausted: true }>;
    trace: RuntimeStreamTraceCollector | undefined;
    iteration: number;
    acceptedTurn: AcceptedRuntimeTurn;
  }): ToolExecutionOutcome {
    const payload = createToolBudgetExhaustedResult({
      toolName: input.toolCall.name,
      reservation: input.reservation
    });
    this.logger.warn(
      `[tool-budget-exhausted] requestId=${input.acceptedTurn.receipt.requestId} sessionId=${input.acceptedTurn.session.sessionId} tool=${input.toolCall.name} reason=${payload.budgetReason} limit=${String(payload.limit)} observed=${String(payload.observed)} iteration=${String(input.iteration)}`
    );
    input.trace?.stage(
      `iter${String(input.iteration)}.tool_budget_exhausted.${input.toolCall.name}`
    );
    return this.createToolExecutionOutcome(
      input.toolCall,
      { ...payload } as Record<string, unknown>,
      true
    );
  }

  private createToolFinishedStreamEvent(
    acceptedTurn: AcceptedRuntimeTurn,
    toolCall: ProviderGatewayToolCall,
    isError: boolean
  ): RuntimeTurnStreamEvent {
    return {
      type: "tool_finished",
      requestId: acceptedTurn.receipt.requestId,
      sessionId: acceptedTurn.session.sessionId,
      toolCallId: toolCall.id,
      toolName: toolCall.name,
      isError
    };
  }

  private createArtifactStreamEvent(
    acceptedTurn: AcceptedRuntimeTurn,
    artifact: RuntimeOutputArtifact
  ): RuntimeTurnStreamEvent {
    return {
      type: "artifact",
      requestId: acceptedTurn.receipt.requestId,
      sessionId: acceptedTurn.session.sessionId,
      artifact
    };
  }

  private createTurnExecutionState(): TurnExecutionState {
    return {
      sharedCompaction: {
        invoked: false,
        durableStatePersisted: false
      },
      artifacts: [],
      fileHandles: [],
      usageEntries: [],
      toolInvocations: [],
      deferredMediaJobs: [],
      deferredDocumentJobs: [],
      closedOpenLoopRefs: [],
      discoveredFilePathSet: []
    };
  }

  private applyPreparedTurnExecutionState(
    turnState: TurnExecutionState,
    execution: PreparedTurnExecution
  ): void {
    if (execution.preludeUsageEntries.length > 0) {
      turnState.usageEntries.push(...execution.preludeUsageEntries);
    }
  }

  private mergePendingFilePreviewBlocks(
    existing: ProviderGatewayMessageContentBlock[] | undefined,
    incoming: ProviderGatewayMessageContentBlock[]
  ): ProviderGatewayMessageContentBlock[] {
    if (incoming.length === 0) {
      return existing ?? [];
    }
    return [...(existing ?? []), ...incoming];
  }

  private restorePendingFilePreviewBlocksAfterOverflow(
    turnState: TurnExecutionState,
    consumedBlocks: ProviderGatewayMessageContentBlock[] | undefined
  ): void {
    if (consumedBlocks === undefined || consumedBlocks.length === 0) {
      return;
    }
    turnState.pendingFilePreviewBlocks = this.mergePendingFilePreviewBlocks(
      turnState.pendingFilePreviewBlocks,
      consumedBlocks
    );
  }

  private reservePreviewFollowUpIterationIfNeeded(input: {
    turnState: TurnExecutionState;
    iteration: number;
    maxToolLoopIterations: number;
    previewFollowUpExtraIterations: number;
  }): number {
    if (
      input.turnState.pendingFilePreviewBlocks === undefined ||
      input.turnState.pendingFilePreviewBlocks.length === 0
    ) {
      return input.previewFollowUpExtraIterations;
    }
    if (input.iteration + 1 < input.maxToolLoopIterations + input.previewFollowUpExtraIterations) {
      return input.previewFollowUpExtraIterations;
    }
    return Math.max(input.previewFollowUpExtraIterations, 1);
  }

  private extractBillingFactsFromToolPayload(
    payload: ToolExecutionOutcome["payload"]
  ): RuntimeBillingFacts | null {
    if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
      return null;
    }
    const candidate = (payload as { billingFacts?: unknown }).billingFacts;
    if (candidate === null || candidate === undefined) {
      return null;
    }
    if (typeof candidate !== "object" || Array.isArray(candidate)) {
      return null;
    }
    return candidate as RuntimeBillingFacts;
  }

  private applyToolExecutionOutcome(
    turnState: TurnExecutionState,
    outcome: ToolExecutionOutcome,
    iteration: number
  ): void {
    const billingFacts = this.extractBillingFactsFromToolPayload(outcome.payload);
    turnState.toolInvocations.push({
      name: outcome.exchange.toolCall.name,
      iteration,
      ok: outcome.exchange.toolResult.isError !== true,
      toolCallId: outcome.exchange.toolCall.id,
      ...(this.resolveToolInvocationExecutionMode(outcome.payload) === undefined
        ? {}
        : { executionMode: this.resolveToolInvocationExecutionMode(outcome.payload)! }),
      ...(billingFacts === null ? {} : { billingFacts })
    });
    const closedOpenLoopRef = this.extractClosedOpenLoopRef(outcome.payload);
    if (closedOpenLoopRef !== null && !turnState.closedOpenLoopRefs.includes(closedOpenLoopRef)) {
      turnState.closedOpenLoopRefs.push(closedOpenLoopRef);
    }
    if (
      outcome.pendingFilePreviewBlocks !== undefined &&
      outcome.pendingFilePreviewBlocks.length > 0
    ) {
      turnState.pendingFilePreviewBlocks = this.mergePendingFilePreviewBlocks(
        turnState.pendingFilePreviewBlocks,
        outcome.pendingFilePreviewBlocks
      );
    }
    if (outcome.artifacts !== undefined && outcome.artifacts.length > 0) {
      for (const artifact of outcome.artifacts) {
        const existingIndex = turnState.artifacts.findIndex(
          (existingArtifact) => existingArtifact.artifactId === artifact.artifactId
        );
        if (existingIndex >= 0) {
          turnState.artifacts[existingIndex] = artifact;
        } else {
          turnState.artifacts.push(artifact);
        }
        const fileHandle: RuntimeFileHandle = {
          storagePath: artifact.storagePath,
          mimeType: artifact.mimeType,
          sizeBytes: artifact.sizeBytes ?? 0,
          displayName: artifact.filename,
          workspaceId: "",
          sourceToolCode: artifact.sourceToolCode ?? null,
          authorLabel: "model"
        };
        const existingFileIndex = turnState.fileHandles.findIndex(
          (existingFileRef) => existingFileRef.storagePath === fileHandle.storagePath
        );
        if (existingFileIndex >= 0) {
          turnState.fileHandles[existingFileIndex] = fileHandle;
        } else {
          turnState.fileHandles.push(fileHandle);
        }
      }
    }

    const producedFileHandles = this.extractProducedFileHandles(outcome.payload);
    if (producedFileHandles.length > 0) {
      for (const fileHandle of producedFileHandles) {
        const existingIndex = turnState.fileHandles.findIndex(
          (existingFileHandle) => existingFileHandle.storagePath === fileHandle.storagePath
        );
        if (existingIndex >= 0) {
          turnState.fileHandles[existingIndex] = fileHandle;
        } else {
          turnState.fileHandles.push(fileHandle);
        }
      }
    }
    // ADR-100 follow-up — files-tool discovery refs surface as a parallel
    // signal: they don't replace any existing entry for the same storagePath,
    // but they merge the sticky Working Files aliases onto whichever entry
    // already exists so the next provider iteration can address it by
    // absolute pod path (or via `image_edit`) without recomputing
    // recency-based ordinals.
    if (outcome.discoveredFileHandles !== undefined && outcome.discoveredFileHandles.length > 0) {
      for (const discoveredRef of outcome.discoveredFileHandles) {
        const existingIndex = turnState.fileHandles.findIndex(
          (existingFileHandle) => existingFileHandle.storagePath === discoveredRef.storagePath
        );
        if (existingIndex >= 0) {
          const existing = turnState.fileHandles[existingIndex]!;
          turnState.fileHandles[existingIndex] = {
            ...existing,
            aliases: this.mergeFileRefAliases(existing.aliases, discoveredRef.aliases)
          };
        } else {
          turnState.fileHandles.push(discoveredRef);
        }
        // ADR-100 Piece 1 — also track the canonical id for durable persistence
        // so the API can write it to assistant message metadata and future
        // hydration can preserve the same sticky Working Files handle.
        if (
          turnState.discoveredFilePathSet.length < 20 &&
          !turnState.discoveredFilePathSet.includes(discoveredRef.storagePath)
        ) {
          turnState.discoveredFilePathSet.push(discoveredRef.storagePath);
        }
      }
    }
    const toolUsage = this.extractToolUsageSnapshot(outcome.payload);
    if (toolUsage !== null) {
      this.recordUsageEntry(turnState, {
        stepType: "tool_execution",
        modelRole: this.resolveToolUsageModelRole(outcome.exchange.toolCall.name),
        usage: toolUsage,
        toolCode: outcome.exchange.toolCall.name
      });
    }
    if (outcome.sharedCompaction === undefined) {
      const deferredMediaJob = this.extractDeferredMediaJob(outcome.payload);
      if (deferredMediaJob !== null) {
        turnState.deferredMediaJobs.push(deferredMediaJob);
      }
      const deferredDocumentJob = this.extractDeferredDocumentJob(outcome.payload);
      if (deferredDocumentJob !== null) {
        turnState.deferredDocumentJobs.push(deferredDocumentJob);
      }
      return;
    }
    const deferredMediaJob = this.extractDeferredMediaJob(outcome.payload);
    if (deferredMediaJob !== null) {
      turnState.deferredMediaJobs.push(deferredMediaJob);
    }
    const deferredDocumentJob = this.extractDeferredDocumentJob(outcome.payload);
    if (deferredDocumentJob !== null) {
      turnState.deferredDocumentJobs.push(deferredDocumentJob);
    }
    turnState.sharedCompaction.invoked = true;
    turnState.sharedCompaction.durableStatePersisted =
      turnState.sharedCompaction.durableStatePersisted ||
      outcome.sharedCompaction.durableStatePersisted;
  }

  private maybeRefundToolRequestRejectionReservation(
    toolBudgetPolicy: ToolBudgetPolicy,
    entry: PlannedToolExecution | null,
    outcome: ToolExecutionOutcome
  ): void {
    if (entry === null || entry.reservation.exhausted) {
      return;
    }
    if (
      entry.toolCall.name !== IMAGE_GENERATE_TOOL_CODE &&
      entry.toolCall.name !== IMAGE_EDIT_TOOL_CODE &&
      entry.toolCall.name !== VIDEO_GENERATE_TOOL_CODE
    ) {
      return;
    }
    if (!this.isRefundableToolRequestRejectionOutcome(outcome.payload)) {
      return;
    }
    toolBudgetPolicy.refund(entry.toolCall.name, entry.reservedUnits);
  }

  private isRefundableToolRequestRejectionOutcome(payload: unknown): boolean {
    if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
      return false;
    }
    const candidate = payload as { action?: unknown; reason?: unknown };
    return (
      candidate.action === "skipped" &&
      typeof candidate.reason === "string" &&
      REFUNDABLE_TOOL_REQUEST_REJECTION_REASONS.has(candidate.reason)
    );
  }

  private resolveToolInvocationExecutionMode(
    payload: ToolExecutionOutcome["payload"]
  ): RuntimeTurnToolInvocation["executionMode"] | undefined {
    if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
      return undefined;
    }
    const value = (payload as { executionMode?: unknown }).executionMode;
    if (value === "inline" || value === "worker" || value === "sandbox") {
      return value;
    }
    return undefined;
  }

  private extractClosedOpenLoopRef(payload: ToolExecutionOutcome["payload"]): string | null {
    if (
      payload &&
      typeof payload === "object" &&
      "toolCode" in payload &&
      payload.toolCode === MEMORY_WRITE_TOOL_CODE &&
      "action" in payload &&
      payload.action === "closed" &&
      "closedItemRef" in payload &&
      typeof payload.closedItemRef === "string" &&
      payload.closedItemRef.trim().length > 0
    ) {
      return payload.closedItemRef;
    }
    return null;
  }

  private shouldDeferMediaToolExecution(input: RuntimeTurnRequest): boolean {
    return !input.conversation.externalThreadKey.startsWith("system:media-job:");
  }

  private async runPostFinalChatPlanSelfCheck(input: {
    acceptedTurn: AcceptedRuntimeTurn;
    execution: PreparedTurnExecution;
    input: RuntimeTurnRequest;
    turnState: TurnExecutionState;
    providerResult: ProviderGatewayTextGenerateResult;
  }): Promise<ProviderGatewayTextGenerateResult> {
    const originalText = input.providerResult.text ?? "";
    if (
      input.providerResult.stopReason !== "completed" ||
      originalText.trim().length === 0 ||
      input.execution.selfCheckHopsRemaining <= 0 ||
      input.turnState.toolInvocations.length === 0 ||
      !this.hasSubstantiveWorkExcludingTodoWrite(input.turnState)
    ) {
      return input.providerResult;
    }

    try {
      const chatPlan = await this.turnContextHydrationService.buildChatPlanBlock(input.input);
      const todos = chatPlan?.todos ?? [];
      if (todos.length === 0) {
        return input.providerResult;
      }
      const openRows = todos.filter((t) => t.status === "in_progress" || t.status === "pending");
      if (openRows.length === 0) {
        return input.providerResult;
      }

      const reminderMessage: ProviderGatewayTextMessage = {
        role: "user",
        content: this.buildPostFinalSelfCheckReminder(openRows),
        cacheRole: "volatile_context",
        volatileKind: "system_reminder"
      };
      const selfCheckBaseRequest: ProviderGatewayTextGenerateRequest = {
        ...input.execution.providerRequest,
        messages: [
          ...input.execution.providerRequest.messages,
          { role: "assistant", content: originalText },
          reminderMessage
        ],
        requestMetadata: this.createSelfCheckProviderRequestMetadata(input.acceptedTurn)
      };

      const firstResult = await this.callPostFinalSelfCheckProvider({
        acceptedTurn: input.acceptedTurn,
        execution: input.execution,
        request: selfCheckBaseRequest,
        turnState: input.turnState,
        attemptKey: "self_check:0"
      });

      if (firstResult.stopReason === "completed") {
        const text = this.normalizeOptionalText(firstResult.text ?? "") ?? "";
        return text.length > 0 ? this.withAssistantText(firstResult, text) : input.providerResult;
      }

      if (firstResult.stopReason !== "tool_calls" || firstResult.toolCalls.length === 0) {
        return input.providerResult;
      }

      const nonTodoWriteCall = firstResult.toolCalls.find(
        (toolCall) => toolCall.name !== TODO_WRITE_TOOL_CODE
      );
      if (nonTodoWriteCall !== undefined) {
        this.logger.warn(
          `[self-check] rejected non-todo-write follow-up requestId=${input.acceptedTurn.receipt.requestId} tool=${nonTodoWriteCall.name}`
        );
        return input.providerResult;
      }

      const toolHistory: ProviderGatewayToolExchange[] = [];
      for (const toolCall of firstResult.toolCalls) {
        const outcome = await this.executeProjectedToolCall(
          input.execution,
          input.acceptedTurn,
          input.input,
          toolCall,
          input.input.idempotencyKey,
          input.turnState.artifacts,
          input.turnState.fileHandles,
          input.execution.availableWorkingFileHandles
        );
        outcome.exchange.reasoningContent = firstResult.reasoningContent ?? null;
        toolHistory.push(outcome.exchange);
        this.applyToolExecutionOutcome(input.turnState, outcome, 0);
      }

      if (input.execution.selfCheckHopsRemaining <= 0) {
        return input.providerResult;
      }

      const finalRequest = this.buildToolLoopProviderRequest(selfCheckBaseRequest, {
        assistantText: "",
        baseDeveloperInstructionSections: input.execution.developerInstructionSections,
        toolHistory,
        availableToolNames: input.execution.projectedTools.tools.map((tool) => tool.name),
        availableWorkingFileHandles: input.execution.availableWorkingFileHandles,
        closedOpenLoopRefs: input.turnState.closedOpenLoopRefs,
        forceFinalTextOnly: true,
        deferredMediaJobs: input.turnState.deferredMediaJobs,
        deferredDocumentJobs: input.turnState.deferredDocumentJobs,
        requestMetadata: this.createSelfCheckProviderRequestMetadata(input.acceptedTurn)
      });
      const finalResult = await this.callPostFinalSelfCheckProvider({
        acceptedTurn: input.acceptedTurn,
        execution: input.execution,
        request: finalRequest,
        turnState: input.turnState,
        attemptKey: "self_check:1"
      });
      if (finalResult.stopReason !== "completed") {
        return input.providerResult;
      }
      const finalText = this.normalizeOptionalText(finalResult.text ?? "") ?? "";
      return finalText.length > 0
        ? this.withAssistantText(finalResult, finalText)
        : input.providerResult;
    } catch (error) {
      this.logger.warn(
        `[self-check] failed requestId=${input.acceptedTurn.receipt.requestId}: ${this.formatLogError(error)}`
      );
      return input.providerResult;
    }
  }

  private async callPostFinalSelfCheckProvider(input: {
    acceptedTurn: AcceptedRuntimeTurn;
    execution: PreparedTurnExecution;
    request: ProviderGatewayTextGenerateRequest;
    turnState: TurnExecutionState;
    attemptKey: string;
  }): Promise<ProviderGatewayTextGenerateResult> {
    input.execution.selfCheckHopsRemaining = Math.max(
      0,
      input.execution.selfCheckHopsRemaining - 1
    );
    const result = await this.generateTextWithRuntimeFallback({
      bundle: input.execution.bundle,
      request: input.request,
      modelRole: input.execution.selectedModelRole,
      telemetryContext: {
        surface: "turn_sync",
        requestId: input.acceptedTurn.receipt.requestId,
        classification: input.request.requestMetadata?.classification ?? "tool_loop_followup",
        attemptKey: input.attemptKey
      }
    });
    this.recordUsageEntry(input.turnState, {
      stepType: "tool_loop_followup",
      modelRole: input.execution.selectedModelRole,
      usage: result.usage
    });
    return result;
  }

  private hasSubstantiveWorkExcludingTodoWrite(turnState: TurnExecutionState): boolean {
    return (
      turnState.toolInvocations.some((tool) => tool.name !== TODO_WRITE_TOOL_CODE) ||
      turnState.deferredMediaJobs.length > 0 ||
      turnState.deferredDocumentJobs.length > 0 ||
      turnState.artifacts.length > 0
    );
  }

  private buildPostFinalSelfCheckReminder(openRows: readonly RuntimeTodoItem[]): string {
    const renderedRows = openRows
      .slice(0, POST_FINAL_SELF_CHECK_MAX_OPEN_ROWS_RENDERED)
      .map(
        (todo) =>
          `  - "${this.truncatePostFinalSelfCheckTodoTitle(todo.content)}" (${todo.status}, id ${todo.id})`
      );
    const remaining = openRows.length - POST_FINAL_SELF_CHECK_MAX_OPEN_ROWS_RENDERED;
    const moreLine = remaining > 0 ? `\n  ...and ${String(remaining)} more` : "";
    return [
      "You finished your reply but the chat plan still has open rows:",
      `${renderedRows.join("\n")}${moreLine}`,
      "Either: (a) call todo_write to reconcile them (complete the in_progress row if your work satisfies it; bring a pending row to in_progress if it is now your active focus), THEN your final reply will be re-emitted; OR (b) reply with a one-line clarification explaining why these rows remain open intentionally. The user sees both your text and the plan card — open rows next to a closing message is confusing."
    ].join("\n");
  }

  private truncatePostFinalSelfCheckTodoTitle(content: string): string {
    const normalized = content.trim().replace(/\s+/g, " ");
    if (normalized.length <= POST_FINAL_SELF_CHECK_TODO_TITLE_MAX) {
      return normalized;
    }
    return `${normalized.slice(0, POST_FINAL_SELF_CHECK_TODO_TITLE_MAX - 1).trimEnd()}…`;
  }

  private createSelfCheckProviderRequestMetadata(
    acceptedTurn: AcceptedRuntimeTurn
  ): ProviderGatewayRequestMetadata {
    return {
      classification: "tool_loop_followup",
      runtimeRequestId: acceptedTurn.receipt.requestId,
      runtimeSessionId: acceptedTurn.session.sessionId,
      toolLoopIteration: null,
      compactionToolCode: null
    };
  }

  private extractDeferredMediaJob(
    payload: ToolExecutionOutcome["payload"]
  ): RuntimeDeferredMediaJobSummary | null {
    if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
      return null;
    }
    const row = payload as {
      action?: unknown;
      jobId?: unknown;
      toolCode?: unknown;
      messageToUser?: unknown;
      requestedCount?: unknown;
      expectedResultCount?: unknown;
    };
    if (row.action !== "pending_delivery" || typeof row.jobId !== "string") {
      return null;
    }
    if (
      row.toolCode !== IMAGE_GENERATE_TOOL_CODE &&
      row.toolCode !== IMAGE_EDIT_TOOL_CODE &&
      row.toolCode !== VIDEO_GENERATE_TOOL_CODE
    ) {
      return null;
    }
    return {
      jobId: row.jobId,
      toolCode: row.toolCode,
      kind: row.toolCode === VIDEO_GENERATE_TOOL_CODE ? "video" : "image",
      action: "pending_delivery",
      canSendFileNow: false,
      messageToUser: typeof row.messageToUser === "string" ? row.messageToUser : null,
      requestedCount:
        typeof row.requestedCount === "number" && Number.isInteger(row.requestedCount)
          ? row.requestedCount
          : null,
      expectedResultCount:
        typeof row.expectedResultCount === "number" && Number.isInteger(row.expectedResultCount)
          ? row.expectedResultCount
          : null
    };
  }

  private extractDeferredDocumentJob(
    payload: ToolExecutionOutcome["payload"]
  ): TurnExecutionState["deferredDocumentJobs"][number] | null {
    if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
      return null;
    }
    const row = payload as {
      action?: unknown;
      jobId?: unknown;
      docId?: unknown;
      versionId?: unknown;
      toolCode?: unknown;
      descriptorMode?: unknown;
      documentType?: unknown;
    };
    if (
      (row.action !== "deferred" && row.action !== "pending_delivery") ||
      typeof row.jobId !== "string" ||
      row.toolCode !== DOCUMENT_TOOL_CODE
    ) {
      return null;
    }
    if (
      row.descriptorMode !== "create_pdf_document" &&
      row.descriptorMode !== "create_presentation" &&
      row.descriptorMode !== "revise_document" &&
      row.descriptorMode !== "export_or_redeliver"
    ) {
      return null;
    }
    if (row.documentType !== "pdf_document" && row.documentType !== "presentation") {
      return null;
    }
    return {
      jobId: row.jobId,
      toolCode: "document",
      ...(typeof row.docId === "string" && row.docId.length > 0 ? { docId: row.docId } : {}),
      ...(typeof row.versionId === "string" && row.versionId.length > 0
        ? { versionId: row.versionId }
        : {}),
      descriptorMode: row.descriptorMode,
      documentType: row.documentType
    };
  }

  private readFilesRequestedAction(value: unknown): RuntimeFilesToolResult["requestedAction"] {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      return null;
    }
    const action = (value as { action?: unknown }).action;
    return action === "list" ||
      action === "read" ||
      action === "preview" ||
      action === "write" ||
      action === "delete" ||
      action === "attach"
      ? action
      : null;
  }

  /**
   * Case-insensitive alias merge that mirrors
   * `TurnContextHydrationService.mergeAliases` (which is private to that
   * service). Used when merging files-tool discovery refs into
   * `turnState.fileHandles` so the discovered file's sticky Working Files labels
   * are appended to whatever aliases the existing turnState ref already
   * carried, instead of duplicating or silently shadowing them.
   */
  private mergeFileRefAliases(
    existing: string[] | null | undefined,
    next: string[] | null | undefined
  ): string[] {
    const seen = new Set<string>();
    const merged: string[] = [];
    for (const alias of [...(existing ?? []), ...(next ?? [])]) {
      const normalized = alias.trim().toLowerCase();
      if (normalized.length === 0 || seen.has(normalized)) {
        continue;
      }
      seen.add(normalized);
      merged.push(alias);
    }
    return merged;
  }

  private resolveSurfaceThreadKey(conversation: RuntimeTurnRequest["conversation"]): string | null {
    const key = conversation.externalThreadKey;
    if (typeof key !== "string") {
      return null;
    }
    const trimmed = key.trim();
    return trimmed.length === 0 ? null : trimmed;
  }

  private extractProducedFileHandles(
    payload: ToolExecutionOutcome["payload"]
  ): RuntimeFileHandle[] {
    const job = this.resolveProducedFileJob(payload);
    if (job === null || job.files.length === 0) {
      return [];
    }
    return job.files.map((file) => ({
      storagePath: file.storagePath,
      mimeType: file.mimeType,
      sizeBytes: file.sizeBytes,
      displayName: file.displayName,
      workspaceId: "",
      authorLabel: "sandbox" as const
    }));
  }

  private isSandboxToolPayload(
    payload: ToolExecutionOutcome["payload"]
  ): payload is RuntimeSandboxToolResult {
    return (
      payload !== null &&
      typeof payload === "object" &&
      "executionMode" in payload &&
      payload.executionMode === "sandbox"
    );
  }

  private isFilesToolPayload(
    payload: ToolExecutionOutcome["payload"]
  ): payload is RuntimeFilesToolResult {
    return (
      payload !== null &&
      typeof payload === "object" &&
      "toolCode" in payload &&
      payload.toolCode === FILES_TOOL_CODE
    );
  }

  private resolveProducedFileJob(
    payload: ToolExecutionOutcome["payload"]
  ): RuntimeSandboxToolResult["job"] | null {
    if (this.isSandboxToolPayload(payload)) {
      return payload.job;
    }
    return null;
  }

  private buildProviderGatewayStreamOptions(
    signal: AbortSignal | undefined,
    traceEnabled: boolean
  ): { signal?: AbortSignal; traceEnabled?: boolean } | undefined {
    if (signal === undefined && !traceEnabled) {
      return undefined;
    }
    const options: { signal?: AbortSignal; traceEnabled?: boolean } = {};
    if (signal !== undefined) {
      options.signal = signal;
    }
    if (traceEnabled) {
      options.traceEnabled = true;
    }
    return options;
  }

  private async refreshProviderRequestMessages(
    execution: PreparedTurnExecution,
    input: RuntimeTurnRequest
  ): Promise<ProviderGatewayTextGenerateRequest> {
    const hydratedMessages = await this.turnContextHydrationService.buildMessages(
      input,
      execution.bundle
    );
    // ADR-074 Slice T1: presence is per-turn but, because durable compaction
    // can land mid-turn and trigger a context refresh, we also re-render the
    // presence block here so the developer-tail keeps a fresh local time and
    // weekday across the (typically sub-second) refresh window.
    const presenceBlock = await this.turnContextHydrationService.computePresenceBlock(
      input,
      execution.bundle
    );
    const openLoopRefsBlock =
      await this.turnContextHydrationService.computeOpenLoopRefsDeveloperBlock(input);
    const developerInstructionSections = this.buildBaseDeveloperInstructionSections({
      request: input,
      projectedTools: execution.projectedTools,
      availableWorkingFileHandles: execution.availableWorkingFileHandles,
      deepModeEnabled: execution.deepModeEnabled,
      routeDecision: execution.routeDecision,
      openLoopRefsBlock,
      presenceBlock,
      openMediaJobs: input.openMediaJobs,
      openDocumentJobs: input.openDocumentJobs,
      jobDeliveryUpdates: input.jobDeliveryUpdates
    });
    execution.developerInstructionSections = developerInstructionSections;
    const refreshThinkingBudget =
      execution.routeDecision.mode === "active" ? execution.routeDecision.thinkingBudget : 0;
    const refreshedBase = this.buildProviderRequest(
      execution.bundle,
      {
        provider: execution.providerRequest.provider,
        model: execution.providerRequest.model
      },
      hydratedMessages,
      execution.projectedTools,
      execution.deepModeEnabled,
      developerInstructionSections,
      execution.promptMode,
      refreshThinkingBudget,
      this.resolveSlotPromptCacheRetention(execution.bundle, execution.selectedModelRole)
    );
    // ADR-122 Slice 2: propagate the resolved output budget onto the refreshed
    // request so the context-refresh path also sets maxOutputTokens rather than
    // relying on the provider-client fallback.
    const refreshCapability = this.resolveSlotCapability(
      execution.bundle,
      execution.selectedModelRole
    );
    const refreshInputEstimate = estimateProviderRequestInputTokens(refreshedBase);
    return {
      ...refreshedBase,
      maxOutputTokens: resolveModelOutputBudget(refreshCapability, {
        inputTokensEstimate: refreshInputEstimate,
        thinkingBudget: refreshThinkingBudget
      })
    };
  }

  /**
   * ADR-125 Amendment 2 — surgical volatile-prefix swap.
   *
   * Re-renders the volatile prefix (active scenario block + chat-plan block +
   * `<system-reminder>` blocks) from the current `execution.currentSkillDecisionState`
   * and a fresh `buildChatPlanBlock` read, then replaces the leading
   * `execution.volatilePrefixLength` messages of `execution.providerRequest.messages`
   * with the new prefix. The base history (assistant/user messages) is preserved
   * verbatim — we do NOT call `buildMessages` here, so this is cheap (one API
   * read for the chat plan window; the skill state is already in-memory).
   *
   * Called from the tool loop after any iteration whose batch contained a
   * `skill.engage` / `skill.release` / `todo_write` call. The mutation flag is
   * accumulated in {@link maybeApplyVolatileSideEffectFromTool}.
   */
  private async refreshVolatilePrefix(
    execution: PreparedTurnExecution,
    input: RuntimeTurnRequest,
    toolBudgetSnapshot: ToolBudgetSnapshot
  ): Promise<void> {
    const activeScenarioBlock = this.buildActiveScenarioBlockService.buildBlock({
      bundle: execution.bundle,
      skillDecisionState: execution.currentSkillDecisionState
    });
    const chatPlan = await this.turnContextHydrationService.buildChatPlanBlock(input);
    const reminderBlocks = this.buildSystemReminderBlocksService.buildBlocks({
      bundle: execution.bundle,
      skillDecisionState: execution.currentSkillDecisionState,
      currentTurnHasUserAttachedImage: execution.currentTurnHasUserAttachedImage,
      toolBudgetSnapshot,
      chatPlanTodos: chatPlan?.todos ?? null
    });
    const newPrefix: ProviderGatewayTextMessage[] = [];
    if (activeScenarioBlock !== null) newPrefix.push(activeScenarioBlock);
    if (chatPlan !== null) newPrefix.push(chatPlan.block);
    if (reminderBlocks.length > 0) newPrefix.push(...reminderBlocks);
    const base = execution.providerRequest.messages.slice(execution.volatilePrefixLength);
    execution.providerRequest = {
      ...execution.providerRequest,
      messages: [...newPrefix, ...base]
    };
    execution.volatilePrefixLength = newPrefix.length;
  }

  /**
   * ADR-125 Amendment 2 — synthesize the new `RuntimeSkillDecisionState`
   * from a successful `skill.engage` / `skill.release` outcome. Returns
   * `true` when the in-memory state actually changed (so the caller knows
   * to schedule a {@link refreshVolatilePrefix} after the batch). Errors,
   * unrelated tools, and `todo_write` (which mutates the chat plan but not
   * the skill state) are no-ops here — `todo_write` triggers the volatile
   * refresh via {@link toolMutatesVolatilePrefix} directly.
   */
  private maybeApplySkillStateMutationFromTool(
    execution: PreparedTurnExecution,
    outcome: ToolExecutionOutcome
  ): boolean {
    if (outcome.exchange.toolCall.name !== SKILL_TOOL_CODE) {
      return false;
    }
    if (outcome.exchange.toolResult.isError === true) {
      return false;
    }
    const payload = outcome.payload as RuntimeSkillToolResult;
    if ("error" in payload) {
      return false;
    }
    if (payload.action === "released") {
      execution.currentSkillDecisionState = null;
      return true;
    }
    // engaged (with or without a scenario)
    execution.currentSkillDecisionState = {
      status: "active",
      activeSkillId: payload.skillId,
      activeSkillName: payload.skillDisplayName,
      activeScenarioKey: payload.scenarioKey,
      activeScenarioDisplayName: payload.scenario?.displayName ?? null,
      topicSummary: execution.currentSkillDecisionState?.topicSummary ?? null
    };
    return true;
  }

  /**
   * ADR-125 Amendment 2 — true when the tool call mutates DB-backed state that
   * feeds the volatile prefix (skill decision state OR chat plan), and therefore
   * justifies a mid-loop volatile-prefix refresh on the next iteration.
   */
  private toolMutatesVolatilePrefix(toolName: string): boolean {
    return toolName === SKILL_TOOL_CODE || toolName === TODO_WRITE_TOOL_CODE;
  }

  private createTurnProviderRequestMetadata(input: {
    acceptedTurn: AcceptedRuntimeTurn;
    classification: TurnProviderRequestClassification;
    toolLoopIteration: number;
  }): ProviderGatewayRequestMetadata {
    return {
      classification: input.classification,
      runtimeRequestId: input.acceptedTurn.receipt.requestId,
      runtimeSessionId: input.acceptedTurn.session.sessionId,
      toolLoopIteration: input.toolLoopIteration,
      compactionToolCode: null
    };
  }

  /**
   * ADR-124 — when the main turn is routed to a text-only provider (DeepSeek),
   * inline image/PDF blocks cannot be sent to the chat model. We describe each
   * such block once via the plan's `systemTool` slot (a vision-capable
   * OpenAI/Anthropic model) and replace it with text. Vision-capable main
   * providers keep their raw blocks and skip this path entirely. The describer
   * returns null (→ explicit placeholder, never a silent drop or raw pixels)
   * when the systemTool slot is not vision-capable or the describe call fails.
   */
  private buildTextOnlyMultimodalDescriber(
    execution: PreparedTurnExecution,
    acceptedTurn: AcceptedRuntimeTurn
  ): MultimodalBlockDescriber {
    const routing = this.asObject(execution.bundle.runtime.runtimeProviderRouting);
    const systemToolSelection = this.resolveModelSlotSelection(routing, "system_tool");
    const visionSelection =
      systemToolSelection !== null && providerAcceptsMultimodalInput(systemToolSelection.provider)
        ? systemToolSelection
        : null;
    return async (block) => {
      if (visionSelection === null) {
        return null;
      }
      const kind = block.type === "image" ? "image" : "PDF document";
      const result = await this.providerGatewayClientService.generateText({
        provider: visionSelection.provider,
        model: visionSelection.model,
        systemPrompt:
          "You are a hidden vision helper for a text-only chat model. Read the attached " +
          "file and describe its content factually and concisely so the chat model can " +
          "reason about it: capture visible text verbatim where it matters, plus key " +
          "structure, data, and visual details. Do not add commentary or refuse.",
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: `Describe this ${kind} for a text-only assistant.` },
              block
            ]
          }
        ],
        maxOutputTokens: 1024,
        requestMetadata: {
          classification: "turn_routing",
          runtimeRequestId: acceptedTurn.receipt.requestId,
          runtimeSessionId: acceptedTurn.session.sessionId,
          toolLoopIteration: null,
          compactionToolCode: null
        }
      });
      return result.text;
    };
  }

  /**
   * ADR-124 — strip inline image/PDF blocks from the base turn messages once
   * (idempotent: re-running on already text-only messages is a no-op), before
   * the tool loop spreads them into every provider call. No-op for
   * vision-capable main providers.
   */
  private async sanitizeBaseRequestMultimodalForTextOnlyProvider(
    execution: PreparedTurnExecution,
    acceptedTurn: AcceptedRuntimeTurn
  ): Promise<void> {
    if (providerAcceptsMultimodalInput(execution.providerRequest.provider)) {
      return;
    }
    const describe = this.buildTextOnlyMultimodalDescriber(execution, acceptedTurn);
    const sanitizedMessages = await sanitizeMultimodalMessages(
      execution.providerRequest.messages,
      describe
    );
    if (sanitizedMessages !== execution.providerRequest.messages) {
      execution.providerRequest = {
        ...execution.providerRequest,
        messages: sanitizedMessages
      };
    }
  }

  /**
   * ADR-124 — strip inline image/PDF blocks from `files.preview`
   * follow-up content before it reaches a text-only main provider. No-op for
   * vision-capable main providers and for an absent block set.
   */
  private async sanitizePreviewBlocksMultimodalForTextOnlyProvider(
    execution: PreparedTurnExecution,
    acceptedTurn: AcceptedRuntimeTurn,
    blocks: ProviderGatewayMessageContentBlock[] | undefined
  ): Promise<ProviderGatewayMessageContentBlock[] | undefined> {
    if (
      blocks === undefined ||
      providerAcceptsMultimodalInput(execution.providerRequest.provider)
    ) {
      return blocks;
    }
    const describe = this.buildTextOnlyMultimodalDescriber(execution, acceptedTurn);
    const { blocks: sanitized } = await sanitizeMultimodalContentBlocks(blocks, describe);
    return sanitized;
  }

  private buildPromptCacheConfig(input: {
    bundle: AssistantRuntimeBundle;
    provider: NativeManagedProvider;
    family: string;
    promptCacheRetention: ProviderGatewayPromptCacheRetention;
    messages?: ProviderGatewayTextMessage[];
    deepModeEnabled?: boolean;
    projectedTools?: RuntimeNativeToolProjection;
  }): ProviderGatewayPromptCacheConfig | undefined {
    if (input.provider === "anthropic") {
      return input.family === "ordinary_chat" || input.family === "deep_chat"
        ? {
            anthropicHistoryBreakpointMinTokens: ANTHROPIC_HISTORY_BREAKPOINT_MIN_TOKENS
          }
        : {};
    }
    if (input.provider !== "openai") {
      return undefined;
    }
    const stablePrefixHash = this.resolvePromptCacheStablePrefixHash(input.bundle, input.family);
    const stablePrefixToken =
      stablePrefixHash === null
        ? null
        : buildPromptCacheStableBlockToken({
            family: "ordinary_prompt",
            hash: stablePrefixHash
          });
    const hydratedStableBlockTokens =
      input.messages === undefined
        ? []
        : this.resolveHydratedStableBlockTokens(input.messages, input.family);
    const variantHash =
      input.deepModeEnabled === undefined && input.projectedTools === undefined
        ? null
        : createHash("sha256")
            .update(
              JSON.stringify({
                deepModeEnabled: input.deepModeEnabled ?? false,
                tools: input.projectedTools?.tools ?? []
              })
            )
            .digest("hex");
    const identityToken = stablePrefixToken ?? this.computePromptCacheIdentityHash(input.bundle);
    return {
      key: this.buildOpenAIPromptCacheKey({
        bundle: input.bundle,
        family: input.family,
        identityToken,
        hydratedStableBlockTokens,
        variantHash
      }),
      retention: input.promptCacheRetention
    };
  }

  private resolvePromptCacheStablePrefixHash(
    bundle: AssistantRuntimeBundle,
    family: string
  ): string | null {
    if (family !== "ordinary_chat" && family !== "deep_chat") {
      return null;
    }
    return bundle.promptConstructor.ordinary.stablePrefix?.hash ?? null;
  }

  private resolveHydratedStableBlockTokens(
    messages: ProviderGatewayTextMessage[],
    family: string
  ): string[] {
    if (family !== "ordinary_chat" && family !== "deep_chat") {
      return [];
    }
    return resolveLeadingHydratedPromptCacheStableBlockTokens(messages);
  }

  private computePromptCacheIdentityHash(bundle: AssistantRuntimeBundle): string {
    return createHash("sha256")
      .update(
        [
          bundle.metadata.assistantId,
          bundle.metadata.publishedVersionId,
          String(bundle.metadata.publishedVersion),
          String(bundle.metadata.algorithmVersion),
          String(bundle.metadata.configGeneration)
        ].join(":")
      )
      .digest("hex");
  }

  private buildOpenAIPromptCacheKey(input: {
    bundle: AssistantRuntimeBundle;
    family: string;
    identityToken: string;
    hydratedStableBlockTokens: string[];
    variantHash: string | null;
  }): string {
    const digest = createHash("sha256")
      .update(
        JSON.stringify({
          family: input.family,
          identityToken: input.identityToken,
          hydratedStableBlockTokens: input.hydratedStableBlockTokens,
          variantHash: input.variantHash
        })
      )
      .digest("hex")
      .slice(0, PROMPT_CACHE_KEY_DIGEST_HEX_LENGTH);
    return `ps1:${this.resolvePromptCacheFamilyAlias(input.family)}:${digest}:b${this.computePromptCacheBucket(
      input.bundle.metadata.assistantId
    )}`;
  }

  private resolvePromptCacheFamilyAlias(family: string): string {
    switch (family) {
      case "ordinary_chat":
        return "oc";
      case "deep_chat":
        return "dc";
      default:
        return "uk";
    }
  }

  private computePromptCacheBucket(source: string): string {
    const digest = createHash("sha256").update(source).digest();
    return String((digest.at(0) ?? 0) % PROMPT_CACHE_KEY_BUCKETS).padStart(2, "0");
  }

  private recordUsageEntry(
    turnState: TurnExecutionState,
    input: {
      stepType: string;
      modelRole: PersaiRuntimeModelRole | null;
      usage: RuntimeUsageSnapshot | null;
      toolCode?: string;
    }
  ): void {
    if (input.usage === null) {
      return;
    }
    turnState.usageEntries.push({
      stepType: input.stepType,
      modelRole: input.modelRole,
      providerKey: input.usage.providerKey,
      modelKey: input.usage.modelKey,
      inputTokens: input.usage.inputTokens,
      cacheCreationInputTokens: input.usage.cacheCreationInputTokens ?? null,
      cachedInputTokens: input.usage.cachedInputTokens ?? null,
      outputTokens: input.usage.outputTokens,
      totalTokens: input.usage.totalTokens,
      ...(input.toolCode === undefined ? {} : { toolCode: input.toolCode })
    });
  }

  private async generateTextWithRuntimeFallback(input: {
    bundle: AssistantRuntimeBundle;
    request: ProviderGatewayTextGenerateRequest;
    modelRole: PersaiRuntimeModelRole;
    telemetryContext: {
      surface: "turn_sync" | "background_task" | "turn_stream";
      requestId: string;
      classification: string;
      attemptKey: string;
    };
  }): Promise<ProviderGatewayTextGenerateResult> {
    try {
      return await this.providerGatewayClientService.generateText(input.request);
    } catch (error) {
      const fallbackSelection = resolveRuntimeTextFallbackSelection(input.bundle);
      if (
        !isRetryableRuntimeTextFailure(error) ||
        fallbackSelection === null ||
        sameProviderSelection(
          { provider: input.request.provider, model: input.request.model },
          fallbackSelection
        )
      ) {
        throw error;
      }
      this.logger.warn(
        `[runtime-text-fallback-primary-failed] surface=${input.telemetryContext.surface} requestId=${input.telemetryContext.requestId} classification=${input.telemetryContext.classification} attempt=${input.telemetryContext.attemptKey} role=${input.modelRole} provider=${input.request.provider} model=${input.request.model} fallbackProvider=${fallbackSelection.provider} fallbackModel=${fallbackSelection.model} error=${
          error instanceof Error ? error.message : String(error)
        }`
      );
      try {
        const result = await this.providerGatewayClientService.generateText({
          ...input.request,
          provider: fallbackSelection.provider,
          model: fallbackSelection.model
        });
        this.logger.log(
          `[runtime-text-fallback-succeeded] surface=${input.telemetryContext.surface} requestId=${input.telemetryContext.requestId} classification=${input.telemetryContext.classification} attempt=${input.telemetryContext.attemptKey} role=${input.modelRole} primaryProvider=${input.request.provider} primaryModel=${input.request.model} fallbackProvider=${result.provider} fallbackModel=${result.model}`
        );
        return result;
      } catch (fallbackError) {
        this.logger.warn(
          `[runtime-text-fallback-failed] surface=${input.telemetryContext.surface} requestId=${input.telemetryContext.requestId} classification=${input.telemetryContext.classification} attempt=${input.telemetryContext.attemptKey} role=${input.modelRole} primaryProvider=${input.request.provider} primaryModel=${input.request.model} fallbackProvider=${fallbackSelection.provider} fallbackModel=${fallbackSelection.model} error=${
            fallbackError instanceof Error ? fallbackError.message : String(fallbackError)
          }`
        );
        throw fallbackError;
      }
    }
  }

  private buildUsageAccounting(entries: RuntimeUsageAccountingEntry[]): RuntimeUsageAccounting {
    const sum = (
      selector: (entry: RuntimeUsageAccountingEntry) => number | null
    ): number | null => {
      let total = 0;
      let seen = false;
      for (const entry of entries) {
        const value = selector(entry);
        if (value === null) {
          continue;
        }
        total += value;
        seen = true;
      }
      return seen ? total : null;
    };
    return {
      inputTokens: sum((entry) => entry.inputTokens),
      cacheCreationInputTokens: sum((entry) => entry.cacheCreationInputTokens),
      cachedInputTokens: sum((entry) => entry.cachedInputTokens),
      outputTokens: sum((entry) => entry.outputTokens),
      totalTokens: sum((entry) => entry.totalTokens),
      entries: [...entries]
    };
  }

  private extractToolUsageSnapshot(
    payload: ToolExecutionOutcome["payload"]
  ): RuntimeUsageSnapshot | null {
    const record =
      payload !== null && typeof payload === "object" && !Array.isArray(payload)
        ? (payload as Record<string, unknown>)
        : null;
    const usage =
      record?.usage !== null && typeof record?.usage === "object" && !Array.isArray(record?.usage)
        ? (record.usage as Record<string, unknown>)
        : null;
    if (usage === null) {
      return null;
    }
    return {
      providerKey: this.asNonEmptyString(usage.providerKey),
      modelKey: this.asNonEmptyString(usage.modelKey),
      inputTokens: typeof usage.inputTokens === "number" ? usage.inputTokens : null,
      cacheCreationInputTokens:
        typeof usage.cacheCreationInputTokens === "number" ? usage.cacheCreationInputTokens : null,
      cachedInputTokens:
        typeof usage.cachedInputTokens === "number" ? usage.cachedInputTokens : null,
      outputTokens: typeof usage.outputTokens === "number" ? usage.outputTokens : null,
      totalTokens: typeof usage.totalTokens === "number" ? usage.totalTokens : null
    };
  }

  private resolveToolUsageModelRole(toolCode: string): PersaiRuntimeModelRole {
    return toolCode === "summarize_context" || toolCode === "compact_context"
      ? "system_tool"
      : "tool_worker";
  }

  private readOptionalInstructions(
    argumentsObject: Record<string, unknown>
  ): string | null | Error {
    const unknownKeys = Object.keys(argumentsObject).filter((key) => key !== "instructions");
    if (unknownKeys.length > 0) {
      return new Error(`Unexpected arguments: ${unknownKeys.join(", ")}`);
    }
    if (!("instructions" in argumentsObject)) {
      return null;
    }
    const instructions = argumentsObject.instructions;
    if (instructions === null || instructions === undefined) {
      return null;
    }
    return typeof instructions === "string" && instructions.trim().length > 0
      ? instructions.trim()
      : new Error("instructions must be a non-empty string when provided");
  }

  private readWebSearchArguments(argumentsObject: Record<string, unknown>):
    | {
        query: string;
        count: number | null;
      }
    | Error {
    const unknownKeys = Object.keys(argumentsObject).filter(
      (key) => key !== "query" && key !== "count"
    );
    if (unknownKeys.length > 0) {
      return new Error(`Unexpected arguments: ${unknownKeys.join(", ")}`);
    }
    const query = this.asNonEmptyString(argumentsObject.query);
    if (query === null) {
      return new Error("query must be a non-empty string");
    }
    let count: number | null = null;
    if ("count" in argumentsObject) {
      if (argumentsObject.count === null || argumentsObject.count === undefined) {
        count = null;
      } else if (
        Number.isInteger(argumentsObject.count) &&
        Number(argumentsObject.count) >= WEB_SEARCH_MIN_COUNT &&
        Number(argumentsObject.count) <= WEB_SEARCH_MAX_COUNT
      ) {
        count = Number(argumentsObject.count);
      } else {
        return new Error(
          `count must be null or an integer between ${String(WEB_SEARCH_MIN_COUNT)} and ${String(
            WEB_SEARCH_MAX_COUNT
          )}`
        );
      }
    }
    return {
      query,
      count
    };
  }

  private readWebFetchArguments(argumentsObject: Record<string, unknown>):
    | {
        url: string;
        extractMode: PersaiRuntimeWebFetchExtractMode;
        maxChars: number | null;
      }
    | Error {
    const unknownKeys = Object.keys(argumentsObject).filter(
      (key) => key !== "url" && key !== "extractMode" && key !== "maxChars"
    );
    if (unknownKeys.length > 0) {
      return new Error(`Unexpected arguments: ${unknownKeys.join(", ")}`);
    }
    const url = this.asNonEmptyString(argumentsObject.url);
    if (url === null) {
      return new Error("url must be a non-empty string");
    }
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
    } catch {
      return new Error("url must be a valid URL");
    }
    if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
      return new Error("url must use http or https");
    }

    let extractMode = WEB_FETCH_DEFAULT_EXTRACT_MODE;
    if ("extractMode" in argumentsObject) {
      if (argumentsObject.extractMode === null || argumentsObject.extractMode === undefined) {
        extractMode = WEB_FETCH_DEFAULT_EXTRACT_MODE;
      } else if (
        typeof argumentsObject.extractMode === "string" &&
        PERSAI_RUNTIME_WEB_FETCH_EXTRACT_MODES.includes(
          argumentsObject.extractMode as (typeof PERSAI_RUNTIME_WEB_FETCH_EXTRACT_MODES)[number]
        )
      ) {
        extractMode = argumentsObject.extractMode as PersaiRuntimeWebFetchExtractMode;
      } else {
        return new Error('extractMode must be "markdown" or "text" when provided');
      }
    }

    let maxChars: number | null = null;
    if ("maxChars" in argumentsObject) {
      if (argumentsObject.maxChars === null || argumentsObject.maxChars === undefined) {
        maxChars = null;
      } else if (
        Number.isInteger(argumentsObject.maxChars) &&
        Number(argumentsObject.maxChars) >= WEB_FETCH_MIN_MAX_CHARS &&
        Number(argumentsObject.maxChars) <= WEB_FETCH_MAX_MAX_CHARS
      ) {
        maxChars = Number(argumentsObject.maxChars);
      } else {
        return new Error(
          `maxChars must be null or an integer between ${String(WEB_FETCH_MIN_MAX_CHARS)} and ${String(
            WEB_FETCH_MAX_MAX_CHARS
          )}`
        );
      }
    }

    return {
      url: parsedUrl.toString(),
      extractMode,
      maxChars
    };
  }

  private normalizeOptionalText(value: string | null): string | null {
    return value === null || value.trim().length === 0 ? null : value.trim();
  }

  // ADR-074 Slice M2 — `executePostTurnAutoCompaction` and
  // `buildAutoCompactionRequest` were removed: auto-compaction is now
  // off-band via `fireBackgroundCompactionEnqueue` above and runs through
  // the API-side scheduler, never blocking the user-perceived turn.

  private asObject(value: unknown): Record<string, unknown> | null {
    return value !== null && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  }

  private resolveAllowedInlineToolPolicy(
    bundle: AssistantRuntimeBundle,
    toolCode: string
  ): RuntimeToolPolicy | null {
    const policy =
      bundle.governance.toolPolicies.find((entry) => entry.toolCode === toolCode) ?? null;
    if (
      policy === null ||
      policy.enabled !== true ||
      policy.usageRule !== "allowed" ||
      policy.executionMode !== "inline"
    ) {
      return null;
    }
    return policy;
  }

  private resolveConfiguredCredentialRef(
    bundle: AssistantRuntimeBundle,
    toolCode: string
  ): AssistantRuntimeBundleToolCredentialRef | null {
    const credential = bundle.governance.toolCredentialRefs[toolCode] ?? null;
    if (
      credential === null ||
      credential.configured !== true ||
      credential.secretRef.id.trim().length === 0
    ) {
      return null;
    }
    return credential;
  }

  private resolveCurrentNativeWebSearchProviderId(
    providerId: string | null
  ): PersaiRuntimeWebSearchProviderId | null {
    if (providerId === null) {
      return DEFAULT_NATIVE_WEB_SEARCH_PROVIDER_ID;
    }
    return providerId === "tavily" ||
      providerId === "brave" ||
      providerId === "perplexity" ||
      providerId === "google"
      ? (providerId as PersaiRuntimeWebSearchProviderId)
      : null;
  }

  private asNonEmptyString(value: unknown): string | null {
    return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
  }

  private asPromptCacheRetention(value: unknown): ProviderGatewayPromptCacheRetention | null {
    return value === "in_memory" || value === "24h" ? value : null;
  }

  private isContextWindowExceededError(error: unknown): boolean {
    if (this.isRuntimeFailedEvent(error) && error.code === "provider_context_window_exceeded") {
      return true;
    }
    return error instanceof Error && this.isContextWindowExceededMessage(error.message);
  }

  private isContextWindowExceededMessage(message: string): boolean {
    const normalized = message.toLowerCase();
    return (
      normalized.includes("exceeds the context window") ||
      normalized.includes("context window") ||
      normalized.includes("maximum context length") ||
      normalized.includes("too many tokens")
    );
  }

  private asNativeManagedProvider(value: unknown): NativeManagedProvider | null {
    return value === "openai" || value === "anthropic" || value === "deepseek" ? value : null;
  }

  private formatLogError(error: unknown): string {
    if (error instanceof Error) {
      return `${error.name}: ${error.message}`;
    }
    return String(error);
  }

  private async failAcceptedTurnQuietly(
    acceptedTurn: AcceptedRuntimeTurn,
    error: unknown,
    trace?: RuntimeTrace,
    turnState?: TurnExecutionState
  ): Promise<RuntimeFailedEvent> {
    const failure = this.toFailureEvent(acceptedTurn, error, trace, turnState);
    if (failure.trace !== undefined) {
      this.runtimeObservabilityService.recordStreamTurn(failure.trace);
    }
    try {
      await this.turnFinalizationService.failAcceptedTurn(acceptedTurn, failure);
    } catch (finalizationError) {
      this.logger.warn(
        `runtime_turn_failure_finalization_payload_failed requestId=${acceptedTurn.receipt.requestId} sessionId=${acceptedTurn.session.sessionId} code=${failure.code} error=${this.formatLogError(finalizationError)}`
      );
      try {
        await this.turnFinalizationService.failAcceptedTurnMinimal(acceptedTurn, failure);
      } catch (minimalFinalizationError) {
        this.logger.error(
          `runtime_turn_failure_finalization_minimal_failed requestId=${acceptedTurn.receipt.requestId} sessionId=${acceptedTurn.session.sessionId} code=${failure.code} error=${this.formatLogError(minimalFinalizationError)}`
        );
      }
    }
    return failure;
  }

  private async interruptAcceptedTurnQuietly(input: {
    acceptedTurn: AcceptedRuntimeTurn;
    event: RuntimeInterruptedEvent;
    usage?: RuntimeUsageSnapshot | null;
  }): Promise<void> {
    if (input.event.trace !== undefined) {
      this.runtimeObservabilityService.recordStreamTurn(input.event.trace);
    }
    try {
      await this.turnFinalizationService.interruptAcceptedTurn(input);
    } catch {
      // The durable accepted receipt remains replay truth even if interruption finalization breaks.
    }
  }

  private toInterruptedEvent(
    acceptedTurn: AcceptedRuntimeTurn,
    assistantText: string,
    respondedAt: string | null,
    trace?: RuntimeTrace,
    turnState?: TurnExecutionState
  ): RuntimeInterruptedEvent {
    return {
      type: "interrupted",
      requestId: acceptedTurn.receipt.requestId,
      sessionId: acceptedTurn.session.sessionId,
      assistantText: assistantText.trim(),
      ...(turnState === undefined || turnState.artifacts.length === 0
        ? {}
        : { artifacts: [...turnState.artifacts] }),
      ...(turnState === undefined || turnState.fileHandles.length === 0
        ? {}
        : { fileHandles: [...turnState.fileHandles] }),
      respondedAt,
      ...(trace === undefined ? {} : { trace })
    };
  }

  private toFailureEvent(
    acceptedTurn: AcceptedRuntimeTurn,
    error: unknown,
    trace?: RuntimeTrace,
    turnState?: TurnExecutionState
  ): RuntimeFailedEvent {
    if (this.isRuntimeFailedEvent(error)) {
      const withTrace =
        trace === undefined || error.trace !== undefined ? error : { ...error, trace };
      return this.withTerminalRecoveryOutputs(withTrace, turnState);
    }
    if (error instanceof TurnExecutionError) {
      return this.withTerminalRecoveryOutputs(
        {
          type: "failed",
          requestId: acceptedTurn.receipt.requestId,
          sessionId: acceptedTurn.session.sessionId,
          code: error.code,
          message: error.message,
          willRetry: false,
          ...(trace === undefined ? {} : { trace })
        },
        turnState
      );
    }
    if (error instanceof HttpException) {
      const status = error.getStatus();
      if (status === 400 || status === 413) {
        return this.withTerminalRecoveryOutputs(
          {
            type: "failed",
            requestId: acceptedTurn.receipt.requestId,
            sessionId: acceptedTurn.session.sessionId,
            code: "native_runtime_request_invalid",
            message: error.message,
            willRetry: false,
            ...(trace === undefined ? {} : { trace })
          },
          turnState
        );
      }
    }
    if (error instanceof Error && error.message.trim().length > 0) {
      return this.withTerminalRecoveryOutputs(
        {
          type: "failed",
          requestId: acceptedTurn.receipt.requestId,
          sessionId: acceptedTurn.session.sessionId,
          code: "turn_execution_failed",
          message: error.message,
          willRetry: false,
          ...(trace === undefined ? {} : { trace })
        },
        turnState
      );
    }
    return this.withTerminalRecoveryOutputs(
      {
        type: "failed",
        requestId: acceptedTurn.receipt.requestId,
        sessionId: acceptedTurn.session.sessionId,
        code: "turn_execution_failed",
        message: "Native turn execution failed.",
        willRetry: false,
        ...(trace === undefined ? {} : { trace })
      },
      turnState
    );
  }

  private withTerminalRecoveryOutputs<T extends RuntimeFailedEvent>(
    event: T,
    turnState?: TurnExecutionState
  ): T {
    if (turnState === undefined) {
      return event;
    }
    return {
      ...event,
      ...(turnState.artifacts.length === 0 ? {} : { artifacts: [...turnState.artifacts] }),
      ...(turnState.fileHandles.length === 0 ? {} : { fileHandles: [...turnState.fileHandles] })
    };
  }

  private toHttpException(error: unknown): HttpException {
    if (error instanceof TurnExecutionError) {
      return error.exception;
    }
    if (error instanceof HttpException) {
      return error;
    }
    if (error instanceof Error && error.message.trim().length > 0) {
      return new InternalServerErrorException(error.message);
    }
    return new InternalServerErrorException("Native turn execution failed.");
  }

  private isRuntimeFailedEvent(value: unknown): value is RuntimeFailedEvent {
    const row = this.asObject(value);
    return (
      row?.type === "failed" &&
      typeof row.requestId === "string" &&
      (typeof row.sessionId === "string" || row.sessionId === null) &&
      typeof row.code === "string" &&
      typeof row.message === "string" &&
      typeof row.willRetry === "boolean"
    );
  }

  private isAbortError(error: unknown): boolean {
    return error instanceof Error && error.name === "AbortError";
  }

  private isRuntimeTurnResult(value: unknown): value is RuntimeTurnResult {
    const row = this.asObject(value);
    return (
      typeof row?.requestId === "string" &&
      typeof row.sessionId === "string" &&
      typeof row.assistantText === "string" &&
      Array.isArray(row.artifacts) &&
      typeof row.respondedAt === "string" &&
      (row.turnRouting === undefined ||
        row.turnRouting === null ||
        this.isRuntimeTurnRoutingSnapshot(row.turnRouting)) &&
      (row.usage === null ||
        (typeof row.usage === "object" && row.usage !== null && !Array.isArray(row.usage)))
    );
  }

  private isRuntimeTurnRoutingSnapshot(value: unknown): value is RuntimeTurnRoutingSnapshot {
    const row = this.asObject(value);
    return (
      (row?.mode === "shadow" || row?.mode === "active") &&
      (row.executionMode === "normal" ||
        row.executionMode === "premium" ||
        row.executionMode === "reasoning") &&
      (row.source === "precheck" || row.source === "llm" || row.source === "fallback")
    );
  }
}
