import { Injectable } from "@nestjs/common";
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

@Injectable()
export class RuntimeMemoryWriteToolService {
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
          "fact",
          "invalid_arguments",
          "Memory write arguments are invalid."
        ),
        isError: true
      };
    }

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

      return {
        payload: {
          toolCode: "memory_write",
          executionMode: "inline",
          requestedKind: request.kind,
          item: outcome.item,
          action: "remembered",
          reason: null,
          warning: null
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

  private readArguments(
    args: Record<string, unknown>
  ): { kind: PersaiRuntimeMemoryWriteKind; memory: string } | Error {
    const unknownKeys = Object.keys(args).filter((key) => key !== "kind" && key !== "memory");
    const kind = this.asKind(args.kind);
    const memory = this.normalizeMemory(args.memory);
    if (unknownKeys.length > 0 || kind === null || memory === null) {
      return new Error("Memory write arguments are invalid.");
    }
    return { kind, memory };
  }

  private createSkippedPayload(
    requestedKind: PersaiRuntimeMemoryWriteKind,
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
      warning
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
