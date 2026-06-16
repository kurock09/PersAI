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
  type ProviderGatewayRequestMetadata,
  type ProviderGatewayMessageContentBlock,
  type ProviderGatewayToolCall,
  type ProviderGatewayToolExchange,
  type ProviderGatewayTextMessage,
  type ProviderGatewayTextGenerateRequest,
  type ProviderGatewayTextGenerateResult,
  type PersaiRuntimeWebFetchExtractMode,
  type RuntimeKnowledgeFetchToolResult,
  type RuntimeKnowledgeSearchToolResult,
  type RuntimeAttachmentRef,
  type RuntimeMemoryWriteToolResult,
  type RuntimeQuotaStatusToolResult,
  type RuntimeBrowserToolResult,
  type RuntimeDocumentToolResult,
  type RuntimeFilesToolResult,
  type RuntimeImageEditToolResult,
  type RuntimeImageGenerateToolResult,
  type RuntimeFileRef,
  type RuntimeOutputArtifact,
  type RuntimeSandboxToolResult,
  type RuntimeScheduledActionToolResult,
  type RuntimeBackgroundTaskToolResult,
  type RuntimeDeferredMediaJobSummary,
  type RuntimeDeferredDocumentJobSummary,
  type RuntimeSharedCompactionToolResult,
  type RuntimeTtsToolResult,
  type RuntimeVideoGenerateToolResult,
  type RuntimeToolPolicy,
  type RuntimeFailedEvent,
  type RuntimeInterruptedEvent,
  type RuntimeTextDeltaSource,
  type RuntimeSkillStateCheckResult,
  type RuntimeTurnRequest,
  type RuntimeTurnResult,
  type RuntimeTurnRoutingSnapshot,
  type RuntimeTurnToolInvocation,
  type RuntimeTurnStreamEvent,
  type RuntimeRetrievedKnowledgeContext,
  type RuntimeRetrievedKnowledgeContextItem,
  type RuntimeRetrievalActivitySource,
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
  createProjectModePostRetrievalStreamEvents,
  createProjectModeReplanStreamEvents,
  createProjectModeSynthesisStreamEvents,
  isProjectChatMode,
  PROJECT_EXECUTION_DEVELOPER_CONTRACT
} from "./project-execution-profile";
import { PersaiInternalApiClientService } from "./persai-internal-api.client.service";
import { ProviderGatewayClientService } from "./provider-gateway.client.service";
import {
  isRetryableRuntimeTextFailure,
  isRetryableRuntimeTextStreamFailureCode,
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
import { RuntimeSkillToolService } from "./runtime-skill-tool.service";
import { RuntimeQuotaStatusToolService } from "./runtime-quota-status-tool.service";
import { RuntimeSandboxToolService } from "./runtime-sandbox-tool.service";
import { RuntimeBackgroundTaskToolService } from "./runtime-background-task-tool.service";
import { RuntimeScheduledActionToolService } from "./runtime-scheduled-action-tool.service";
import { RuntimeTtsToolService } from "./runtime-tts-tool.service";
import { RuntimeVideoGenerateToolService } from "./runtime-video-generate-tool.service";
import {
  buildPromptCacheStableBlockToken,
  isDurableMemoryContextualMessage,
  resolveLeadingHydratedPromptCacheStableBlockTokens
} from "./prompt-cache-stable-blocks";
import { resolveRuntimeContextHydrationConfig } from "./runtime-context-hydration-policy";
import { SessionCompactionService } from "./session-compaction.service";
import {
  ToolBudgetPolicy,
  createToolBudgetExhaustedResult,
  type ToolBudgetExecutionMode
} from "./tool-budget-policy";
import { TurnContextHydrationService } from "./turn-context-hydration.service";
import { TurnAcceptanceService, type AcceptedRuntimeTurn } from "./turn-acceptance.service";
import { TurnFinalizationService } from "./turn-finalization.service";
import { RuntimeBundleAutoRefreshService } from "./runtime-bundle-auto-refresh.service";
import { SkillStateRoutingService } from "./skill-state-routing.service";
import { TurnRoutingService, type TurnRouteDecision } from "./turn-routing.service";
import {
  RuntimeExecutionAdmissionService,
  classifyInteractiveExecutionClass
} from "./runtime-execution-admission.service";

type NativeManagedProvider = "openai" | "anthropic";

const PROMPT_CACHE_KEY_BUCKETS = 8;
const PROMPT_CACHE_KEY_DIGEST_HEX_LENGTH = 32;
const DEFAULT_OPENAI_PROMPT_CACHE_RETENTION = "in_memory" as const;
const ANTHROPIC_HISTORY_BREAKPOINT_MIN_TOKENS = 3_000;
const APPROX_CHARS_PER_TOKEN = 4;
const MAX_OPEN_MEDIA_JOB_CONTEXT_ITEMS = 4;
const MAX_OPEN_DOCUMENT_JOB_CONTEXT_ITEMS = 4;
const MAX_JOB_DELIVERY_UPDATE_ITEMS = 6;
const MAX_MODEL_VISIBLE_WORKING_FILES = 20;
const MAX_WORKING_FILE_MICRO_DESCRIPTION_CHARS = 120;
const WORKING_FILE_REF_SUFFIX_HEX_LENGTH = 8;

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
  availableWorkingFileRefs: RuntimeFileRef[];
  deepModeEnabled: boolean;
  selectedModelRole: PersaiRuntimeModelRole;
  routeDecision: TurnRouteDecision;
  retrievedKnowledgeContext: RuntimeRetrievedKnowledgeContext | null;
  preludeUsageEntries: RuntimeUsageAccountingEntry[];
  // ADR-074 Slice T1: rendered presence developer-tail block, computed once
  // per `prepareTurnExecution`. `null` when the bundle has no presence
  // template (legacy bundle compiled before T1) or the channel doesn't have
  // a canonical chat row to ground the in-thread baseline.
  presenceBlock: string | null;
};

type TurnKnowledgeSourcePolicyState =
  | "default"
  | "skill_only"
  | "escalated_to_user"
  | "escalated_to_web"
  | "escalated_to_product";

