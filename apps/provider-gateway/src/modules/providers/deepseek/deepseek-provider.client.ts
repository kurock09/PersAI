import { Inject, Injectable, Logger } from "@nestjs/common";
import type { ProviderGatewayConfig } from "@persai/config";
import OpenAI from "openai";
import type {
  ChatCompletionCreateParamsNonStreaming,
  ChatCompletionCreateParamsStreaming
} from "openai/resources/chat/completions/completions";
import type {
  ProviderGatewayMessageContent,
  ProviderGatewayTextCompletedEvent,
  ProviderGatewayTextDeltaEvent,
  ProviderGatewayTextFailedEvent,
  ProviderGatewayTextGenerateRequest,
  ProviderGatewayTextGenerateResult,
  ProviderGatewayTextKeepaliveEvent,
  ProviderGatewayTextStreamEvent,
  ProviderGatewayTextToolCallsEvent
} from "@persai/runtime-contract";
import { PROVIDER_GATEWAY_CONFIG } from "../../../provider-gateway-config";
import type { ProviderWarmableClient } from "../provider-client.types";
import { toProviderTextFailedEvent, toProviderTextHttpException } from "../provider-text-error";

export const DEEPSEEK_BASE_URL = "https://api.deepseek.com";

type DeepSeekChatCompletionCreateParams =
  | ChatCompletionCreateParamsNonStreaming
  | ChatCompletionCreateParamsStreaming;
type DeepSeekStreamingChatCompletionCreateParams = ChatCompletionCreateParamsStreaming;
type DeepSeekNonStreamingChatCompletionCreateParams = ChatCompletionCreateParamsNonStreaming;

type DeepSeekStreamToolCallState = {
  id: string;
  name: string | null;
  argumentsText: string;
};

type DeepSeekToolCallRecord = {
  id?: string | null;
  function?: {
    name?: string | null;
    arguments?: string | null;
  } | null;
};

type DeepSeekStreamToolCallDelta = DeepSeekToolCallRecord & {
  index?: number | null;
};

@Injectable()
export class DeepSeekProviderClient implements ProviderWarmableClient {
  readonly provider = "deepseek" as const;
  readonly catalogSource = "bootstrap_config" as const;
  private readonly logger = new Logger(DeepSeekProviderClient.name);
  private client: OpenAI | null = null;

  constructor(@Inject(PROVIDER_GATEWAY_CONFIG) private readonly config: ProviderGatewayConfig) {}

  isConfigured(): boolean {
    return this.client !== null;
  }

  getCatalogModels(): string[] {
    return [];
  }

  async warm(apiKeyOverride?: string): Promise<void> {
    const apiKey = apiKeyOverride?.trim() ?? "";
    if (apiKey.length === 0) {
      this.client = null;
      return;
    }
    this.client = this.createClient(apiKey, DEEPSEEK_BASE_URL);
  }

  async generateText(
    input: ProviderGatewayTextGenerateRequest
  ): Promise<ProviderGatewayTextGenerateResult> {
    const client = this.requireClient();
    const { signal, dispose } = this.createTimedSignal(
      this.config.PROVIDER_GATEWAY_REQUEST_TIMEOUT_MS
    );
    try {
      const payload = this.buildChatCompletionPayload(input, false);
      const response = await client.chat.completions.create(payload, { signal });
      const choice = response.choices[0];
      const message = choice?.message;
      const toolCalls = this.parseToolCalls(message?.tool_calls);
      if (toolCalls.length > 0) {
        return {
          provider: "deepseek",
          model: input.model,
          text: this.normalizeOptionalText(message?.content),
          respondedAt: new Date().toISOString(),
          usage: this.toUsageSnapshot(input.model, response.usage),
          stopReason: "tool_calls",
          reasoningContent: this.extractReasoningContent(message),
          toolCalls
        };
      }
      return {
        provider: "deepseek",
        model: input.model,
        text: this.normalizeOptionalText(message?.content),
        respondedAt: new Date().toISOString(),
        usage: this.toUsageSnapshot(input.model, response.usage),
        stopReason: "completed",
        truncated: choice?.finish_reason === "length",
        toolCalls: []
      };
    } catch (error) {
      throw toProviderTextHttpException(
        "deepseek",
        error,
        "DeepSeek text generation request failed."
      );
    } finally {
      dispose();
    }
  }

