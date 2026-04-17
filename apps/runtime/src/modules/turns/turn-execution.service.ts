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
  type RuntimeImageEditToolResult,
  type RuntimeImageGenerateToolResult,
  type RuntimeOutputArtifact,
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
import { RuntimeImageEditToolService } from "./runtime-image-edit-tool.service";
import { RuntimeImageGenerateToolService } from "./runtime-image-generate-tool.service";
import { RuntimeKnowledgeToolService } from "./runtime-knowledge-tool.service";
import { RuntimeMemoryWriteToolService } from "./runtime-memory-write-tool.service";
import { RuntimeQuotaStatusToolService } from "./runtime-quota-status-tool.service";
import { RuntimeScheduledActionToolService } from "./runtime-scheduled-action-tool.service";
import { RuntimeTtsToolService } from "./runtime-tts-tool.service";
import { RuntimeVideoGenerateToolService } from "./runtime-video-generate-tool.service";
import { resolveRuntimeContextHydrationConfig } from "./runtime-context-hydration-policy";
import { SessionCompactionService } from "./session-compaction.service";
import { TurnContextHydrationService } from "./turn-context-hydration.service";
import { TurnAcceptanceService, type AcceptedRuntimeTurn } from "./turn-acceptance.service";
import { TurnFinalizationService } from "./turn-finalization.service";

type NativeManagedProvider = "openai" | "anthropic";

type ProviderSelection = {
  provider: NativeManagedProvider;
  model: string;
};

type UserFacingTurnModelRole = Extract<
  PersaiRuntimeModelRole,
  "normal_reply" | "premium_reply" | "reasoning"
>;

type TurnLookupStrategy =
  | "none"
  | "internal_first"
  | "internal_required"
  | "web_first"
  | "web_required";

type PreparedTurnExecution = {
  bundle: AssistantRuntimeBundle;
  projectedTools: RuntimeNativeToolProjection;
  runtimeTier: RuntimeTurnRequest["runtimeTier"];
  providerRequest: ProviderGatewayTextGenerateRequest;
  currentMessageAttachments: RuntimeTurnRequest["message"]["attachments"];
  deepModeEnabled: boolean;
  selectedModelRole: PersaiRuntimeModelRole;
  selectedLookupStrategy: TurnLookupStrategy;
  preludeUsageEntries: RuntimeUsageAccountingEntry[];
};

type TurnProviderRequestClassification = "main_turn" | "tool_loop_followup";

