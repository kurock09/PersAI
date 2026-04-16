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
  type RuntimeUsageSnapshot
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

type PreparedTurnExecution = {
  bundle: AssistantRuntimeBundle;
  projectedTools: RuntimeNativeToolProjection;
  runtimeTier: RuntimeTurnRequest["runtimeTier"];
  providerRequest: ProviderGatewayTextGenerateRequest;
  currentMessageAttachments: RuntimeTurnRequest["message"]["attachments"];
};

type TurnProviderRequestClassification = "main_turn" | "tool_loop_followup";

type TurnExecutionState = {
  sharedCompaction: {
    invoked: boolean;
    durableStatePersisted: boolean;
  };
  artifacts: RuntimeOutputArtifact[];
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
        return this.streamAcceptedTurn(
          acceptedTurn,
          execution,
          input,
          this.createTurnExecutionState(),
          options?.signal
        );
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

    const providerSelection = this.resolveProviderSelection(bundleEntry.parsedBundle, input);
    const hydratedMessages = await this.turnContextHydrationService.buildMessages(
      input,
      bundleEntry.parsedBundle
    );
    const projectedTools = projectRuntimeNativeTools(bundleEntry.parsedBundle, {
      allowModelToolExposure: options?.allowModelToolExposure ?? true
    });
    return {
      bundle: bundleEntry.parsedBundle,
      projectedTools,
      runtimeTier: input.runtimeTier,
      currentMessageAttachments: input.message.attachments,
      providerRequest: this.buildProviderRequest(
        bundleEntry.parsedBundle,
        providerSelection,
        hydratedMessages,
        projectedTools
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
      usage: providerResult.usage
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
    projectedTools: RuntimeNativeToolProjection
  ): ProviderGatewayTextGenerateRequest {
    return {
      provider: providerSelection.provider,
      model: providerSelection.model,
      systemPrompt: this.buildSystemPrompt(bundle, projectedTools),
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
    projectedTools: RuntimeNativeToolProjection
  ): string | null {
    const sections = [
      bundle.persona.displayName === null
        ? null
        : `Assistant display name: ${bundle.persona.displayName}`,
      bundle.userContext.displayName === null
        ? null
        : `User display name: ${bundle.userContext.displayName}`,
      `User locale: ${bundle.userContext.locale}`,
      `User timezone: ${bundle.userContext.timezone}`,
      this.normalizeOptionalText(bundle.persona.instructions),
      this.normalizeOptionalText(bundle.promptDocuments.soul),
      this.normalizeOptionalText(bundle.promptDocuments.user),
      this.normalizeOptionalText(bundle.promptDocuments.identity),
      this.buildToolRuntimeGuidance(projectedTools),
      this.normalizeOptionalText(bundle.promptDocuments.agents),
      this.normalizeOptionalText(bundle.promptDocuments.heartbeat)
    ].filter((section): section is string => section !== null);

    return sections.length === 0 ? null : sections.join("\n\n");
  }

  private buildToolRuntimeGuidance(projectedTools: RuntimeNativeToolProjection): string {
    if (projectedTools.tools.length === 0) {
      return [
        "Native tool runtime:",
        "- No model-visible tools are enabled for this turn.",
        "- Do not claim or invent access to tools that are not declared as machine-readable tools for this request."
      ].join("\n");
    }

    return [
      "Native tool runtime:",
      "- Use only the machine-readable tools declared for this turn.",
      "- Do not rely on old TOOLS.md text, catalog alias names, or undeclared helpers.",
      ...projectedTools.tools.map((tool) => `- ${tool.name}: ${tool.description}`)
    ].join("\n");
  }

  private resolveProviderSelection(
    bundle: AssistantRuntimeBundle,
    input: Pick<RuntimeTurnRequest, "providerOverride" | "modelOverride">
  ): ProviderSelection {
    if (input.providerOverride !== undefined && input.modelOverride !== undefined) {
      return {
        provider: input.providerOverride,
        model: input.modelOverride.trim()
      };
    }

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

    throw new TurnExecutionError(
      "native_provider_selection_unavailable",
      new ServiceUnavailableException(
        "Runtime bundle does not declare a native managed provider/model for turn execution."
      )
    );
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
          toolCall,
          input.idempotencyKey
        );
        exchanges.push(outcome.exchange);
        this.applyToolExecutionOutcome(turnState, outcome);
        durableCompactionExecuted =
          durableCompactionExecuted || outcome.sharedCompaction?.durableStatePersisted === true;
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
      artifacts: []
    };
  }

  private applyToolExecutionOutcome(
    turnState: TurnExecutionState,
    outcome: ToolExecutionOutcome
  ): void {
    if (outcome.artifacts !== undefined && outcome.artifacts.length > 0) {
      turnState.artifacts.push(...outcome.artifacts);
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
