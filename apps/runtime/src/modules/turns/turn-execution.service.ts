import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  InternalServerErrorException,
  ServiceUnavailableException
} from "@nestjs/common";
import type { AssistantRuntimeBundle } from "@persai/runtime-bundle";
import type {
  ProviderGatewayTextMessage,
  ProviderGatewayTextGenerateRequest,
  ProviderGatewayTextStreamEvent,
  RuntimeFailedEvent,
  RuntimeInterruptedEvent,
  RuntimeTurnRequest,
  RuntimeTurnResult,
  RuntimeTurnStreamEvent,
  RuntimeUsageSnapshot
} from "@persai/runtime-contract";
import { RuntimeBundleRegistryService } from "../bundles/runtime-bundle-registry.service";
import type { RuntimeTurnReceiptSummary } from "./idempotency.service";
import { ProviderGatewayClientService } from "./provider-gateway.client.service";
import { TurnContextHydrationService } from "./turn-context-hydration.service";
import { TurnAcceptanceService, type AcceptedRuntimeTurn } from "./turn-acceptance.service";
import { TurnFinalizationService } from "./turn-finalization.service";

type NativeManagedProvider = "openai" | "anthropic";

type ProviderSelection = {
  provider: NativeManagedProvider;
  model: string;
};

type PreparedTurnExecution = {
  providerRequest: ProviderGatewayTextGenerateRequest;
};

class TurnExecutionError extends Error {
  constructor(
    readonly code: string,
    readonly exception: HttpException
  ) {
    super(exception.message);
  }
}

@Injectable()
export class TurnExecutionService {
  constructor(
    private readonly runtimeBundleRegistryService: RuntimeBundleRegistryService,
    private readonly providerGatewayClientService: ProviderGatewayClientService,
    private readonly turnContextHydrationService: TurnContextHydrationService,
    private readonly turnAcceptanceService: TurnAcceptanceService,
    private readonly turnFinalizationService: TurnFinalizationService
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
        const result = await this.executeAcceptedTurn(input, acceptedTurn);
        await this.turnFinalizationService.completeAcceptedTurn(acceptedTurn, result);
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
        const execution = await this.prepareTurnExecution(input);
        const providerStream = await this.providerGatewayClientService.streamText(
          execution.providerRequest,
          options?.signal === undefined ? undefined : { signal: options.signal }
        );
        return this.streamAcceptedTurn(acceptedTurn, providerStream, options?.signal);
      }
    }
  }

  private async executeAcceptedTurn(
    input: RuntimeTurnRequest,
    acceptedTurn: AcceptedRuntimeTurn
  ): Promise<RuntimeTurnResult> {
    try {
      const execution = await this.prepareTurnExecution(input);
      const providerResult = await this.providerGatewayClientService.generateText(
        execution.providerRequest
      );

      return this.buildTurnResult(acceptedTurn, providerResult);
    } catch (error) {
      await this.failAcceptedTurnQuietly(acceptedTurn, error);
      throw this.toHttpException(error);
    }
  }

  private async prepareTurnExecution(input: RuntimeTurnRequest): Promise<PreparedTurnExecution> {
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
    return {
      providerRequest: this.buildProviderRequest(
        bundleEntry.parsedBundle,
        providerSelection,
        hydratedMessages
      )
    };
  }

  private async *streamAcceptedTurn(
    acceptedTurn: AcceptedRuntimeTurn,
    providerStream: AsyncGenerator<ProviderGatewayTextStreamEvent>,
    signal?: AbortSignal
  ): AsyncGenerator<RuntimeTurnStreamEvent> {
    let accumulatedText = "";
    let completionFinalizationAttempted = false;

    yield {
      type: "started",
      requestId: acceptedTurn.receipt.requestId,
      sessionId: acceptedTurn.session.sessionId
    };

    try {
      for await (const event of providerStream) {
        if (signal?.aborted) {
          await this.interruptAcceptedTurnQuietly({
            acceptedTurn,
            event: this.toInterruptedEvent(acceptedTurn, accumulatedText, null)
          });
          return;
        }

        if (event.type === "text_delta" && event.delta !== undefined) {
          accumulatedText = event.accumulatedText ?? accumulatedText + event.delta;
          yield {
            type: "text_delta",
            requestId: acceptedTurn.receipt.requestId,
            sessionId: acceptedTurn.session.sessionId,
            delta: event.delta,
            accumulatedText
          };
          continue;
        }

        if (event.type === "completed" && event.result !== undefined) {
          const result = this.buildTurnResult(acceptedTurn, event.result);
          completionFinalizationAttempted = true;
          await this.turnFinalizationService.completeAcceptedTurn(acceptedTurn, result);
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
    providerResult: {
      text: string;
      respondedAt: string;
      usage: RuntimeUsageSnapshot | null;
    }
  ): RuntimeTurnResult {
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
    messages: ProviderGatewayTextMessage[]
  ): ProviderGatewayTextGenerateRequest {
    return {
      provider: providerSelection.provider,
      model: providerSelection.model,
      systemPrompt: this.buildSystemPrompt(bundle),
      messages
    };
  }

  private buildSystemPrompt(bundle: AssistantRuntimeBundle): string | null {
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
      this.normalizeOptionalText(bundle.promptDocuments.tools),
      this.normalizeOptionalText(bundle.promptDocuments.agents),
      this.normalizeOptionalText(bundle.promptDocuments.heartbeat)
    ].filter((section): section is string => section !== null);

    return sections.length === 0 ? null : sections.join("\n\n");
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
          new BadRequestException("Runtime bundle primary provider path is inactive for web chat.")
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
        "Runtime bundle does not declare a native managed provider/model for web turn execution."
      )
    );
  }

  private assertSupportedTurnRequest(
    input: RuntimeTurnRequest,
    operation: "createTurn" | "streamTurn"
  ): void {
    if (input.message.text.trim().length === 0) {
      throw new BadRequestException(`message.text must be non-empty for native web ${operation}.`);
    }
    const hasProviderOverride = input.providerOverride !== undefined;
    const hasModelOverride = input.modelOverride !== undefined;
    if (hasProviderOverride !== hasModelOverride) {
      throw new BadRequestException(
        `providerOverride and modelOverride must be provided together for native web ${operation}.`
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
          `message.attachments[].objectKey must be non-empty for native web ${operation}.`
        );
      }
    }
  }

  private normalizeOptionalText(value: string | null): string | null {
    return value === null || value.trim().length === 0 ? null : value.trim();
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
