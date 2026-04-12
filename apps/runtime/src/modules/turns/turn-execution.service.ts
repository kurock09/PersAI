import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  InternalServerErrorException,
  Logger,
  ServiceUnavailableException
} from "@nestjs/common";
import type { AssistantRuntimeBundle } from "@persai/runtime-bundle";
import type {
  RuntimeCompactionRequest,
  ProviderGatewayToolCall,
  ProviderGatewayToolExchange,
  ProviderGatewayTextMessage,
  ProviderGatewayTextGenerateRequest,
  ProviderGatewayTextGenerateResult,
  RuntimeKnowledgeFetchToolResult,
  RuntimeKnowledgeSearchToolResult,
  RuntimeSharedCompactionToolResult,
  RuntimeFailedEvent,
  RuntimeInterruptedEvent,
  RuntimeTurnRequest,
  RuntimeTurnResult,
  RuntimeTurnStreamEvent,
  RuntimeUsageSnapshot
} from "@persai/runtime-contract";
import { RuntimeBundleRegistryService } from "../bundles/runtime-bundle-registry.service";
import type { RuntimeTurnReceiptSummary } from "./idempotency.service";
import {
  projectRuntimeNativeTools,
  type RuntimeNativeToolProjection
} from "./native-tool-projection";
import { ProviderGatewayClientService } from "./provider-gateway.client.service";
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
};

