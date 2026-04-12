import { Inject, Injectable } from "@nestjs/common";
import type { ProviderGatewayConfig } from "@persai/config";
import type {
  ProviderGatewayToolCall,
  ProviderGatewayAudioTranscriptionResult,
  ProviderGatewayTextCompletedEvent,
  ProviderGatewayTextDeltaEvent,
  ProviderGatewayTextFailedEvent,
  ProviderGatewayTextGenerateRequest,
  ProviderGatewayTextGenerateResult,
  ProviderGatewayTextToolCallsEvent,
  ProviderGatewayTextStreamEvent,
  RuntimeUsageSnapshot
} from "@persai/runtime-contract";
import OpenAI from "openai";
import { toFile } from "openai/uploads";
import { PROVIDER_GATEWAY_CONFIG } from "../../../provider-gateway-config";
import type { ProviderWarmableClient } from "../provider-client.types";

const OPENAI_AUDIO_TRANSCRIPTION_MODEL = "gpt-4o-mini-transcribe";
type OpenAIResponseCreateParams = Parameters<OpenAI["responses"]["create"]>[0];
type OpenAINonStreamingCreateParams = Exclude<OpenAIResponseCreateParams, { stream: true }>;
type OpenAIResponseInputParam = NonNullable<OpenAINonStreamingCreateParams["input"]>;
type OpenAIResponseToolsParam = NonNullable<OpenAINonStreamingCreateParams["tools"]>;
type OpenAIResponseToolChoice = OpenAIResponseCreateParams["tool_choice"];
type OpenAINonStreamingResponse = Extract<
  Awaited<ReturnType<OpenAI["responses"]["create"]>>,
  { output: unknown }
>;
type OpenAIInputContent =
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
    >;
type OpenAIBuiltInputItem =
  | {
      role: "user" | "assistant";
      content: OpenAIInputContent;
    }
  | {
      type: "function_call";
      call_id: string;
      name: string;
      arguments: string;
    }
  | {
      type: "function_call_output";
      call_id: string;
      output: string;
    };
