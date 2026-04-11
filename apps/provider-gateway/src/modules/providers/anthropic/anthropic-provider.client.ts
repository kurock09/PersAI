import { Inject, Injectable } from "@nestjs/common";
import type { ProviderGatewayConfig } from "@persai/config";
import type {
  ProviderGatewayTextCompletedEvent,
  ProviderGatewayTextDeltaEvent,
  ProviderGatewayTextFailedEvent,
  ProviderGatewayTextGenerateRequest,
  ProviderGatewayTextGenerateResult,
  ProviderGatewayTextStreamEvent,
  RuntimeUsageSnapshot
} from "@persai/runtime-contract";
import Anthropic from "@anthropic-ai/sdk";
import { PROVIDER_GATEWAY_CONFIG } from "../../../provider-gateway-config";
import type { ProviderWarmableClient } from "../provider-client.types";

@Injectable()
export class AnthropicProviderClient implements ProviderWarmableClient {
  readonly provider = "anthropic" as const;
  readonly catalogSource = "bootstrap_config" as const;
  private client: Anthropic | null = null;

  constructor(@Inject(PROVIDER_GATEWAY_CONFIG) private readonly config: ProviderGatewayConfig) {}

  isConfigured(): boolean {
    return typeof this.config.PROVIDER_GATEWAY_ANTHROPIC_API_KEY === "string";
  }

  getCatalogModels(): string[] {
    return [...this.config.PROVIDER_GATEWAY_ANTHROPIC_MODELS];
  }

  async warm(): Promise<void> {
    const apiKey = this.config.PROVIDER_GATEWAY_ANTHROPIC_API_KEY;
    if (!apiKey) {
      this.client = null;
      return;
    }
    this.client = new Anthropic({ apiKey });
  }

  async generateText(
    input: ProviderGatewayTextGenerateRequest
  ): Promise<ProviderGatewayTextGenerateResult> {
    if (this.client === null) {
      throw new Error("Anthropic provider client is not warmed.");
    }

    const { signal, dispose } = this.createTimedSignal(
      this.config.PROVIDER_GATEWAY_REQUEST_TIMEOUT_MS
    );
    try {
      const response = await this.client.messages.create(
        {
          model: input.model,
          max_tokens: input.maxOutputTokens ?? 1_024,
          ...(input.systemPrompt === null ? {} : { system: input.systemPrompt }),
          messages: input.messages.map((message) => ({
            role: message.role,
            content: message.content
          }))
        },
        { signal }
      );

      const text = response.content
        .filter((block): block is Anthropic.Messages.TextBlock => block.type === "text")
        .map((block) => block.text)
        .join("\n")
        .trim();

      if (!text) {
        throw new Error("Anthropic provider response did not contain text output.");
      }

      const inputTokens = response.usage?.input_tokens ?? null;
      const outputTokens = response.usage?.output_tokens ?? null;
      const totalTokens =
        inputTokens === null && outputTokens === null
          ? null
          : (inputTokens ?? 0) + (outputTokens ?? 0);

      return {
        provider: "anthropic",
        model: input.model,
        text,
        respondedAt: new Date().toISOString(),
        usage: {
          providerKey: "anthropic",
          modelKey: input.model,
          inputTokens,
          outputTokens,
          totalTokens
        }
      };
    } finally {
      dispose();
    }
  }

  getClient(): Anthropic | null {
    return this.client;
  }

  async *streamText(
    input: ProviderGatewayTextGenerateRequest,
    signal?: AbortSignal
  ): AsyncGenerator<ProviderGatewayTextStreamEvent> {
    if (this.client === null) {
      throw new Error("Anthropic provider client is not warmed.");
    }

    let accumulatedText = "";
    let latestUsage: RuntimeUsageSnapshot | null = null;
    const { signal: timedSignal, dispose } = this.createTimedSignal(
      this.config.PROVIDER_GATEWAY_STREAM_TIMEOUT_MS,
      signal
    );

    try {
      const stream = await this.client.messages.create(
        {
          model: input.model,
          max_tokens: input.maxOutputTokens ?? 1_024,
          ...(input.systemPrompt === null ? {} : { system: input.systemPrompt }),
          messages: input.messages.map((message) => ({
            role: message.role,
            content: message.content
          })),
          stream: true
        },
        { signal: timedSignal }
      );

      for await (const event of stream) {
        if (event.type === "message_start") {
          latestUsage = this.toUsageSnapshot(input.model, event.message.usage);
          continue;
        }

        if (event.type === "message_delta") {
          latestUsage = this.toUsageSnapshot(input.model, event.usage);
          continue;
        }

        if (
          event.type === "content_block_delta" &&
          event.delta.type === "text_delta" &&
          event.delta.text.length > 0
        ) {
          accumulatedText += event.delta.text;
          const deltaEvent: ProviderGatewayTextDeltaEvent = {
            type: "text_delta",
            delta: event.delta.text,
            accumulatedText
          };
          yield deltaEvent;
          continue;
        }

        if (event.type === "message_stop") {
          const text = accumulatedText.trim();
          if (!text) {
            const failedEvent: ProviderGatewayTextFailedEvent = {
              type: "failed",
              code: "provider_invalid_response",
              message: "Anthropic provider stream completed without text output."
            };
            yield failedEvent;
            return;
          }

          const completedEvent: ProviderGatewayTextCompletedEvent = {
            type: "completed",
            result: {
              provider: "anthropic",
              model: input.model,
              text,
              respondedAt: new Date().toISOString(),
              usage: latestUsage
            }
          };
          yield completedEvent;
          return;
        }
      }

      const failedEvent: ProviderGatewayTextFailedEvent = {
        type: "failed",
        code: "provider_stream_ended",
        message: "Anthropic provider stream ended before a completed result was emitted."
      };
      yield failedEvent;
    } catch (error) {
      if (this.isAbortError(error) || signal?.aborted) {
        return;
      }
      const failedEvent: ProviderGatewayTextFailedEvent = {
        type: "failed",
        code: "provider_stream_failed",
        message: error instanceof Error ? error.message : "Anthropic provider stream failed."
      };
      yield failedEvent;
    } finally {
      dispose();
    }
  }

  private toUsageSnapshot(
    model: string,
    usage: Anthropic.Messages.Usage | Anthropic.Messages.MessageDeltaUsage | null | undefined
  ): RuntimeUsageSnapshot | null {
    if (usage === undefined || usage === null) {
      return null;
    }

    const inputTokens = usage.input_tokens ?? null;
    const outputTokens = usage.output_tokens ?? null;
    return {
      providerKey: "anthropic",
      modelKey: model,
      inputTokens,
      outputTokens,
      totalTokens:
        inputTokens === null && outputTokens === null
          ? null
          : (inputTokens ?? 0) + (outputTokens ?? 0)
    };
  }

  private createTimedSignal(
    timeoutMs: number,
    externalSignal?: AbortSignal
  ): { signal: AbortSignal; dispose: () => void } {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    if (externalSignal) {
      if (externalSignal.aborted) {
        controller.abort();
      } else {
        externalSignal.addEventListener("abort", () => controller.abort(), { once: true });
      }
    }
    return {
      signal: controller.signal,
      dispose: () => clearTimeout(timeoutId)
    };
  }

  private isAbortError(error: unknown): boolean {
    return error instanceof Error && error.name === "AbortError";
  }
}
