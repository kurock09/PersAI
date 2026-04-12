import { Inject, Injectable } from "@nestjs/common";
import type { ProviderGatewayConfig } from "@persai/config";
import type {
  ProviderGatewayToolCall,
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

type AnthropicCreateMessageParams = Parameters<Anthropic["messages"]["create"]>[0];
type AnthropicNonStreamingCreateMessageParams = Exclude<
  AnthropicCreateMessageParams,
  { stream: true }
>;
type AnthropicMessageParams = NonNullable<AnthropicNonStreamingCreateMessageParams["messages"]>;
type AnthropicTool = NonNullable<AnthropicCreateMessageParams["tools"]>[number];
type AnthropicStructuredTool = Extract<AnthropicTool, { input_schema: unknown }>;
type AnthropicToolsParam = NonNullable<AnthropicNonStreamingCreateMessageParams["tools"]>;
type AnthropicToolChoice = AnthropicCreateMessageParams["tool_choice"];
type AnthropicNonStreamingMessage = Extract<
  Awaited<ReturnType<Anthropic["messages"]["create"]>>,
  { content: unknown }
>;
type AnthropicBuiltMessageContent =
  | string
  | Array<
      | {
          type: "text";
          text: string;
        }
      | {
          type: "image";
          source: {
            type: "base64";
            media_type: "image/png" | "image/jpeg" | "image/gif" | "image/webp";
            data: string;
          };
        }
      | {
          type: "document";
          source: {
            type: "base64";
            media_type: "application/pdf";
            data: string;
          };
          title?: string | null;
        }
      | {
          type: "tool_use";
          id: string;
          name: string;
          input: Record<string, unknown>;
        }
      | {
          type: "tool_result";
          tool_use_id: string;
          content: string;
          is_error: boolean;
        }
    >;
type AnthropicBuiltMessage = {
  role: "user" | "assistant";
  content: AnthropicBuiltMessageContent;
};

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
      const toolChoice = this.toAnthropicToolChoice(input);
      const payload: AnthropicNonStreamingCreateMessageParams = {
        model: input.model,
        max_tokens: input.maxOutputTokens ?? 1_024,
        messages: this.buildAnthropicMessages(input) as AnthropicMessageParams
      };
      if (input.systemPrompt !== null) {
        payload.system = input.systemPrompt;
      }
      if ((input.tools?.length ?? 0) > 0) {
        payload.tools = this.toAnthropicTools(input) as AnthropicToolsParam;
      }
      if (toolChoice !== undefined) {
        payload.tool_choice = toolChoice;
      }
      const response = (await this.client.messages.create(payload, {
        signal
      })) as AnthropicNonStreamingMessage;
      const toolCalls = this.parseAnthropicToolCalls(response.content);
      if (toolCalls.length > 0) {
        return {
          provider: "anthropic",
          model: input.model,
          text: this.extractAnthropicText(response.content),
          respondedAt: new Date().toISOString(),
          usage: this.toUsageSnapshot(input.model, response.usage),
          stopReason: "tool_calls",
          toolCalls
        };
      }

      const text = this.extractAnthropicText(response.content) ?? "";

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
        },
        stopReason: "completed",
        toolCalls: []
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
    if (
      (input.tools?.length ?? 0) > 0 ||
      input.toolChoice !== undefined ||
      (input.toolHistory?.length ?? 0) > 0
    ) {
      throw new Error("Tool-capable Anthropic streaming is not implemented.");
    }
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
          messages: this.buildAnthropicMessages(input) as AnthropicMessageParams,
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
              usage: latestUsage,
              stopReason: "completed",
              toolCalls: []
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

  private buildAnthropicMessages(
    input: ProviderGatewayTextGenerateRequest
  ): AnthropicBuiltMessage[] {
    const messages: AnthropicBuiltMessage[] = input.messages.map((message) => ({
      role: message.role,
      content: this.toAnthropicMessageContent(message.content)
    }));
    for (const exchange of input.toolHistory ?? []) {
      messages.push({
        role: "assistant",
        content: [
          {
            type: "tool_use",
            id: exchange.toolCall.id,
            name: exchange.toolCall.name,
            input: exchange.toolCall.arguments
          }
        ]
      });
      messages.push({
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: exchange.toolCall.id,
            content: exchange.toolResult.content,
            is_error: exchange.toolResult.isError
          }
        ]
      });
    }
    return messages;
  }

  private toAnthropicTools(input: ProviderGatewayTextGenerateRequest): AnthropicTool[] {
    return (input.tools ?? []).map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.inputSchema as AnthropicStructuredTool["input_schema"]
    }));
  }

  private toAnthropicToolChoice(
    input: ProviderGatewayTextGenerateRequest
  ): AnthropicToolChoice | undefined {
    if (input.toolChoice === undefined || input.toolChoice === "none") {
      return undefined;
    }
    if (input.toolChoice === "auto") {
      return {
        type: "auto"
      };
    }
    return {
      type: "tool",
      name: input.toolChoice.name
    };
  }

  private parseAnthropicToolCalls(
    content: Anthropic.Messages.Message["content"]
  ): ProviderGatewayToolCall[] {
    return content
      .filter(
        (block): block is Anthropic.Messages.ToolUseBlock =>
          block.type === "tool_use" &&
          typeof block.id === "string" &&
          typeof block.name === "string"
      )
      .map((block) => ({
        id: block.id,
        name: block.name,
        arguments:
          block.input !== null && typeof block.input === "object" && !Array.isArray(block.input)
            ? (block.input as Record<string, unknown>)
            : {}
      }));
  }

  private extractAnthropicText(content: Anthropic.Messages.Message["content"]): string | null {
    const text = content
      .filter((block): block is Anthropic.Messages.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("\n")
      .trim();
    return text.length > 0 ? text : null;
  }

  private toAnthropicMessageContent(
    content: ProviderGatewayTextGenerateRequest["messages"][number]["content"]
  ): AnthropicBuiltMessageContent {
    if (typeof content === "string") {
      return content;
    }

    return content.map((block) =>
      block.type === "text"
        ? {
            type: "text",
            text: block.text
          }
        : block.type === "image"
          ? {
              type: "image",
              source: {
                type: "base64",
                media_type: this.toAnthropicImageMime(block.mimeType),
                data: block.dataBase64
              }
            }
          : {
              type: "document",
              source: {
                type: "base64",
                media_type: "application/pdf",
                data: block.dataBase64
              },
              title: block.filename
            }
    );
  }

  private toAnthropicImageMime(
    mimeType: string
  ): "image/png" | "image/jpeg" | "image/gif" | "image/webp" {
    switch (mimeType) {
      case "image/png":
      case "image/jpeg":
      case "image/gif":
      case "image/webp":
        return mimeType;
      default:
        throw new Error(`Anthropic does not support image MIME "${mimeType}".`);
    }
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