type OpenAIBuiltTool = {
  type: "function";
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  strict: false;
};

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
      const toolChoice = this.toOpenAIToolChoice(input);
      const payload: OpenAINonStreamingCreateParams = {
        model: input.model,
        input: this.buildOpenAIInputItems(input) as OpenAIResponseInputParam
      };
      if (input.systemPrompt !== null) {
        payload.instructions = input.systemPrompt;
      }
      if (input.maxOutputTokens !== undefined) {
        payload.max_output_tokens = input.maxOutputTokens;
      }
      if ((input.tools?.length ?? 0) > 0) {
        payload.tools = this.toOpenAITools(input) as OpenAIResponseToolsParam;
      }
      if (toolChoice !== undefined) {
        payload.tool_choice = toolChoice;
      }
      const metadata = this.toOpenAIMetadata(input.requestMetadata);
      if (metadata !== undefined) {
        (
          payload as OpenAINonStreamingCreateParams & { metadata?: Record<string, string> }
        ).metadata = metadata;
      }
      const response = (await this.client.responses.create(payload, {
        signal
      })) as OpenAINonStreamingResponse;
      const toolCalls = this.parseOpenAIToolCalls(response.output);
      if (toolCalls.length > 0) {
        return {
          provider: "openai",
          model: input.model,
          text: this.normalizeOptionalText(response.output_text),
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
                },
          stopReason: "tool_calls",
          toolCalls
        };
      }

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
              },
        stopReason: "completed",
        toolCalls: []
      };
    } finally {
      dispose();
    }
  }

  async transcribeAudio(input: {
    buffer: Buffer;
    mimeType: string;
    filename: string | null;
  }): Promise<ProviderGatewayAudioTranscriptionResult> {
    if (this.client === null) {
      throw new Error("OpenAI provider client is not warmed.");
    }

    const { signal, dispose } = this.createTimedSignal(
      this.config.PROVIDER_GATEWAY_REQUEST_TIMEOUT_MS
    );
    try {
      const response = await this.client.audio.transcriptions.create(
        {
          model: OPENAI_AUDIO_TRANSCRIPTION_MODEL,
          file: await toFile(
            input.buffer,
            input.filename ?? this.defaultAudioFilename(input.mimeType),
            input.mimeType.trim().length > 0 ? { type: input.mimeType } : undefined
          )
        },
        { signal }
      );

      const text = typeof response.text === "string" ? response.text.trim() : "";
      if (!text) {
        throw new Error("OpenAI provider transcription did not contain text output.");
      }

      return {
        provider: "openai",
        model: OPENAI_AUDIO_TRANSCRIPTION_MODEL,
        text,
        respondedAt: new Date().toISOString()
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
    const streamedToolCalls = new Map<
      string,
      {
        id: string;
        name: string | null;
        argumentsText: string;
      }
    >();
    const { signal: timedSignal, dispose } = this.createTimedSignal(
      this.config.PROVIDER_GATEWAY_STREAM_TIMEOUT_MS,
      signal
    );

    try {
      const toolChoice = this.toOpenAIToolChoice(input);
      const payload: Record<string, unknown> = {
        model: input.model,
        input: this.buildOpenAIInputItems(input) as OpenAIResponseInputParam,
        stream: true
      };
      if (input.systemPrompt !== null) {
        payload.instructions = input.systemPrompt;
      }
      if (input.maxOutputTokens !== undefined) {
        payload.max_output_tokens = input.maxOutputTokens;
      }
      if ((input.tools?.length ?? 0) > 0) {
        payload.tools = this.toOpenAITools(input) as OpenAIResponseToolsParam;
      }
      if (toolChoice !== undefined) {
        payload.tool_choice = toolChoice;
      }
      const metadata = this.toOpenAIMetadata(input.requestMetadata);
      if (metadata !== undefined) {
        payload.metadata = metadata;
      }
      const stream = (await this.client.responses.create(
        payload as unknown as OpenAIResponseCreateParams,
        {
          signal: timedSignal
        }
      )) as AsyncIterable<Record<string, unknown>>;

      for await (const rawEvent of stream) {
        const event = this.asObject(rawEvent);
        if (
          event?.type === "response.output_text.delta" &&
          typeof event.delta === "string" &&
          event.delta.length > 0
        ) {
          accumulatedText += event.delta;
          const deltaEvent: ProviderGatewayTextDeltaEvent = {
            type: "text_delta",
            delta: event.delta,
            accumulatedText
          };
          yield deltaEvent;
          continue;
        }

        const streamedToolCall = this.readOpenAIStreamToolCall(event);
        if (streamedToolCall !== null) {
          streamedToolCalls.set(streamedToolCall.id, streamedToolCall);
          continue;
        }

        if (event?.type === "response.completed") {
          const response = this.asObject(event.response);
          const toolCalls =
            streamedToolCalls.size > 0
              ? this.finalizeOpenAIStreamToolCalls(streamedToolCalls)
              : this.parseOpenAIToolCalls(response?.output);
          if (toolCalls.length > 0) {
            const toolCallsEvent: ProviderGatewayTextToolCallsEvent = {
              type: "tool_calls",
              result: {
                provider: "openai",
                model: input.model,
                text:
                  this.normalizeOptionalText(response?.output_text) ??
                  this.normalizeOptionalText(accumulatedText),
                respondedAt: new Date().toISOString(),
                usage: this.toUsageSnapshot(
                  input.model,
                  response?.usage as OpenAI.Responses.ResponseUsage | undefined
                ),
                stopReason: "tool_calls",
                toolCalls
              }
            };
            yield toolCallsEvent;
            return;
          }

          const text =
            this.normalizeOptionalText(response?.output_text) ??
            this.normalizeOptionalText(accumulatedText);
          if (text === null) {
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
              usage: this.toUsageSnapshot(
                input.model,
                response?.usage as OpenAI.Responses.ResponseUsage | undefined
              ),
              stopReason: "completed",
              toolCalls: []
            }
          };
          yield completedEvent;
          return;
        }

        if (event?.type === "error") {
          const failedEvent: ProviderGatewayTextFailedEvent = {
            type: "failed",
            code: typeof event.code === "string" ? event.code : "provider_stream_error",
            message:
              typeof event.message === "string" ? event.message : "OpenAI provider stream failed."
          };
          yield failedEvent;
          return;
        }

        if (event?.type === "response.failed" || event?.type === "response.incomplete") {
          const response = this.asObject(event.response);
          const error = this.asObject(response?.error);
          const failedEvent: ProviderGatewayTextFailedEvent = {
            type: "failed",
            code: "provider_stream_failed",
            message:
              typeof error?.message === "string"
                ? error.message
                : "OpenAI provider stream did not complete successfully."
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

  private buildOpenAIInputItems(input: ProviderGatewayTextGenerateRequest): OpenAIBuiltInputItem[] {
    const items: OpenAIBuiltInputItem[] = input.messages.map((message) => ({
      role: message.role,
      content: this.toOpenAIMessageContent(message.content)
    }));
    for (const exchange of input.toolHistory ?? []) {
      items.push({
        type: "function_call",
        call_id: exchange.toolCall.id,
        name: exchange.toolCall.name,
        arguments: JSON.stringify(exchange.toolCall.arguments)
      });
      items.push({
        type: "function_call_output",
        call_id: exchange.toolCall.id,
        output: exchange.toolResult.content
      });
    }
    return items;
  }

  private toOpenAITools(input: ProviderGatewayTextGenerateRequest): OpenAIBuiltTool[] {
    return (input.tools ?? []).map((tool) => ({
      type: "function",
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema,
      strict: false
    }));
  }

  private toOpenAIToolChoice(
    input: ProviderGatewayTextGenerateRequest
  ): OpenAIResponseToolChoice | undefined {
    if (input.toolChoice === undefined || input.toolChoice === "none") {
      return undefined;
    }
    if (input.toolChoice === "auto") {
      return "auto";
    }
    return {
      type: "function",
      name: input.toolChoice.name
    };
  }

  private toOpenAIMetadata(
    metadata: ProviderGatewayTextGenerateRequest["requestMetadata"]
  ): Record<string, string> | undefined {
    if (metadata === undefined) {
      return undefined;
    }

    return {
      persai_request_classification: metadata.classification,
      persai_runtime_request_id: metadata.runtimeRequestId ?? "",
      persai_runtime_session_id: metadata.runtimeSessionId ?? "",
      persai_tool_loop_iteration:
        metadata.toolLoopIteration === null ? "" : String(metadata.toolLoopIteration),
      persai_compaction_tool_code: metadata.compactionToolCode ?? ""
    };
  }

  private parseOpenAIToolCalls(output: unknown): ProviderGatewayToolCall[] {
    if (!Array.isArray(output)) {
      return [];
    }
    return output
      .filter((item) => this.isOpenAIFunctionCallItem(item))
      .map((item) => ({
        id: item.call_id,
        name: item.name,
        arguments: this.parseOpenAIToolArguments(item.arguments, item.name)
      }));
  }

  private isOpenAIFunctionCallItem(
    value: unknown
  ): value is { type: "function_call"; call_id: string; name: string; arguments: string } {
    return (
      value !== null &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      (value as { type?: unknown }).type === "function_call" &&
      typeof (value as { call_id?: unknown }).call_id === "string" &&
      typeof (value as { name?: unknown }).name === "string" &&
      typeof (value as { arguments?: unknown }).arguments === "string"
    );
  }

  private parseOpenAIToolArguments(
    rawArguments: string,
    toolName: string
  ): Record<string, unknown> {
    if (rawArguments.trim().length === 0) {
      return {};
    }
    try {
      const parsed = JSON.parse(rawArguments);
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error();
      }
      return parsed as Record<string, unknown>;
    } catch {
      throw new Error(`OpenAI tool call "${toolName}" returned invalid JSON arguments.`);
    }
  }

  private normalizeOptionalText(value: unknown): string | null {
    return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
  }

  private readOpenAIStreamToolCall(event: unknown): {
    id: string;
    name: string | null;
    argumentsText: string;
  } | null {
    const row = this.asObject(event);
    if (row?.type === "response.output_item.done") {
      const item = this.asObject(row.item);
      if (
        item?.type === "function_call" &&
        typeof item.call_id === "string" &&
        typeof item.name === "string" &&
        typeof item.arguments === "string"
      ) {
        return {
          id: item.call_id,
          name: item.name,
          argumentsText: item.arguments
        };
      }
    }

    if (row?.type === "response.function_call_arguments.done") {
      const callId = typeof row.call_id === "string" ? row.call_id : null;
      const argumentsText = typeof row.arguments === "string" ? row.arguments : null;
      if (callId !== null && argumentsText !== null) {
        return {
          id: callId,
          name: typeof row.name === "string" ? row.name : null,
          argumentsText
        };
      }
    }

    return null;
  }

  private finalizeOpenAIStreamToolCalls(
    streamedToolCalls: Map<
      string,
      {
        id: string;
        name: string | null;
        argumentsText: string;
      }
    >
  ): ProviderGatewayToolCall[] {
    const toolCalls: ProviderGatewayToolCall[] = [];
    for (const streamedToolCall of streamedToolCalls.values()) {
      if (streamedToolCall.name === null) {
        throw new Error(
          `OpenAI provider stream returned a tool call without a tool name for "${streamedToolCall.id}".`
        );
      }
      toolCalls.push({
        id: streamedToolCall.id,
        name: streamedToolCall.name,
        arguments: this.parseOpenAIToolArguments(
          streamedToolCall.argumentsText,
          streamedToolCall.name
        )
      });
    }
    return toolCalls;
  }

  private asObject(value: unknown): Record<string, unknown> | null {
    return value !== null && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  }

  private defaultAudioFilename(mimeType: string): string {
    switch (mimeType) {
      case "audio/mpeg":
      case "audio/mp3":
        return "audio.mp3";
      case "audio/wav":
        return "audio.wav";
      case "audio/mp4":
      case "audio/aac":
        return "audio.m4a";
      case "audio/ogg":
      case "audio/opus":
      case "audio/x-opus+ogg":
        return "audio.ogg";
      case "audio/flac":
        return "audio.flac";
      case "audio/webm":
      default:
        return "audio.webm";
    }
  }

  private toOpenAIMessageContent(
    content: ProviderGatewayTextGenerateRequest["messages"][number]["content"]
  ): OpenAIInputContent {
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
