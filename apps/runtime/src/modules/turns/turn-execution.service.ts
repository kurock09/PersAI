import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  ServiceUnavailableException,
  type HttpException
} from "@nestjs/common";
import type { AssistantRuntimeBundle } from "@persai/runtime-bundle";
import type {
  ProviderGatewayTextGenerateRequest,
  RuntimeFailedEvent,
  RuntimeTurnRequest,
  RuntimeTurnResult
} from "@persai/runtime-contract";
import { RuntimeBundleRegistryService } from "../bundles/runtime-bundle-registry.service";
import type { RuntimeTurnReceiptSummary } from "./idempotency.service";
import { ProviderGatewayClientService } from "./provider-gateway.client.service";
import { TurnAcceptanceService, type AcceptedRuntimeTurn } from "./turn-acceptance.service";
import { TurnFinalizationService } from "./turn-finalization.service";

type NativeManagedProvider = "openai" | "anthropic";

type ProviderSelection = {
  provider: NativeManagedProvider;
  model: string;
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
    private readonly turnAcceptanceService: TurnAcceptanceService,
    private readonly turnFinalizationService: TurnFinalizationService
  ) {}

  async createTurn(input: RuntimeTurnRequest): Promise<RuntimeTurnResult> {
    this.assertSupportedCreateTurnRequest(input);

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

  private async executeAcceptedTurn(
    input: RuntimeTurnRequest,
    acceptedTurn: AcceptedRuntimeTurn
  ): Promise<RuntimeTurnResult> {
    try {
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
      const providerRequest = this.buildProviderRequest(bundleEntry.parsedBundle, input, providerSelection);
      const providerResult = await this.providerGatewayClientService.generateText(providerRequest);

      return {
        requestId: acceptedTurn.receipt.requestId,
        sessionId: acceptedTurn.session.sessionId,
        assistantText: providerResult.text,
        artifacts: [],
        respondedAt: providerResult.respondedAt,
        usage: providerResult.usage
      };
    } catch (error) {
      await this.failAcceptedTurnQuietly(acceptedTurn, error);
      throw this.toHttpException(error);
    }
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
    input: RuntimeTurnRequest,
    providerSelection: ProviderSelection
  ): ProviderGatewayTextGenerateRequest {
    return {
      provider: providerSelection.provider,
      model: providerSelection.model,
      systemPrompt: this.buildSystemPrompt(bundle),
      messages: [
        {
          role: "user",
          content: input.message.text
        }
      ]
    };
  }

  private buildSystemPrompt(bundle: AssistantRuntimeBundle): string | null {
    const sections = [
      bundle.persona.displayName === null
        ? null
        : `Assistant display name: ${bundle.persona.displayName}`,
      bundle.userContext.displayName === null ? null : `User display name: ${bundle.userContext.displayName}`,
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
        "Runtime bundle does not declare a native managed provider/model for web createTurn."
      )
    );
  }

  private assertSupportedCreateTurnRequest(input: RuntimeTurnRequest): void {
    if (input.message.text.trim().length === 0) {
      throw new BadRequestException("message.text must be non-empty for native web createTurn.");
    }
    const hasProviderOverride = input.providerOverride !== undefined;
    const hasModelOverride = input.modelOverride !== undefined;
    if (hasProviderOverride !== hasModelOverride) {
      throw new BadRequestException(
        "providerOverride and modelOverride must be provided together for native web createTurn."
      );
    }
    if (input.modelOverride !== undefined && input.modelOverride.trim().length === 0) {
      throw new BadRequestException(
        "modelOverride must be a non-empty string when providerOverride is provided."
      );
    }
    if (input.message.attachments.length > 0) {
      throw new BadRequestException(
        "Native web createTurn currently supports text-only requests in this step."
      );
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
  ): Promise<void> {
    const failure = this.toFailureEvent(acceptedTurn, error);
    try {
      await this.turnFinalizationService.failAcceptedTurn(acceptedTurn, failure);
    } catch {
      // The durable accepted receipt remains replay truth even if failure finalization also breaks.
    }
  }

  private toFailureEvent(acceptedTurn: AcceptedRuntimeTurn, error: unknown): RuntimeFailedEvent {
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
    if (error instanceof BadRequestException || error instanceof ConflictException) {
      return error;
    }
    if (error instanceof Error && error.message.trim().length > 0) {
      return new InternalServerErrorException(error.message);
    }
    return new InternalServerErrorException("Native turn execution failed.");
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