type TurnKnowledgeSourcePolicy = {
  searchSources: PersaiRuntimeKnowledgeSource[];
  fetchSources: PersaiRuntimeKnowledgeSource[];
  state: TurnKnowledgeSourcePolicyState;
  activeSkillTurn: boolean;
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
  fileRefs: RuntimeFileRef[];
  usageEntries: RuntimeUsageAccountingEntry[];
  toolInvocations: RuntimeTurnToolInvocation[];
  deferredMediaJobs: RuntimeDeferredMediaJobSummary[];
  /**
   * ADR-105 — set true when any media tool call in this turn returned a
   * `skipped` rejection (limit, quota, safety, validation, concurrency). Used
   * to preserve the model's explicit rejection wording instead of overwriting
   * the whole reply with a generic "pending delivery" acknowledgement when a
   * turn mixes accepted (`pending_delivery`) and rejected media outcomes.
   */
  hadRejectedMediaRequest: boolean;
  deferredDocumentJobs: RuntimeDeferredDocumentJobSummary[];
  closedOpenLoopRefs: string[];
  /**
   * ADR-100 Piece 1 — ordered set of canonical AssistantFile ids (fileRef
   * strings) discovered via `files.list / search / get / read` during this
   * turn's tool loop. Capped at 20 (insertion order, deduplicated). Surfaced
   * on the turn result so the API can persist them on the assistant message's
   * metadata for next-turn hydration.
   */
  discoveredFileRefIdSet: string[];
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
    | RuntimeQuotaStatusToolResult
    | RuntimeBrowserToolResult
    | RuntimeDocumentToolResult
    | RuntimeFilesToolResult
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
   * `files.search` / `files.list` / `files.get` / `files.read`. The runtime
   * caller merges these into `turnState.fileRefs` so the next provider
   * iteration's Working Files developer block carries the same sticky
   * `file #N` / `image #N` labels as the rest of the turn instead of
   * recomputing recency-based ordinals.
   */
  discoveredFileRefs?: RuntimeFileRef[];
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
  | "retrieved_knowledge"
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
    private readonly skillStateRoutingService: SkillStateRoutingService,
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
    private readonly runtimeQuotaStatusToolService: RuntimeQuotaStatusToolService,
    private readonly runtimeSandboxToolService: RuntimeSandboxToolService,
    private readonly runtimeBackgroundTaskToolService: RuntimeBackgroundTaskToolService,
    private readonly runtimeScheduledActionToolService: RuntimeScheduledActionToolService,
    private readonly runtimeTtsToolService: RuntimeTtsToolService,
    private readonly runtimeVideoGenerateToolService: RuntimeVideoGenerateToolService,
    private readonly runtimeSkillToolService: RuntimeSkillToolService,
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

  async checkSkillRouting(input: RuntimeTurnRequest): Promise<RuntimeSkillStateCheckResult> {
    this.assertSupportedTurnRequest(input, "checkSkillRouting");
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
      throw new ServiceUnavailableException(
        `Runtime bundle "${input.bundle.bundleId}" is not warmed.`
      );
    }
    const request =
      input.skillStateContext === undefined
        ? input
        : {
            ...input,
            skillStateContext: { ...input.skillStateContext, forceCheck: true }
          };
    const result = await this.skillStateRoutingService.checkSkillState({
      bundle: bundleEntry.parsedBundle,
      request
    });
    return {
      requestId: input.requestId,
      skillState: result.skillState
    };
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

    const hydratedMessages = await this.turnContextHydrationService.buildMessages(
      input,
      bundleEntry.parsedBundle
    );
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
    const retrievedKnowledgeContext = await this.resolveRetrievedKnowledgeContext({
      bundle: bundleEntry.parsedBundle,
      input,
      routeDecision: executionPlan.routeDecision,
      projectedTools,
      knowledgeSourcePolicy
    });
    options?.trace?.stage("prepare.retrieval_context_ready");
    const plannedRetrievedKnowledgeContext = this.planRetrievedKnowledgeContext(
      bundleEntry.parsedBundle,
      retrievedKnowledgeContext,
      hydratedMessages
    );
    const providerSelection = this.resolveProviderSelection(bundleEntry.parsedBundle, {
      modelRoleOverride: executionPlan.modelRole,
      ...(input.providerOverride === undefined ? {} : { providerOverride: input.providerOverride }),
      ...(input.modelOverride === undefined ? {} : { modelOverride: input.modelOverride })
    });
    options?.trace?.stage("prepare.provider_selected");
    const availableWorkingFileRefs =
      await this.turnContextHydrationService.listAvailableWorkingFileRefs({
        conversation: input.conversation,
        currentAttachments: input.message.attachments
      });
    const developerInstructionSections = this.buildBaseDeveloperInstructionSections({
      request: input,
      projectedTools,
      availableWorkingFileRefs,
      deepModeEnabled: input.deepMode === true,
      routeDecision: executionPlan.routeDecision,
      retrievedKnowledgeContext: plannedRetrievedKnowledgeContext,
      openLoopRefsBlock,
      presenceBlock,
      openMediaJobs: input.openMediaJobs,
      openDocumentJobs: input.openDocumentJobs,
      jobDeliveryUpdates: input.jobDeliveryUpdates
    });
    const promptMode = options?.promptMode ?? "chat";
    const providerRequest = this.buildProviderRequest(
      bundleEntry.parsedBundle,
      providerSelection,
      hydratedMessages,
      projectedTools,
      input.deepMode === true,
      developerInstructionSections,
      promptMode
    );
    options?.trace?.stage("prepare.provider_request_built");
    return {
      bundle: bundleEntry.parsedBundle,
      projectedTools,
      runtimeTier: input.runtimeTier,
      promptMode,
      currentMessageAttachments: input.message.attachments,
      developerInstructionSections,
      availableWorkingFileRefs,
      deepModeEnabled: input.deepMode === true,
      selectedModelRole: executionPlan.modelRole,
      routeDecision: executionPlan.routeDecision,
      retrievedKnowledgeContext: plannedRetrievedKnowledgeContext,
      preludeUsageEntries: executionPlan.usageEntries,
      providerRequest,
      presenceBlock
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
    if (!this.isActiveSkillRetrievalTurn(routeDecision)) {
      return {
        searchSources: defaultSearchSources,
        fetchSources: defaultFetchSources,
        state: "default",
        activeSkillTurn: false
      };
    }
    const allowedSkillTurnKnowledgeSources: PersaiRuntimeKnowledgeSource[] = [
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
      fetchSources: defaultFetchSources.filter((source) => allowed.has(source)),
      state: "skill_only",
      activeSkillTurn: true
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

  private async resolveRetrievedKnowledgeContext(input: {
    bundle: AssistantRuntimeBundle;
    input: RuntimeTurnRequest;
    routeDecision: TurnRouteDecision;
    projectedTools: RuntimeNativeToolProjection;
    knowledgeSourcePolicy: TurnKnowledgeSourcePolicy;
  }): Promise<RuntimeRetrievedKnowledgeContext | null> {
    if (input.routeDecision.mode !== "active") {
      return null;
    }
    const plan = input.routeDecision.retrievalPlan;
    if (!plan.useSkills && !plan.useUserKnowledge && !plan.useProductKnowledge && !plan.useWeb) {
      return null;
    }
    const availableToolNames = new Set(input.projectedTools.tools.map((tool) => tool.name));
    if (
      (plan.useUserKnowledge || plan.useProductKnowledge || plan.useSkills) &&
      !availableToolNames.has("knowledge_search")
    ) {
      return null;
    }
    try {
      const context = await this.persaiInternalApiClientService.orchestrateRetrieval({
        assistantId: input.bundle.metadata.assistantId,
        query: input.input.message.text,
        locale: input.input.message.locale ?? input.bundle.userContext.locale,
        retrievalPlan: plan,
        gatherProfile: isProjectChatMode(input.input) ? "project" : null,
        sourcePolicy: {
          mode: input.knowledgeSourcePolicy.activeSkillTurn ? "active_skill" : "default",
          state: input.knowledgeSourcePolicy.state,
          allowedKnowledgeSearchSources: input.knowledgeSourcePolicy.searchSources,
          allowedKnowledgeFetchSources: input.knowledgeSourcePolicy.fetchSources
        },
        conversation: {
          channel: input.input.conversation.channel,
          surfaceThreadKey: input.input.conversation.externalThreadKey
        }
      });
      return context.renderedBlock === null || context.items.length === 0 ? null : context;
    } catch (error) {
      this.logger.warn(
        `Orchestrated retrieval failed for assistant ${input.bundle.metadata.assistantId}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      return null;
    }
  }

  private planRetrievedKnowledgeContext(
    bundle: AssistantRuntimeBundle,
    context: RuntimeRetrievedKnowledgeContext | null,
    hydratedMessages: ProviderGatewayTextGenerateRequest["messages"]
  ): RuntimeRetrievedKnowledgeContext | null {
    if (context === null || context.items.length === 0) {
      return context;
    }
    const coherentContext = this.removeShortMemoryDuplicatesFromRetrievedKnowledge(
      context,
      hydratedMessages
    );
    if (coherentContext.items.length === 0) {
      return {
        items: [],
        renderedBlock: null
      };
    }
    const config = resolveRuntimeContextHydrationConfig(bundle);
    const charBudget = Math.max(
      1_000,
      Math.floor(config.knowledgeHydrationBudget * APPROX_CHARS_PER_TOKEN)
    );
    const selectedItems: RuntimeRetrievedKnowledgeContextItem[] = [];
    let renderedBlock = this.renderRetrievedKnowledgeContextBlock(selectedItems);
    for (const item of this.rankRetrievedKnowledgeContextItems(coherentContext.items)) {
      const candidateItem = this.fitRetrievedKnowledgeContextItem(item, charBudget);
      const candidateItems = [...selectedItems, candidateItem];
      const candidateBlock = this.renderRetrievedKnowledgeContextBlock(candidateItems);
      if (candidateBlock.length <= charBudget) {
        selectedItems.push(candidateItem);
        renderedBlock = candidateBlock;
        continue;
      }
      const remainingChars = charBudget - renderedBlock.length;
      if (remainingChars <= 240) {
        break;
      }
      const shortened = {
        ...candidateItem,
        content: this.truncate(candidateItem.content, remainingChars)
      };
      const shortenedBlock = this.renderRetrievedKnowledgeContextBlock([
        ...selectedItems,
        shortened
      ]);
      if (shortenedBlock.length <= charBudget) {
        selectedItems.push(shortened);
        renderedBlock = shortenedBlock;
      }
      break;
    }
    return {
      items: selectedItems,
      renderedBlock: selectedItems.length === 0 ? null : renderedBlock
    };
  }

  private removeShortMemoryDuplicatesFromRetrievedKnowledge(
    context: RuntimeRetrievedKnowledgeContext,
    hydratedMessages: ProviderGatewayTextGenerateRequest["messages"]
  ): RuntimeRetrievedKnowledgeContext {
    const contextualSummaries = this.extractRenderedShortMemorySummaries(hydratedMessages);
    if (contextualSummaries.size === 0) {
      return context;
    }
    const items = context.items.filter((item) => {
      const source = this.asNonEmptyString(item.metadata?.source);
      if (source !== "memory") {
        return true;
      }
      const candidateSummary = this.asNonEmptyString(item.metadata?.summary) ?? item.content;
      return !contextualSummaries.has(this.normalizeRetrievedKnowledgeSummary(candidateSummary));
    });
    return items.length === context.items.length
      ? context
      : {
          items,
          renderedBlock:
            items.length === 0 ? null : this.renderRetrievedKnowledgeContextBlock(items)
        };
  }

  private extractRenderedShortMemorySummaries(
    messages: ProviderGatewayTextGenerateRequest["messages"]
  ): Set<string> {
    const summaries = new Set<string>();
    for (const message of messages) {
      if (!isDurableMemoryContextualMessage(message) || typeof message.content !== "string") {
        continue;
      }
      for (const line of message.content.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("- ")) {
          continue;
        }
        const summary = trimmed.replace(/^- \[[^\]]+\]\s*/, "").trim();
        const normalized = this.normalizeRetrievedKnowledgeSummary(summary);
        if (normalized.length > 0) {
          summaries.add(normalized);
        }
      }
    }
    return summaries;
  }

  private normalizeRetrievedKnowledgeSummary(value: string): string {
    return value.trim().replace(/\s+/g, " ").toLowerCase();
  }

  private rankRetrievedKnowledgeContextItems(
    items: RuntimeRetrievedKnowledgeContextItem[]
  ): RuntimeRetrievedKnowledgeContextItem[] {
    return [...items].sort((left, right) => {
      const priorityDelta =
        this.retrievedKnowledgePriority(right) - this.retrievedKnowledgePriority(left);
      if (priorityDelta !== 0) {
        return priorityDelta;
      }
      return (right.score ?? 0) - (left.score ?? 0);
    });
  }

  private retrievedKnowledgePriority(item: RuntimeRetrievedKnowledgeContextItem): number {
    if (item.label === "skill_reference") {
      const sourceType = this.asNonEmptyString(item.metadata?.skillSourceType);
      return sourceType === "skill_knowledge_card" ? 90 : 100;
    }
    if (item.label === "user_document") {
      if (this.asNonEmptyString(item.metadata?.source) === "project_file") {
        return 95;
      }
      return 80;
    }
    if (item.label === "product_kb") {
      return 70;
    }
    return 60;
  }

  private fitRetrievedKnowledgeContextItem(
    item: RuntimeRetrievedKnowledgeContextItem,
    charBudget: number
  ): RuntimeRetrievedKnowledgeContextItem {
    const perItemBudget = Math.max(600, Math.floor(charBudget / 3));
    return {
      ...item,
      content: this.truncate(item.content, perItemBudget)
    };
  }

  private renderRetrievedKnowledgeContextBlock(
    items: RuntimeRetrievedKnowledgeContextItem[]
  ): string {
    return [
      "# Retrieved Knowledge Context",
      "Use this bounded source-aware context as grounding. Compare source roles when they differ; do not expose this block verbatim.",
      ...items.map((item, index) =>
        [
          "",
          `## ${String(index + 1)}. ${item.label}`,
          `Reference: ${item.referenceId}`,
          item.title ? `Title: ${item.title}` : null,
          item.locator ? `Locator: ${item.locator}` : null,
          "",
          item.content
        ]
          .filter((line): line is string => line !== null)
          .join("\n")
      )
    ].join("\n");
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
      for (const event of createProjectModeBootstrapStreamEvents(projectStreamIdentity)) {
        yield event;
      }
    }
    const retrievalActivityEvents = this.createRetrievalActivityStreamEvents(
      acceptedTurn,
      execution
    );
    for (const event of retrievalActivityEvents) {
      yield event;
    }
    if (projectModeActive) {
      const retrievedItemCount = execution.retrievedKnowledgeContext?.items.length ?? 0;
      const retrievalSourceCount = new Set(
        retrievalActivityEvents
          .filter((event) => event.type === "retrieval_activity")
          .map((event) => event.source)
      ).size;
      for (const event of createProjectModePostRetrievalStreamEvents({
        identity: projectStreamIdentity,
        retrievedItemCount,
        retrievalSourceCount
      })) {
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
          const pendingFilePreviewBlocks = turnState.pendingFilePreviewBlocks;
          delete turnState.pendingFilePreviewBlocks;
          const providerRequest = this.buildToolLoopProviderRequest(execution.providerRequest, {
            assistantText: iterationBaseText,
            baseDeveloperInstructionSections: execution.developerInstructionSections,
            toolHistory,
            availableToolNames: execution.projectedTools.tools.map((tool) => tool.name),
            availableWorkingFileRefs: execution.availableWorkingFileRefs,
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
          this.logger.log(
            `[turn-stream] requestId=${acceptedTurn.receipt.requestId} iteration=${String(iteration)} classification=${providerRequest.requestMetadata?.classification ?? "unknown"} modelRole=${execution.selectedModelRole} provider=${providerRequest.provider} model=${providerRequest.model} toolCount=${String(providerRequest.tools?.length ?? 0)} toolHistoryCount=${String(providerRequest.toolHistory?.length ?? 0)}`
          );
          trace?.stage(`iter${String(iteration)}.provider_request_ready`);
          let providerStream = await this.providerGatewayClientService.streamText(
            providerRequest,
            this.buildProviderGatewayStreamOptions(signal, traceEnabled)
          );
          trace?.stage(`iter${String(iteration)}.provider_headers_received`);
          let advancedToNextIteration = false;
          let firstProviderEventSeen = false;
          let streamFallbackAttempted = false;

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
            if (!firstProviderEventSeen) {
              firstProviderEventSeen = true;
              trace?.stage(`iter${String(iteration)}.first_provider_event`);
            }

            if (event.type === "text_delta" && event.delta !== undefined) {
              assembledText = this.mergeAssistantTurnText(iterationBaseText, event.accumulatedText);
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
              trace?.stage(`iter${String(iteration)}.tool_calls_received`);
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
                    availableWorkingFileRefs: execution.availableWorkingFileRefs,
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
                      toolHistory.push(result.outcome.exchange);
                      this.applyToolExecutionOutcome(turnState, result.outcome, iteration);
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
                        turnState.fileRefs,
                        execution.availableWorkingFileRefs,
                        turnState.deferredDocumentJobs
                      );
                    } catch (error) {
                      yield this.createToolFinishedStreamEvent(acceptedTurn, toolCall, true);
                      throw error;
                    }
                  }
                  this.maybeRefundToolRequestRejectionReservation(toolBudgetPolicy, entry, outcome);
                  toolHistory.push(outcome.exchange);
                  this.applyToolExecutionOutcome(turnState, outcome, iteration);
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
                const refreshElapsedMs = Date.now() - refreshStartedAtMs;
                trace?.stage(`iter${String(iteration)}.provider_request_refreshed`);
                if (traceEnabled) {
                  this.logger.log(
                    `[turn-stream-refresh] requestId=${acceptedTurn.receipt.requestId} iteration=${String(iteration)} refreshProviderRequestMessagesMs=${String(refreshElapsedMs)} reason=durable_compaction`
                  );
                }
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
                hadRejectedMediaRequest: turnState.hadRejectedMediaRequest,
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
              const correctedProviderResult = this.withAssistantText(
                completedProviderResult,
                correctedAssistantText
              );
              this.recordUsageEntry(turnState, {
                stepType: iteration === 0 ? "main_turn" : "tool_loop_followup",
                modelRole: execution.selectedModelRole,
                usage: correctedProviderResult.usage
              });
              const result = this.buildTurnResult(
                acceptedTurn,
                correctedProviderResult,
                turnState,
                execution.routeDecision,
                trace?.build("ok")
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
                !firstProviderEventSeen &&
                !streamFallbackAttempted &&
                isRetryableRuntimeTextStreamFailureCode(event.code)
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
                  try {
                    providerStream = await this.providerGatewayClientService.streamText(
                      {
                        ...providerRequest,
                        provider: fallbackSelection.provider,
                        model: fallbackSelection.model
                      },
                      this.buildProviderGatewayStreamOptions(signal, traceEnabled)
                    );
                    this.logger.log(
                      `[runtime-text-fallback-succeeded] surface=turn_stream requestId=${acceptedTurn.receipt.requestId} classification=${providerRequest.requestMetadata?.classification ?? "unknown"} attempt=tool_loop:${String(iteration)} role=${execution.selectedModelRole} primaryProvider=${providerRequest.provider} primaryModel=${providerRequest.model} fallbackProvider=${fallbackSelection.provider} fallbackModel=${fallbackSelection.model}`
                    );
                    firstProviderEventSeen = false;
                    break;
                  } catch (fallbackError) {
                    this.logger.warn(
                      `[runtime-text-fallback-failed] surface=turn_stream requestId=${acceptedTurn.receipt.requestId} classification=${providerRequest.requestMetadata?.classification ?? "unknown"} attempt=tool_loop:${String(iteration)} role=${execution.selectedModelRole} primaryProvider=${providerRequest.provider} primaryModel=${providerRequest.model} fallbackProvider=${fallbackSelection.provider} fallbackModel=${fallbackSelection.model} error=${
                        fallbackError instanceof Error
                          ? fallbackError.message
                          : String(fallbackError)
                      }`
                    );
                    throw fallbackError;
                  }
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

          if (advancedToNextIteration) {
            continue;
          }
          if (streamFallbackAttempted && !firstProviderEventSeen) {
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

        if (signal?.aborted || this.isAbortError(error)) {
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
    trace?: RuntimeTrace
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

    const turnRouting =
      routeDecision === undefined ? null : this.toRuntimeTurnRoutingSnapshot(routeDecision);
    const result: RuntimeTurnResult = {
      requestId: acceptedTurn.receipt.requestId,
      sessionId: acceptedTurn.session.sessionId,
      assistantText: providerResult.text ?? "",
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
      ...(turnState.discoveredFileRefIdSet.length === 0
        ? {}
        : { discoveredFileRefIds: [...turnState.discoveredFileRefIdSet] })
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
    promptMode: "chat" | "background_worker"
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
      messages,
      deepModeEnabled,
      projectedTools
    });
    const developerInstructions = this.renderDeveloperInstructionSections(
      developerInstructionSections
    );
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
          })
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
    availableWorkingFileRefs: RuntimeFileRef[];
    deepModeEnabled: boolean;
    routeDecision: TurnRouteDecision | undefined;
    retrievedKnowledgeContext: RuntimeRetrievedKnowledgeContext | null;
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
      input.availableWorkingFileRefs
    );
    const retrievedKnowledgeSection = this.buildRetrievedKnowledgeContextDeveloperSection(
      input.retrievedKnowledgeContext
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
      { key: "retrieved_knowledge", content: retrievedKnowledgeSection },
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

  private buildRetrievedKnowledgeContextDeveloperSection(
    context: RuntimeRetrievedKnowledgeContext | null
  ): string | null {
    return this.normalizeOptionalText(context?.renderedBlock ?? null);
  }

  private buildWorkingFilesDeveloperSection(
    availableWorkingFileRefs: RuntimeFileRef[]
  ): string | null {
    const modelVisibleWorkingFiles = this.limitModelVisibleWorkingFiles(availableWorkingFileRefs);
    if (modelVisibleWorkingFiles.length === 0) {
      return null;
    }

    const lines = ["## Working Files"];
    const documentPriorityNote =
      this.buildWorkingFileDocumentPriorityNote(availableWorkingFileRefs);
    if (documentPriorityNote !== null) {
      lines.push("", ...documentPriorityNote);
    }

    const duplicateDisplayNames = this.collectDuplicateWorkingFileNames(modelVisibleWorkingFiles);
    lines.push("", ...this.buildWorkingFileGeneralFileNote(availableWorkingFileRefs), "");
    for (const file of modelVisibleWorkingFiles) {
      lines.push(this.formatWorkingFileHistoryLine(file, duplicateDisplayNames));
    }

    lines.push(
      "",
      'Use sticky aliases first (`file #N`, `image #N`). For image/video tools, prefer image aliases such as "image #1".'
    );
    lines.push(
      "If the needed file is absent or ambiguous, use `files.list`/`files.search`; do not answer from this block alone."
    );
    lines.push(
      "Do not send files or claim delivery/preparation unless the user explicitly asks and the current turn returns the matching tool result."
    );
    return lines.join("\n");
  }

  private isCurrentSourceWorkingFile(file: RuntimeFileRef): boolean {
    return (
      file.origin === "uploaded_attachment" && this.isDocumentSourceWorkingFileMime(file.mimeType)
    );
  }

  private isLastDeliveredDocumentResultWorkingFile(file: RuntimeFileRef): boolean {
    return (
      this.isAssistantGeneratedWorkingFile(file) &&
      (this.isPdfWorkingFileMime(file.mimeType) || file.sourceToolCode === DOCUMENT_TOOL_CODE)
    );
  }

  private isDocumentRelatedWorkingFile(file: RuntimeFileRef): boolean {
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

  private isAssistantGeneratedWorkingFile(file: RuntimeFileRef): boolean {
    return file.origin !== "uploaded_attachment";
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
      routeDecision.retrievalPlan.useSkills
        ? `Retrieval plan selected enabled Skills: ${routeDecision.retrievalPlan.selectedSkillIds.join(", ")}. Prefer the Retrieved Knowledge Context developer section when present.`
        : null,
      this.isActiveSkillRetrievalTurn(routeDecision) &&
      availableToolNames.includes("knowledge_search")
        ? "Active-skill retrieval is runtime-owned for this turn. Use low-level knowledge_search/knowledge_fetch only for assistant-owned follow-up lookup that is still genuinely needed after the Retrieved Knowledge Context developer section."
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

    const defaultRouteDecision: TurnRouteDecision = {
      executionMode: input.deepMode === true ? "premium" : "normal",
      retrievalHint: false,
      toolHints: "none",
      confidence: "high",
      clarifyNeeded: false,
      fallbackMode: input.deepMode === true ? "premium" : "normal",
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
    operation: "createTurn" | "streamTurn" | "createBackgroundTaskToolRun" | "checkSkillRouting"
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
      if (attachment.objectKey.trim().length === 0) {
        throw new BadRequestException(
          `message.attachments[].objectKey must be non-empty for native ${operation} execution.`
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
    for (
      let iteration = 0;
      iteration < maxToolLoopIterations + previewFollowUpExtraIterations;
      iteration += 1
    ) {
      let providerResult: ProviderGatewayTextGenerateResult;
      let availableWorkingFileRefs = execution.availableWorkingFileRefs;
      let pendingFilePreviewBlocks: ProviderGatewayMessageContentBlock[] | undefined;
      try {
        availableWorkingFileRefs =
          await this.turnContextHydrationService.listAvailableWorkingFileRefs({
            conversation: acceptedTurn.session.conversation,
            currentAttachments: execution.currentMessageAttachments,
            currentFileRefs: turnState.fileRefs,
            currentArtifacts: turnState.artifacts
          });
        pendingFilePreviewBlocks = turnState.pendingFilePreviewBlocks;
        delete turnState.pendingFilePreviewBlocks;
        const request = this.buildToolLoopProviderRequest(execution.providerRequest, {
          assistantText: accumulatedText,
          baseDeveloperInstructionSections: execution.developerInstructionSections,
          toolHistory,
          availableToolNames: execution.projectedTools.tools.map((tool) => tool.name),
          availableWorkingFileRefs,
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
        return this.withAssistantText(
          providerResult,
          this.applyAssistantTextCorrections({
            assistantText: accumulatedText,
            artifacts: turnState.artifacts,
            deferredMediaJobs: turnState.deferredMediaJobs,
            hadRejectedMediaRequest: turnState.hadRejectedMediaRequest,
            deferredDocumentJobs: turnState.deferredDocumentJobs,
            locale: input.message.locale ?? execution.bundle.userContext.locale ?? null
          })
        );
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
            availableWorkingFileRefs,
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
              toolHistory.push(result.outcome.exchange);
              this.applyToolExecutionOutcome(turnState, result.outcome, iteration);
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
                turnState.fileRefs,
                availableWorkingFileRefs,
                turnState.deferredDocumentJobs
              );
          this.maybeRefundToolRequestRejectionReservation(toolBudgetPolicy, entry, outcome);
          toolHistory.push(outcome.exchange);
          this.applyToolExecutionOutcome(turnState, outcome, iteration);
          durableCompactionExecuted =
            durableCompactionExecuted || outcome.sharedCompaction?.durableStatePersisted === true;
        }
      }
      if (durableCompactionExecuted) {
        execution.providerRequest = await this.refreshProviderRequestMessages(execution, input);
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
    availableWorkingFileRefs: RuntimeFileRef[];
    trace: RuntimeStreamTraceCollector | undefined;
    iteration: number;
  }): Promise<ExecutedToolCallResult[]> {
    const currentArtifacts = [...params.turnState.artifacts];
    const currentFileRefs = [...params.turnState.fileRefs];
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
              currentFileRefs,
              params.availableWorkingFileRefs,
              params.turnState.deferredDocumentJobs
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
    currentFileRefs: RuntimeFileRef[],
    availableWorkingFileRefs: RuntimeFileRef[],
    currentDeferredDocumentJobs: TurnExecutionState["deferredDocumentJobs"] = []
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
        const requestedFilesAction = this.readFilesRequestedAction(toolCall.arguments);
        if (
          currentDeferredDocumentJobs.length > 0 &&
          (requestedFilesAction === "send" || requestedFilesAction === "write_and_send")
        ) {
          return this.createToolExecutionOutcome(toolCall, {
            toolCode: "files",
            executionMode: "inline",
            requestedAction: requestedFilesAction,
            action: "skipped",
            reason: "document_pending_delivery",
            warning:
              "A document job from this turn is still pending delivery. Do not send an older file as the new document result.",
            item: null,
            items: [],
            content: null,
            job: null,
            fileRefs: [],
            queuedArtifacts: 0
          });
        }
        const availableWorkingFileRefs =
          await this.turnContextHydrationService.listAvailableWorkingFileRefs({
            conversation: acceptedTurn.session.conversation,
            currentAttachments: execution.currentMessageAttachments,
            currentFileRefs,
            currentArtifacts
          });
        const result = await this.runtimeFilesToolService.executeToolCall({
          bundle: execution.bundle,
          toolCall,
          sessionId: acceptedTurn.session.sessionId,
          requestId: acceptedTurn.receipt.requestId,
          currentArtifacts,
          currentFileRefs,
          availableWorkingFileRefs,
          channel: acceptedTurn.session.conversation.channel
        });
        return this.createToolExecutionOutcome(
          toolCall,
          result.payload,
          result.isError,
          undefined,
          result.artifacts,
          result.discoveredFileRefs,
          result.pendingFilePreviewBlocks
        );
      }
      case EXEC_TOOL_CODE:
      case SHELL_TOOL_CODE: {
        const result = await this.runtimeSandboxToolService.executeToolCall({
          bundle: execution.bundle,
          toolCall,
          sessionId: acceptedTurn.session.sessionId,
          requestId: acceptedTurn.receipt.requestId,
          currentFileRefs
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
          availableWorkingFileRefs
        );
        const result = await this.runtimeDocumentToolService.executeToolCall({
          bundle: execution.bundle,
          toolCall,
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
          availableWorkingFileRefs,
          currentArtifacts,
          currentFileRefs
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
          availableWorkingFileRefs,
          currentArtifacts,
          currentFileRefs
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
          availableWorkingFileRefs,
          currentArtifacts,
          currentFileRefs
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
    availableWorkingFileRefs: RuntimeFileRef[],
    currentArtifacts: RuntimeOutputArtifact[],
    currentFileRefs: RuntimeFileRef[]
  ): Promise<RuntimeAttachmentRef[]> {
    const aliasByFileRef = new Map<string, string[]>();
    const aliasByObjectKey = new Map<string, string[]>();
    for (const fileRef of [...availableWorkingFileRefs, ...currentFileRefs]) {
      if ((fileRef.aliases ?? []).length === 0) {
        continue;
      }
      aliasByFileRef.set(fileRef.fileRef, fileRef.aliases ?? []);
      aliasByObjectKey.set(fileRef.objectKey, fileRef.aliases ?? []);
    }
    const withWorkingFileAliases = (
      attachment: RuntimeAttachmentRef
    ): RuntimeAttachmentRef | null => {
      const workingFileAliases =
        (typeof attachment.fileRef === "string"
          ? aliasByFileRef.get(attachment.fileRef)
          : undefined) ??
        aliasByObjectKey.get(attachment.objectKey) ??
        null;
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
        objectKey: artifact.objectKey,
        mimeType: artifact.mimeType,
        filename: artifact.filename,
        sizeBytes: artifact.sizeBytes ?? 0,
        fileRef: artifact.fileRef,
        aliases: null
      }))
      .map(withWorkingFileAliases)
      .filter((attachment): attachment is RuntimeAttachmentRef => attachment !== null);
    const workingFileImageAttachments = [...availableWorkingFileRefs, ...currentFileRefs]
      .filter((fileRef) => fileRef.mimeType.startsWith("image/"))
      .map((fileRef) => ({
        attachmentId: `file:${fileRef.fileRef}`,
        kind: "image" as const,
        objectKey: fileRef.objectKey,
        mimeType: fileRef.mimeType,
        filename: fileRef.displayName ?? null,
        sizeBytes: fileRef.logicalSizeBytes ?? fileRef.sizeBytes ?? 0,
        fileRef: fileRef.fileRef,
        aliases: fileRef.aliases ?? null
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
    availableWorkingFileRefs: RuntimeFileRef[]
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
    for (const fileRef of availableWorkingFileRefs) {
      if (!this.isDocumentSourceWorkingFileMime(fileRef.mimeType)) {
        continue;
      }
      upsert({
        attachmentId: `file:${fileRef.fileRef}`,
        kind: "file",
        objectKey: fileRef.objectKey,
        mimeType: fileRef.mimeType,
        filename: fileRef.displayName ?? null,
        sizeBytes: fileRef.logicalSizeBytes ?? fileRef.sizeBytes ?? 0,
        fileRef: fileRef.fileRef,
        aliases: fileRef.aliases ?? null
      });
    }
    return [...merged.values()];
  }

  private buildRuntimeAttachmentDedupeKey(attachment: RuntimeAttachmentRef): string {
    return typeof attachment.fileRef === "string" && attachment.fileRef.trim().length > 0
      ? `file:${attachment.fileRef}`
      : `object:${attachment.objectKey}`;
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
      | RuntimeQuotaStatusToolResult
      | RuntimeBrowserToolResult
      | RuntimeDocumentToolResult
      | RuntimeFilesToolResult
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
    discoveredFileRefs?: RuntimeFileRef[],
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
      ...(discoveredFileRefs === undefined || discoveredFileRefs.length === 0
        ? {}
        : { discoveredFileRefs }),
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
      availableWorkingFileRefs: RuntimeFileRef[];
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
      input.availableWorkingFileRefs,
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
    availableWorkingFileRefs: RuntimeFileRef[],
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
      this.buildWorkingFilesDeveloperSection(availableWorkingFileRefs)
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
    file: RuntimeFileRef,
    duplicateDisplayNames: Set<string>
  ): string {
    const createdAt = this.formatWorkingFileCreatedAt(file.createdAt);
    const author = file.authorLabel ?? this.resolveWorkingFileAuthorLabel(file.origin);
    const alias = this.describeWorkingFileStickyLabel(file);
    const filename = this.formatWorkingFileDisplayName(file, duplicateDisplayNames);
    const markers = this.formatWorkingFileMarkers(file);
    const microDescription = this.formatWorkingFileMicroDescription(file.semanticSummaryHint);
    return `- ${createdAt} | ${author} | ${alias} | ${filename} | ${markers} | ${microDescription}`;
  }

  private buildWorkingFileDocumentPriorityNote(files: RuntimeFileRef[]): string[] | null {
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

  private buildWorkingFileGeneralFileNote(files: RuntimeFileRef[]): string[] {
    const lastDeliveredFile = this.selectLastDeliveredWorkingFile(files);
    return [
      "Chat files visible to tools (documents, media, and attachments):",
      `- LAST_DELIVERED_FILE = ${this.describeWorkingFilePriorityAnchor(lastDeliveredFile)}`
    ];
  }

  private selectLastDeliveredWorkingFile(files: RuntimeFileRef[]): RuntimeFileRef | null {
    return this.sortWorkingFilesByCreatedAt(files)[0] ?? null;
  }

  private describeWorkingFilePriorityAnchor(file: RuntimeFileRef | null): string {
    if (file === null) {
      return "none";
    }
    return `${this.resolvePrimaryWorkingFileAlias(file)} | ${this.formatWorkingFileDisplayName(
      file,
      new Set<string>()
    )}`;
  }

  private collectDuplicateWorkingFileNames(files: RuntimeFileRef[]): Set<string> {
    const counts = new Map<string, number>();
    for (const file of files) {
      const displayName = this.resolveWorkingFileDisplayName(file).toLowerCase();
      counts.set(displayName, (counts.get(displayName) ?? 0) + 1);
    }
    return new Set(
      [...counts.entries()].filter(([, count]) => count > 1).map(([displayName]) => displayName)
    );
  }

  private resolvePrimaryWorkingFileAlias(file: RuntimeFileRef): string {
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

  private resolveStickyFileAlias(file: RuntimeFileRef): string | null {
    return (file.aliases ?? []).find((alias) => /^file #\d+$/i.test(alias.trim()))?.trim() ?? null;
  }

  private resolveStickyImageAlias(file: RuntimeFileRef): string | null {
    return (file.aliases ?? []).find((alias) => /^image #\d+$/i.test(alias.trim()))?.trim() ?? null;
  }

  private describeWorkingFileStickyLabel(file: RuntimeFileRef): string {
    const imageAlias = this.resolveStickyImageAlias(file);
    const fileAlias = this.resolveStickyFileAlias(file);
    if (imageAlias !== null && fileAlias !== null) {
      return `${imageAlias} (${fileAlias})`;
    }
    return imageAlias ?? fileAlias ?? this.resolvePrimaryWorkingFileAlias(file);
  }

  private formatWorkingFileMarkers(file: RuntimeFileRef): string {
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

  private isRecentWorkingFile(file: RuntimeFileRef): boolean {
    const createdAtMs = this.parseWorkingFileCreatedAtMs(file.createdAt);
    if (createdAtMs === 0) {
      return false;
    }
    return Date.now() - createdAtMs <= 1000 * 60 * 60 * 24 * 7;
  }

  private resolveWorkingFileDisplayName(file: RuntimeFileRef): string {
    return file.displayName ?? file.relativePath.split("/").pop() ?? "file";
  }

  private formatWorkingFileDisplayName(
    file: RuntimeFileRef,
    duplicateDisplayNames: Set<string>
  ): string {
    const displayName = this.resolveWorkingFileDisplayName(file);
    if (!duplicateDisplayNames.has(displayName.toLowerCase())) {
      return displayName;
    }
    return `${displayName} [${file.fileRef.slice(-WORKING_FILE_REF_SUFFIX_HEX_LENGTH)}]`;
  }

  private formatWorkingFileMicroDescription(summary: string | null | undefined): string {
    const normalized = summary?.replace(/\s+/g, " ").trim() ?? "";
    if (normalized.length === 0) {
      return "-";
    }
    return normalized.slice(0, MAX_WORKING_FILE_MICRO_DESCRIPTION_CHARS);
  }

  private resolveWorkingFileAuthorLabel(
    origin: RuntimeFileRef["origin"]
  ): NonNullable<RuntimeFileRef["authorLabel"]> {
    switch (origin) {
      case "uploaded_attachment":
        return "user";
      case "sandbox_output":
        return "sandbox";
      default:
        return "model";
    }
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
    availableWorkingFileRefs: RuntimeFileRef[]
  ): RuntimeFileRef[] {
    const sorted = this.sortWorkingFilesByCreatedAt(availableWorkingFileRefs);
    if (sorted.length <= MAX_MODEL_VISIBLE_WORKING_FILES) {
      return sorted;
    }
    const { currentSource, lastDelivered } = this.selectWorkingFileDocumentPriorityAnchors(sorted);
    const requiredFileRefs = new Set(
      [currentSource, lastDelivered]
        .filter((file): file is RuntimeFileRef => file !== null)
        .map((file) => file.fileRef)
    );
    const visible = [...sorted.slice(0, MAX_MODEL_VISIBLE_WORKING_FILES)];
    const visibleFileRefs = new Set(visible.map((file) => file.fileRef));
    for (const file of [currentSource, lastDelivered]) {
      if (file !== null && !visibleFileRefs.has(file.fileRef)) {
        visible.push(file);
        visibleFileRefs.add(file.fileRef);
      }
    }
    const ordered = this.sortWorkingFilesByCreatedAt(visible);
    while (ordered.length > MAX_MODEL_VISIBLE_WORKING_FILES) {
      const removableIndex = [...ordered]
        .reverse()
        .findIndex((file) => !requiredFileRefs.has(file.fileRef));
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

  private sortWorkingFilesByCreatedAt(files: RuntimeFileRef[]): RuntimeFileRef[] {
    return [...files].sort((left, right) => {
      const createdAtDiff =
        this.parseWorkingFileCreatedAtMs(right.createdAt) -
        this.parseWorkingFileCreatedAtMs(left.createdAt);
      if (createdAtDiff !== 0) {
        return createdAtDiff;
      }
      return right.fileRef.localeCompare(left.fileRef);
    });
  }

  private selectWorkingFileDocumentPriorityAnchors(files: RuntimeFileRef[]): {
    currentSource: RuntimeFileRef | null;
    lastDelivered: RuntimeFileRef | null;
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
    const needsInlineSeparator =
      !/\s$/.test(existingText) &&
      !/^\s/.test(sanitizedNextText) &&
      !/^[,.;:!?)]/.test(sanitizedNextText);
    return needsInlineSeparator
      ? `${existingText} ${sanitizedNextText}`
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
    hadRejectedMediaRequest: boolean;
    deferredDocumentJobs: TurnExecutionState["deferredDocumentJobs"];
    locale: string | null;
  }): string {
    const normalizedText = this.normalizeOptionalText(input.assistantText) ?? "";
    const deferredCorrected = this.applyDeferredMediaAcknowledgementCorrection(
      normalizedText,
      input.artifacts,
      input.deferredMediaJobs,
      input.hadRejectedMediaRequest,
      input.locale
    );
    return this.applyDeferredDocumentAcknowledgementCorrection(
      deferredCorrected,
      input.artifacts,
      input.deferredDocumentJobs,
      input.locale
    );
  }

  private applyDeferredMediaAcknowledgementCorrection(
    assistantText: string,
    artifacts: RuntimeOutputArtifact[],
    deferredMediaJobs: RuntimeDeferredMediaJobSummary[],
    hadRejectedMediaRequest: boolean,
    locale: string | null
  ): string {
    const normalizedText = this.normalizeOptionalText(assistantText) ?? "";
    if (deferredMediaJobs.length === 0 || artifacts.length > 0) {
      return normalizedText;
    }
    // ADR-105 — a turn that mixed accepted (pending) and rejected media must not
    // collapse into one generic pending sentence: blanket-overwriting would
    // erase the model's explanation of the rejected request. Preserve the
    // model's text and let the undelivered-attachment correction below catch
    // any false "I sent the file" claim.
    if (hadRejectedMediaRequest) {
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
      "Write only a brief acknowledgement that the request is in progress and the final media will arrive separately when ready.",
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
      "Do not call files.send for this document or any older document file in this turn.",
      "Write only a brief acknowledgement that the request is in progress and the final document will arrive separately when ready.",
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

  private createRetrievalActivityStreamEvents(
    acceptedTurn: AcceptedRuntimeTurn,
    execution: PreparedTurnExecution
  ): RuntimeTurnStreamEvent[] {
    const context = execution.retrievedKnowledgeContext;
    const activeSkillName = this.resolveActiveSkillActivityName(execution, context);
    const activeSkillIconEmoji = this.resolveActiveSkillActivityIconEmoji(execution);
    if (context === null || context.items.length === 0) {
      if (!execution.routeDecision.retrievalPlan.useSkills || activeSkillName === undefined) {
        return [];
      }
      return [
        {
          type: "retrieval_activity",
          requestId: acceptedTurn.receipt.requestId,
          sessionId: acceptedTurn.session.sessionId,
          source: "skill",
          phase: "start",
          resultCount: 0,
          skillName: activeSkillName,
          ...(activeSkillIconEmoji === undefined ? {} : { skillIconEmoji: activeSkillIconEmoji })
        }
      ];
    }
    const counts = new Map<RuntimeRetrievalActivitySource, number>();
    for (const item of context.items) {
      const source = this.toRetrievalActivitySource(item.label);
      counts.set(source, (counts.get(source) ?? 0) + 1);
    }
    if (execution.routeDecision.retrievalPlan.useSkills && activeSkillName !== undefined) {
      counts.set("skill", counts.get("skill") ?? 0);
    }
    if (counts.size === 0) {
      return [];
    }
    return [...counts.entries()].map(([source, resultCount]) => {
      const skillName = source === "skill" ? activeSkillName : undefined;
      return {
        type: "retrieval_activity",
        requestId: acceptedTurn.receipt.requestId,
        sessionId: acceptedTurn.session.sessionId,
        source,
        phase: "start",
        resultCount,
        ...(skillName === undefined ? {} : { skillName }),
        ...(source !== "skill" || activeSkillIconEmoji === undefined
          ? {}
          : { skillIconEmoji: activeSkillIconEmoji })
      };
    });
  }

  private resolveActiveSkillActivityName(
    execution: PreparedTurnExecution,
    context: RuntimeRetrievedKnowledgeContext | null
  ): string | undefined {
    const state = execution.routeDecision.skillState;
    if (state?.status === "active" && state.activeSkillName !== null) {
      const activeName = state.activeSkillName.trim();
      if (activeName.length > 0) {
        return activeName;
      }
    }
    const retrievedSkillName =
      context === null ? undefined : this.resolveFirstRetrievedSkillName(context);
    if (retrievedSkillName !== undefined) {
      return retrievedSkillName;
    }
    return this.resolveSelectedSkillActivitySummary(execution)?.name;
  }

  private resolveActiveSkillActivityIconEmoji(
    execution: PreparedTurnExecution
  ): string | undefined {
    const skill = this.resolveSelectedSkillActivitySummary(execution);
    const iconEmoji = skill?.iconEmoji?.trim();
    return iconEmoji && iconEmoji.length > 0 ? iconEmoji : undefined;
  }

  private resolveSelectedSkillActivitySummary(
    execution: PreparedTurnExecution
  ): { name: string; iconEmoji?: string | null } | undefined {
    const activeSkillId = execution.routeDecision.skillState?.activeSkillId;
    const selectedSkillIds =
      typeof activeSkillId === "string" && activeSkillId.trim().length > 0
        ? [activeSkillId]
        : execution.routeDecision.retrievalPlan.selectedSkillIds;
    for (const skillId of selectedSkillIds) {
      const normalizedSkillId = typeof skillId === "string" ? skillId.trim() : "";
      if (normalizedSkillId.length === 0) {
        continue;
      }
      const skill =
        execution.bundle.skills?.enabled.find((row) => row.id === normalizedSkillId) ?? null;
      if (skill === null) {
        continue;
      }
      const name = skill.name.trim();
      if (name.length > 0) {
        return skill.iconEmoji === undefined ? { name } : { name, iconEmoji: skill.iconEmoji };
      }
    }
    return undefined;
  }

  private resolveFirstRetrievedSkillName(
    context: RuntimeRetrievedKnowledgeContext
  ): string | undefined {
    const item = context.items.find((row) => row.label === "skill_reference") ?? null;
    const title = item?.title?.trim();
    if (!title) {
      return undefined;
    }
    return title.split(" / ")[0]?.trim() || undefined;
  }

  private toRetrievalActivitySource(
    label: RuntimeRetrievedKnowledgeContext["items"][number]["label"]
  ): RuntimeRetrievalActivitySource {
    switch (label) {
      case "skill_reference":
        return "skill";
      case "product_kb":
        return "product";
      case "web_reference":
        return "web";
      case "user_document":
        return "user";
    }
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
      fileRefs: [],
      usageEntries: [],
      toolInvocations: [],
      deferredMediaJobs: [],
      hadRejectedMediaRequest: false,
      deferredDocumentJobs: [],
      closedOpenLoopRefs: [],
      discoveredFileRefIdSet: []
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
        const existingFileIndex = turnState.fileRefs.findIndex(
          (existingFileRef) => existingFileRef.fileRef === artifact.file.fileRef
        );
        if (existingFileIndex >= 0) {
          turnState.fileRefs[existingFileIndex] = artifact.file;
        } else {
          turnState.fileRefs.push(artifact.file);
        }
      }
    }

    const producedFileRefs = this.extractProducedFileRefs(outcome.payload);
    if (producedFileRefs.length > 0) {
      for (const fileRef of producedFileRefs) {
        const existingIndex = turnState.fileRefs.findIndex(
          (existingFileRef) => existingFileRef.fileRef === fileRef.fileRef
        );
        if (existingIndex >= 0) {
          turnState.fileRefs[existingIndex] = fileRef;
        } else {
          turnState.fileRefs.push(fileRef);
        }
      }
    }
    // ADR-100 follow-up — files-tool discovery refs (search/list/get/read)
    // surface as a parallel signal: they don't replace any existing entry
    // for `fileRef.fileRef`, but they merge the sticky Working Files aliases
    // onto whichever entry already exists so the next provider iteration can
    // address it through `files.send` / `image_edit` without recomputing
    // recency-based ordinals.
    if (outcome.discoveredFileRefs !== undefined && outcome.discoveredFileRefs.length > 0) {
      for (const discoveredRef of outcome.discoveredFileRefs) {
        const existingIndex = turnState.fileRefs.findIndex(
          (existingFileRef) => existingFileRef.fileRef === discoveredRef.fileRef
        );
        if (existingIndex >= 0) {
          const existing = turnState.fileRefs[existingIndex]!;
          turnState.fileRefs[existingIndex] = {
            ...existing,
            aliases: this.mergeFileRefAliases(existing.aliases, discoveredRef.aliases)
          };
        } else {
          turnState.fileRefs.push(discoveredRef);
        }
        // ADR-100 Piece 1 — also track the canonical id for durable persistence
        // so the API can write it to assistant message metadata and future
        // hydration can preserve the same sticky Working Files handle.
        if (
          turnState.discoveredFileRefIdSet.length < 20 &&
          !turnState.discoveredFileRefIdSet.includes(discoveredRef.fileRef)
        ) {
          turnState.discoveredFileRefIdSet.push(discoveredRef.fileRef);
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
      this.markRejectedMediaRequestIfApplicable(turnState, outcome.payload);
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
    this.markRejectedMediaRequestIfApplicable(turnState, outcome.payload);
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

  /**
   * ADR-105 — flag a turn that contains a rejected media request (a media tool
   * returning `action: "skipped"`). When set, the deferred-media text
   * correction does not blanket-overwrite the assistant reply, so an explicit
   * rejection explanation (limit hit, quota, safety, validation) survives even
   * when another media request in the same turn was accepted as pending.
   */
  private markRejectedMediaRequestIfApplicable(
    turnState: TurnExecutionState,
    payload: ToolExecutionOutcome["payload"]
  ): void {
    if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
      return;
    }
    const row = payload as { action?: unknown; toolCode?: unknown };
    if (
      row.action === "skipped" &&
      (row.toolCode === IMAGE_GENERATE_TOOL_CODE ||
        row.toolCode === IMAGE_EDIT_TOOL_CODE ||
        row.toolCode === VIDEO_GENERATE_TOOL_CODE)
    ) {
      turnState.hadRejectedMediaRequest = true;
    }
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
      action === "search" ||
      action === "inspect" ||
      action === "get" ||
      action === "read" ||
      action === "preview" ||
      action === "write" ||
      action === "write_and_send" ||
      action === "edit" ||
      action === "delete" ||
      action === "send"
      ? action
      : null;
  }

  /**
   * Case-insensitive alias merge that mirrors
   * `TurnContextHydrationService.mergeAliases` (which is private to that
   * service). Used when merging files-tool discovery refs into
   * `turnState.fileRefs` so the discovered file's sticky Working Files labels
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

  private extractProducedFileRefs(payload: ToolExecutionOutcome["payload"]): RuntimeFileRef[] {
    const job = this.resolveProducedFileJob(payload);
    if (job === null || job.files.length === 0) {
      return [];
    }
    return job.files.map((file) => file.fileRef);
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
  ): RuntimeSandboxToolResult["job"] | RuntimeFilesToolResult["job"] {
    if (this.isSandboxToolPayload(payload)) {
      return payload.job;
    }
    if (this.isFilesToolPayload(payload)) {
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
      availableWorkingFileRefs: execution.availableWorkingFileRefs,
      deepModeEnabled: execution.deepModeEnabled,
      routeDecision: execution.routeDecision,
      retrievedKnowledgeContext: execution.retrievedKnowledgeContext,
      openLoopRefsBlock,
      presenceBlock,
      openMediaJobs: input.openMediaJobs,
      openDocumentJobs: input.openDocumentJobs,
      jobDeliveryUpdates: input.jobDeliveryUpdates
    });
    execution.developerInstructionSections = developerInstructionSections;
    return this.buildProviderRequest(
      execution.bundle,
      {
        provider: execution.providerRequest.provider,
        model: execution.providerRequest.model
      },
      hydratedMessages,
      execution.projectedTools,
      execution.deepModeEnabled,
      developerInstructionSections,
      execution.promptMode
    );
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

  private buildPromptCacheConfig(input: {
    bundle: AssistantRuntimeBundle;
    provider: NativeManagedProvider;
    family: string;
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
      retention: DEFAULT_OPENAI_PROMPT_CACHE_RETENTION
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

  private truncate(value: string, maxChars: number): string {
    const normalized = value.trim();
    if (normalized.length <= maxChars) {
      return normalized;
    }
    return `${normalized.slice(0, Math.max(0, maxChars - 14)).trimEnd()}\n[truncated]`;
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
    return value === "openai" || value === "anthropic" ? value : null;
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
      ...(turnState === undefined || turnState.fileRefs.length === 0
        ? {}
        : { fileRefs: [...turnState.fileRefs] }),
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
      ...(turnState.fileRefs.length === 0 ? {} : { fileRefs: [...turnState.fileRefs] })
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
