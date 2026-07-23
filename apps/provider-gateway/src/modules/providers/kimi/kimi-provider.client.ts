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
import { normalizeProviderTextGenerationUsageV2 } from "@persai/runtime-contract";
import { PROVIDER_GATEWAY_CONFIG } from "../../../provider-gateway-config";
import type { ProviderWarmableClient } from "../provider-client.types";
import { toProviderTextFailedEvent, toProviderTextHttpException } from "../provider-text-error";
import { logProviderCacheZoneTelemetry } from "../provider-cache-zone-observability";

/** Moonshot Open Platform (global) Chat Completions base URL. */
export const KIMI_BASE_URL = "https://api.moonshot.ai/v1";

type KimiChatCompletionCreateParams =
  | ChatCompletionCreateParamsNonStreaming
  | ChatCompletionCreateParamsStreaming;
type KimiStreamingChatCompletionCreateParams = ChatCompletionCreateParamsStreaming;
type KimiNonStreamingChatCompletionCreateParams = ChatCompletionCreateParamsNonStreaming;

type KimiStreamToolCallState = {
  id: string;
  name: string | null;
  argumentsText: string;
};

type KimiToolCallRecord = {
  id?: string | null;
  function?: {
    name?: string | null;
    arguments?: string | null;
  } | null;
};

type KimiStreamToolCallDelta = KimiToolCallRecord & {
  index?: number | null;
};

type KimiReasoningEffort = "low" | "high" | "max";

