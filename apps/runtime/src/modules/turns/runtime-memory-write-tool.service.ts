import { Injectable, Logger } from "@nestjs/common";
import type { AssistantRuntimeBundle } from "@persai/runtime-bundle";
import type {
  PersaiRuntimeMemoryWriteKind,
  ProviderGatewayToolCall,
  RuntimeMemoryWriteToolResult,
  RuntimeTurnRequest
} from "@persai/runtime-contract";
import { PersaiInternalApiClientService } from "./persai-internal-api.client.service";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface RuntimeMemoryWriteToolExecutionResult {
  payload: RuntimeMemoryWriteToolResult;
  isError: boolean;
}

type WriteRequest = {
  action: "write";
  kind: PersaiRuntimeMemoryWriteKind;
  memory: string;
  closeOpenLoop: boolean;
};

type CloseRequest = {
  action: "close";
  ref: string;
};

type ParsedRequest = WriteRequest | CloseRequest;

@Injectable()
export class RuntimeMemoryWriteToolService {
  private readonly logger = new Logger(RuntimeMemoryWriteToolService.name);

  constructor(private readonly persaiInternalApiClientService: PersaiInternalApiClientService) {}

  async executeToolCall(params: {
    bundle: AssistantRuntimeBundle;
    toolCall: ProviderGatewayToolCall;
    conversation: RuntimeTurnRequest["conversation"];
    currentUserMessageId: string | null;
    requestId: string | null;
  }): Promise<RuntimeMemoryWriteToolExecutionResult> {
    const request = this.readArguments(params.toolCall.arguments);
    if (request instanceof Error) {
      return {
        payload: this.createSkippedPayload(
          null,
          "invalid_arguments",
          "Memory write arguments are invalid."
        ),
        isError: true
      };
    }

    // ADR-074 L1.1 — memory_write was previously invisible to the daily
    // counter (the original L1 anchor explicitly left it uncounted so
    // durable memory work would not be throttled). The L1.1 audit found
    // this hid runaway memory loops from the founder dashboard. Now we
    // count for observability + per-tool cap (default 10/turn): the
    // founder anchor "memory work must not be throttled" is preserved by
    // a generous cap, not by zero-tracking. The API still honours
    // `dailyCallLimit: null` as "count, no enforcement".
    const policy = this.resolveAllowedInlineToolPolicy(params.bundle, "memory_write");
    if (policy !== null) {
      const quotaOutcome = await this.persaiInternalApiClientService.consumeToolDailyLimit({
        assistantId: params.bundle.metadata.assistantId,
        toolCode: "memory_write",
        dailyCallLimit: policy.dailyCallLimit
      });
      if (!quotaOutcome.allowed) {
        return {
          payload: this.createSkippedPayload(
            request.action === "write" ? request.kind : null,
            quotaOutcome.code,
            quotaOutcome.message
          ),
          isError: false
        };
      }
    }

    if (request.action === "close") {
      return this.executeClose(params, request);
    }

    return this.executeWrite(params, request);
  }

