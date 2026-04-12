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
import OpenAI from "openai";
import { PROVIDER_GATEWAY_CONFIG } from "../../../provider-gateway-config";
import type { ProviderWarmableClient } from "../provider-client.types";

@Injectable()
export class OpenAIProviderClient implements ProviderWarmableClient {
  readonly provider = "openai" as const;
  readonly catalogSource = "bootstrap_config" as const;
  private client: OpenAI | null = null;

  constructor(@Inject(PROVIDER_GATEWAY_CONFIG) private readonly config: ProviderGatewayConfig) {}

  isConfigured(): boolean {
    return typeof this.config.PROVIDER_GATEWAY_OPENAI_API_KEY === "string";
  }

  getCatalogModels(): string[] {
    return [...this.config.PROVIDER_GATEWAY_OPENAI_MODELS];
  }

  async warm(): Promise<void> {
    const apiKey = this.config.PROVIDER_GATEWAY_OPENAI_API_KEY;
    if (!apiKey) {
      this.client = null;
      return;
    }
    this.client = new OpenAI({ apiKey });
  }

  async generateText(
    input: ProviderGatewayTextGenerateRequest
  ): Promise<ProviderGatewayTextGenerateResult> {
    if (this.client === null) {
      throw new Error("OpenAI provider client is not warmed.");
    }

    const { signal, dispose } = this.createTimedSignal(
      this.config.PROVIDER_GATEWAY_REQUEST_TIMEOUT_MS
    );
    try {
      const response = await this.client.responses.create(
        {
          model: input.model,
          ...(input.systemPrompt === null ? {} : { instructions: input.systemPrompt }),
          input: input.messages.map((message) => ({
            role: message.role,
            content: this.toOpenAIMessageContent(message.content)
          })),
          ...(input.maxOutputTokens === undefined
            ? {}
            : { max_output_tokens: input.maxOutputTokens })
        },
        { signal }
      );

      const text = typeof response.output_text === "string" ? response.output_text.trim() : "";
      if (!text) {
        throw new Error("OpenAI provider response did not contain text output.");
      }

      return {
        provider: "openai",
        model: input.model,
        text,
        respondedAt: new Date().toISOString(),
        usage:
          response.usage === undefined
            ? null
            : {
                providerKey: "openai",
                modelKey: input.model,
                inputTokens: response.usage.input_tokens ?? null,
                outputTokens: response.usage.output_tokens ?? null,
                totalTokens: response.usage.total_tokens ?? null
              }
      };
    } finally {
      dispose();
    }
  }

  getClient(): OpenAI | null {
    return this.client;
  }

  async *streamText(
    input: ProviderGatewayTextGenerateRequest,
    signal?: AbortSignal
  ): AsyncGenerator<ProviderGatewayTextStreamEvent> {
    if (this.client === null) {
      throw new Error("OpenAI provider client is not warmed.");
    }

    let accumulatedText = "";
    const { signal: timedSignal, dispose } = this.createTimedSignal(
      this.config.PROVIDER_GATEWAY_STREAM_TIMEOUT_MS,
      signal
    );

    try {
      const stream = await this.client.responses.create(
        {
          model: input.model,
          ...(input.systemPrompt === null ? {} : { instructions: input.systemPrompt }),
          input: input.messages.map((message) => ({
            role: message.role,
            content: this.toOpenAIMessageContent(message.content)
          })),
          ...(input.maxOutputTokens === undefined
            ? {}
            : { max_output_tokens: input.maxOutputTokens }),
          stream: true
        },
        { signal: timedSignal }
      );

      for await (const event of stream) {
        if (event.type === "response.output_text.delta" && event.delta.length > 0) {
          accumulatedText += event.delta;
          const deltaEvent: ProviderGatewayTextDeltaEvent = {
            type: "text_delta",
            delta: event.delta,
            accumulatedText
          };
          yield deltaEvent;
          continue;
        }

        if (event.type === "response.completed") {
          const text =
            typeof event.response.output_text === "string"
              ? event.response.output_text.trim()
              : accumulatedText.trim();
          if (!text) {
            const failedEvent: ProviderGatewayTextFailedEvent = {
              type: "failed",
              code: "provider_invalid_response",
              message: "OpenAI provider stream completed without text output."
            };
            yield failedEvent;
            return;
          }

          const completedEvent: ProviderGatewayTextCompletedEvent = {
            type: "completed",
            result: {
              provider: "openai",
              model: input.model,
              text,
              respondedAt: new Date().toISOString(),
              usage: this.toUsageSnapshot(input.model, event.response.usage)
            }
          };
          yield completedEvent;
          return;
        }

        if (event.type === "error") {
          const failedEvent: ProviderGatewayTextFailedEvent = {
            type: "failed",
            code: event.code ?? "provider_stream_error",
            message: event.message
          };
          yield failedEvent;
          return;
        }

        if (event.type === "response.failed" || event.type === "response.incomplete") {
          const failedEvent: ProviderGatewayTextFailedEvent = {
            type: "failed",
            code: "provider_stream_failed",
            message:
              event.response.error?.message ??
              "OpenAI provider stream did not complete successfully."
          };
          yield failedEvent;
          return;
        }
      }

      const failedEvent: ProviderGatewayTextFailedEvent = {
        type: "failed",
        code: "provider_stream_ended",
        message: "OpenAI provider stream ended before a completed result was emitted."
      };
      yield failedEvent;
    } catch (error) {
      if (this.isAbortError(error) || signal?.aborted) {
        return;
      }
      const failedEvent: ProviderGatewayTextFailedEvent = {
        type: "failed",
        code: "provider_stream_failed",
        message: error instanceof Error ? error.message : "OpenAI provider stream failed."
      };
      yield failedEvent;
    } finally {
      dispose();
    }
  }

  private toUsageSnapshot(
    model: string,
    usage: OpenAI.Responses.ResponseUsage | undefined
  ): RuntimeUsageSnapshot | null {
    return usage === undefined
      ? null
      : {
          providerKey: "openai",
          modelKey: model,
          inputTokens: usage.input_tokens ?? null,
          outputTokens: usage.output_tokens ?? null,
          totalTokens: usage.total_tokens ?? null
        };
  }

  private toOpenAIMessageContent(
    content: ProviderGatewayTextGenerateRequest["messages"][number]["content"]
  ):
    | string
    | Array<
        | {
            type: "input_text";
            text: string;
          }
        | {
            type: "input_image";
            image_url: string;
            detail: "auto";
          }
        | {
            type: "input_file";
            filename: string;
            file_data: string;
          }
      > {
    if (typeof content === "string") {
      return content;
    }

    return content.map((block) =>
      block.type === "text"
        ? {
            type: "input_text",
            text: block.text
          }
        : block.type === "image"
          ? {
            type: "input_image",
            image_url: `data:${block.mimeType};base64,${block.dataBase64}`,
            detail: "auto"
          }
          : {
              type: "input_file",
              filename: block.filename ?? "attachment.pdf",
              file_data: `data:application/pdf;base64,${block.dataBase64}`
            }
    );
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