  async *streamText(
    input: ProviderGatewayTextGenerateRequest,
    signal?: AbortSignal
  ): AsyncGenerator<ProviderGatewayTextStreamEvent> {
    const client = this.requireClient();
    let accumulatedText = "";
    let accumulatedReasoning = "";
    const streamedToolCalls = new Map<number, DeepSeekStreamToolCallState>();
    const {
      signal: timedSignal,
      reset,
      dispose
    } = this.createTimedSignal(this.config.PROVIDER_GATEWAY_STREAM_TIMEOUT_MS, signal);
    try {
      const payload = this.buildChatCompletionPayload(input, true);
      const stream = await client.chat.completions.create(payload, { signal: timedSignal });
      const keepaliveEvent: ProviderGatewayTextKeepaliveEvent = { type: "keepalive" };
      yield keepaliveEvent;
      reset();
      let finishReason: string | null = null;
      let streamUsage:
        | {
            prompt_tokens?: number | null;
            completion_tokens?: number | null;
            total_tokens?: number | null;
            prompt_tokens_details?: { cached_tokens?: number | null } | null;
          }
        | null
        | undefined = undefined;
      for await (const chunk of stream) {
        reset();
        // OpenAI-compatible streams emit usage on a trailing chunk when
        // stream_options.include_usage=true (often with empty choices).
        if (chunk?.usage !== undefined && chunk.usage !== null) {
          streamUsage = chunk.usage;
        }
        const choice = chunk?.choices?.[0];
        const delta = choice?.delta;
        const reasoningDelta = this.readReasoningContentDelta(delta);
        if (reasoningDelta !== null) {
          accumulatedReasoning += reasoningDelta;
        }
        if (typeof delta?.content === "string" && delta.content.length > 0) {
          accumulatedText += delta.content;
          const deltaEvent: ProviderGatewayTextDeltaEvent = {
            type: "text_delta",
            delta: delta.content,
            accumulatedText
          };
          yield deltaEvent;
        }
        if (Array.isArray(delta?.tool_calls)) {
          this.accumulateStreamToolCalls(streamedToolCalls, delta.tool_calls);
        }
        if (typeof choice?.finish_reason === "string") {
          finishReason = choice.finish_reason;
        }
      }

      const usage = this.toUsageSnapshot(input.model, streamUsage);
      const finalizedToolCalls = this.finalizeStreamToolCalls(streamedToolCalls);
      if (finalizedToolCalls.length > 0) {
        const toolCallsEvent: ProviderGatewayTextToolCallsEvent = {
          type: "tool_calls",
          result: {
            provider: "deepseek",
            model: input.model,
            text: this.normalizeOptionalText(accumulatedText),
            respondedAt: new Date().toISOString(),
            usage,
            stopReason: "tool_calls",
            reasoningContent: this.normalizeOptionalText(accumulatedReasoning),
            toolCalls: finalizedToolCalls
          }
        };
        yield toolCallsEvent;
        return;
      }

      const completedEvent: ProviderGatewayTextCompletedEvent = {
        type: "completed",
        result: {
          provider: "deepseek",
          model: input.model,
          text: this.normalizeOptionalText(accumulatedText),
          respondedAt: new Date().toISOString(),
          usage,
          stopReason: "completed",
          truncated: finishReason === "length",
          toolCalls: []
        }
      };
      yield completedEvent;
    } catch (error) {
      const failedEvent: ProviderGatewayTextFailedEvent = toProviderTextFailedEvent(
        "deepseek",
        error,
        "DeepSeek text stream failed."
      );
      this.logger.warn(
        `[deepseek-stream-failed] requestId=${input.requestMetadata?.runtimeRequestId ?? "unknown"} model=${input.model} code=${failedEvent.code} kind=${failedEvent.providerErrorKind ?? "unknown"} status=${failedEvent.providerErrorStatus ?? "unknown"}`
      );
      yield failedEvent;
    } finally {
      dispose();
    }
  }