  /**
   * ADR-074 L1.1 — local copy of `turn-execution`'s
   * `resolveAllowedInlineToolPolicy` so this service can find its own
   * `dailyCallLimit` without depending on the orchestrator. Returns null
   * when the assistant has no policy entry for memory_write — in that
   * case we silently skip quota tracking (the orchestrator would already
   * have refused to dispatch the call).
   */
  private resolveAllowedInlineToolPolicy(bundle: AssistantRuntimeBundle, toolCode: string) {
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

  private async executeClose(
    params: {
      bundle: AssistantRuntimeBundle;
      toolCall: ProviderGatewayToolCall;
      conversation: RuntimeTurnRequest["conversation"];
      currentUserMessageId: string | null;
      requestId: string | null;
    },
    request: CloseRequest
  ): Promise<RuntimeMemoryWriteToolExecutionResult> {
    try {
      const outcome = await this.persaiInternalApiClientService.closeAssistantMemoryByRef({
        assistantId: params.bundle.metadata.assistantId,
        itemId: request.ref,
        requestId: params.requestId
      });

      // The API returns `not_found` / `not_open_loop` as soft outcomes (the
      // client maps 404 / 400 to these). The model should see a `skipped`
      // result so it can adjust, not a `closed` confirmation.
      if (outcome.reason === "not_found" || outcome.reason === "not_open_loop") {
        return {
          payload: this.createSkippedPayload(
            null,
            outcome.reason === "not_found"
              ? "memory_close_ref_not_found"
              : "memory_close_ref_not_open_loop",
            outcome.reason === "not_found"
              ? `Open-loop ref "${request.ref}" was not found.`
              : `Memory item "${request.ref}" is not an open-loop.`
          ),
          isError: false
        };
      }

      return {
        payload: {
          toolCode: "memory_write",
          executionMode: "inline",
          requestedKind: null,
          item: null,
          action: "closed",
          reason: outcome.reason,
          warning: null,
          closedItemRef: outcome.closedItemId
        },
        isError: false
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Memory close failed.";
      this.logger.warn(
        `[memory_write] action=close failed for assistant=${params.bundle.metadata.assistantId} ref=${request.ref}: ${message}`
      );
      return {
        payload: this.createSkippedPayload(null, "memory_close_failed", message),
        isError: true
      };
    }
  }

  private async executeWrite(
    params: {
      bundle: AssistantRuntimeBundle;
      toolCall: ProviderGatewayToolCall;
      conversation: RuntimeTurnRequest["conversation"];
      currentUserMessageId: string | null;
      requestId: string | null;
    },
    request: WriteRequest
  ): Promise<RuntimeMemoryWriteToolExecutionResult> {
    const transportSurface = this.resolveTransportSurface(params.conversation.channel);
    if (transportSurface === null) {
      return {
        payload: this.createSkippedPayload(
          request.kind,
          "surface_unavailable",
          `Memory write is not available on channel "${params.conversation.channel}".`
        ),
        isError: false
      };
    }

    const relatedUserMessageId =
      params.currentUserMessageId !== null && UUID_PATTERN.test(params.currentUserMessageId)
        ? params.currentUserMessageId
        : null;

    try {
      const outcome = await this.persaiInternalApiClientService.writeMemory({
        assistantId: params.bundle.metadata.assistantId,
        kind: request.kind,
        summary: request.memory,
        transportSurface,
        sourceTrust: params.conversation.mode === "direct" ? "trusted_1to1" : "group",
        relatedUserMessageId,
        requestId: params.requestId
      });

      if (!outcome.written || outcome.item === null) {
        return {
          payload: this.createSkippedPayload(
            request.kind,
            outcome.code ?? "memory_write_denied",
            outcome.message
          ),
          isError: false
        };
      }

      // ADR-074 Slice M3 — opt-in legacy explicit close of the most-similar
      // active open-loop. M3.1 prefers `action:"close"` with a ref from the
      // carry-over block; this flag remains for cases where the model does
      // not have a precise ref. Failures here MUST NOT fail the surrounding
      // memory_write (which already succeeded server-side); we log and move
      // on.
      if (request.closeOpenLoop) {
        try {
          await this.persaiInternalApiClientService.closeMostSimilarOpenLoop({
            assistantId: params.bundle.metadata.assistantId,
            referenceText: request.memory,
            requestId: params.requestId
          });
        } catch (closeError) {
          this.logger.warn(
            `[memory_write] closeOpenLoop=true follow-up failed for assistant=${params.bundle.metadata.assistantId}: ${
              closeError instanceof Error ? closeError.message : String(closeError)
            }`
          );
        }
      }

      return {
        payload: {
          toolCode: "memory_write",
          executionMode: "inline",
          requestedKind: request.kind,
          item: outcome.item,
          action: "remembered",
          reason: null,
          warning: null,
          closedItemRef: null
        },
        isError: false
      };
    } catch (error) {
      return {
        payload: this.createSkippedPayload(
          request.kind,
          "memory_write_failed",
          error instanceof Error ? error.message : "Memory write failed."
        ),
        isError: true
      };
    }
  }

  private readArguments(args: Record<string, unknown>): ParsedRequest | Error {
    const allowedKeys = new Set(["action", "kind", "memory", "closeOpenLoop", "ref"]);
    const unknownKeys = Object.keys(args).filter((key) => !allowedKeys.has(key));
    if (unknownKeys.length > 0) {
      return new Error("Memory write arguments are invalid.");
    }
    const action = this.asAction(args.action);
    if (action === null) {
      return new Error("Memory write arguments are invalid.");
    }

    if (action === "close") {
      const ref = this.asRef(args.ref);
      // For close: forbid kind/memory/closeOpenLoop fields per the schema
      // contract. Tolerate `kind`/`memory`/`closeOpenLoop` literally being
      // `undefined` (some providers serialize JSON `undefined` properties).
      if (
        ref === null ||
        args.kind !== undefined ||
        args.memory !== undefined ||
        args.closeOpenLoop !== undefined
      ) {
        return new Error("Memory write arguments are invalid.");
      }
      return { action: "close", ref };
    }

    // Write path. `ref` MUST NOT be supplied.
    if (args.ref !== undefined) {
      return new Error("Memory write arguments are invalid.");
    }
    const kind = this.asKind(args.kind);
    const memory = this.normalizeMemory(args.memory);
    const closeOpenLoop = this.asCloseOpenLoop(args.closeOpenLoop);
    if (kind === null || memory === null || closeOpenLoop === null) {
      return new Error("Memory write arguments are invalid.");
    }
    return { action: "write", kind, memory, closeOpenLoop };
  }

  private asAction(value: unknown): "write" | "close" | null {
    if (value === undefined) {
      return "write";
    }
    if (value === "write" || value === "close") {
      return value;
    }
    return null;
  }

  private asRef(value: unknown): string | null {
    if (typeof value !== "string") {
      return null;
    }
    const trimmed = value.trim();
    if (!UUID_PATTERN.test(trimmed)) {
      return null;
    }
    return trimmed;
  }

  private asCloseOpenLoop(value: unknown): boolean | null {
    if (value === undefined) {
      return false;
    }
    if (typeof value === "boolean") {
      return value;
    }
    return null;
  }

  private createSkippedPayload(
    requestedKind: PersaiRuntimeMemoryWriteKind | null,
    reason: string,
    warning: string | null
  ): RuntimeMemoryWriteToolResult {
    return {
      toolCode: "memory_write",
      executionMode: "inline",
      requestedKind,
      item: null,
      action: "skipped",
      reason,
      warning,
      closedItemRef: null
    };
  }

  private resolveTransportSurface(channel: string): "web" | "telegram" | null {
    if (channel === "web" || channel === "telegram") {
      return channel;
    }
    return null;
  }

  private asKind(value: unknown): PersaiRuntimeMemoryWriteKind | null {
    return value === "fact" || value === "preference" || value === "open_loop" ? value : null;
  }

  private normalizeMemory(value: unknown): string | null {
    if (typeof value !== "string") {
      return null;
    }
    const normalized = value.trim().replace(/\s+/g, " ");
    if (normalized.length === 0 || normalized.length > 500) {
      return null;
    }
    return normalized;
  }
}
