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
    if (
      (input.tools?.length ?? 0) > 0 ||
      input.toolChoice !== undefined ||
      (input.toolHistory?.length ?? 0) > 0
    ) {
      throw new Error("Tool-capable OpenAI streaming is not implemented.");
    }
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
          input: this.buildOpenAIInputItems(input) as OpenAIResponseInputParam,
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
              usage: this.toUsageSnapshot(input.model, event.response.usage),
              stopReason: "completed",
              toolCalls: []
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