  private buildChatCompletionPayload(
    input: ProviderGatewayTextGenerateRequest,
    stream: false
  ): DeepSeekNonStreamingChatCompletionCreateParams;
  private buildChatCompletionPayload(
    input: ProviderGatewayTextGenerateRequest,
    stream: true
  ): DeepSeekStreamingChatCompletionCreateParams;
  private buildChatCompletionPayload(
    input: ProviderGatewayTextGenerateRequest,
    stream: boolean
  ): DeepSeekChatCompletionCreateParams {
    const payload: Record<string, unknown> = {
      model: input.model,
      messages: this.buildMessages(input),
      stream
    };
    if (stream) {
      // Required for Chat Completions streaming: otherwise DeepSeek never
      // emits a usage chunk and PersAI session currentTokens stays null.
      payload.stream_options = { include_usage: true };
    }
    if (input.maxOutputTokens !== undefined) {
      payload.max_tokens = input.maxOutputTokens;
    }
    if ((input.tools?.length ?? 0) > 0) {
      payload.tools = input.tools?.map((tool) => ({
        type: "function",
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.inputSchema
        }
      }));
      // ADR-124 — DeepSeek V4 runs in thinking mode by default; each thinking
      // tool-call turn carries a `reasoning_content` that MUST be echoed back on
      // the assistant message in the next request. Forcing one tool call per
      // turn keeps that echo strictly canonical (one assistant message = one
      // tool_call + its reasoning_content), exactly like the official DeepSeek
      // function-calling example, and avoids ambiguous reasoning attribution
      // across parallel calls.
      payload.parallel_tool_calls = false;
    }
    if (input.toolChoice !== undefined) {
      payload.tool_choice =
        input.toolChoice === "auto" || input.toolChoice === "none"
          ? input.toolChoice
          : {
              type: "function",
              function: { name: input.toolChoice.name }
            };
    }
    if (input.outputSchema !== undefined) {
      payload.response_format = {
        type: "json_schema",
        json_schema: {
          name: input.outputSchema.name,
          description: input.outputSchema.description,
          schema: input.outputSchema.schema,
          strict: input.outputSchema.strict ?? true
        }
      };
    }
    return payload as unknown as DeepSeekChatCompletionCreateParams;
  }

  private buildMessages(input: ProviderGatewayTextGenerateRequest): Array<Record<string, unknown>> {
    const messages: Array<Record<string, unknown>> = [];
    if (typeof input.systemPrompt === "string" && input.systemPrompt.trim().length > 0) {
      messages.push({
        role: "system",
        content: input.systemPrompt
      });
    }
    if (
      typeof input.developerInstructions === "string" &&
      input.developerInstructions.trim().length > 0
    ) {
      messages.push({
        role: "system",
        content: input.developerInstructions
      });
    }
    for (const message of input.messages) {
      if (message.cacheRole === "volatile_context") {
        messages.push({
          role: "system",
          content: this.wrapVolatileContext(
            this.textOnlyContent(message.content),
            message.volatileKind
          )
        });
        continue;
      }
      for (const exchange of message.priorToolExchanges ?? []) {
        this.pushDeepSeekExchangeMessages(messages, exchange);
      }
      messages.push({
        role: message.role,
        content: this.textOnlyContent(message.content)
      });
    }
    for (const exchange of input.toolHistory ?? []) {
      this.pushDeepSeekExchangeMessages(messages, exchange);
    }
    if (input.toolFollowUpUserContent !== undefined) {
      messages.push({
        role: "user",
        content: this.textOnlyContent(input.toolFollowUpUserContent)
      });
    }
    return messages;
  }

  private pushDeepSeekExchangeMessages(
    target: Array<Record<string, unknown>>,
    exchange: NonNullable<ProviderGatewayTextGenerateRequest["toolHistory"]>[number]
  ): void {
    const reasoningContent =
      typeof exchange.reasoningContent === "string" && exchange.reasoningContent.trim().length > 0
        ? exchange.reasoningContent
        : null;
    target.push({
      role: "assistant",
      content: null,
      // ADR-124 — DeepSeek thinking mode requires the assistant tool-call
      // message to carry back the `reasoning_content` it produced; omitting
      // it yields a 400 ("reasoning_content ... must be passed back").
      ...(reasoningContent === null ? {} : { reasoning_content: reasoningContent }),
      tool_calls: [
        {
          id: exchange.toolCall.id,
          type: "function",
          function: {
            name: exchange.toolCall.name,
            arguments: JSON.stringify(exchange.toolCall.arguments)
          }
        }
      ]
    });
    target.push({
      role: "tool",
      tool_call_id: exchange.toolResult.toolCallId,
      content: exchange.toolResult.content
    });
  }

  private textOnlyContent(content: ProviderGatewayMessageContent): string {
    if (typeof content === "string") {
      return content;
    }
    const parts: string[] = [];
    for (const block of content) {
      if (block.type !== "text") {
        throw toProviderTextHttpException(
          "deepseek",
          {
            status: 400,
            error: {
              code: "unsupported_content",
              type: "invalid_request_error",
              message: "DeepSeek currently supports text-only chat input."
            }
          },
          "DeepSeek currently supports text-only chat input."
        );
      }
      if (block.text.trim().length > 0) {
        parts.push(block.text);
      }
    }
    return parts.join("\n\n");
  }

  private wrapVolatileContext(
    content: string,
    volatileKind: "active_scenario" | "system_reminder" | "chat_plan" | undefined
  ): string {
    if (volatileKind === "active_scenario") {
      return `<persai_active_scenario>\n${content}\n</persai_active_scenario>`;
    }
    if (volatileKind === "system_reminder") {
      return `<system-reminder>\n${content}\n</system-reminder>`;
    }
    if (volatileKind === "chat_plan") {
      return `<persai_chat_plan>\n${content}\n</persai_chat_plan>`;
    }
    return content;
  }

  private parseToolCalls(toolCalls: unknown): ProviderGatewayTextGenerateResult["toolCalls"] {
    if (!Array.isArray(toolCalls)) {
      return [];
    }
    const parsed: ProviderGatewayTextGenerateResult["toolCalls"] = [];
    for (const entry of toolCalls) {
      const id = entry?.id;
      const name = entry?.function?.name;
      const argumentsText = entry?.function?.arguments;
      if (typeof id !== "string" || typeof name !== "string" || typeof argumentsText !== "string") {
        continue;
      }
      parsed.push({
        id,
        name,
        arguments: this.parseToolArguments(argumentsText)
      });
    }
    return parsed;
  }

  private parseToolArguments(value: string): Record<string, unknown> {
    try {
      const parsed = JSON.parse(value);
      return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch {
      return {};
    }
  }

  private accumulateStreamToolCalls(
    store: Map<number, DeepSeekStreamToolCallState>,
    toolCalls: ReadonlyArray<DeepSeekStreamToolCallDelta>
  ): void {
    for (const entry of toolCalls) {
      const index = typeof entry?.index === "number" ? entry.index : 0;
      const current = store.get(index) ?? {
        id: typeof entry?.id === "string" ? entry.id : `tool-${String(index)}`,
        name: null,
        argumentsText: ""
      };
      if (typeof entry?.id === "string" && entry.id.length > 0) {
        current.id = entry.id;
      }
      if (typeof entry?.function?.name === "string" && entry.function.name.length > 0) {
        current.name = entry.function.name;
      }
      if (typeof entry?.function?.arguments === "string" && entry.function.arguments.length > 0) {
        current.argumentsText += entry.function.arguments;
      }
      store.set(index, current);
    }
  }

  private finalizeStreamToolCalls(
    store: Map<number, DeepSeekStreamToolCallState>
  ): ProviderGatewayTextGenerateResult["toolCalls"] {
    return Array.from(store.values())
      .filter((entry) => entry.name !== null)
      .map((entry) => ({
        id: entry.id,
        name: entry.name as string,
        arguments: this.parseToolArguments(entry.argumentsText)
      }));
  }

  private toUsageSnapshot(
    model: string,
    usage:
      | {
          prompt_tokens?: number | null;
          completion_tokens?: number | null;
          total_tokens?: number | null;
          prompt_tokens_details?: { cached_tokens?: number | null } | null;
        }
      | null
      | undefined
  ): ProviderGatewayTextGenerateResult["usage"] {
    if (!usage) {
      return null;
    }
    return {
      providerKey: "deepseek",
      modelKey: model,
      inputTokens: usage.prompt_tokens ?? null,
      cacheCreationInputTokens: null,
      cachedInputTokens: usage.prompt_tokens_details?.cached_tokens ?? null,
      outputTokens: usage.completion_tokens ?? null,
      totalTokens: usage.total_tokens ?? null
    };
  }

  private normalizeOptionalText(value: unknown): string | null {
    if (typeof value !== "string") {
      return null;
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  /**
   * ADR-124 — DeepSeek returns chain-of-thought in a `reasoning_content` field
   * that sits alongside `content`, which the OpenAI SDK types do not model.
   * Read it defensively without widening the typed message shape.
   */
  private extractReasoningContent(message: unknown): string | null {
    if (message === null || typeof message !== "object") {
      return null;
    }
    const candidate = (message as { reasoning_content?: unknown }).reasoning_content;
    return this.normalizeOptionalText(candidate);
  }

  private readReasoningContentDelta(delta: unknown): string | null {
    if (delta === null || typeof delta !== "object") {
      return null;
    }
    const candidate = (delta as { reasoning_content?: unknown }).reasoning_content;
    return typeof candidate === "string" && candidate.length > 0 ? candidate : null;
  }

  private requireClient(): OpenAI {
    if (this.client === null) {
      throw new Error("DeepSeek provider client is not warmed.");
    }
    return this.client;
  }

  private createClient(apiKey: string, baseURL: string): OpenAI {
    return new OpenAI({
      apiKey,
      baseURL
    });
  }

  private createTimedSignal(
    timeoutMs: number,
    parentSignal?: AbortSignal
  ): {
    signal: AbortSignal;
    reset: () => void;
    dispose: () => void;
  } {
    const controller = new AbortController();
    let timeoutId: NodeJS.Timeout | null = null;
    const reset = () => {
      if (timeoutId !== null) {
        clearTimeout(timeoutId);
      }
      timeoutId = setTimeout(() => controller.abort(), timeoutMs);
      timeoutId.unref?.();
    };
    const onAbort = () => controller.abort();
    if (parentSignal) {
      if (parentSignal.aborted) {
        controller.abort();
      } else {
        parentSignal.addEventListener("abort", onAbort, { once: true });
      }
    }
    reset();
    return {
      signal: controller.signal,
      reset,
      dispose: () => {
        if (timeoutId !== null) {
          clearTimeout(timeoutId);
        }
        if (parentSignal) {
          parentSignal.removeEventListener("abort", onAbort);
        }
      }
    };
  }
}