type TurnExecutionState = {
  sharedCompaction: {
    invoked: boolean;
    durableStatePersisted: boolean;
  };
  artifacts: RuntimeOutputArtifact[];
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
    | RuntimeImageEditToolResult
    | RuntimeImageGenerateToolResult
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
  routeControl?: {
    modelRole: UserFacingTurnModelRole;
    lookupStrategy: TurnLookupStrategy;
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
const ROUTE_CONTROL_TOOL_CODE = "route_control";
const TURN_MODEL_ROLE_SELECTION_MAX_OUTPUT_TOKENS = 120;
const TURN_MODEL_ROLE_SELECTION_RECENT_MESSAGE_COUNT = 3;
const TURN_MODEL_ROLE_SELECTION_RECENT_MESSAGE_MAX_CHARS = 280;
const TURN_MODEL_ROLE_SELECTION_RECENT_CONTEXT_MAX_CHARS = 900;
const TURN_LOOKUP_STRATEGIES: TurnLookupStrategy[] = [
  "none",
  "internal_first",
  "internal_required",
  "web_first",
  "web_required"
];
const USER_FACING_TURN_MODEL_ROLES: UserFacingTurnModelRole[] = [
  "normal_reply",
  "premium_reply",
  "reasoning"
];
const TURN_MODEL_ROLE_SELECTION_OUTPUT_SCHEMA = {
  name: "turn_execution_plan",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["role", "lookupStrategy"],
    properties: {
      role: {
        type: "string",
        enum: USER_FACING_TURN_MODEL_ROLES
      },
      lookupStrategy: {
        type: "string",
        enum: TURN_LOOKUP_STRATEGIES
      },
      reason: {
        type: "string"
      }
    }
  }
} as const;

@Injectable()
export class TurnExecutionService {
  private readonly logger = new Logger(TurnExecutionService.name);

  constructor(
    private readonly runtimeBundleRegistryService: RuntimeBundleRegistryService,
    private readonly providerGatewayClientService: ProviderGatewayClientService,
    private readonly persaiInternalApiClientService: PersaiInternalApiClientService,
    private readonly turnContextHydrationService: TurnContextHydrationService,
    private readonly turnAcceptanceService: TurnAcceptanceService,
    private readonly turnFinalizationService: TurnFinalizationService,
    private readonly sessionCompactionService: SessionCompactionService,
    private readonly runtimeBrowserToolService: RuntimeBrowserToolService,
    private readonly runtimeImageEditToolService: RuntimeImageEditToolService,
    private readonly runtimeImageGenerateToolService: RuntimeImageGenerateToolService,
    private readonly runtimeKnowledgeToolService: RuntimeKnowledgeToolService,
    private readonly runtimeMemoryWriteToolService: RuntimeMemoryWriteToolService,
    private readonly runtimeQuotaStatusToolService: RuntimeQuotaStatusToolService,
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
      return this.buildTurnResult(acceptedTurn, providerResult, turnState);
    } catch (error) {
      await this.failAcceptedTurnQuietly(acceptedTurn, error);
      throw this.toHttpException(error);
    }
  }

  private async prepareTurnExecution(
    input: RuntimeTurnRequest,
    options?: { allowModelToolExposure?: boolean }
  ): Promise<PreparedTurnExecution> {
    const bundleEntry = this.runtimeBundleRegistryService.getBundle(input.bundle.bundleId);
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
      selectedLookupStrategy: executionPlan.lookupStrategy,
      preludeUsageEntries: executionPlan.usageEntries,
      providerRequest: this.buildProviderRequest(
        bundleEntry.parsedBundle,
        providerSelection,
        hydratedMessages,
        baselineProjectedTools,
        executionPlan.lookupStrategy,
        input.deepMode === true
      )
    };
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
        const providerStream = await this.providerGatewayClientService.streamText(
          this.buildToolLoopProviderRequest(execution.providerRequest, {
            assistantText: iterationBaseText,
            toolHistory,
            requestMetadata: this.createTurnProviderRequestMetadata({
              acceptedTurn,
              classification: iteration === 0 ? "main_turn" : "tool_loop_followup",
              toolLoopIteration: iteration
            })
          }),
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
            let routeControl: ToolExecutionOutcome["routeControl"];
            for (const toolCall of event.result.toolCalls) {
              yield this.createToolStartedStreamEvent(acceptedTurn, toolCall);
              let outcome: ToolExecutionOutcome;
              try {
                outcome = await this.executeProjectedToolCall(
                  execution,
                  acceptedTurn,
                  input,
                  toolCall,
                  input.idempotencyKey
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
              routeControl = outcome.routeControl ?? routeControl;
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

            if (routeControl !== undefined) {
              this.applyRouteControlOutcome(execution, input, routeControl);
            }
            if (durableCompactionExecuted) {
              execution.providerRequest = await this.refreshProviderRequestMessages(
                execution.providerRequest,
                input,
                execution.bundle
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
            const result = this.buildTurnResult(acceptedTurn, completedProviderResult, turnState);
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
    turnState: TurnExecutionState
  ): RuntimeTurnResult {
    if (providerResult.stopReason !== "completed" || providerResult.text === null) {
      throw new InternalServerErrorException(
        `Turn "${acceptedTurn.receipt.requestId}" did not finish with a completed text result.`
      );
    }

    return {
      requestId: acceptedTurn.receipt.requestId,
      sessionId: acceptedTurn.session.sessionId,
      assistantText: providerResult.text,
      artifacts: [...turnState.artifacts],
      respondedAt: providerResult.respondedAt,
      usage: providerResult.usage,
      ...(turnState.usageEntries.length === 0
        ? {}
        : { usageAccounting: this.buildUsageAccounting(turnState.usageEntries) })
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
    lookupStrategy: TurnLookupStrategy,
    deepModeEnabled: boolean
  ): ProviderGatewayTextGenerateRequest {
    return {
      provider: providerSelection.provider,
      model: providerSelection.model,
      systemPrompt: this.buildSystemPrompt(bundle, projectedTools, lookupStrategy, deepModeEnabled),
      messages,
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
    lookupStrategy: TurnLookupStrategy = "none",
    deepModeEnabled = false
  ): string | null {
    const normalized = this.normalizeOptionalText(bundle.promptConstructor.ordinary.systemPrompt);
    const routeGuidance = this.buildLookupStrategyPrompt(bundle, projectedTools, lookupStrategy);
    const routeControlGuidance = this.buildRouteControlPrompt(
      bundle,
      projectedTools,
      deepModeEnabled
    );
    const sections = [normalized, routeGuidance, routeControlGuidance]
      .filter((section): section is string => section !== null)
      .join("\n\n");
    return sections.length === 0 ? null : sections;
  }

  private buildRouteControlPrompt(
    bundle: AssistantRuntimeBundle,
    projectedTools: RuntimeNativeToolProjection | undefined,
    deepModeEnabled: boolean
  ): string | null {
    const availableToolNames =
      projectedTools === undefined ? [] : projectedTools.tools.map((tool) => tool.name);
    if (!availableToolNames.includes(ROUTE_CONTROL_TOOL_CODE)) {
      return null;
    }
    return [
      "## Route Control",
      deepModeEnabled
        ? "Deep mode is enabled for this turn. Spend more effort than usual on quality and completeness, and call route_control whenever you need help choosing between premium vs reasoning execution or deciding whether internal/web lookup should guide the answer."
        : "Stay on the ordinary reply path by default. Call route_control only when the turn is ambiguous, high-stakes, clearly needs deeper reasoning, or you need hidden guidance about whether internal/web lookup should steer the answer.",
      "Use route_control before answering when a short follow-up depends on earlier context, when the task may need premium/reasoning escalation, or when the answer likely needs assistant-owned knowledge or live web verification.",
      "If route_control returns a route, follow it on the next step instead of guessing."
    ].join("\n");
  }

  private buildLookupStrategyPrompt(
    bundle: AssistantRuntimeBundle,
    projectedTools: RuntimeNativeToolProjection | undefined,
    lookupStrategy: TurnLookupStrategy
  ): string | null {
    if (lookupStrategy === "none") {
      return null;
    }
    const availableToolNames =
      projectedTools === undefined ? [] : projectedTools.tools.map((tool) => tool.name);
    const availableKnowledgeTools = [
      bundle.runtime.knowledgeAccess.searchToolCode,
      bundle.runtime.knowledgeAccess.fetchToolCode
    ].filter((toolName) => availableToolNames.includes(toolName));
    const availableWebTools = [WEB_SEARCH_TOOL_CODE, WEB_FETCH_TOOL_CODE, BROWSER_TOOL_CODE].filter(
      (toolName) => availableToolNames.includes(toolName)
    );
    const availableKnowledgeSummary =
      availableKnowledgeTools.length === 0
        ? "none currently available"
        : availableKnowledgeTools.join(", ");
    const availableWebSummary =
      availableWebTools.length === 0 ? "none currently available" : availableWebTools.join(", ");
    const instruction =
      lookupStrategy === "internal_required"
        ? "Use internal assistant-owned knowledge or memory tools before answering. If internal evidence is unavailable, say so instead of substituting unsupported claims from general memory."
        : lookupStrategy === "internal_first"
          ? "Prefer internal assistant-owned knowledge or memory tools first. If internal lookup is insufficient, web tools may be used as fallback."
          : lookupStrategy === "web_required"
            ? "Use live web lookup before answering. Do not rely on stale memory alone for current or fast-changing facts."
            : "Prefer live web lookup first. Internal tools may still be used if they add relevant assistant-owned context.";
    return [
      "## Turn Route Guidance",
      instruction,
      `Available internal tools for this turn: ${availableKnowledgeSummary}.`,
      `Available web tools for this turn: ${availableWebSummary}.`
    ].join("\n");
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
    lookupStrategy: TurnLookupStrategy;
    usageEntries: RuntimeUsageAccountingEntry[];
  }> {
    void bundle;
    void hydratedMessages;
    void projectedTools;

    if (input.modelRoleOverride !== undefined) {
      return {
        modelRole: input.modelRoleOverride,
        lookupStrategy: "none",
        usageEntries: []
      };
    }
    if (input.providerOverride !== undefined || input.modelOverride !== undefined) {
      return {
        modelRole: "normal_reply",
        lookupStrategy: "none",
        usageEntries: []
      };
    }
    return {
      modelRole: input.deepMode === true ? "premium_reply" : "normal_reply",
      lookupStrategy: "none",
      usageEntries: []
    };
  }

  private shouldRunTurnExecutionPlanner(
    bundle: AssistantRuntimeBundle,
    hydratedMessages: ProviderGatewayTextMessage[],
    projectedTools: RuntimeNativeToolProjection
  ): boolean {
    return (
      this.canRunTurnModelRoleChooser(bundle) ||
      this.shouldRunKnowledgeToolPlanner(hydratedMessages, projectedTools) ||
      this.shouldRunWebToolPlanner(hydratedMessages, projectedTools)
    );
  }

  private canRunTurnModelRoleChooser(bundle: AssistantRuntimeBundle): boolean {
    const selections = USER_FACING_TURN_MODEL_ROLES.map((role) =>
      this.resolveProviderSelectionForRole(bundle, role)
    );
    if (selections.some((selection) => selection === null)) {
      return false;
    }
    return (
      new Set(selections.map((selection) => `${selection?.provider}:${selection?.model}`)).size > 1
    );
  }

  private buildTurnExecutionPlanRequest(input: {
    bundle: AssistantRuntimeBundle;
    input: RuntimeTurnRequest;
    providerSelection: ProviderSelection;
    hydratedMessages: ProviderGatewayTextMessage[];
    routeControlReason?: string | null;
  }): ProviderGatewayTextGenerateRequest {
    const attachmentSummary =
      input.input.message.attachments.length === 0
        ? "none"
        : input.input.message.attachments
            .map(
              (attachment) => `${attachment.kind}:${attachment.filename ?? attachment.attachmentId}`
            )
            .join(", ");
    const recentConversationTail = this.buildTurnModelRoleRecentContext(input.hydratedMessages);
    return {
      provider: input.providerSelection.provider,
      model: input.providerSelection.model,
      systemPrompt: [
        "You are the hidden PersAI turn planner.",
        "Choose the cheapest reply role that should still preserve answer quality.",
        "normal_reply: ordinary chat, simple rewrites, brief help, low-risk replies.",
        "premium_reply: polished user-facing writing, nuanced emotional tone, broader synthesis, higher quality wording.",
        "reasoning: difficult debugging, planning, architecture, contracts, trade-offs, multi-step analysis, or high-stakes correctness.",
        "lookupStrategy=none when direct answering is fine and no source route needs to be enforced.",
        "lookupStrategy=internal_first when assistant-owned knowledge or memory should be checked first, but web fallback may still be acceptable.",
        "lookupStrategy=internal_required when the answer should come from assistant-owned knowledge or memory and unsupported guesses should be avoided.",
        "lookupStrategy=web_first when live web lookup is the best first move, but internal tools may still add useful context.",
        "lookupStrategy=web_required when current or fast-changing facts require live web verification before answering.",
        "Short follow-ups like yes, no, continue, or ok can inherit complexity from the recent conversation tail.",
        "Escalate only when deeper reasoning or noticeably better language quality is justified.",
        "Return only JSON matching the provided schema."
      ].join("\n\n"),
      messages: [
        {
          role: "user",
          content: [
            `Channel: ${input.input.conversation.channel}`,
            `Conversation mode: ${input.input.conversation.mode}`,
            `Attachment summary: ${attachmentSummary}`,
            `User locale: ${input.input.message.locale ?? input.bundle.userContext.locale}`,
            `Deep mode: ${input.input.deepMode === true ? "enabled" : "disabled"}`,
            input.routeControlReason === null || input.routeControlReason === undefined
              ? null
              : `Route-control trigger: ${input.routeControlReason}`,
            recentConversationTail === null ? null : "",
            recentConversationTail === null ? null : "Recent conversation tail:",
            recentConversationTail,
            "",
            "Current user message:",
            input.input.message.text
          ]
            .filter((section): section is string => section !== null)
            .join("\n")
        }
      ],
      maxOutputTokens: TURN_MODEL_ROLE_SELECTION_MAX_OUTPUT_TOKENS,
      outputSchema: TURN_MODEL_ROLE_SELECTION_OUTPUT_SCHEMA,
      requestMetadata: {
        classification: "role_selection",
        runtimeRequestId: input.input.requestId,
        runtimeSessionId: null,
        toolLoopIteration: null,
        compactionToolCode: null
      }
    };
  }

  private shouldRunKnowledgeToolPlanner(
    hydratedMessages: ProviderGatewayTextMessage[],
    projectedTools: RuntimeNativeToolProjection
  ): boolean {
    void projectedTools.tools.length;
    const currentMessage = hydratedMessages.at(-1);
    const currentText =
      currentMessage === undefined
        ? null
        : this.extractTurnModelRoleMessageText(currentMessage.content);
    if (currentText !== null && this.matchesKnowledgePlanningHint(currentText)) {
      return true;
    }
    if (currentText === null || !this.isShortFollowupMessage(currentText)) {
      return false;
    }
    const recentContext = this.buildTurnModelRoleRecentContext(hydratedMessages);
    return recentContext !== null && this.matchesKnowledgePlanningHint(recentContext);
  }

  private shouldRunWebToolPlanner(
    hydratedMessages: ProviderGatewayTextMessage[],
    projectedTools: RuntimeNativeToolProjection
  ): boolean {
    void projectedTools.tools.length;
    const currentMessage = hydratedMessages.at(-1);
    const currentText =
      currentMessage === undefined
        ? null
        : this.extractTurnModelRoleMessageText(currentMessage.content);
    if (currentText !== null && this.matchesWebPlanningHint(currentText)) {
      return true;
    }
    if (currentText === null || !this.isShortFollowupMessage(currentText)) {
      return false;
    }
    const recentContext = this.buildTurnModelRoleRecentContext(hydratedMessages);
    return recentContext !== null && this.matchesWebPlanningHint(recentContext);
  }

  private buildTurnModelRoleRecentContext(messages: ProviderGatewayTextMessage[]): string | null {
    const previousMessages = messages.slice(0, -1);
    if (previousMessages.length === 0) {
      return null;
    }
    const recentMessages = previousMessages.slice(-TURN_MODEL_ROLE_SELECTION_RECENT_MESSAGE_COUNT);
    const lines: string[] = [];
    let consumedChars = 0;
    for (const message of recentMessages) {
      const remainingChars = TURN_MODEL_ROLE_SELECTION_RECENT_CONTEXT_MAX_CHARS - consumedChars;
      if (remainingChars <= 0) {
        break;
      }
      const extractedText = this.extractTurnModelRoleMessageText(message.content);
      if (extractedText === null) {
        continue;
      }
      const boundedText = this.truncateTurnModelRoleMessageText(
        extractedText,
        Math.min(TURN_MODEL_ROLE_SELECTION_RECENT_MESSAGE_MAX_CHARS, remainingChars)
      );
      if (boundedText.length === 0) {
        continue;
      }
      lines.push(`${message.role}: ${boundedText}`);
      consumedChars += boundedText.length;
    }
    return lines.length === 0 ? null : lines.join("\n");
  }

  private extractTurnModelRoleMessageText(
    content: ProviderGatewayTextMessage["content"]
  ): string | null {
    const rawText =
      typeof content === "string"
        ? content
        : content
            .map((block) =>
              block.type === "text"
                ? block.text
                : block.type === "image"
                  ? "[image attachment]"
                  : "[pdf attachment]"
            )
            .join("\n");
    const normalized = rawText.replace(/\s+/g, " ").trim();
    return normalized.length === 0 ? null : normalized;
  }

  private truncateTurnModelRoleMessageText(text: string, maxChars: number): string {
    if (maxChars <= 0) {
      return "";
    }
    if (text.length <= maxChars) {
      return text;
    }
    if (maxChars <= 3) {
      return text.slice(0, maxChars);
    }
    return `${text.slice(0, maxChars - 3).trimEnd()}...`;
  }

  private parseTurnExecutionPlannerResult(text: string | null): {
    modelRole: UserFacingTurnModelRole;
    lookupStrategy: TurnLookupStrategy;
  } | null {
    if (text === null || text.trim().length === 0) {
      return null;
    }
    try {
      const parsed = JSON.parse(text) as unknown;
      const record =
        parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
          ? (parsed as Record<string, unknown>)
          : null;
      const role = record?.role;
      const lookupStrategy = record?.lookupStrategy;
      const normalizedLookupStrategy =
        typeof lookupStrategy === "string" &&
        TURN_LOOKUP_STRATEGIES.includes(lookupStrategy as TurnLookupStrategy)
          ? (lookupStrategy as TurnLookupStrategy)
          : null;
      if (
        (role !== "normal_reply" && role !== "premium_reply" && role !== "reasoning") ||
        normalizedLookupStrategy === null
      ) {
        return null;
      }
      return {
        modelRole: role,
        lookupStrategy: normalizedLookupStrategy
      };
    } catch {
      return null;
    }
  }

  private matchesKnowledgePlanningHint(text: string): boolean {
    const normalized = text.toLowerCase();
    return [
      "remember",
      "recall",
      "what did i",
      "earlier",
      "yesterday",
      "last time",
      "look up",
      "find in",
      "search",
      "document",
      "docs",
      "policy",
      "source",
      "file",
      "knowledge",
      "memory",
      "according to",
      "помни",
      "помнишь",
      "вспомни",
      "запомн",
      "что я",
      "вчера",
      "раньше",
      "документ",
      "документа",
      "файл",
      "источник",
      "найди",
      "поищи",
      "поиск",
      "знани",
      "памят"
    ].some((hint) => normalized.includes(hint));
  }

  private matchesWebPlanningHint(text: string): boolean {
    const normalized = text.toLowerCase();
    return [
      "weather",
      "forecast",
      "temperature",
      "rain",
      "snow",
      "wind",
      "news",
      "headline",
      "headlines",
      "latest",
      "current",
      "today",
      "right now",
      "now",
      "exchange rate",
      "currency",
      "stock",
      "market",
      "price",
      "prices",
      "search the web",
      "online",
      "internet",
      "website",
      "web",
      "url",
      "link",
      "погод",
      "курс",
      "новост",
      "сейчас",
      "сегодня",
      "последн",
      "актуальн",
      "интернет",
      "веб",
      "сайт",
      "ссылк"
    ].some((hint) => normalized.includes(hint));
  }

  private isShortFollowupMessage(text: string): boolean {
    const normalized = text.trim().toLowerCase();
    if (normalized.length === 0) {
      return false;
    }
    return (
      normalized.length <= 24 &&
      [
        "yes",
        "no",
        "ok",
        "okay",
        "continue",
        "go on",
        "sure",
        "yep",
        "nope",
        "да",
        "нет",
        "ок",
        "ага",
        "угу",
        "продолжай",
        "дальше"
      ].includes(normalized)
    );
  }

  private toTurnModelRoleSelectionUsageEntries(
    usage: RuntimeUsageSnapshot | null
  ): RuntimeUsageAccountingEntry[] {
    if (usage === null) {
      return [];
    }
    return [
      {
        stepType: "model_role_selection",
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
          input.idempotencyKey
        );
        exchanges.push(outcome.exchange);
        this.applyToolExecutionOutcome(turnState, outcome);
        durableCompactionExecuted =
          durableCompactionExecuted || outcome.sharedCompaction?.durableStatePersisted === true;
        if (outcome.routeControl !== undefined) {
          this.applyRouteControlOutcome(execution, input, outcome.routeControl);
        }
      }
      toolHistory.push(...exchanges);
      if (durableCompactionExecuted) {
        execution.providerRequest = await this.refreshProviderRequestMessages(
          execution.providerRequest,
          input,
          execution.bundle
        );
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
    currentUserMessageId: string | null
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
      case ROUTE_CONTROL_TOOL_CODE:
        return this.executeRouteControlTool(execution, acceptedTurn, input, toolCall);
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

  private async executeRouteControlTool(
    execution: PreparedTurnExecution,
    acceptedTurn: AcceptedRuntimeTurn,
    input: RuntimeTurnRequest,
    toolCall: ProviderGatewayToolCall
  ): Promise<ToolExecutionOutcome> {
    const routeControlReason = this.readRouteControlReason(toolCall.arguments);
    if (routeControlReason instanceof Error) {
      return this.createToolExecutionOutcome(
        toolCall,
        {
          toolCode: ROUTE_CONTROL_TOOL_CODE,
          action: "skipped",
          reason: "invalid_arguments",
          warning: routeControlReason.message,
          modelRole: execution.selectedModelRole,
          lookupStrategy: execution.selectedLookupStrategy
        },
        true
      );
    }

    const chooserSelection = this.resolveProviderSelectionForRole(execution.bundle, "system_tool");
    if (chooserSelection === null) {
      return this.createToolExecutionOutcome(toolCall, {
        toolCode: ROUTE_CONTROL_TOOL_CODE,
        action: "skipped",
        reason: "tool_unavailable",
        warning: null,
        modelRole: execution.selectedModelRole,
        lookupStrategy: execution.selectedLookupStrategy
      });
    }

    try {
      const chooserResult = await this.providerGatewayClientService.generateText(
        this.buildTurnExecutionPlanRequest({
          bundle: execution.bundle,
          input,
          providerSelection: chooserSelection,
          hydratedMessages: execution.providerRequest.messages,
          routeControlReason
        })
      );
      if (chooserResult.stopReason !== "completed") {
        this.logger.warn(
          `[route-control] planner stopped with ${chooserResult.stopReason} for request ${acceptedTurn.receipt.requestId}`
        );
        return this.createToolExecutionOutcome(toolCall, {
          toolCode: ROUTE_CONTROL_TOOL_CODE,
          action: "skipped",
          reason: "planner_incomplete",
          warning: null,
          modelRole: execution.selectedModelRole,
          lookupStrategy: execution.selectedLookupStrategy,
          usage: chooserResult.usage
        });
      }

      const executionPlan = this.parseTurnExecutionPlannerResult(chooserResult.text);
      if (executionPlan === null) {
        this.logger.warn(
          `[route-control] invalid planner output for request ${acceptedTurn.receipt.requestId}`
        );
        return this.createToolExecutionOutcome(toolCall, {
          toolCode: ROUTE_CONTROL_TOOL_CODE,
          action: "skipped",
          reason: "invalid_planner_output",
          warning: null,
          modelRole: execution.selectedModelRole,
          lookupStrategy: execution.selectedLookupStrategy,
          usage: chooserResult.usage
        });
      }

      return this.createToolExecutionOutcome(
        toolCall,
        {
          toolCode: ROUTE_CONTROL_TOOL_CODE,
          action: "planned",
          reason: routeControlReason,
          warning: null,
          modelRole: executionPlan.modelRole,
          lookupStrategy: executionPlan.lookupStrategy,
          usage: chooserResult.usage
        },
        false,
        undefined,
        undefined,
        {
          modelRole: executionPlan.modelRole,
          lookupStrategy: executionPlan.lookupStrategy
        }
      );
    } catch (error) {
      this.logger.warn(
        `[route-control] planner failed for request ${acceptedTurn.receipt.requestId}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      return this.createToolExecutionOutcome(toolCall, {
        toolCode: ROUTE_CONTROL_TOOL_CODE,
        action: "skipped",
        reason: "planner_failed",
        warning: error instanceof Error ? error.message : String(error),
        modelRole: execution.selectedModelRole,
        lookupStrategy: execution.selectedLookupStrategy
      });
    }
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
      | RuntimeImageEditToolResult
      | RuntimeImageGenerateToolResult
      | RuntimeScheduledActionToolResult
      | RuntimeTtsToolResult
      | RuntimeVideoGenerateToolResult
      | RuntimeWebSearchToolResult
      | RuntimeWebFetchToolResult
      | Record<string, unknown>,
    isError = false,
    sharedCompaction?: ToolExecutionOutcome["sharedCompaction"],
    artifacts?: RuntimeOutputArtifact[],
    routeControl?: ToolExecutionOutcome["routeControl"]
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
      ...(sharedCompaction === undefined ? {} : { sharedCompaction }),
      ...(routeControl === undefined ? {} : { routeControl })
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
      turnState.artifacts.push(...outcome.artifacts);
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

  private async refreshProviderRequestMessages(
    baseRequest: ProviderGatewayTextGenerateRequest,
    input: RuntimeTurnRequest,
    bundle: AssistantRuntimeBundle
  ): Promise<ProviderGatewayTextGenerateRequest> {
    return {
      ...baseRequest,
      messages: await this.turnContextHydrationService.buildMessages(input, bundle)
    };
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
    return toolCode === "summarize_context" ||
      toolCode === "compact_context" ||
      toolCode === ROUTE_CONTROL_TOOL_CODE
      ? "system_tool"
      : "tool_worker";
  }

  private applyRouteControlOutcome(
    execution: PreparedTurnExecution,
    input: RuntimeTurnRequest,
    routeControl: NonNullable<ToolExecutionOutcome["routeControl"]>
  ): void {
    execution.selectedLookupStrategy = routeControl.lookupStrategy;
    const nextModelRole =
      input.modelRoleOverride !== undefined ||
      input.providerOverride !== undefined ||
      input.modelOverride !== undefined
        ? execution.selectedModelRole
        : routeControl.modelRole;
    execution.selectedModelRole = nextModelRole;

    const providerSelection =
      input.providerOverride !== undefined && input.modelOverride !== undefined
        ? {
            provider: input.providerOverride,
            model: input.modelOverride.trim()
          }
        : this.resolveProviderSelection(execution.bundle, {
            modelRoleOverride: nextModelRole
          });

    execution.providerRequest = {
      ...execution.providerRequest,
      provider: providerSelection.provider,
      model: providerSelection.model,
      systemPrompt: this.buildSystemPrompt(
        execution.bundle,
        execution.projectedTools,
        execution.selectedLookupStrategy,
        execution.deepModeEnabled
      )
    };
  }

  private readRouteControlReason(argumentsObject: Record<string, unknown>): string | null | Error {
    const unknownKeys = Object.keys(argumentsObject).filter((key) => key !== "reason");
    if (unknownKeys.length > 0) {
      return new Error(`Unexpected arguments: ${unknownKeys.join(", ")}`);
    }
    if (
      !("reason" in argumentsObject) ||
      argumentsObject.reason === null ||
      argumentsObject.reason === undefined
    ) {
      return null;
    }
    return typeof argumentsObject.reason === "string" && argumentsObject.reason.trim().length > 0
      ? argumentsObject.reason.trim()
      : new Error("reason must be a non-empty string when provided");
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
      (row.usage === null ||
        (typeof row.usage === "object" && row.usage !== null && !Array.isArray(row.usage)))
    );
  }
}