type ToolExecutionOutcome = {
  exchange: ProviderGatewayToolExchange;
  payload:
    | RuntimeSharedCompactionToolResult
    | RuntimeKnowledgeSearchToolResult
    | RuntimeKnowledgeFetchToolResult
    | Record<string, unknown>;
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

@Injectable()
export class TurnExecutionService {
  private readonly logger = new Logger(TurnExecutionService.name);

  constructor(
    private readonly runtimeBundleRegistryService: RuntimeBundleRegistryService,
    private readonly providerGatewayClientService: ProviderGatewayClientService,
    private readonly turnContextHydrationService: TurnContextHydrationService,
    private readonly turnAcceptanceService: TurnAcceptanceService,
    private readonly turnFinalizationService: TurnFinalizationService,
    private readonly sessionCompactionService: SessionCompactionService
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
        const result = await this.executeAcceptedTurn(acceptedTurn, execution);
        await this.turnFinalizationService.completeAcceptedTurn(acceptedTurn, result);
        this.scheduleAutoCompaction(input, execution.bundle);
        return result;
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
        return this.streamAcceptedTurn(acceptedTurn, execution, input, options?.signal);
      }
    }
  }

  private async executeAcceptedTurn(
    acceptedTurn: AcceptedRuntimeTurn,
    execution: PreparedTurnExecution
  ): Promise<RuntimeTurnResult> {
    try {
      const providerResult = await this.executeProviderToolLoop(acceptedTurn, execution);
      return this.buildTurnResult(acceptedTurn, providerResult);
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
    const hydratedMessages = await this.turnContextHydrationService.buildMessages(input);
    const projectedTools = projectRuntimeNativeTools(bundleEntry.parsedBundle, {
      allowModelToolExposure: options?.allowModelToolExposure ?? true
    });
    return {
      bundle: bundleEntry.parsedBundle,
      projectedTools,
      runtimeTier: input.runtimeTier,
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
    signal?: AbortSignal
  ): AsyncGenerator<RuntimeTurnStreamEvent> {
    let accumulatedText = "";
    const toolHistory: ProviderGatewayToolExchange[] = [];
    let completionFinalizationAttempted = false;

    yield {
      type: "started",
      requestId: acceptedTurn.receipt.requestId,
      sessionId: acceptedTurn.session.sessionId
    };

    try {
      for (let iteration = 0; iteration < MAX_NATIVE_TOOL_LOOP_ITERATIONS; iteration += 1) {
        const iterationBaseText = accumulatedText;
        const providerStream = await this.providerGatewayClientService.streamText(
          this.buildToolLoopProviderRequest(execution.providerRequest, {
            assistantText: iterationBaseText,
            toolHistory
          }),
          signal === undefined ? undefined : { signal }
        );
        let advancedToNextIteration = false;

        for await (const event of providerStream) {
          if (signal?.aborted) {
            await this.interruptAcceptedTurnQuietly({
              acceptedTurn,
              event: this.toInterruptedEvent(acceptedTurn, accumulatedText, null)
            });
            return;
          }

          if (event.type === "text_delta" && event.delta !== undefined) {
            accumulatedText = this.mergeAssistantTurnText(iterationBaseText, event.accumulatedText);
            yield {
              type: "text_delta",
              requestId: acceptedTurn.receipt.requestId,
              sessionId: acceptedTurn.session.sessionId,
              delta: event.delta,
              accumulatedText
            };
            continue;
          }

          if (event.type === "tool_calls") {
            accumulatedText = this.mergeAssistantTurnText(accumulatedText, event.result.text);
            if (event.result.toolCalls.length === 0) {
              throw new TurnExecutionError(
                "native_tool_result_invalid",
                new ServiceUnavailableException(
                  "Provider stream returned a tool-call stop without any tool calls."
                )
              );
            }

            for (const toolCall of event.result.toolCalls) {
              yield this.createToolStartedStreamEvent(acceptedTurn, toolCall);
              let outcome: ToolExecutionOutcome;
              try {
                outcome = await this.executeProjectedToolCall(execution, acceptedTurn, toolCall);
              } catch (error) {
                yield this.createToolFinishedStreamEvent(acceptedTurn, toolCall, true);
                throw error;
              }
              toolHistory.push(outcome.exchange);
              yield this.createToolFinishedStreamEvent(
                acceptedTurn,
                toolCall,
                outcome.exchange.toolResult.isError
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
                accumulatedText,
                event.result.text
              )
            );
            const result = this.buildTurnResult(acceptedTurn, completedProviderResult);
            completionFinalizationAttempted = true;
            await this.turnFinalizationService.completeAcceptedTurn(acceptedTurn, result);
            this.scheduleAutoCompaction(input, execution.bundle);
            yield {
              type: "completed",
              result
            };
            return;
          }

          if (event.type === "failed") {
            if (accumulatedText.trim().length > 0) {
              const interrupted = this.toInterruptedEvent(acceptedTurn, accumulatedText, null);
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

        if (accumulatedText.trim().length > 0) {
          const interrupted = this.toInterruptedEvent(acceptedTurn, accumulatedText, null);
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
          event: this.toInterruptedEvent(acceptedTurn, accumulatedText, null)
        });
        return;
      }

      if (accumulatedText.trim().length > 0) {
        const interrupted = this.toInterruptedEvent(acceptedTurn, accumulatedText, null);
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
    providerResult: ProviderGatewayTextGenerateResult
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
      artifacts: [],
      respondedAt: providerResult.respondedAt,
      usage: providerResult.usage
    };
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
    execution: PreparedTurnExecution
  ): Promise<ProviderGatewayTextGenerateResult> {
    const toolHistory: ProviderGatewayToolExchange[] = [];
    let accumulatedText = "";
    for (let iteration = 0; iteration < MAX_NATIVE_TOOL_LOOP_ITERATIONS; iteration += 1) {
      const providerResult = await this.providerGatewayClientService.generateText(
        this.buildToolLoopProviderRequest(execution.providerRequest, {
          assistantText: accumulatedText,
          toolHistory
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
      for (const toolCall of providerResult.toolCalls) {
        const outcome = await this.executeProjectedToolCall(execution, acceptedTurn, toolCall);
        exchanges.push(outcome.exchange);
      }
      toolHistory.push(...exchanges);
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
    toolCall: ProviderGatewayToolCall
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
          heldLease: acceptedTurn.lease
        });
        return this.createToolExecutionOutcome(toolCall, result.toolResult);
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
          heldLease: acceptedTurn.lease
        });
        return this.createToolExecutionOutcome(toolCall, result.toolResult);
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
  ): ToolExecutionOutcome {
    const unknownKeys = Object.keys(toolCall.arguments).filter(
      (key) => key !== "source" && key !== "query" && key !== "maxResults"
    );
    const source = this.asNonEmptyString(toolCall.arguments.source);
    const query = this.asNonEmptyString(toolCall.arguments.query);
    const maxResults =
      toolCall.arguments.maxResults === undefined || toolCall.arguments.maxResults === null
        ? null
        : Number.isInteger(toolCall.arguments.maxResults) &&
            Number(toolCall.arguments.maxResults) > 0
          ? Number(toolCall.arguments.maxResults)
          : null;
    if (
      unknownKeys.length > 0 ||
      source === null ||
      query === null ||
      ("maxResults" in toolCall.arguments && maxResults === null)
    ) {
      return this.createToolExecutionOutcome(
        toolCall,
        {
          toolCode: execution.bundle.runtime.knowledgeAccess.searchToolCode,
          source: source ?? "internal",
          executionMode: "inline",
          hits: [],
          action: "skipped",
          reason: "invalid_arguments"
        },
        true
      );
    }
    const sourceAllowed = execution.projectedTools.knowledgeSearchSources.some(
      (sourceConfig) => sourceConfig.source === source
    );
    return this.createToolExecutionOutcome(toolCall, {
      toolCode: execution.bundle.runtime.knowledgeAccess.searchToolCode,
      source: source as RuntimeKnowledgeSearchToolResult["source"],
      executionMode: "inline",
      hits: [],
      action: "skipped",
      reason: sourceAllowed ? "native_knowledge_search_not_implemented" : "source_unavailable"
    });
  }

  private executeKnowledgeFetchTool(
    execution: PreparedTurnExecution,
    toolCall: ProviderGatewayToolCall
  ): ToolExecutionOutcome {
    const unknownKeys = Object.keys(toolCall.arguments).filter(
      (key) => key !== "source" && key !== "referenceId"
    );
    const source = this.asNonEmptyString(toolCall.arguments.source);
    const referenceId = this.asNonEmptyString(toolCall.arguments.referenceId);
    if (unknownKeys.length > 0 || source === null || referenceId === null) {
      return this.createToolExecutionOutcome(
        toolCall,
        {
          toolCode: execution.bundle.runtime.knowledgeAccess.fetchToolCode,
          source: source ?? "internal",
          executionMode: "inline",
          document: null,
          action: "skipped",
          reason: "invalid_arguments"
        },
        true
      );
    }
    const sourceAllowed = execution.projectedTools.knowledgeFetchSources.some(
      (sourceConfig) => sourceConfig.source === source
    );
    return this.createToolExecutionOutcome(toolCall, {
      toolCode: execution.bundle.runtime.knowledgeAccess.fetchToolCode,
      source: source as RuntimeKnowledgeFetchToolResult["source"],
      executionMode: "inline",
      document: null,
      action: "skipped",
      reason: sourceAllowed ? "native_knowledge_fetch_not_implemented" : "source_unavailable"
    });
  }

  private createToolExecutionOutcome(
    toolCall: ProviderGatewayToolCall,
    payload:
      | RuntimeSharedCompactionToolResult
      | RuntimeKnowledgeSearchToolResult
      | RuntimeKnowledgeFetchToolResult
      | Record<string, unknown>,
    isError = false
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
      payload
    };
  }

  private buildToolLoopProviderRequest(
    baseRequest: ProviderGatewayTextGenerateRequest,
    input: {
      assistantText: string;
      toolHistory: ProviderGatewayToolExchange[];
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
      ...(input.toolHistory.length === 0 ? {} : { toolHistory: input.toolHistory })
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

  private normalizeOptionalText(value: string | null): string | null {
    return value === null || value.trim().length === 0 ? null : value.trim();
  }

  private scheduleAutoCompaction(input: RuntimeTurnRequest, bundle: AssistantRuntimeBundle): void {
    const request = this.buildAutoCompactionRequest(input, bundle);
    if (request === null) {
      return;
    }

    queueMicrotask(() => {
      void this.runAutoCompaction(request);
    });
  }

  private buildAutoCompactionRequest(
    input: RuntimeTurnRequest,
    bundle: AssistantRuntimeBundle
  ): RuntimeCompactionRequest | null {
    if (
      input.conversation.channel !== "telegram" ||
      bundle.runtime.sharedCompaction.telegramAutoSummarizeEnabled !== true
    ) {
      return null;
    }

    return {
      runtimeTier: input.runtimeTier,
      conversation: input.conversation,
      instructions: null
    };
  }

  private async runAutoCompaction(request: RuntimeCompactionRequest): Promise<void> {
    try {
      const result = await this.sessionCompactionService.compactSession(request);
      if (
        !result.compacted &&
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
  }

  private asObject(value: unknown): Record<string, unknown> | null {
    return value !== null && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
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