@Injectable()
export class KimiProviderClient implements ProviderWarmableClient {
  readonly provider = "kimi" as const;
  readonly catalogSource = "bootstrap_config" as const;
  private readonly logger = new Logger(KimiProviderClient.name);
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
    this.client = this.createClient(apiKey, KIMI_BASE_URL);
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
      this.logCacheZoneTelemetry(input, payload);
      const response = await client.chat.completions.create(payload, { signal });
      const choice = response.choices[0];
      const message = choice?.message;
      const toolCalls = this.parseToolCalls(message?.tool_calls);
      if (toolCalls.length > 0) {
        return {
          provider: "kimi",
          model: input.model,
          text: this.normalizeOptionalText(message?.content),
          respondedAt: new Date().toISOString(),
          usage: this.toUsageSnapshot(input.model, response.usage),
          textUsage: normalizeProviderTextGenerationUsageV2({
            providerKey: "kimi",
            modelKey: input.model,
            stepType: this.textUsageStepType(input),
            modelRole: null,
            responseUsage: response.usage as Record<string, unknown> | undefined
          }),
          stopReason: "tool_calls",
          reasoningContent: this.extractReasoningContent(message),
          toolCalls
        };
      }
      return {
        provider: "kimi",
        model: input.model,
        text: this.normalizeOptionalText(message?.content),
        respondedAt: new Date().toISOString(),
        usage: this.toUsageSnapshot(input.model, response.usage),
        textUsage: normalizeProviderTextGenerationUsageV2({
          providerKey: "kimi",
          modelKey: input.model,
          stepType: this.textUsageStepType(input),
          modelRole: null,
          responseUsage: response.usage as Record<string, unknown> | undefined
        }),
        stopReason: "completed",
        truncated: choice?.finish_reason === "length",
        toolCalls: []
      };
    } catch (error) {
      throw toProviderTextHttpException("kimi", error, "Kimi text generation request failed.");
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
    const streamedToolCalls = new Map<number, KimiStreamToolCallState>();
    const {
      signal: timedSignal,
      reset,
      dispose
    } = this.createTimedSignal(this.config.PROVIDER_GATEWAY_STREAM_TIMEOUT_MS, signal);
    try {
      const payload = this.buildChatCompletionPayload(input, true);
      this.logCacheZoneTelemetry(input, payload);
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
            cached_tokens?: number | null;
          }
        | null
        | undefined = undefined;
      for await (const chunk of stream) {
        reset();
        if (chunk?.usage !== undefined && chunk.usage !== null) {
          streamUsage = chunk.usage as unknown as typeof streamUsage;
        }
        const choice = chunk?.choices?.[0];
        const delta = choice?.delta;
        const reasoningDelta = this.readReasoningContentDelta(delta);
        if (reasoningDelta !== null) {
          accumulatedReasoning += reasoningDelta;
          yield {
            type: "thinking_delta",
            delta: reasoningDelta,
            accumulatedThinking: accumulatedReasoning
          };
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
            provider: "kimi",
            model: input.model,
            text: this.normalizeOptionalText(accumulatedText),
            respondedAt: new Date().toISOString(),
            usage,
            textUsage: normalizeProviderTextGenerationUsageV2({
              providerKey: "kimi",
              modelKey: input.model,
              stepType: this.textUsageStepType(input),
              modelRole: null,
              responseUsage: streamUsage as Record<string, unknown> | null | undefined
            }),
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
          provider: "kimi",
          model: input.model,
          text: this.normalizeOptionalText(accumulatedText),
          respondedAt: new Date().toISOString(),
          usage,
          textUsage: normalizeProviderTextGenerationUsageV2({
            providerKey: "kimi",
            modelKey: input.model,
            stepType: this.textUsageStepType(input),
            modelRole: null,
            responseUsage: streamUsage as Record<string, unknown> | null | undefined
          }),
          stopReason: "completed",
          truncated: finishReason === "length",
          toolCalls: []
        }
      };
      yield completedEvent;
    } catch (error) {
      const failedEvent: ProviderGatewayTextFailedEvent = toProviderTextFailedEvent(
        "kimi",
        error,
        "Kimi text stream failed."
      );
      this.logger.warn(
        `[kimi-stream-failed] requestId=${input.requestMetadata?.runtimeRequestId ?? "unknown"} model=${input.model} code=${failedEvent.code} kind=${failedEvent.providerErrorKind ?? "unknown"} status=${failedEvent.providerErrorStatus ?? "unknown"}`
      );
      yield failedEvent;
    } finally {
      dispose();
    }
  }

  private buildChatCompletionPayload(
    input: ProviderGatewayTextGenerateRequest,
    stream: false
  ): KimiNonStreamingChatCompletionCreateParams;
  private buildChatCompletionPayload(
    input: ProviderGatewayTextGenerateRequest,
    stream: true
  ): KimiStreamingChatCompletionCreateParams;
  private buildChatCompletionPayload(
    input: ProviderGatewayTextGenerateRequest,
    stream: boolean
  ): KimiChatCompletionCreateParams {
    const payload: Record<string, unknown> = {
      model: input.model,
      messages: this.buildMessages(input),
      stream
    };
    if (stream) {
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
      payload.parallel_tool_calls = input.skillsEnabled === true ? false : true;
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
    const reasoningEffort = this.reasoningEffortForRequest(input);
    if (reasoningEffort !== null) {
      payload.reasoning_effort = reasoningEffort;
    }
    return payload as unknown as KimiChatCompletionCreateParams;
  }

  /**
   * Map ADR-121 thinkingBudget onto Moonshot `reasoning_effort` for kimi-k3 only.
   * Absent/zero budget → omit (K3 defaults to max). Non-k3 models omit.
   */
  private reasoningEffortForRequest(
    input: ProviderGatewayTextGenerateRequest
  ): KimiReasoningEffort | null {
    if (!/^kimi-k3(\b|$)/i.test(input.model)) {
      return null;
    }
    if (input.thinkingBudget === undefined || input.thinkingBudget <= 0) {
      return null;
    }
    if (input.thinkingBudget <= 10_000) {
      return "low";
    }
    if (input.thinkingBudget <= 25_000) {
      return "high";
    }
    return "max";
  }

  private buildMessages(input: ProviderGatewayTextGenerateRequest): Array<Record<string, unknown>> {
    const messages: Array<Record<string, unknown>> = [];
    if (typeof input.systemPrompt === "string" && input.systemPrompt.trim().length > 0) {
      messages.push({
        role: "system",
        content: input.systemPrompt
      });
    }
    const stableHistoryChat =
      input.requestMetadata?.classification === "main_turn" ||
      input.requestMetadata?.classification === "tool_loop_followup";
    const hasEarlyDeveloperInstructions =
      !stableHistoryChat &&
      typeof input.developerInstructions === "string" &&
      input.developerInstructions.trim().length > 0;
    if (hasEarlyDeveloperInstructions) {
      messages.push({
        role: "system",
        content: input.developerInstructions
      });
    }
    const volatileContextMessages: ProviderGatewayTextGenerateRequest["messages"] = [];
    for (const message of input.messages) {
      if (message.cacheRole === "volatile_context") {
        volatileContextMessages.push(message);
        continue;
      }
      for (const exchange of message.priorToolExchanges ?? []) {
        this.pushToolExchangeMessages(messages, exchange);
      }
      messages.push({
        role: message.role,
        content: this.toMessageContent(message.content)
      });
    }
    for (const exchange of input.toolHistory ?? []) {
      this.pushToolExchangeMessages(messages, exchange);
    }
    if (input.toolFollowUpUserContent !== undefined) {
      messages.push({
        role: "user",
        content: this.toMessageContent(input.toolFollowUpUserContent)
      });
    }
    const projectedVolatileMessages = volatileContextMessages.map((message) => ({
      role: "system",
      content: this.wrapVolatileContext(
        this.contentAsPlainText(message.content),
        message.volatileKind
      )
    }));
    if (stableHistoryChat) {
      messages.push(...projectedVolatileMessages);
    } else if (projectedVolatileMessages.length > 0) {
      messages.splice(
        (typeof input.systemPrompt === "string" && input.systemPrompt.trim().length > 0 ? 1 : 0) +
          (hasEarlyDeveloperInstructions ? 1 : 0),
        0,
        ...projectedVolatileMessages
      );
    }
    if (
      stableHistoryChat &&
      typeof input.developerInstructions === "string" &&
      input.developerInstructions.trim().length > 0
    ) {
      messages.push({
        role: "system",
        content: input.developerInstructions
      });
    }
    return messages;
  }

  private logCacheZoneTelemetry(
    input: ProviderGatewayTextGenerateRequest,
    payload: KimiChatCompletionCreateParams
  ): void {
    const rawPayload = payload as unknown as Record<string, unknown>;
    const messages = Array.isArray(rawPayload.messages) ? (rawPayload.messages as unknown[]) : [];
    let lastSealedIndex = -1;
    for (let index = 0; index < messages.length; index += 1) {
      const message = messages[index];
      if (
        message !== null &&
        typeof message === "object" &&
        (message as { role?: unknown }).role === "tool"
      ) {
        lastSealedIndex = index;
      }
    }
    logProviderCacheZoneTelemetry({
      logger: this.logger,
      input,
      representation: {
        tools: rawPayload.tools ?? [],
        prefix: lastSealedIndex >= 0 ? messages.slice(0, lastSealedIndex + 1) : messages,
        stableSystem:
          typeof input.systemPrompt === "string"
            ? [{ role: "system", content: input.systemPrompt }]
            : [],
        hydratedHistory: messages.slice(
          typeof input.systemPrompt === "string" && input.systemPrompt.trim().length > 0 ? 1 : 0,
          lastSealedIndex >= 0 ? lastSealedIndex + 1 : messages.length
        ),
        volatileContext: input.messages.filter(
          (message) => message.cacheRole === "volatile_context"
        ),
        developerTail: input.developerInstructions ?? null,
        cacheBreakpointCount: 0
      }
    });
  }

  private pushToolExchangeMessages(
    target: Array<Record<string, unknown>>,
    exchange: NonNullable<ProviderGatewayTextGenerateRequest["toolHistory"]>[number]
  ): void {
    const reasoningContent =
      typeof exchange.reasoningContent === "string" && exchange.reasoningContent.trim().length > 0
        ? exchange.reasoningContent
        : null;
    const assistantText =
      typeof exchange.assistantText === "string" && exchange.assistantText.trim().length > 0
        ? exchange.assistantText
        : null;
    target.push({
      role: "assistant",
      content: assistantText,
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

  private toMessageContent(
    content: ProviderGatewayMessageContent
  ): string | Array<Record<string, unknown>> {
    if (typeof content === "string") {
      return content;
    }
    const parts: Array<Record<string, unknown>> = [];
    for (const block of content) {
      if (block.type === "text") {
        if (block.text.trim().length > 0) {
          parts.push({ type: "text", text: block.text });
        }
        continue;
      }
      if (block.type === "image") {
        parts.push({
          type: "image_url",
          image_url: {
            url: `data:${block.mimeType};base64,${block.dataBase64}`
          }
        });
        continue;
      }
      throw toProviderTextHttpException(
        "kimi",
        {
          status: 400,
          error: {
            code: "unsupported_content",
            type: "invalid_request_error",
            message: "Kimi chat adapter supports text and image content blocks only."
          }
        },
        "Kimi chat adapter supports text and image content blocks only."
      );
    }
    if (parts.length === 0) {
      return "";
    }
    if (parts.length === 1 && parts[0]?.type === "text") {
      return String(parts[0].text ?? "");
    }
    return parts;
  }

  private contentAsPlainText(content: ProviderGatewayMessageContent): string {
    if (typeof content === "string") {
      return content;
    }
    const parts: string[] = [];
    for (const block of content) {
      if (block.type === "text" && block.text.trim().length > 0) {
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
    store: Map<number, KimiStreamToolCallState>,
    toolCalls: ReadonlyArray<KimiStreamToolCallDelta>
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
    store: Map<number, KimiStreamToolCallState>
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
          cached_tokens?: number | null;
        }
      | null
      | undefined
  ): ProviderGatewayTextGenerateResult["usage"] {
    if (!usage) {
      return null;
    }
    return {
      providerKey: "kimi",
      modelKey: model,
      inputTokens: usage.prompt_tokens ?? null,
      cacheCreationInputTokens: null,
      cachedInputTokens: usage.cached_tokens ?? null,
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

  private textUsageStepType(
    input: ProviderGatewayTextGenerateRequest
  ): "main_turn" | "tool_loop_followup" {
    return input.requestMetadata?.classification === "tool_loop_followup"
      ? "tool_loop_followup"
      : "main_turn";
  }

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
      throw new Error("Kimi provider client is not warmed.");
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
