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
  PERSAI_RUNTIME_MODEL_ROLES,
  PERSAI_RUNTIME_WEB_FETCH_EXTRACT_MODES,
  type PersaiRuntimeWebSearchProviderId,
  type PersaiRuntimeSharedCompactionToolCode,
  type ProviderGatewayPromptCacheConfig,
  type ProviderGatewayRequestMetadata,
  type ProviderGatewayToolCall,
  type ProviderGatewayToolExchange,
  type ProviderGatewayTextMessage,
  type ProviderGatewayTextGenerateRequest,
  type ProviderGatewayTextGenerateResult,
  type PersaiRuntimeWebFetchExtractMode,
  type RuntimeCompactionRequest,
  type RuntimeKnowledgeFetchToolResult,
  type RuntimeKnowledgeSearchToolResult,
  type RuntimeMemoryWriteToolResult,
  type RuntimeQuotaStatusToolResult,
  type RuntimeBrowserToolResult,
  type RuntimeFilesToolResult,
  type RuntimeImageEditToolResult,
  type RuntimeImageGenerateToolResult,
  type RuntimeFileRef,
  type RuntimeOutputArtifact,
  type RuntimeSandboxToolResult,
  type RuntimeScheduledActionToolResult,
  type RuntimeSharedCompactionToolResult,
  type RuntimeTtsToolResult,
  type RuntimeVideoGenerateToolResult,
  type RuntimeToolPolicy,
  type RuntimeFailedEvent,
  type RuntimeInterruptedEvent,
  type RuntimeTurnAutoCompactionState,
  type RuntimeTextDeltaSource,
  type RuntimeTurnRequest,
  type RuntimeTurnResult,
  type RuntimeTurnRoutingSnapshot,
  type RuntimeTurnStreamEvent,
  type RuntimeWebSearchToolResult,
  type RuntimeWebFetchToolResult,
  type RuntimeUsageAccounting,
  type RuntimeUsageAccountingEntry,
  type RuntimeUsageSnapshot,
  type PersaiRuntimeModelRole
} from "@persai/runtime-contract";
import { RuntimeBundleRegistryService } from "../bundles/runtime-bundle-registry.service";
import type { RuntimeTurnReceiptSummary } from "./idempotency.service";
import {
  projectRuntimeNativeTools,
  type RuntimeNativeToolProjection
} from "./native-tool-projection";
import { PersaiInternalApiClientService } from "./persai-internal-api.client.service";
import { ProviderGatewayClientService } from "./provider-gateway.client.service";
import { RuntimeBrowserToolService } from "./runtime-browser-tool.service";
import { RuntimeFilesToolService } from "./runtime-files-tool.service";
import { RuntimeImageEditToolService } from "./runtime-image-edit-tool.service";
import { RuntimeImageGenerateToolService } from "./runtime-image-generate-tool.service";
import { RuntimeKnowledgeToolService } from "./runtime-knowledge-tool.service";
import { RuntimeMemoryWriteToolService } from "./runtime-memory-write-tool.service";
import { RuntimeQuotaStatusToolService } from "./runtime-quota-status-tool.service";
import { RuntimeSandboxToolService } from "./runtime-sandbox-tool.service";
import { RuntimeScheduledActionToolService } from "./runtime-scheduled-action-tool.service";
import { RuntimeTtsToolService } from "./runtime-tts-tool.service";
import { RuntimeVideoGenerateToolService } from "./runtime-video-generate-tool.service";
import {
  buildPromptCacheStableBlockToken,
  resolveLeadingHydratedPromptCacheStableBlockTokens
} from "./prompt-cache-stable-blocks";
import { resolveRuntimeContextHydrationConfig } from "./runtime-context-hydration-policy";
import { SessionCompactionService } from "./session-compaction.service";
import { TurnContextHydrationService } from "./turn-context-hydration.service";
import { TurnAcceptanceService, type AcceptedRuntimeTurn } from "./turn-acceptance.service";
import { TurnFinalizationService } from "./turn-finalization.service";
import { RuntimeBundleAutoRefreshService } from "./runtime-bundle-auto-refresh.service";
import { TurnRoutingService, type TurnRouteDecision } from "./turn-routing.service";

type NativeManagedProvider = "openai" | "anthropic";

type ProviderSelection = {
  provider: NativeManagedProvider;
  model: string;
};

