import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { unlinkSync, writeFileSync } from "node:fs";
import { Inject, Injectable, Logger } from "@nestjs/common";
import type { ProviderGatewayConfig } from "@persai/config";
import type {
  ProviderGatewayImageEditRequest,
  ProviderGatewayImageEditResult,
  ProviderGatewayImageGenerateRequest,
  ProviderGatewayImageGenerateResult,
  ProviderGatewayVideoGenerateRequest,
  ProviderGatewayVideoGenerateResult,
  ProviderGatewaySpeechGenerateRequest,
  ProviderGatewaySpeechGenerateResult,
  ProviderGatewayToolCall,
  ProviderGatewayAudioTranscriptionResult,
  ProviderGatewayTextCompletedEvent,
  ProviderGatewayTextDeltaEvent,
  ProviderGatewayTextFailedEvent,
  ProviderGatewayTextGenerateRequest,
  ProviderGatewayTextGenerateResult,
  ProviderGatewayTextKeepaliveEvent,
  ProviderGatewayTextToolCallsEvent,
  ProviderGatewayTextStreamEvent,
  RuntimeBillingFacts,
  RuntimeUsageSnapshot
} from "@persai/runtime-contract";
import OpenAI from "openai";
import { toFile } from "openai/uploads";
import { PROVIDER_GATEWAY_CONFIG } from "../../../provider-gateway-config";
import type { ProviderWarmableClient } from "../provider-client.types";