const PROMPT_CACHE_KEY_BUCKETS = 8;
const PROMPT_CACHE_KEY_DIGEST_HEX_LENGTH = 32;
const DEFAULT_OPENAI_PROMPT_CACHE_RETENTION = "in_memory" as const;

type PreparedTurnExecution = {
  bundle: AssistantRuntimeBundle;
  projectedTools: RuntimeNativeToolProjection;
  runtimeTier: RuntimeTurnRequest["runtimeTier"];
  providerRequest: ProviderGatewayTextGenerateRequest;
  currentMessageAttachments: RuntimeTurnRequest["message"]["attachments"];
  deepModeEnabled: boolean;
  selectedModelRole: PersaiRuntimeModelRole;
  routeDecision: TurnRouteDecision;
  preludeUsageEntries: RuntimeUsageAccountingEntry[];
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
};

type AutoCompactionRequest = RuntimeCompactionRequest & {
  trigger: "auto_compaction";
  runtimeRequestId: string;
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
    | RuntimeFilesToolResult
    | RuntimeImageEditToolResult
    | RuntimeImageGenerateToolResult
    | RuntimeSandboxToolResult
    | RuntimeScheduledActionToolResult
    | RuntimeTtsToolResult
    | RuntimeVideoGenerateToolResult
    | RuntimeWebSearchToolResult
    | RuntimeWebFetchToolResult
    | Record<string, unknown>;
  artifacts?: RuntimeOutputArtifact[];
  sharedCompaction?: {
    toolCode: PersaiRuntimeSharedCompactionToolCode;
    durableStatePersisted: boolean;
  };
};

class TurnExecutionError extends Error {
  constructor(
    readonly code: string,
    readonly exception: HttpException
  ) {
    super(exception.message);
  }
}

const MAX_NATIVE_TOOL_LOOP_ITERATIONS = 4;
const BROWSER_TOOL_CODE = "browser";
const WEB_SEARCH_TOOL_CODE = "web_search";
const DEFAULT_NATIVE_WEB_SEARCH_PROVIDER_ID: PersaiRuntimeWebSearchProviderId = "tavily";
const WEB_SEARCH_MIN_COUNT = 1;
const WEB_SEARCH_MAX_COUNT = 20;
const WEB_FETCH_TOOL_CODE = "web_fetch";
const WEB_FETCH_DEFAULT_EXTRACT_MODE: PersaiRuntimeWebFetchExtractMode = "markdown";
const WEB_FETCH_MIN_MAX_CHARS = 100;
const WEB_FETCH_MAX_MAX_CHARS = 50_000;
const MEMORY_WRITE_TOOL_CODE = "memory_write";
const QUOTA_STATUS_TOOL_CODE = "quota_status";
const SCHEDULED_ACTION_TOOL_CODE = "scheduled_action";
const IMAGE_EDIT_TOOL_CODE = "image_edit";
const IMAGE_GENERATE_TOOL_CODE = "image_generate";
const VIDEO_GENERATE_TOOL_CODE = "video_generate";
const TTS_TOOL_CODE = "tts";
const FILES_TOOL_CODE = "files";
const EXEC_TOOL_CODE = "exec";
const SHELL_TOOL_CODE = "shell";

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
    private readonly runtimeFilesToolService: RuntimeFilesToolService,
    private readonly runtimeImageEditToolService: RuntimeImageEditToolService,
    private readonly runtimeImageGenerateToolService: RuntimeImageGenerateToolService,
    private readonly runtimeKnowledgeToolService: RuntimeKnowledgeToolService,
    private readonly runtimeMemoryWriteToolService: RuntimeMemoryWriteToolService,
    private readonly runtimeQuotaStatusToolService: RuntimeQuotaStatusToolService,
    private readonly runtimeSandboxToolService: RuntimeSandboxToolService,
    private readonly runtimeScheduledActionToolService: RuntimeScheduledActionToolService,
    private readonly runtimeTtsToolService: RuntimeTtsToolService,
    private readonly runtimeVideoGenerateToolService: RuntimeVideoGenerateToolService
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
      }
    }
  }

  async streamTurn(
    input: RuntimeTurnRequest,
    options?: { signal?: AbortSignal }
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
        const execution = await this.prepareTurnExecution(input, {
          allowModelToolExposure: true
        });
        const turnState = this.createTurnExecutionState();
        this.applyPreparedTurnExecutionState(turnState, execution);
        return this.streamAcceptedTurn(acceptedTurn, execution, input, turnState, options?.signal);
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
      await this.failAcceptedTurnQuietly(acceptedTurn, error);
      throw this.toHttpException(error);
    }
  }

  private async prepareTurnExecution(
    input: RuntimeTurnRequest,
    options?: { allowModelToolExposure?: boolean }
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

    const hydratedMessages = await this.turnContextHydrationService.buildMessages(
      input,
      bundleEntry.parsedBundle
    );
    const baselineProjectedTools = projectRuntimeNativeTools(bundleEntry.parsedBundle, {
      allowModelToolExposure: options?.allowModelToolExposure ?? true
    });
    const executionPlan = await this.resolveTurnExecutionPlan(
      bundleEntry.parsedBundle,
      input,
      hydratedMessages,
      baselineProjectedTools
    );
    const providerSelection = this.resolveProviderSelection(bundleEntry.parsedBundle, {
      modelRoleOverride: executionPlan.modelRole,
      ...(input.providerOverride === undefined ? {} : { providerOverride: input.providerOverride }),
      ...(input.modelOverride === undefined ? {} : { modelOverride: input.modelOverride })
    });
    return {
      bundle: bundleEntry.parsedBundle,
      projectedTools: baselineProjectedTools,
      runtimeTier: input.runtimeTier,
      currentMessageAttachments: input.message.attachments,
      deepModeEnabled: input.deepMode === true,
      selectedModelRole: executionPlan.modelRole,
      routeDecision: executionPlan.routeDecision,
      preludeUsageEntries: executionPlan.usageEntries,
      providerRequest: this.buildProviderRequest(
        bundleEntry.parsedBundle,
        providerSelection,
        hydratedMessages,
        baselineProjectedTools,
        input.deepMode === true,
        executionPlan.routeDecision
      )
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
    signal?: AbortSignal
  ): AsyncGenerator<RuntimeTurnStreamEvent> {
    // Keep the fully assembled assistant text separate from the user-visible stream text.
    let assembledText = "";
    let deliveredText = "";
    const toolHistory: ProviderGatewayToolExchange[] = [];
    let completionFinalizationAttempted = false;

    yield {
      type: "started",
      requestId: acceptedTurn.receipt.requestId,
      sessionId: acceptedTurn.session.sessionId
    };

    try {
      for (let iteration = 0; iteration < MAX_NATIVE_TOOL_LOOP_ITERATIONS; iteration += 1) {
        const iterationBaseText = assembledText;
        const providerRequest = this.buildToolLoopProviderRequest(execution.providerRequest, {
          assistantText: iterationBaseText,
          toolHistory,
          requestMetadata: this.createTurnProviderRequestMetadata({
            acceptedTurn,
            classification: iteration === 0 ? "main_turn" : "tool_loop_followup",
            toolLoopIteration: iteration
          })
        });
        this.logger.log(
          `[turn-stream] requestId=${acceptedTurn.receipt.requestId} iteration=${String(iteration)} classification=${providerRequest.requestMetadata?.classification ?? "unknown"} modelRole=${execution.selectedModelRole} provider=${providerRequest.provider} model=${providerRequest.model} toolCount=${String(providerRequest.tools?.length ?? 0)} toolHistoryCount=${String(providerRequest.toolHistory?.length ?? 0)}`
        );
        const providerStream = await this.providerGatewayClientService.streamText(
          providerRequest,
          signal === undefined ? undefined : { signal }
        );
        let advancedToNextIteration = false;

        for await (const event of providerStream) {
          if (signal?.aborted) {
            await this.interruptAcceptedTurnQuietly({
              acceptedTurn,
              event: this.toInterruptedEvent(acceptedTurn, deliveredText, null)
            });
            return;
          }

          if (event.type === "keepalive") {
            continue;
          }

          if (event.type === "text_delta" && event.delta !== undefined) {
            assembledText = this.mergeAssistantTurnText(iterationBaseText, event.accumulatedText);
            const deltaEvent = this.createVisibleTextDeltaStreamEvent({
              acceptedTurn,
              previousDeliveredText: deliveredText,
              nextVisibleText: assembledText,
              source: "provider_text_delta"
            });
            if (deltaEvent !== null) {
              deliveredText = deltaEvent.accumulatedText;
              yield deltaEvent;
            }
            continue;
          }

          if (event.type === "tool_calls") {
            this.recordUsageEntry(turnState, {
              stepType: iteration === 0 ? "main_turn" : "tool_loop_followup",
              modelRole: execution.selectedModelRole,
              usage: event.result.usage
            });
            assembledText = this.mergeAssistantTurnText(assembledText, event.result.text);
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
            for (const toolCall of event.result.toolCalls) {
              yield this.createToolStartedStreamEvent(acceptedTurn, toolCall);
              let outcome: ToolExecutionOutcome;
              try {
                outcome = await this.executeProjectedToolCall(
                  execution,
                  acceptedTurn,
                  input,
                  toolCall,
                  input.idempotencyKey,
                  turnState.artifacts,
                  turnState.fileRefs
                );
              } catch (error) {
                yield this.createToolFinishedStreamEvent(acceptedTurn, toolCall, true);
                throw error;
              }
              toolHistory.push(outcome.exchange);
              this.applyToolExecutionOutcome(turnState, outcome);
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
            if (durableCompactionExecuted) {
              execution.providerRequest = await this.refreshProviderRequestMessages(
                execution,
                input
              );
            }

            advancedToNextIteration = true;
            break;
          }

          if (event.type === "completed" && event.result !== undefined) {
            const completedProviderResult = this.withAssistantText(
              event.result,
              this.resolveCompletedStreamAssistantText(
                iterationBaseText,
                assembledText,
                event.result.text
              )
            );
            this.recordUsageEntry(turnState, {
              stepType: iteration === 0 ? "main_turn" : "tool_loop_followup",
              modelRole: execution.selectedModelRole,
              usage: completedProviderResult.usage
            });
            const result = this.buildTurnResult(
              acceptedTurn,
              completedProviderResult,
              turnState,
              execution.routeDecision
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
            if (deliveredText.trim().length > 0) {
              const interrupted = this.toInterruptedEvent(acceptedTurn, deliveredText, null);
              await this.interruptAcceptedTurnQuietly({
                acceptedTurn,
                event: interrupted
              });
              yield interrupted;
              return;
            }

            const failed = await this.failAcceptedTurnQuietly(acceptedTurn, {
              type: "failed",
              requestId: acceptedTurn.receipt.requestId,
              sessionId: acceptedTurn.session.sessionId,
              code: event.code ?? "provider_stream_failed",
              message: event.message ?? "Provider stream failed.",
              willRetry: false
            });
            yield failed;
            return;
          }
        }

        if (advancedToNextIteration) {
          continue;
        }

        if (deliveredText.trim().length > 0) {
          const interrupted = this.toInterruptedEvent(acceptedTurn, deliveredText, null);
          await this.interruptAcceptedTurnQuietly({
            acceptedTurn,
            event: interrupted
          });
          yield interrupted;
          return;
        }

        const failed = await this.failAcceptedTurnQuietly(acceptedTurn, {
          type: "failed",
          requestId: acceptedTurn.receipt.requestId,
          sessionId: acceptedTurn.session.sessionId,
          code: "provider_stream_ended",
          message: "Provider stream ended before native turn completion.",
          willRetry: false
        });
        yield failed;
        return;
      }

      const exhausted = await this.failAcceptedTurnQuietly(acceptedTurn, {
        type: "failed",
        requestId: acceptedTurn.receipt.requestId,
        sessionId: acceptedTurn.session.sessionId,
        code: "native_tool_loop_exhausted",
        message: `Native tool loop exceeded ${String(MAX_NATIVE_TOOL_LOOP_ITERATIONS)} iterations.`,
        willRetry: false
      });
      yield exhausted;
    } catch (error) {
      if (completionFinalizationAttempted) {
        throw this.toHttpException(error);
      }

      if (signal?.aborted || this.isAbortError(error)) {
        await this.interruptAcceptedTurnQuietly({
          acceptedTurn,
          event: this.toInterruptedEvent(acceptedTurn, deliveredText, null)
        });
        return;
      }

      if (deliveredText.trim().length > 0) {
        const interrupted = this.toInterruptedEvent(acceptedTurn, deliveredText, null);
        await this.interruptAcceptedTurnQuietly({
          acceptedTurn,
          event: interrupted
        });
        yield interrupted;
        return;
      }

      const failed = await this.failAcceptedTurnQuietly(acceptedTurn, error);
      yield failed;
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

  private buildTurnResult(
    acceptedTurn: AcceptedRuntimeTurn,
    providerResult: ProviderGatewayTextGenerateResult,
    turnState: TurnExecutionState,
    routeDecision?: TurnRouteDecision
  ): RuntimeTurnResult {
    if (providerResult.stopReason !== "completed" || providerResult.text === null) {
      throw new InternalServerErrorException(
        `Turn "${acceptedTurn.receipt.requestId}" did not finish with a completed text result.`
      );
    }

    const turnRouting =
      routeDecision === undefined ? null : this.toRuntimeTurnRoutingSnapshot(routeDecision);
    return {
      requestId: acceptedTurn.receipt.requestId,
      sessionId: acceptedTurn.session.sessionId,
      assistantText: providerResult.text,
      artifacts: [...turnState.artifacts],
      respondedAt: providerResult.respondedAt,
      usage: providerResult.usage,
      ...(turnRouting === null ? {} : { turnRouting }),
      ...(turnState.usageEntries.length === 0
        ? {}
        : { usageAccounting: this.buildUsageAccounting(turnState.usageEntries) })
    };
  }

  private toRuntimeTurnRoutingSnapshot(
    routeDecision: TurnRouteDecision
  ): RuntimeTurnRoutingSnapshot | null {
    const source =
      routeDecision.source === "classifier"
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
      source
    };
  }

  private async finalizeAcceptedTurnWithPostTurnEffects(input: {
    acceptedTurn: AcceptedRuntimeTurn;
    result: RuntimeTurnResult;
    input: RuntimeTurnRequest;
    bundle: AssistantRuntimeBundle;
    turnState: TurnExecutionState;
  }): Promise<RuntimeTurnResult> {
    const autoCompaction = await this.executePostTurnAutoCompaction(
      input.input,
      input.bundle,
      input.turnState
    );
    const finalizedResult =
      autoCompaction === null ? input.result : { ...input.result, autoCompaction };
    await this.turnFinalizationService.completeAcceptedTurn(input.acceptedTurn, finalizedResult);
    return finalizedResult;
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
    routeDecision: TurnRouteDecision
  ): ProviderGatewayTextGenerateRequest {
    const promptCache = this.buildPromptCacheConfig({
      bundle,
      provider: providerSelection.provider,
      family: deepModeEnabled ? "deep_chat" : "ordinary_chat",
      messages,
      deepModeEnabled,
      projectedTools
    });
    return {
      provider: providerSelection.provider,
      model: providerSelection.model,
      systemPrompt: this.buildSystemPrompt(bundle, projectedTools, deepModeEnabled, routeDecision),
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
    projectedTools?: RuntimeNativeToolProjection,
    deepModeEnabled = false,
    routeDecision?: TurnRouteDecision
  ): string | null {
    const normalized = this.normalizeOptionalText(bundle.promptConstructor.ordinary.systemPrompt);
    const routingGuidance = this.buildTurnRoutingPrompt(
      projectedTools,
      routeDecision,
      deepModeEnabled
    );
    const sections = [normalized, routingGuidance]
      .filter((section): section is string => section !== null)
      .join("\n\n");
    return sections.length === 0 ? null : sections;
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
      source: "default",
      mode: "shadow",
      usage: null
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
    const modelRole =
      routeDecision.mode === "active"
        ? this.mapExecutionModeToModelRole(routeDecision.executionMode)
        : input.deepMode === true
          ? "premium_reply"
          : "normal_reply";
    return {
      modelRole,
      routeDecision,
      usageEntries: this.toTurnRoutingUsageEntries(routeDecision.usage)
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
        cachedInputTokens: usage.cachedInputTokens ?? null,
        outputTokens: usage.outputTokens,
        totalTokens: usage.totalTokens
      }
    ];
  }

  private assertSupportedTurnRequest(
    input: RuntimeTurnRequest,
    operation: "createTurn" | "streamTurn"
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
    for (let iteration = 0; iteration < MAX_NATIVE_TOOL_LOOP_ITERATIONS; iteration += 1) {
      const providerResult = await this.providerGatewayClientService.generateText(
        this.buildToolLoopProviderRequest(execution.providerRequest, {
          assistantText: accumulatedText,
          toolHistory,
          requestMetadata: this.createTurnProviderRequestMetadata({
            acceptedTurn,
            classification: iteration === 0 ? "main_turn" : "tool_loop_followup",
            toolLoopIteration: iteration
          })
        })
      );
      this.recordUsageEntry(turnState, {
        stepType: iteration === 0 ? "main_turn" : "tool_loop_followup",
        modelRole: execution.selectedModelRole,
        usage: providerResult.usage
      });
      accumulatedText = this.mergeAssistantTurnText(accumulatedText, providerResult.text);
      if (providerResult.stopReason === "completed") {
        return this.withAssistantText(providerResult, accumulatedText);
      }
      if (providerResult.toolCalls.length === 0) {
        throw new TurnExecutionError(
          "native_tool_result_invalid",
          new ServiceUnavailableException(
            "Provider returned a tool-call stop without any tool calls."
          )
        );
      }

      const exchanges: ProviderGatewayToolExchange[] = [];
      let durableCompactionExecuted = false;
      for (const toolCall of providerResult.toolCalls) {
        const outcome = await this.executeProjectedToolCall(
          execution,
          acceptedTurn,
          input,
          toolCall,
          input.idempotencyKey,
          turnState.artifacts,
          turnState.fileRefs
        );
        exchanges.push(outcome.exchange);
        this.applyToolExecutionOutcome(turnState, outcome);
        durableCompactionExecuted =
          durableCompactionExecuted || outcome.sharedCompaction?.durableStatePersisted === true;
      }
      toolHistory.push(...exchanges);
      if (durableCompactionExecuted) {
        execution.providerRequest = await this.refreshProviderRequestMessages(execution, input);
      }
    }

    throw new TurnExecutionError(
      "native_tool_loop_exhausted",
      new ServiceUnavailableException(
        `Native tool loop exceeded ${String(MAX_NATIVE_TOOL_LOOP_ITERATIONS)} iterations.`
      )
    );
  }

  private async executeProjectedToolCall(
    execution: PreparedTurnExecution,
    acceptedTurn: AcceptedRuntimeTurn,
    input: RuntimeTurnRequest,
    toolCall: ProviderGatewayToolCall,
    currentUserMessageId: string | null,
    currentArtifacts: RuntimeOutputArtifact[],
    currentFileRefs: RuntimeFileRef[]
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
      case QUOTA_STATUS_TOOL_CODE: {
        const result = await this.runtimeQuotaStatusToolService.executeToolCall({
          bundle: execution.bundle,
          toolCall
        });
        return this.createToolExecutionOutcome(toolCall, result.payload, result.isError);
      }
      case FILES_TOOL_CODE: {
        const result = await this.runtimeFilesToolService.executeToolCall({
          bundle: execution.bundle,
          toolCall,
          sessionId: acceptedTurn.session.sessionId,
          requestId: acceptedTurn.receipt.requestId,
          currentArtifacts,
          currentFileRefs,
          channel: acceptedTurn.session.conversation.channel
        });
        return this.createToolExecutionOutcome(
          toolCall,
          result.payload,
          result.isError,
          undefined,
          result.artifacts
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
      case IMAGE_EDIT_TOOL_CODE: {
        const result = await this.runtimeImageEditToolService.executeToolCall({
          bundle: execution.bundle,
          toolCall,
          currentAttachments: execution.currentMessageAttachments,
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
      case IMAGE_GENERATE_TOOL_CODE: {
        const result = await this.runtimeImageGenerateToolService.executeToolCall({
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
      case VIDEO_GENERATE_TOOL_CODE: {
        const result = await this.runtimeVideoGenerateToolService.executeToolCall({
          bundle: execution.bundle,
          toolCall,
          currentAttachments: execution.currentMessageAttachments,
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
        allowedSources: execution.projectedTools.knowledgeSearchSources
      })
      .then((result) => this.createToolExecutionOutcome(toolCall, result.payload, result.isError));
  }

  private executeKnowledgeFetchTool(
    execution: PreparedTurnExecution,
    toolCall: ProviderGatewayToolCall
  ): Promise<ToolExecutionOutcome> {
    return this.runtimeKnowledgeToolService
      .executeFetchToolCall({
        bundle: execution.bundle,
        toolCall,
        allowedSources: execution.projectedTools.knowledgeFetchSources
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
      if (policy.dailyCallLimit !== null) {
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
        warning: providerResult.warning
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
      if (policy.dailyCallLimit !== null) {
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
        warning: providerResult.warning
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
      | RuntimeFilesToolResult
      | RuntimeImageEditToolResult
      | RuntimeImageGenerateToolResult
      | RuntimeSandboxToolResult
      | RuntimeScheduledActionToolResult
      | RuntimeTtsToolResult
      | RuntimeVideoGenerateToolResult
      | RuntimeWebSearchToolResult
      | RuntimeWebFetchToolResult
      | Record<string, unknown>,
    isError = false,
    sharedCompaction?: ToolExecutionOutcome["sharedCompaction"],
    artifacts?: RuntimeOutputArtifact[]
  ): ToolExecutionOutcome {
    return {
      exchange: {
        toolCall,
        toolResult: {
          toolCallId: toolCall.id,
          name: toolCall.name,
          content: JSON.stringify(payload),
          isError
        }
      },
      payload,
      ...(artifacts === undefined ? {} : { artifacts }),
      ...(sharedCompaction === undefined ? {} : { sharedCompaction })
    };
  }

  private buildToolLoopProviderRequest(
    baseRequest: ProviderGatewayTextGenerateRequest,
    input: {
      assistantText: string;
      toolHistory: ProviderGatewayToolExchange[];
      requestMetadata: ProviderGatewayRequestMetadata;
    }
  ): ProviderGatewayTextGenerateRequest {
    const assistantText = this.normalizeOptionalText(input.assistantText);
    return {
      ...baseRequest,
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
      requestMetadata: input.requestMetadata
    };
  }

  private mergeAssistantTurnText(existingText: string, nextText: string | null): string {
    if (nextText === null || nextText.length === 0 || nextText.trim().length === 0) {
      return existingText;
    }
    if (existingText.length === 0) {
      return nextText;
    }
    if (nextText === existingText) {
      return existingText;
    }
    if (nextText.startsWith(existingText)) {
      return nextText;
    }
    if (existingText.startsWith(nextText)) {
      return existingText;
    }
    return `${existingText}${nextText}`;
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
      usageEntries: []
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

  private applyToolExecutionOutcome(
    turnState: TurnExecutionState,
    outcome: ToolExecutionOutcome
  ): void {
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
      return;
    }
    turnState.sharedCompaction.invoked = true;
    turnState.sharedCompaction.durableStatePersisted =
      turnState.sharedCompaction.durableStatePersisted ||
      outcome.sharedCompaction.durableStatePersisted;
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

  private async refreshProviderRequestMessages(
    execution: PreparedTurnExecution,
    input: RuntimeTurnRequest
  ): Promise<ProviderGatewayTextGenerateRequest> {
    const messages = await this.turnContextHydrationService.buildMessages(input, execution.bundle);
    return this.buildProviderRequest(
      execution.bundle,
      {
        provider: execution.providerRequest.provider,
        model: execution.providerRequest.model
      },
      messages,
      execution.projectedTools,
      execution.deepModeEnabled,
      execution.routeDecision
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
      cachedInputTokens: input.usage.cachedInputTokens ?? null,
      outputTokens: input.usage.outputTokens,
      totalTokens: input.usage.totalTokens,
      ...(input.toolCode === undefined ? {} : { toolCode: input.toolCode })
    });
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

  private async executePostTurnAutoCompaction(
    input: RuntimeTurnRequest,
    bundle: AssistantRuntimeBundle,
    turnState: TurnExecutionState
  ): Promise<RuntimeTurnAutoCompactionState | null> {
    if (turnState.sharedCompaction.durableStatePersisted) {
      return null;
    }

    const request = this.buildAutoCompactionRequest(input, bundle);
    if (request === null) {
      return null;
    }

    try {
      const result = await this.sessionCompactionService.compactSession(request);
      if (result.toolResult.usage !== null) {
        this.recordUsageEntry(turnState, {
          stepType: "auto_compaction",
          modelRole: "system_tool",
          usage: result.toolResult.usage,
          toolCode: result.toolResult.toolCode
        });
      }
      if (result.compacted) {
        turnState.sharedCompaction.invoked = true;
        turnState.sharedCompaction.durableStatePersisted = true;
        return {
          tokensBefore: result.tokensBefore,
          tokensAfter: result.tokensAfter
        };
      }
      if (
        result.reason !== "threshold_not_reached" &&
        result.reason !== "nothing_to_compact" &&
        result.reason !== "session_busy"
      ) {
        this.logger.warn(
          `[auto-compaction] Non-terminal skip for ${request.conversation.channel}:${request.conversation.externalThreadKey} (${String(
            result.reason ?? "unknown"
          )})`
        );
      }
    } catch (error) {
      this.logger.warn(
        `[auto-compaction] Failed for ${request.conversation.channel}:${request.conversation.externalThreadKey}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
    return null;
  }

  private buildAutoCompactionRequest(
    input: RuntimeTurnRequest,
    bundle: AssistantRuntimeBundle
  ): AutoCompactionRequest | null {
    const contextHydration = resolveRuntimeContextHydrationConfig(bundle);
    const channel = input.conversation.channel;
    const enabled =
      channel === "telegram"
        ? contextHydration.autoCompactionTelegram
        : channel === "web"
          ? contextHydration.autoCompactionWeb
          : false;
    if (!enabled) {
      return null;
    }

    return {
      runtimeTier: input.runtimeTier,
      conversation: input.conversation,
      instructions: null,
      trigger: "auto_compaction",
      runtimeRequestId: input.requestId
    };
  }

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

  private asNativeManagedProvider(value: unknown): NativeManagedProvider | null {
    return value === "openai" || value === "anthropic" ? value : null;
  }

  private async failAcceptedTurnQuietly(
    acceptedTurn: AcceptedRuntimeTurn,
    error: unknown
  ): Promise<RuntimeFailedEvent> {
    const failure = this.toFailureEvent(acceptedTurn, error);
    try {
      await this.turnFinalizationService.failAcceptedTurn(acceptedTurn, failure);
    } catch {
      // The durable accepted receipt remains replay truth even if failure finalization also breaks.
    }
    return failure;
  }

  private async interruptAcceptedTurnQuietly(input: {
    acceptedTurn: AcceptedRuntimeTurn;
    event: RuntimeInterruptedEvent;
    usage?: RuntimeUsageSnapshot | null;
  }): Promise<void> {
    try {
      await this.turnFinalizationService.interruptAcceptedTurn(input);
    } catch {
      // The durable accepted receipt remains replay truth even if interruption finalization breaks.
    }
  }

  private toInterruptedEvent(
    acceptedTurn: AcceptedRuntimeTurn,
    assistantText: string,
    respondedAt: string | null
  ): RuntimeInterruptedEvent {
    return {
      type: "interrupted",
      requestId: acceptedTurn.receipt.requestId,
      sessionId: acceptedTurn.session.sessionId,
      assistantText: assistantText.trim(),
      respondedAt
    };
  }

  private toFailureEvent(acceptedTurn: AcceptedRuntimeTurn, error: unknown): RuntimeFailedEvent {
    if (this.isRuntimeFailedEvent(error)) {
      return error;
    }
    if (error instanceof TurnExecutionError) {
      return {
        type: "failed",
        requestId: acceptedTurn.receipt.requestId,
        sessionId: acceptedTurn.session.sessionId,
        code: error.code,
        message: error.message,
        willRetry: false
      };
    }
    if (error instanceof HttpException) {
      const status = error.getStatus();
      if (status === 400 || status === 413) {
        return {
          type: "failed",
          requestId: acceptedTurn.receipt.requestId,
          sessionId: acceptedTurn.session.sessionId,
          code: "native_runtime_request_invalid",
          message: error.message,
          willRetry: false
        };
      }
    }
    if (error instanceof Error && error.message.trim().length > 0) {
      return {
        type: "failed",
        requestId: acceptedTurn.receipt.requestId,
        sessionId: acceptedTurn.session.sessionId,
        code: "turn_execution_failed",
        message: error.message,
        willRetry: false
      };
    }
    return {
      type: "failed",
      requestId: acceptedTurn.receipt.requestId,
      sessionId: acceptedTurn.session.sessionId,
      code: "turn_execution_failed",
      message: "Native turn execution failed.",
      willRetry: false
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