const OPENAI_AUDIO_TRANSCRIPTION_MODEL = "gpt-4o-mini-transcribe";
const OPENAI_IMAGE_GENERATION_MODEL = "gpt-image-1";
const OPENAI_SPEECH_GENERATION_MODEL = "gpt-4o-mini-tts";
const OPENAI_VIDEO_GENERATION_MODEL = "sora-2";
const OPENAI_IMAGE_GENERATION_TIMEOUT_MS = 300_000;
const MAX_OPENAI_IMAGE_GENERATION_TIMEOUT_MS = 300_000;
const OPENAI_IMAGE_EDIT_TIMEOUT_MS = 420_000;
const MAX_OPENAI_IMAGE_EDIT_TIMEOUT_MS = 420_000;
const OPENAI_VIDEO_GENERATION_TIMEOUT_MS = 600_000;
const OPENAI_VIDEO_POLL_INTERVAL_MS = 2_000;
const OPENAI_CONTEXT_WINDOW_EXCEEDED_CODE = "provider_context_window_exceeded";
type OpenAIResponseCreateParams = Parameters<OpenAI["responses"]["create"]>[0];
type OpenAINonStreamingCreateParams = Exclude<OpenAIResponseCreateParams, { stream: true }>;
type OpenAIResponseInputParam = NonNullable<OpenAINonStreamingCreateParams["input"]>;
type OpenAIResponseToolsParam = NonNullable<OpenAINonStreamingCreateParams["tools"]>;
type OpenAIResponseToolChoice = OpenAIResponseCreateParams["tool_choice"];
type OpenAIImageEditParams = Parameters<OpenAI["images"]["edit"]>[0];
type OpenAIImageGenerateParams = Parameters<OpenAI["images"]["generate"]>[0];
type OpenAISpeechCreateParams = Parameters<OpenAI["audio"]["speech"]["create"]>[0];
type OpenAIImageGenerateResponse = {
  data?: Array<{
    b64_json?: string;
    revised_prompt?: string;
  }>;
  background?: "transparent" | "opaque";
  output_format?: "png" | "webp" | "jpeg";
  usage?: {
    input_tokens?: number | null;
    output_tokens?: number | null;
    total_tokens?: number | null;
  };
};
type OpenAIGeneratedImage = NonNullable<OpenAIImageGenerateResponse["data"]>[number];
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
      role: "user" | "assistant" | "developer";
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
  private readonly logger = new Logger(OpenAIProviderClient.name);
  private client: OpenAI | null = null;

  constructor(@Inject(PROVIDER_GATEWAY_CONFIG) private readonly config: ProviderGatewayConfig) {}

  isConfigured(): boolean {
    return typeof this.config.PROVIDER_GATEWAY_OPENAI_API_KEY === "string";
  }

  getCatalogModels(): string[] {
    return [...this.config.PROVIDER_GATEWAY_OPENAI_MODELS];
  }

  async warm(apiKeyOverride?: string): Promise<void> {
    const apiKey = apiKeyOverride ?? this.config.PROVIDER_GATEWAY_OPENAI_API_KEY;
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
      const textConfig = this.toOpenAITextConfig(input.outputSchema);
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
        payload.parallel_tool_calls = true;
      }
      if (toolChoice !== undefined) {
        payload.tool_choice = toolChoice;
      }
      if (textConfig !== undefined) {
        payload.text = textConfig;
      }
      const metadata = this.toOpenAIMetadata(input.requestMetadata);
      if (metadata !== undefined) {
        (
          payload as OpenAINonStreamingCreateParams & { metadata?: Record<string, string> }
        ).metadata = metadata;
      }
      this.applyOpenAIPromptCache(payload as Record<string, unknown>, input);
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
                  cachedInputTokens: response.usage.input_tokens_details?.cached_tokens ?? null,
                  outputTokens: response.usage.output_tokens ?? null,
                  totalTokens: response.usage.total_tokens ?? null
                },
          stopReason: "tool_calls",
          toolCalls
        };
      }

      const text = typeof response.output_text === "string" ? response.output_text.trim() : "";
      if (text.length === 0) {
        // ADR-074 F2: a "no text + no tool_calls" response is a legitimate outcome
        // of our proactive prompts ("Prefer silence over guessing") and of the
        // assistant-side scheduled-action check turn. Throwing 500 here cascaded
        // into Provider gateway request failed with status 500 → scheduler retried
        // 5× → task disabled with no signal. We treat empty completions as a
        // natural end-of-turn (text=null, stopReason=completed) and emit a single
        // structured warn so we can still spot model glitches (e.g. truncated
        // reasoning, refusals, content-filter blocks) in GKE.
        this.logger.warn({
          event: "openai_empty_completion",
          model: input.model,
          requestId: this.readMetadataRequestId(input),
          outputItemTypes: this.summarizeOutputItemTypes(response.output),
          outputItemCount: Array.isArray(response.output) ? response.output.length : 0,
          hasOutputText: typeof response.output_text === "string",
          finishReason: this.readNonStreamingFinishReason(response),
          inputTokens: response.usage?.input_tokens ?? null,
          outputTokens: response.usage?.output_tokens ?? null
        });
      }

      return {
        provider: "openai",
        model: input.model,
        text: text.length === 0 ? null : text,
        respondedAt: new Date().toISOString(),
        usage:
          response.usage === undefined
            ? null
            : {
                providerKey: "openai",
                modelKey: input.model,
                inputTokens: response.usage.input_tokens ?? null,
                cachedInputTokens: response.usage.input_tokens_details?.cached_tokens ?? null,
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
        respondedAt: new Date().toISOString(),
        billingFacts: this.buildAudioTranscriptionBillingFacts({
          model: OPENAI_AUDIO_TRANSCRIPTION_MODEL,
          buffer: input.buffer
        })
      };
    } finally {
      dispose();
    }
  }

  async generateImage(
    input: ProviderGatewayImageGenerateRequest,
    options?: { apiKey?: string }
  ): Promise<ProviderGatewayImageGenerateResult> {
    const client = this.getApiClient(options?.apiKey);
    const { signal, dispose } = this.createTimedSignal(
      this.resolveImageGenerationTimeoutMs(input.timeoutMs)
    );
    try {
      const model = input.model ?? OPENAI_IMAGE_GENERATION_MODEL;
      const payload: OpenAIImageGenerateParams = {
        model,
        prompt: input.prompt,
        n: input.count,
        output_format: "png",
        background: input.background,
        ...(input.size === null ? {} : { size: input.size })
      };
      const response = (await client.images.generate(payload, {
        signal
      })) as OpenAIImageGenerateResponse;
      const mimeType = this.resolveGeneratedImageMimeType(
        this.asObject(response)?.output_format ?? "png"
      );
      const images = (response.data ?? [])
        .map((entry: OpenAIGeneratedImage) => ({
          bytesBase64:
            typeof entry?.b64_json === "string" && entry.b64_json.trim().length > 0
              ? entry.b64_json
              : null,
          revisedPrompt:
            typeof entry?.revised_prompt === "string" && entry.revised_prompt.trim().length > 0
              ? entry.revised_prompt.trim()
              : null
        }))
        .filter(
          (entry): entry is { bytesBase64: string; revisedPrompt: string | null } =>
            entry.bytesBase64 !== null
        );
      if (images.length === 0) {
        throw new Error("OpenAI image generation did not return any image bytes.");
      }

      const usage = this.toImageUsageSnapshot(model, response.usage);
      return {
        provider: "openai",
        model,
        prompt: input.prompt,
        size: input.size,
        images: images.map((image) => ({
          bytesBase64: image.bytesBase64,
          mimeType,
          revisedPrompt: image.revisedPrompt
        })),
        respondedAt: new Date().toISOString(),
        usage,
        billingFacts: this.buildImageTokenBillingFacts({
          model,
          usage,
          dimensions: {
            operation: "generate",
            size: input.size,
            background: input.background
          }
        }),
        warning: null
      };
    } finally {
      dispose();
    }
  }

  async editImage(
    input: ProviderGatewayImageEditRequest,
    options?: { apiKey?: string }
  ): Promise<ProviderGatewayImageEditResult> {
    const client = this.getApiClient(options?.apiKey);
    const { signal, dispose } = this.createTimedSignal(
      this.resolveImageEditTimeoutMs(input.timeoutMs)
    );
    try {
      const model = input.model ?? OPENAI_IMAGE_GENERATION_MODEL;
      const providerPrompt = this.buildImageEditPrompt(input);
      const sourceImage = await toFile(
        Buffer.from(input.sourceImage.bytesBase64, "base64"),
        input.sourceImage.filename ?? this.defaultImageFilename(input.sourceImage.mimeType),
        input.sourceImage.mimeType.trim().length > 0
          ? { type: input.sourceImage.mimeType }
          : undefined
      );
      const referenceImage =
        input.referenceImage === null
          ? null
          : await toFile(
              Buffer.from(input.referenceImage.bytesBase64, "base64"),
              input.referenceImage.filename ??
                this.defaultImageFilename(input.referenceImage.mimeType),
              input.referenceImage.mimeType.trim().length > 0
                ? { type: input.referenceImage.mimeType }
                : undefined
            );
      const payload: OpenAIImageEditParams = {
        model,
        prompt: providerPrompt,
        image: referenceImage === null ? sourceImage : [sourceImage, referenceImage],
        output_format: "png",
        background: input.background,
        ...(input.size === null ? {} : { size: input.size })
      };
      const response = (await client.images.edit(payload, {
        signal
      })) as OpenAIImageGenerateResponse;
      const mimeType = this.resolveGeneratedImageMimeType(
        this.asObject(response)?.output_format ?? "png"
      );
      const images = (response.data ?? [])
        .map((entry: OpenAIGeneratedImage) => ({
          bytesBase64:
            typeof entry?.b64_json === "string" && entry.b64_json.trim().length > 0
              ? entry.b64_json
              : null,
          revisedPrompt:
            typeof entry?.revised_prompt === "string" && entry.revised_prompt.trim().length > 0
              ? entry.revised_prompt.trim()
              : null
        }))
        .filter(
          (entry): entry is { bytesBase64: string; revisedPrompt: string | null } =>
            entry.bytesBase64 !== null
        );
      if (images.length === 0) {
        throw new Error("OpenAI image edit did not return any image bytes.");
      }

      const usage = this.toImageUsageSnapshot(model, response.usage);
      return {
        provider: "openai",
        model,
        prompt: input.prompt,
        size: input.size,
        images: images.map((image) => ({
          bytesBase64: image.bytesBase64,
          mimeType,
          revisedPrompt: image.revisedPrompt
        })),
        respondedAt: new Date().toISOString(),
        usage,
        billingFacts: this.buildImageTokenBillingFacts({
          model,
          usage,
          dimensions: {
            operation: "edit",
            size: input.size,
            background: input.background
          }
        }),
        warning: null
      };
    } finally {
      dispose();
    }
  }

  private resolveImageGenerationTimeoutMs(timeoutMs: number | null | undefined): number {
    const configured =
      Number.isInteger(timeoutMs) && Number(timeoutMs) > 0
        ? Number(timeoutMs)
        : OPENAI_IMAGE_GENERATION_TIMEOUT_MS;
    return Math.min(
      Math.max(configured, this.config.PROVIDER_GATEWAY_REQUEST_TIMEOUT_MS),
      MAX_OPENAI_IMAGE_GENERATION_TIMEOUT_MS
    );
  }

  private resolveImageEditTimeoutMs(timeoutMs: number | null | undefined): number {
    const configured =
      Number.isInteger(timeoutMs) && Number(timeoutMs) > 0
        ? Number(timeoutMs)
        : OPENAI_IMAGE_EDIT_TIMEOUT_MS;
    return Math.min(
      Math.max(configured, this.config.PROVIDER_GATEWAY_REQUEST_TIMEOUT_MS),
      MAX_OPENAI_IMAGE_EDIT_TIMEOUT_MS
    );
  }

  async generateVideo(
    input: ProviderGatewayVideoGenerateRequest,
    options?: { apiKey?: string }
  ): Promise<ProviderGatewayVideoGenerateResult> {
    const apiKey = this.resolveApiKey(options?.apiKey);
    const { signal, dispose } = this.createTimedSignal(
      Math.max(this.config.PROVIDER_GATEWAY_REQUEST_TIMEOUT_MS, OPENAI_VIDEO_GENERATION_TIMEOUT_MS)
    );
    try {
      const createdJob = await this.createOpenAIVideoJob(input, apiKey, signal);
      const completedJob =
        createdJob.status === "completed"
          ? createdJob
          : createdJob.status === "queued" || createdJob.status === "in_progress"
            ? await this.pollOpenAIVideoJob(createdJob.id, apiKey, signal)
            : (() => {
                throw new Error(
                  `OpenAI video generation ended with status "${createdJob.status}".`
                );
              })();
      const video = await this.downloadOpenAIVideoContent(completedJob.id, apiKey, signal);

      return {
        provider: "openai",
        model: completedJob.model ?? input.model ?? OPENAI_VIDEO_GENERATION_MODEL,
        prompt: input.prompt,
        size: input.size,
        seconds: input.seconds,
        video,
        respondedAt: new Date().toISOString(),
        usage: null,
        billingFacts: this.buildVideoTimeBillingFacts({
          model: completedJob.model ?? input.model ?? OPENAI_VIDEO_GENERATION_MODEL,
          seconds: input.seconds
        }),
        warning: null
      };
    } catch (error) {
      if (this.isAbortError(error)) {
        throw new Error("OpenAI video generation timed out before the video was ready.");
      }
      throw error;
    } finally {
      dispose();
    }
  }

  async generateSpeech(
    input: ProviderGatewaySpeechGenerateRequest,
    options?: { apiKey?: string }
  ): Promise<ProviderGatewaySpeechGenerateResult> {
    const client = this.getApiClient(options?.apiKey);
    const { signal, dispose } = this.createTimedSignal(
      this.config.PROVIDER_GATEWAY_REQUEST_TIMEOUT_MS
    );
    const format = input.deliveryKind === "voice_note" ? "opus" : "mp3";
    try {
      const payload: OpenAISpeechCreateParams = {
        model: OPENAI_SPEECH_GENERATION_MODEL,
        voice: input.voiceProfile.openai.voice ?? "marin",
        input: input.text,
        response_format: format,
        instructions: this.buildSpeechInstructions(input)
      };
      const response = await client.audio.speech.create(payload, { signal });
      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.length === 0) {
        throw new Error("OpenAI speech generation returned an empty audio payload.");
      }

      return {
        provider: "openai",
        model: OPENAI_SPEECH_GENERATION_MODEL,
        deliveryKind: input.deliveryKind,
        bytesBase64: buffer.toString("base64"),
        mimeType: format === "opus" ? "audio/ogg" : "audio/mpeg",
        respondedAt: new Date().toISOString(),
        usage: null,
        billingFacts: this.buildSpeechBillingFacts({
          model: OPENAI_SPEECH_GENERATION_MODEL,
          text: input.text
        }),
        warning: null
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
    const {
      signal: timedSignal,
      reset,
      dispose
    } = this.createTimedSignal(this.config.PROVIDER_GATEWAY_STREAM_TIMEOUT_MS, signal);

    try {
      const toolChoice = this.toOpenAIToolChoice(input);
      const textConfig = this.toOpenAITextConfig(input.outputSchema);
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
        payload.parallel_tool_calls = true;
      }
      if (toolChoice !== undefined) {
        payload.tool_choice = toolChoice;
      }
      if (textConfig !== undefined) {
        payload.text = textConfig;
      }
      const metadata = this.toOpenAIMetadata(input.requestMetadata);
      if (metadata !== undefined) {
        payload.metadata = metadata;
      }
      this.applyOpenAIPromptCache(payload, input);
      this.logger.log(
        `[openai-stream-start] requestId=${input.requestMetadata?.runtimeRequestId ?? "unknown"} classification=${input.requestMetadata?.classification ?? "unknown"} iteration=${
          input.requestMetadata?.toolLoopIteration === null ||
          input.requestMetadata?.toolLoopIteration === undefined
            ? "null"
            : String(input.requestMetadata.toolLoopIteration)
        } model=${input.model} toolCount=${String(input.tools?.length ?? 0)} toolHistoryCount=${String(input.toolHistory?.length ?? 0)}`
      );
      const stream = (await this.client.responses.create(
        payload as unknown as OpenAIResponseCreateParams,
        {
          signal: timedSignal
        }
      )) as AsyncIterable<Record<string, unknown>>;
      this.logger.log(
        `[openai-stream-start] requestId=${input.requestMetadata?.runtimeRequestId ?? "unknown"} iteration=${
          input.requestMetadata?.toolLoopIteration === null ||
          input.requestMetadata?.toolLoopIteration === undefined
            ? "null"
            : String(input.requestMetadata.toolLoopIteration)
        } stream-created`
      );
      reset();

      for await (const rawEvent of stream) {
        reset();
        const event = this.asObject(rawEvent);
        if (event?.type === "keepalive") {
          const keepaliveEvent: ProviderGatewayTextKeepaliveEvent = {
            type: "keepalive"
          };
          yield keepaliveEvent;
          continue;
        }
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
            // ADR-074 F2: see generateText() — empty completion is a legit
            // outcome of our proactive prompts; we no longer fail the stream.
            this.logger.warn({
              event: "openai_empty_completion",
              transport: "stream",
              model: input.model,
              requestId: this.readMetadataRequestId(input),
              outputItemTypes: this.summarizeOutputItemTypes(response?.output),
              outputItemCount: Array.isArray(response?.output)
                ? (response.output as unknown[]).length
                : 0,
              hasOutputText: typeof response?.output_text === "string",
              accumulatedTextLength: accumulatedText.length,
              inputTokens:
                (response?.usage as OpenAI.Responses.ResponseUsage | undefined)?.input_tokens ??
                null,
              outputTokens:
                (response?.usage as OpenAI.Responses.ResponseUsage | undefined)?.output_tokens ??
                null
            });
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
          const message =
            typeof event.message === "string" ? event.message : "OpenAI provider stream failed.";
          const failedEvent: ProviderGatewayTextFailedEvent = {
            type: "failed",
            code: this.isContextWindowExceededMessage(message)
              ? OPENAI_CONTEXT_WINDOW_EXCEEDED_CODE
              : typeof event.code === "string"
                ? event.code
                : "provider_stream_error",
            message
          };
          yield failedEvent;
          return;
        }

        if (event?.type === "response.failed" || event?.type === "response.incomplete") {
          const response = this.asObject(event.response);
          const error = this.asObject(response?.error);
          const message =
            typeof error?.message === "string"
              ? error.message
              : "OpenAI provider stream did not complete successfully.";
          const failedEvent: ProviderGatewayTextFailedEvent = {
            type: "failed",
            code: this.isContextWindowExceededMessage(message)
              ? OPENAI_CONTEXT_WINDOW_EXCEEDED_CODE
              : "provider_stream_failed",
            message
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
      this.logger.warn(
        `[openai-stream-start] requestId=${input.requestMetadata?.runtimeRequestId ?? "unknown"} iteration=${
          input.requestMetadata?.toolLoopIteration === null ||
          input.requestMetadata?.toolLoopIteration === undefined
            ? "null"
            : String(input.requestMetadata.toolLoopIteration)
        } failed-before-event: ${error instanceof Error ? error.message : String(error)}`
      );
      if (this.isAbortError(error) || signal?.aborted) {
        return;
      }
      const failedEvent: ProviderGatewayTextFailedEvent = {
        type: "failed",
        code:
          error instanceof Error && this.isContextWindowExceededMessage(error.message)
            ? OPENAI_CONTEXT_WINDOW_EXCEEDED_CODE
            : "provider_stream_failed",
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
          cachedInputTokens: usage.input_tokens_details?.cached_tokens ?? null,
          outputTokens: usage.output_tokens ?? null,
          totalTokens: usage.total_tokens ?? null
        };
  }

  private toImageUsageSnapshot(
    model: string,
    usage:
      | {
          input_tokens?: number | null;
          output_tokens?: number | null;
          total_tokens?: number | null;
        }
      | undefined
  ): RuntimeUsageSnapshot | null {
    return usage === undefined
      ? null
      : {
          providerKey: "openai",
          modelKey: model,
          inputTokens: usage.input_tokens ?? null,
          cachedInputTokens: null,
          outputTokens: usage.output_tokens ?? null,
          totalTokens: usage.total_tokens ?? null
        };
  }

  private buildAudioTranscriptionBillingFacts(input: {
    model: string;
    buffer: Buffer;
  }): RuntimeBillingFacts | null {
    const durationMs = this.readAudioDurationMs(input.buffer);
    if (durationMs === null) {
      return null;
    }
    return {
      providerKey: "openai",
      modelKey: input.model,
      capability: "speech_to_text",
      occurredAt: new Date().toISOString(),
      metering: {
        meteringKind: "time_metered",
        durationMs,
        durationSeconds: Number((durationMs / 1000).toFixed(3))
      }
    };
  }

  private buildSpeechBillingFacts(input: { model: string; text: string }): RuntimeBillingFacts {
    return {
      providerKey: "openai",
      modelKey: input.model,
      capability: "text_to_speech",
      occurredAt: new Date().toISOString(),
      metering: {
        meteringKind: "text_chars_metered",
        textChars: input.text.length
      }
    };
  }

  private buildImageTokenBillingFacts(input: {
    model: string;
    usage: RuntimeUsageSnapshot | null;
    dimensions?: Record<string, string | number | boolean | null>;
  }): RuntimeBillingFacts | null {
    if (input.usage === null) {
      return null;
    }
    return {
      providerKey: "openai",
      modelKey: input.model,
      capability: "image",
      occurredAt: new Date().toISOString(),
      metering: {
        meteringKind: "token_metered",
        inputTokens: input.usage.inputTokens ?? null,
        cachedInputTokens: input.usage.cachedInputTokens ?? null,
        outputTokens: input.usage.outputTokens ?? null,
        totalTokens: input.usage.totalTokens ?? null,
        dimensions: input.dimensions ?? null
      }
    };
  }

  private buildVideoTimeBillingFacts(input: {
    model: string;
    seconds: string | number;
  }): RuntimeBillingFacts {
    const durationSeconds = Number(input.seconds);
    const safeDurationSeconds =
      Number.isFinite(durationSeconds) && durationSeconds > 0 ? durationSeconds : 0;
    const durationMs = Math.round(safeDurationSeconds * 1000);
    return {
      providerKey: "openai",
      modelKey: input.model,
      capability: "video",
      occurredAt: new Date().toISOString(),
      metering: {
        meteringKind: "time_metered",
        durationMs,
        durationSeconds: safeDurationSeconds
      }
    };
  }

  private readAudioDurationMs(buffer: Buffer): number | null {
    try {
      const probePath = join(tmpdir(), `persai-openai-audio-${Date.now()}-${Math.random()}.bin`);
      writeFileSync(probePath, buffer);
      try {
        const output = execFileSync(
          "ffprobe",
          [
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "default=noprint_wrappers=1:nokey=1",
            probePath
          ],
          {
            encoding: "utf8",
            timeout: 10_000
          }
        ).trim();
        const durationSeconds = Number(output);
        if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
          return null;
        }
        return Math.max(1, Math.round(durationSeconds * 1000));
      } finally {
        unlinkSync(probePath);
      }
    } catch {
      return null;
    }
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
    // ADR-074 P1: per-turn developer instructions live OUTSIDE the cached `instructions` prefix.
    // Appending them as the last input item (after history and any tool exchange) keeps the
    // common prompt prefix byte-stable across turns so OpenAI prompt caching can stay hot.
    const developerInstructions = this.normalizeOptionalText(input.developerInstructions);
    if (developerInstructions !== null) {
      items.push({
        role: "developer",
        content: [
          {
            type: "input_text",
            text: developerInstructions
          }
        ]
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

  private toOpenAITextConfig(
    outputSchema: ProviderGatewayTextGenerateRequest["outputSchema"]
  ): OpenAINonStreamingCreateParams["text"] | undefined {
    if (outputSchema === undefined) {
      return undefined;
    }

    const format: NonNullable<OpenAINonStreamingCreateParams["text"]>["format"] = {
      type: "json_schema",
      name: outputSchema.name,
      schema: outputSchema.schema,
      strict: outputSchema.strict ?? true
    };
    if (outputSchema.description !== undefined) {
      format.description = outputSchema.description;
    }

    return {
      format
    };
  }

  private applyOpenAIPromptCache(
    payload: Record<string, unknown>,
    input: ProviderGatewayTextGenerateRequest
  ): void {
    const promptCache = input.promptCache;
    if (promptCache?.key !== undefined) {
      payload.prompt_cache_key = promptCache.key;
    }
    if (promptCache?.retention !== undefined) {
      payload.prompt_cache_retention = promptCache.retention;
    }
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

  // ADR-074 F2: diagnostics for "openai_empty_completion" warns. We don't
  // want a JSON.stringify of the entire response (PII + token bloat), just
  // the SHAPE — which item types showed up, were they reasoning-only, etc.
  private summarizeOutputItemTypes(output: unknown): string[] {
    if (!Array.isArray(output)) {
      return [];
    }
    const seen = new Set<string>();
    for (const item of output) {
      if (item !== null && typeof item === "object") {
        const candidate = (item as { type?: unknown }).type;
        seen.add(typeof candidate === "string" ? candidate : "unknown");
      } else {
        seen.add("non_object");
      }
    }
    return Array.from(seen).sort();
  }

  private readNonStreamingFinishReason(response: unknown): string | null {
    if (response === null || typeof response !== "object") {
      return null;
    }
    const candidate = (response as { incomplete_details?: { reason?: unknown } }).incomplete_details
      ?.reason;
    if (typeof candidate === "string") {
      return candidate;
    }
    const status = (response as { status?: unknown }).status;
    return typeof status === "string" ? status : null;
  }

  private readMetadataRequestId(input: ProviderGatewayTextGenerateRequest): string | null {
    return input.requestMetadata?.runtimeRequestId ?? null;
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

  private isContextWindowExceededMessage(message: string): boolean {
    const normalized = message.toLowerCase();
    return (
      normalized.includes("exceeds the context window") ||
      normalized.includes("context window") ||
      normalized.includes("maximum context length") ||
      normalized.includes("too many tokens")
    );
  }

  private resolveApiKey(apiKey?: string): string {
    if (typeof apiKey === "string" && apiKey.trim().length > 0) {
      return apiKey.trim();
    }
    const configuredApiKey = this.config.PROVIDER_GATEWAY_OPENAI_API_KEY?.trim();
    if (configuredApiKey && configuredApiKey.length > 0) {
      return configuredApiKey;
    }
    throw new Error("OpenAI provider client is not warmed.");
  }

  private getApiClient(apiKey?: string): OpenAI {
    if (typeof apiKey === "string" && apiKey.trim().length > 0) {
      return new OpenAI({ apiKey: apiKey.trim() });
    }
    if (this.client === null) {
      throw new Error("OpenAI provider client is not warmed.");
    }
    return this.client;
  }

  private buildSpeechInstructions(input: ProviderGatewaySpeechGenerateRequest): string {
    const traits = input.traits ?? {};
    const instructions = [
      `Speak naturally in ${input.locale}.`,
      this.describeTone(input.toneTag),
      this.describeGender(input.assistantGender),
      this.describeFormality(traits.formality),
      this.describeWarmth(traits.warmth),
      this.describePlayfulness(traits.playfulness)
    ].filter((entry): entry is string => entry !== null);
    return instructions.join(" ");
  }

  private describeTone(toneTag: ProviderGatewaySpeechGenerateRequest["toneTag"]): string {
    switch (toneTag) {
      case "warm":
        return "Keep the delivery warm, close, and human.";
      case "gentle":
        return "Keep the delivery soft, gentle, and reassuring.";
      case "calm":
        return "Keep the delivery calm, steady, and grounded.";
      case "cheerful":
        return "Keep the delivery bright, upbeat, and lively.";
      case "playful":
        return "Keep the delivery playful, lightly expressive, and energetic.";
      case "confident":
        return "Keep the delivery clear, assured, and confident.";
      case "neutral":
      default:
        return "Keep the delivery natural and balanced.";
    }
  }

  private describeGender(assistantGender: string | null): string | null {
    switch (assistantGender) {
      case "female":
        return "Use a feminine vocal character.";
      case "male":
        return "Use a masculine vocal character.";
      case "neutral":
        return "Use a neutral vocal character.";
      default:
        return null;
    }
  }

  private describeFormality(value: unknown): string | null {
    if (typeof value !== "number") {
      return null;
    }
    if (value >= 70) {
      return "Keep the style polished and composed.";
    }
    if (value <= 30) {
      return "Keep the style conversational and relaxed.";
    }
    return null;
  }

  private describeWarmth(value: unknown): string | null {
    if (typeof value !== "number") {
      return null;
    }
    if (value >= 70) {
      return "Sound caring, kind, and emotionally present.";
    }
    if (value <= 30) {
      return "Stay measured and emotionally restrained.";
    }
    return null;
  }

  private describePlayfulness(value: unknown): string | null {
    if (typeof value !== "number") {
      return null;
    }
    if (value >= 70) {
      return "Allow a touch of playful energy when it feels natural.";
    }
    if (value <= 30) {
      return "Avoid sounding playful or joking.";
    }
    return null;
  }

  private resolveGeneratedImageMimeType(outputFormat: unknown): string {
    switch (outputFormat) {
      case "jpeg":
        return "image/jpeg";
      case "webp":
        return "image/webp";
      case "png":
      default:
        return "image/png";
    }
  }

  private buildImageEditPrompt(input: ProviderGatewayImageEditRequest): string {
    const prompt = input.prompt.trim();
    if (input.referenceImage === null) {
      return prompt;
    }
    const sourceFilename = input.sourceImage.filename ?? "image #1";
    const referenceFilename = input.referenceImage.filename ?? "image #2";
    return [
      "Edit only the first/source image and return one edited version of that source image.",
      "Use the second/reference image only as visual guidance for style, appearance, makeup, color palette, lighting, environment, or similar attributes unless the user explicitly asks to borrow a concrete object from it.",
      "Do not separately edit, restyle, or reproduce the reference image as its own output.",
      "Preserve the identity, pose, framing, and main content of the source image unless the user explicitly asks to change them.",
      `Source image: ${sourceFilename}.`,
      `Reference image: ${referenceFilename}.`,
      `User request: ${prompt}`
    ].join(" ");
  }

  private defaultImageFilename(mimeType: string): string {
    switch (mimeType) {
      case "image/jpeg":
      case "image/jpg":
        return "image.jpg";
      case "image/webp":
        return "image.webp";
      case "image/png":
      default:
        return "image.png";
    }
  }

  private async createOpenAIVideoJob(
    input: ProviderGatewayVideoGenerateRequest,
    apiKey: string,
    signal: AbortSignal
  ): Promise<{ id: string; status: string; model: string | null }> {
    const formData = new FormData();
    formData.append("model", input.model ?? OPENAI_VIDEO_GENERATION_MODEL);
    formData.append("prompt", input.prompt);
    formData.append("seconds", String(input.seconds));
    if (input.size !== null) {
      formData.append("size", input.size);
    }
    if (input.referenceImage !== null) {
      const normalizedReferenceImage = await this.normalizeOpenAIVideoReferenceImage(
        input.referenceImage,
        input.size
      );
      const filename =
        normalizedReferenceImage.filename ??
        this.defaultImageFilename(normalizedReferenceImage.mimeType);
      formData.append(
        "input_reference",
        new Blob([Uint8Array.from(normalizedReferenceImage.buffer)], {
          type: normalizedReferenceImage.mimeType
        }),
        filename
      );
    }

    const response = await fetch("https://api.openai.com/v1/videos", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`
      },
      body: formData,
      signal
    });
    const body = await this.readJsonBody(response);
    if (!response.ok) {
      throw new Error(this.readOpenAIVideoErrorMessage(body, response.status));
    }
    return this.parseOpenAIVideoJob(body);
  }

  private async normalizeOpenAIVideoReferenceImage(
    referenceImage: NonNullable<ProviderGatewayVideoGenerateRequest["referenceImage"]>,
    size: ProviderGatewayVideoGenerateRequest["size"]
  ): Promise<{
    buffer: Buffer;
    mimeType: string;
    filename: string | null;
  }> {
    const buffer = Buffer.from(referenceImage.bytesBase64, "base64");
    if (buffer.length === 0 || size === null) {
      return {
        buffer,
        mimeType: referenceImage.mimeType,
        filename: referenceImage.filename
      };
    }

    const dimensions = this.parseOpenAIVideoSize(size);
    if (dimensions === null) {
      return {
        buffer,
        mimeType: referenceImage.mimeType,
        filename: referenceImage.filename
      };
    }

    const sharp = (await import("sharp")).default;
    const source = sharp(buffer, { failOn: "none" }).rotate();
    const background = await source
      .clone()
      .resize(dimensions.width, dimensions.height, {
        fit: "cover"
      })
      .blur(16)
      .png()
      .toBuffer();
    const foreground = await source
      .clone()
      .resize(dimensions.width, dimensions.height, {
        fit: "contain",
        background: { r: 0, g: 0, b: 0, alpha: 0 }
      })
      .png()
      .toBuffer();
    const normalizedBuffer = await sharp(background)
      .composite([{ input: foreground }])
      .png()
      .toBuffer();

    return {
      buffer: normalizedBuffer,
      mimeType: "image/png",
      filename: this.replaceImageFilenameExtension(referenceImage.filename, "png")
    };
  }

  private parseOpenAIVideoSize(size: string): { width: number; height: number } | null {
    const match = /^(\d+)x(\d+)$/.exec(size.trim());
    if (match === null) {
      return null;
    }
    const width = Number(match[1]);
    const height = Number(match[2]);
    if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0) {
      return null;
    }
    return { width, height };
  }

  private replaceImageFilenameExtension(filename: string | null, extension: string): string | null {
    if (filename === null) {
      return null;
    }
    const trimmed = filename.trim();
    if (trimmed.length === 0) {
      return null;
    }
    return `${trimmed.replace(/\.[A-Za-z0-9]+$/u, "")}.${extension}`;
  }

  private async pollOpenAIVideoJob(
    videoId: string,
    apiKey: string,
    signal: AbortSignal
  ): Promise<{ id: string; status: string; model: string | null }> {
    let completedJob: { id: string; status: string; model: string | null } | null = null;
    while (completedJob === null) {
      await this.delay(OPENAI_VIDEO_POLL_INTERVAL_MS, signal);
      const response = await fetch(`https://api.openai.com/v1/videos/${videoId}`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${apiKey}`
        },
        signal
      });
      const body = await this.readJsonBody(response);
      if (!response.ok) {
        if (this.isTransientOpenAIVideoPollStatus(response.status)) {
          continue;
        }
        throw new Error(this.readOpenAIVideoErrorMessage(body, response.status));
      }
      const job = this.parseOpenAIVideoJob(body);
      if (job.status === "queued" || job.status === "in_progress") {
        continue;
      }
      if (job.status !== "completed") {
        throw new Error(this.readOpenAIVideoTerminalStatusMessage(body, job.status));
      }
      completedJob = job;
    }
    return completedJob;
  }

  private isTransientOpenAIVideoPollStatus(status: number): boolean {
    return status === 408 || status === 429 || status >= 500;
  }

  private async downloadOpenAIVideoContent(
    videoId: string,
    apiKey: string,
    signal: AbortSignal
  ): Promise<ProviderGatewayVideoGenerateResult["video"]> {
    const response = await fetch(`https://api.openai.com/v1/videos/${videoId}/content`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`
      },
      signal
    });
    if (!response.ok) {
      const body = await this.readJsonBody(response);
      throw new Error(this.readOpenAIVideoErrorMessage(body, response.status));
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length === 0) {
      throw new Error("OpenAI video generation returned an empty video payload.");
    }
    const mimeTypeHeader = response.headers.get("content-type");
    const mimeType =
      typeof mimeTypeHeader === "string" && mimeTypeHeader.trim().length > 0
        ? mimeTypeHeader.split(";")[0]!.trim()
        : "video/mp4";
    return {
      bytesBase64: buffer.toString("base64"),
      mimeType
    };
  }

  private parseOpenAIVideoJob(body: unknown): { id: string; status: string; model: string | null } {
    const row = this.asObject(body);
    const id = typeof row?.id === "string" ? row.id.trim() : "";
    const status = typeof row?.status === "string" ? row.status.trim() : "";
    const model =
      typeof row?.model === "string" && row.model.trim().length > 0 ? row.model.trim() : null;
    if (id.length === 0 || status.length === 0) {
      throw new Error("OpenAI video generation returned an invalid job response.");
    }
    return { id, status, model };
  }

  private readOpenAIVideoErrorMessage(body: unknown, status: number): string {
    const row = this.asObject(body);
    const error = this.asObject(row?.error);
    const message =
      typeof error?.message === "string" && error.message.trim().length > 0
        ? error.message.trim()
        : typeof row?.message === "string" && row.message.trim().length > 0
          ? row.message.trim()
          : null;
    return message ?? `OpenAI video generation request failed with status ${String(status)}.`;
  }

  private readOpenAIVideoTerminalStatusMessage(body: unknown, status: string): string {
    const row = this.asObject(body);
    const error = this.asObject(row?.error);
    const errorMessage =
      typeof error?.message === "string" && error.message.trim().length > 0
        ? error.message.trim()
        : typeof row?.failure_reason === "string" && row.failure_reason.trim().length > 0
          ? row.failure_reason.trim()
          : null;
    return errorMessage ?? `OpenAI video generation ended with status "${status}".`;
  }

  private async readJsonBody(response: Response): Promise<unknown> {
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("application/json")) {
      return null;
    }
    try {
      return await response.json();
    } catch {
      return null;
    }
  }

  private async delay(ms: number, signal: AbortSignal): Promise<void> {
    if (ms <= 0) {
      return;
    }
    if (signal.aborted) {
      throw new DOMException("The operation was aborted.", "AbortError");
    }
    await new Promise<void>((resolve, reject) => {
      const timeoutId = setTimeout(resolve, ms);
      signal.addEventListener(
        "abort",
        () => {
          clearTimeout(timeoutId);
          reject(new DOMException("The operation was aborted.", "AbortError"));
        },
        { once: true }
      );
    });
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
  ): { signal: AbortSignal; reset: () => void; dispose: () => void } {
    const controller = new AbortController();
    let timeoutId: NodeJS.Timeout | null = null;
    const scheduleAbort = () => {
      if (timeoutId !== null) {
        clearTimeout(timeoutId);
      }
      timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    };
    scheduleAbort();
    if (externalSignal) {
      if (externalSignal.aborted) {
        controller.abort();
      } else {
        externalSignal.addEventListener("abort", () => controller.abort(), { once: true });
      }
    }
    return {
      signal: controller.signal,
      reset: () => {
        if (!controller.signal.aborted) {
          scheduleAbort();
        }
      },
      dispose: () => {
        if (timeoutId !== null) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }
      }
    };
  }

  private isAbortError(error: unknown): boolean {
    return error instanceof Error && error.name === "AbortError";
  }
}
