import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { unlinkSync, writeFileSync } from "node:fs";
import { BadRequestException, Inject, Injectable, Logger } from "@nestjs/common";
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
import { normalizeProviderTextGenerationUsageV2 } from "@persai/runtime-contract";
import {
  ANTI_COLLAGE_RULE,
  STANDALONE_IMAGE_RULE,
  referenceGuidanceRule
} from "@persai/runtime-contract";
import OpenAI from "openai";
import { toFile } from "openai/uploads";
import { PROVIDER_GATEWAY_CONFIG } from "../../../provider-gateway-config";
import type { ProviderWarmableClient } from "../provider-client.types";
import { PersaiInternalApiClientService } from "../persai-internal-api.client.service";
import { URL } from "node:url";
import {
  PROVIDER_DEBUG_LOGGER_NAME,
  ProviderDebugPayloadLogger
} from "../provider-debug-payload-logger";
import { toProviderTextFailedEvent, toProviderTextHttpException } from "../provider-text-error";
import { logProviderCacheZoneTelemetry } from "../provider-cache-zone-observability";

const OPENAI_AUDIO_TRANSCRIPTION_MODEL = "gpt-4o-mini-transcribe";
const OPENAI_IMAGE_GENERATION_MODEL = "gpt-image-1";
const OPENAI_SPEECH_GENERATION_MODEL = "gpt-4o-mini-tts";
const OPENAI_SPEECH_GENERATION_MODELS = new Set([
  OPENAI_SPEECH_GENERATION_MODEL,
  "gpt-4o-tts",
  "tts-1",
  "tts-1-hd"
]);
const OPENAI_VIDEO_GENERATION_MODEL = "sora-2";
const OPENAI_IMAGE_GENERATION_TIMEOUT_MS = 300_000;
const MAX_OPENAI_IMAGE_GENERATION_TIMEOUT_MS = 300_000;
const OPENAI_IMAGE_EDIT_TIMEOUT_MS = 420_000;
const MAX_OPENAI_IMAGE_EDIT_TIMEOUT_MS = 420_000;
const OPENAI_VIDEO_GENERATION_TIMEOUT_MS = 600_000;
const OPENAI_VIDEO_POLL_INTERVAL_MS = 2_000;
const OPENAI_MAX_TRANSIENT_VIDEO_POLL_FETCH_FAILURES = 3;
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
          prompt_cache_breakpoint?: { mode: "explicit" };
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

type OpenAIAcceptedVideoTask = {
  videoId: string;
  model: string;
  acceptedAt: string;
};

type OpenAIImageTransportFailure = {
  class: "network" | "timeout" | "rate_limit" | "server_error" | "account_unavailable" | "unknown";
  status: number | null;
  code: string | null;
  type: string | null;
  message: string | null;
  requestId: string | null;
};

@Injectable()
export class OpenAIProviderClient implements ProviderWarmableClient {
  readonly provider = "openai" as const;
  readonly catalogSource = "bootstrap_config" as const;
  private readonly logger = new Logger(OpenAIProviderClient.name);
  private readonly debugPayloadLogger = new ProviderDebugPayloadLogger(PROVIDER_DEBUG_LOGGER_NAME);
  private client: OpenAI | null = null;

  constructor(
    @Inject(PROVIDER_GATEWAY_CONFIG) private readonly config: ProviderGatewayConfig,
    private readonly persaiInternalApiClientService?: PersaiInternalApiClientService
  ) {}

  isConfigured(): boolean {
    return false;
  }

  getCatalogModels(): string[] {
    return [...this.config.PROVIDER_GATEWAY_OPENAI_MODELS];
  }

  async warm(apiKeyOverride?: string): Promise<void> {
    const apiKey = apiKeyOverride?.trim() ?? "";
    if (apiKey.length === 0) {
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

    // ADR-097 Slice 3: honour per-request timeoutMsHint when larger than the config default.
    // Gateway enforces a hard cap of 600_000ms regardless of the caller's hint.
    const OPENAI_TEXT_GENERATION_MAX_TIMEOUT_MS = 600_000;
    const hintedTimeout =
      Number.isInteger(input.timeoutMsHint) && Number(input.timeoutMsHint) > 0
        ? Math.min(OPENAI_TEXT_GENERATION_MAX_TIMEOUT_MS, Number(input.timeoutMsHint))
        : null;
    const effectiveTimeoutMs = Math.max(
      this.config.PROVIDER_GATEWAY_REQUEST_TIMEOUT_MS,
      hintedTimeout ?? 0
    );
    const { signal, dispose } = this.createTimedSignal(effectiveTimeoutMs);
    try {
      const toolChoice = this.toOpenAIToolChoice(input);
      const textConfig = this.toOpenAITextConfig(input.outputSchema);
      const payload: OpenAINonStreamingCreateParams = {
        model: input.model,
        input: this.buildOpenAIInputItems(input) as OpenAIResponseInputParam
      };
      // ADR-119 Slice 2: system prompt is now prepended as developer-role items inside input[];
      // the separate `instructions` parameter is removed from the Responses API payload.
      if (input.maxOutputTokens !== undefined) {
        payload.max_output_tokens = input.maxOutputTokens;
      }
      if ((input.tools?.length ?? 0) > 0) {
        payload.tools = this.toOpenAITools(input) as OpenAIResponseToolsParam;
        // ADR-119 Slice 2: disable parallel tool calls when Skills are enabled to prevent the
        // model from co-firing skill({engage}) with a media tool in the same response.
        payload.parallel_tool_calls = input.skillsEnabled === true ? false : true;
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
      if (
        input.thinkingBudget !== undefined &&
        input.thinkingBudget > 0 &&
        this.supportsReasoning(input.model)
      ) {
        (payload as unknown as Record<string, unknown>).reasoning = {
          effort: this.reasoningEffortForBudget(input.thinkingBudget)
        };
      }
      this.logCacheZoneTelemetry(input, payload);
      this.debugPayloadLogger.dumpRequest({
        provider: "openai",
        requestId: input.requestMetadata?.runtimeRequestId ?? "unknown",
        payload,
        systemPromptText: this.extractOpenAISystemPromptText(payload),
        messages: Array.isArray(payload.input) ? payload.input : []
      });
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
                  cacheCreationInputTokens: null,
                  cachedInputTokens: response.usage.input_tokens_details?.cached_tokens ?? null,
                  outputTokens: response.usage.output_tokens ?? null,
                  totalTokens: response.usage.total_tokens ?? null
                },
          textUsage: normalizeProviderTextGenerationUsageV2({
            providerKey: "openai",
            modelKey: input.model,
            stepType:
              input.requestMetadata?.classification === "tool_loop_followup"
                ? "tool_loop_followup"
                : "main_turn",
            modelRole: null,
            responseUsage: (response.usage ?? null) as unknown as Record<string, unknown> | null,
            promptCachePolicy: input.promptCache?.openaiPolicy ?? null
          }),
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
                cacheCreationInputTokens: null,
                cachedInputTokens: response.usage.input_tokens_details?.cached_tokens ?? null,
                outputTokens: response.usage.output_tokens ?? null,
                totalTokens: response.usage.total_tokens ?? null
              },
        textUsage: normalizeProviderTextGenerationUsageV2({
          providerKey: "openai",
          modelKey: input.model,
          stepType:
            input.requestMetadata?.classification === "tool_loop_followup"
              ? "tool_loop_followup"
              : "main_turn",
          modelRole: null,
          responseUsage: (response.usage ?? null) as unknown as Record<string, unknown> | null,
          promptCachePolicy: input.promptCache?.openaiPolicy ?? null
        }),
        stopReason: "completed",
        truncated: this.isMaxOutputTokensTruncation(response),
        toolCalls: []
      };
    } catch (error) {
      throw toProviderTextHttpException("openai", error, "OpenAI provider text request failed.");
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
    options?: { apiKey?: string; reserveApiKey?: string | null }
  ): Promise<ProviderGatewayImageGenerateResult> {
    const { signal, dispose } = this.createTimedSignal(
      this.resolveImageGenerationTimeoutMs(input.timeoutMs)
    );
    try {
      const model = input.model ?? OPENAI_IMAGE_GENERATION_MODEL;
      const providerPrompt =
        input.count > 1
          ? [
              `Return ${String(input.count)} distinct standalone images.`,
              `${STANDALONE_IMAGE_RULE} ${ANTI_COLLAGE_RULE}`,
              `User request: ${input.prompt}`
            ].join(" ")
          : input.prompt;
      const payload: OpenAIImageGenerateParams = {
        model,
        prompt: providerPrompt,
        n: input.count,
        output_format: "png",
        background: input.background,
        ...(input.size === null ? {} : { size: input.size })
      };
      const response = await this.executeImageRequestWithReserveFallback({
        action: "generate",
        input,
        payload,
        signal,
        ...(options?.apiKey === undefined ? {} : { primaryApiKey: options.apiKey }),
        reserveApiKey: options?.reserveApiKey ?? null,
        run: (client, requestPayload, requestOptions) =>
          client.images.generate(
            requestPayload as OpenAIImageGenerateParams,
            requestOptions
          ) as Promise<OpenAIImageGenerateResponse>
      });
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
    options?: { apiKey?: string; reserveApiKey?: string | null }
  ): Promise<ProviderGatewayImageEditResult> {
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
      // OpenAI `images.edit` accepts the source plus all references as one
      // ordered `image[]` input set.
      const referenceInputs = Array.isArray(input.referenceImages) ? input.referenceImages : [];
      const referenceImages = await Promise.all(
        referenceInputs.map((reference) =>
          toFile(
            Buffer.from(reference.bytesBase64, "base64"),
            reference.filename ?? this.defaultImageFilename(reference.mimeType),
            reference.mimeType.trim().length > 0 ? { type: reference.mimeType } : undefined
          )
        )
      );
      const payload: OpenAIImageEditParams = {
        model,
        prompt: providerPrompt,
        n: input.count,
        image: referenceImages.length === 0 ? sourceImage : [sourceImage, ...referenceImages],
        output_format: "png",
        background: input.background,
        ...(input.size === null ? {} : { size: input.size })
      };
      const response = await this.executeImageRequestWithReserveFallback({
        action: "edit",
        input,
        payload,
        signal,
        ...(options?.apiKey === undefined ? {} : { primaryApiKey: options.apiKey }),
        reserveApiKey: options?.reserveApiKey ?? null,
        run: (client, requestPayload, requestOptions) =>
          client.images.edit(
            requestPayload as OpenAIImageEditParams,
            requestOptions
          ) as Promise<OpenAIImageGenerateResponse>
      });
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

  private async executeImageRequestWithReserveFallback(params: {
    action: "generate" | "edit";
    input: ProviderGatewayImageGenerateRequest | ProviderGatewayImageEditRequest;
    payload: OpenAIImageGenerateParams | OpenAIImageEditParams;
    signal: AbortSignal;
    primaryApiKey?: string;
    reserveApiKey: string | null;
    run: (
      client: OpenAI,
      payload: OpenAIImageGenerateParams | OpenAIImageEditParams,
      options: { signal: AbortSignal }
    ) => Promise<OpenAIImageGenerateResponse>;
  }): Promise<OpenAIImageGenerateResponse> {
    const primaryClient = this.getApiClient(params.primaryApiKey);
    try {
      return await params.run(primaryClient, params.payload, { signal: params.signal });
    } catch (error) {
      const primaryFailure = this.extractOpenAIImageFailure(error);
      const reserveConfig = params.input.credential.reserveTransport;
      if (
        reserveConfig?.enabled !== true ||
        typeof params.reserveApiKey !== "string" ||
        params.reserveApiKey.trim().length === 0 ||
        !this.shouldFallbackToReserveTransport(primaryFailure)
      ) {
        throw this.toOpenAIImageException(error, params.action);
      }
      const reserveClient = this.getApiClient(params.reserveApiKey, reserveConfig.baseUrl);
      this.logger.warn({
        event: "openai_image_primary_failed_reserve_retrying",
        action: params.action,
        model: params.payload.model,
        primaryFailureClass: primaryFailure.class,
        primaryStatus: primaryFailure.status,
        reserveBaseUrlHost: this.readUrlHost(reserveConfig.baseUrl),
        runtimeRequestId: params.input.credential.requestContext?.runtimeRequestId ?? null,
        runtimeSessionId: params.input.credential.requestContext?.runtimeSessionId ?? null,
        workspaceId: params.input.credential.requestContext?.workspaceId ?? null
      });
      try {
        const reserveResult = await params.run(reserveClient, params.payload, {
          signal: params.signal
        });
        this.logger.log({
          event: "openai_image_primary_failed_reserve_used",
          action: params.action,
          model: params.payload.model,
          primaryFailureClass: primaryFailure.class,
          primaryStatus: primaryFailure.status,
          reserveBaseUrlHost: this.readUrlHost(reserveConfig.baseUrl),
          runtimeRequestId: params.input.credential.requestContext?.runtimeRequestId ?? null,
          runtimeSessionId: params.input.credential.requestContext?.runtimeSessionId ?? null,
          workspaceId: params.input.credential.requestContext?.workspaceId ?? null
        });
        await this.emitReserveFallbackAuditEvent({
          action: params.action,
          input: params.input,
          modelKey: typeof params.payload.model === "string" ? params.payload.model : null,
          primaryFailure,
          reserveBaseUrl: reserveConfig.baseUrl
        });
        return reserveResult;
      } catch (reserveError) {
        this.logger.error({
          event: "openai_image_primary_failed_reserve_failed",
          action: params.action,
          model: params.payload.model,
          primaryFailureClass: primaryFailure.class,
          primaryStatus: primaryFailure.status,
          reserveBaseUrlHost: this.readUrlHost(reserveConfig.baseUrl),
          reserveError: reserveError instanceof Error ? reserveError.message : String(reserveError),
          runtimeRequestId: params.input.credential.requestContext?.runtimeRequestId ?? null,
          runtimeSessionId: params.input.credential.requestContext?.runtimeSessionId ?? null,
          workspaceId: params.input.credential.requestContext?.workspaceId ?? null
        });
        throw this.toOpenAIImageException(reserveError, params.action);
      }
    }
  }

  private toOpenAIImageException(error: unknown, action: "generate" | "edit"): Error {
    const details = this.extractOpenAIImageErrorDetails(error);
    if (!this.isOpenAIImageSafetyReject(details)) {
      return error instanceof Error
        ? error
        : new Error(`OpenAI image ${action} request failed unexpectedly.`);
    }
    return new BadRequestException({
      error: {
        code: "image_provider_safety_rejected",
        message: this.buildOpenAIImageSafetyRejectMessage(action, details),
        retryable: false,
        providerStatus: {
          provider: "openai",
          state: "failed",
          category: "safety_reject",
          action,
          requestId: details.requestId,
          httpStatus: details.status,
          upstreamCode: details.code,
          upstreamType: details.type,
          upstreamMessage: details.message,
          safetyViolations: details.safetyViolations,
          retryable: false
        }
      }
    });
  }

  private extractOpenAIImageErrorDetails(error: unknown): {
    status: number | null;
    message: string | null;
    code: string | null;
    type: string | null;
    requestId: string | null;
    safetyViolations: string[] | null;
  } {
    const row = this.asObject(error);
    const response = this.asObject(row?.response);
    const body = this.asObject(row?.body);
    const nestedError =
      this.asObject(row?.error) ?? this.asObject(body?.error) ?? this.asObject(response?.error);
    const requestIdCandidate =
      row?.request_id ??
      row?.requestId ??
      body?.request_id ??
      body?.requestId ??
      response?.request_id ??
      response?.requestId;
    const requestId =
      typeof requestIdCandidate === "string" && requestIdCandidate.trim().length > 0
        ? requestIdCandidate.trim()
        : null;
    const messageCandidate =
      nestedError?.message ?? row?.message ?? body?.message ?? response?.message ?? null;
    const message =
      typeof messageCandidate === "string" && messageCandidate.trim().length > 0
        ? messageCandidate.trim()
        : null;
    const codeCandidate = nestedError?.code ?? row?.code ?? null;
    const typeCandidate = nestedError?.type ?? row?.type ?? null;
    const safetyViolationsCandidate =
      nestedError?.safety_violations ?? body?.safety_violations ?? row?.safety_violations ?? null;
    return {
      status: this.asPositiveInteger(row?.status) ?? this.asPositiveInteger(response?.status),
      message,
      code:
        typeof codeCandidate === "string" && codeCandidate.trim().length > 0 ? codeCandidate : null,
      type:
        typeof typeCandidate === "string" && typeCandidate.trim().length > 0 ? typeCandidate : null,
      requestId,
      safetyViolations: Array.isArray(safetyViolationsCandidate)
        ? safetyViolationsCandidate.filter(
            (entry): entry is string => typeof entry === "string" && entry.trim().length > 0
          )
        : null
    };
  }

  private isOpenAIImageSafetyReject(input: {
    status: number | null;
    message: string | null;
    safetyViolations: string[] | null;
  }): boolean {
    const haystack =
      `${input.message ?? ""} ${(input.safetyViolations ?? []).join(" ")}`.toLowerCase();
    return (
      input.status === 400 &&
      (haystack.includes("rejected by the safety system") ||
        haystack.includes("safety system") ||
        haystack.includes("safety_violations") ||
        haystack.includes("safety violations"))
    );
  }

  private buildOpenAIImageSafetyRejectMessage(
    action: "generate" | "edit",
    input: {
      message: string | null;
      requestId: string | null;
    }
  ): string {
    const requestIdText = input.requestId === null ? "" : ` (request id ${input.requestId})`;
    const upstreamMessage =
      input.message ?? "Your request was rejected by the OpenAI safety system.";
    return `OpenAI image ${action} request was rejected by the provider safety system${requestIdText}: ${upstreamMessage}`;
  }

  private extractOpenAIImageFailure(error: unknown): OpenAIImageTransportFailure {
    const details = this.extractOpenAIImageErrorDetails(error);
    const message = details.message?.toLowerCase() ?? "";
    const code = details.code?.toLowerCase() ?? "";
    const type = details.type?.toLowerCase() ?? "";
    if (this.isAbortError(error) || message.includes("timed out") || message.includes("timeout")) {
      return { class: "timeout", ...details };
    }
    if (details.status === null) {
      return { class: "network", ...details };
    }
    if (details.status === 408) {
      return { class: "timeout", ...details };
    }
    if (details.status === 429) {
      return { class: "rate_limit", ...details };
    }
    if ([500, 502, 503, 504].includes(details.status)) {
      return { class: "server_error", ...details };
    }
    if (
      [401, 403].includes(details.status) &&
      (message.includes("quota") ||
        message.includes("billing") ||
        message.includes("suspended") ||
        message.includes("disabled") ||
        message.includes("deactivated") ||
        message.includes("incorrect api key") ||
        message.includes("invalid api key") ||
        message.includes("insufficient_quota") ||
        message.includes("region") ||
        message.includes("unavailable") ||
        message.includes("auth") ||
        code.includes("invalid_api_key") ||
        code.includes("insufficient_quota") ||
        code.includes("billing") ||
        code.includes("account") ||
        type.includes("billing") ||
        type.includes("authentication"))
    ) {
      return { class: "account_unavailable", ...details };
    }
    return { class: "unknown", ...details };
  }

  private shouldFallbackToReserveTransport(input: OpenAIImageTransportFailure): boolean {
    return (
      input.class === "network" ||
      input.class === "timeout" ||
      input.class === "rate_limit" ||
      input.class === "server_error" ||
      input.class === "account_unavailable"
    );
  }

  private readUrlHost(value: string): string | null {
    try {
      return new URL(value).host;
    } catch {
      return null;
    }
  }

  private async emitReserveFallbackAuditEvent(params: {
    action: "generate" | "edit";
    input: ProviderGatewayImageGenerateRequest | ProviderGatewayImageEditRequest;
    modelKey: string | null;
    primaryFailure: OpenAIImageTransportFailure;
    reserveBaseUrl: string;
  }): Promise<void> {
    const workspaceId = params.input.credential.requestContext?.workspaceId ?? null;
    if (workspaceId === null || this.persaiInternalApiClientService === undefined) {
      return;
    }
    try {
      const toolCode = params.action === "generate" ? "image_generate" : "image_edit";
      const reserveBaseUrlHost = this.readUrlHost(params.reserveBaseUrl);
      await this.persaiInternalApiClientService.appendAssistantAuditEvent({
        workspaceId,
        assistantId: null,
        actorUserId: null,
        eventCategory: "provider_transport",
        eventCode: "assistant.media.reserve_openai_transport_used",
        summary: `Reserve OpenAI-compatible transport succeeded for ${toolCode}.`,
        outcome: "degraded",
        details: {
          tool: toolCode,
          modelKey: params.modelKey,
          primaryFailureClass: params.primaryFailure.class,
          primaryFailureStatus: params.primaryFailure.status,
          primaryFailureCode: params.primaryFailure.code,
          reserveBaseUrlHost,
          runtimeRequestId: params.input.credential.requestContext?.runtimeRequestId ?? null,
          runtimeSessionId: params.input.credential.requestContext?.runtimeSessionId ?? null
        }
      });
    } catch (error) {
      this.logger.warn({
        event: "openai_image_reserve_fallback_audit_failed",
        action: params.action,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  async generateVideo(
    input: ProviderGatewayVideoGenerateRequest,
    options?: { apiKey?: string }
  ): Promise<ProviderGatewayVideoGenerateResult> {
    const apiKey = this.requireApiKey(options?.apiKey);
    const { signal, dispose } = this.createTimedSignal(
      Math.max(this.config.PROVIDER_GATEWAY_REQUEST_TIMEOUT_MS, OPENAI_VIDEO_GENERATION_TIMEOUT_MS)
    );
    try {
      const acceptedTask = await this.resolveAcceptedOpenAIVideoTask(input, apiKey, signal);
      const createdJob = acceptedTask.job;
      const completedJob =
        createdJob.status === "completed"
          ? createdJob
          : createdJob.status === "queued" || createdJob.status === "in_progress"
            ? await this.pollOpenAIVideoJob(acceptedTask.task, apiKey, signal)
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
    const model = this.resolveSpeechModel(input.credential.modelKey ?? null);
    try {
      const payload: OpenAISpeechCreateParams = {
        model,
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
        model,
        deliveryKind: input.deliveryKind,
        bytesBase64: buffer.toString("base64"),
        mimeType: format === "opus" ? "audio/ogg" : "audio/mpeg",
        respondedAt: new Date().toISOString(),
        usage: null,
        billingFacts: this.buildSpeechBillingFacts({
          model,
          text: input.text
        }),
        warning: null
      };
    } finally {
      dispose();
    }
  }

  private resolveSpeechModel(modelKey: string | null): string {
    const normalized = modelKey?.trim() ?? "";
    return OPENAI_SPEECH_GENERATION_MODELS.has(normalized)
      ? normalized
      : OPENAI_SPEECH_GENERATION_MODEL;
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
      // ADR-119 Slice 2: system prompt is now prepended as developer-role items inside input[];
      // the separate `instructions` parameter is removed from the Responses API payload.
      if (input.maxOutputTokens !== undefined) {
        payload.max_output_tokens = input.maxOutputTokens;
      }
      if ((input.tools?.length ?? 0) > 0) {
        payload.tools = this.toOpenAITools(input) as OpenAIResponseToolsParam;
        // ADR-119 Slice 2: disable parallel tool calls when Skills are enabled to prevent the
        // model from co-firing skill({engage}) with a media tool in the same response.
        payload.parallel_tool_calls = input.skillsEnabled === true ? false : true;
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
      if (
        input.thinkingBudget !== undefined &&
        input.thinkingBudget > 0 &&
        this.supportsReasoning(input.model)
      ) {
        payload.reasoning = { effort: this.reasoningEffortForBudget(input.thinkingBudget) };
      }
      this.logCacheZoneTelemetry(input, payload);
      this.logger.log(
        `[openai-stream-start] requestId=${input.requestMetadata?.runtimeRequestId ?? "unknown"} classification=${input.requestMetadata?.classification ?? "unknown"} iteration=${
          input.requestMetadata?.toolLoopIteration === null ||
          input.requestMetadata?.toolLoopIteration === undefined
            ? "null"
            : String(input.requestMetadata.toolLoopIteration)
        } model=${input.model} toolCount=${String(input.tools?.length ?? 0)} toolHistoryCount=${String(input.toolHistory?.length ?? 0)}`
      );
      this.debugPayloadLogger.dumpRequest({
        provider: "openai",
        requestId: input.requestMetadata?.runtimeRequestId ?? "unknown",
        payload,
        systemPromptText: this.extractOpenAISystemPromptText(payload),
        messages: Array.isArray(payload.input) ? payload.input : []
      });
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
                textUsage: normalizeProviderTextGenerationUsageV2({
                  providerKey: "openai",
                  modelKey: input.model,
                  stepType: this.textUsageStepType(input),
                  modelRole: null,
                  responseUsage: (response?.usage ?? null) as Record<string, unknown> | null,
                  promptCachePolicy: input.promptCache?.openaiPolicy ?? null
                }),
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
              textUsage: normalizeProviderTextGenerationUsageV2({
                providerKey: "openai",
                modelKey: input.model,
                stepType: this.textUsageStepType(input),
                modelRole: null,
                responseUsage: (response?.usage ?? null) as Record<string, unknown> | null,
                promptCachePolicy: input.promptCache?.openaiPolicy ?? null
              }),
              stopReason: "completed",
              truncated: this.isMaxOutputTokensTruncation(response),
              toolCalls: []
            }
          };
          yield completedEvent;
          return;
        }

        if (event?.type === "error") {
          const failedEvent = toProviderTextFailedEvent(
            "openai",
            event,
            "OpenAI provider stream failed."
          );
          yield failedEvent;
          return;
        }

        if (event?.type === "response.incomplete") {
          const incompleteResponse = this.asObject(event.response);
          if (this.isMaxOutputTokensTruncation(incompleteResponse)) {
            // ADR-122 Slice 3: max_output_tokens stop is a completed turn that
            // was cut short. Yield the accumulated text with truncated:true so
            // the hydration guard can mark it and stop the model from continuing.
            const truncatedText =
              this.normalizeOptionalText(
                (incompleteResponse as Record<string, unknown> | null)?.output_text
              ) ?? this.normalizeOptionalText(accumulatedText);
            const truncatedCompletedEvent: ProviderGatewayTextCompletedEvent = {
              type: "completed",
              result: {
                provider: "openai",
                model: input.model,
                text: truncatedText,
                respondedAt: new Date().toISOString(),
                usage: this.toUsageSnapshot(
                  input.model,
                  (incompleteResponse as Record<string, unknown> | null)?.usage as
                    | OpenAI.Responses.ResponseUsage
                    | undefined
                ),
                textUsage: normalizeProviderTextGenerationUsageV2({
                  providerKey: "openai",
                  modelKey: input.model,
                  stepType: this.textUsageStepType(input),
                  modelRole: null,
                  responseUsage: ((incompleteResponse as Record<string, unknown> | null)?.usage ??
                    null) as Record<string, unknown> | null,
                  promptCachePolicy: input.promptCache?.openaiPolicy ?? null
                }),
                stopReason: "completed",
                truncated: true,
                toolCalls: []
              }
            };
            yield truncatedCompletedEvent;
            return;
          }
          const response = incompleteResponse;
          const failedEvent = toProviderTextFailedEvent(
            "openai",
            response,
            "OpenAI provider stream did not complete successfully."
          );
          yield failedEvent;
          return;
        }

        if (event?.type === "response.failed") {
          const response = this.asObject(event.response);
          const failedEvent = toProviderTextFailedEvent(
            "openai",
            response,
            "OpenAI provider stream did not complete successfully."
          );
          yield failedEvent;
          return;
        }
      }

      const failedEvent: ProviderGatewayTextFailedEvent = {
        type: "failed",
        code: "provider_stream_ended",
        message: "OpenAI provider stream ended before a completed result was emitted.",
        providerErrorKind: "server_error",
        providerErrorCode: null,
        providerErrorType: null,
        providerErrorStatus: null
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
      const failedEvent = toProviderTextFailedEvent(
        "openai",
        error,
        "OpenAI provider stream failed."
      );
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
          cacheCreationInputTokens: null,
          cachedInputTokens: usage.input_tokens_details?.cached_tokens ?? null,
          outputTokens: usage.output_tokens ?? null,
          totalTokens: usage.total_tokens ?? null
        };
  }

  private textUsageStepType(
    input: ProviderGatewayTextGenerateRequest
  ): "main_turn" | "tool_loop_followup" {
    return input.requestMetadata?.classification === "tool_loop_followup"
      ? "tool_loop_followup"
      : "main_turn";
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
          cacheCreationInputTokens: null,
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
        cacheCreationInputTokens: input.usage.cacheCreationInputTokens ?? null,
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

  /**
   * ADR-119: build the developer-role item that represents the system prompt prefix inside
   * `input[]`. Emits a single developer item containing the full `systemPrompt` so the OpenAI
   * Responses API prefix-match cache sees the large stable system content at index 0.
   *
   * This item must be FIRST in `input[]` so the stable system content forms the cache prefix.
   */
  private buildOpenAISystemDeveloperItems(
    input: ProviderGatewayTextGenerateRequest
  ): OpenAIBuiltInputItem[] {
    const systemPrompt =
      typeof input.systemPrompt === "string" && input.systemPrompt.length > 0
        ? input.systemPrompt
        : null;
    if (systemPrompt !== null) {
      return [
        {
          role: "developer" as const,
          content: [
            {
              type: "input_text" as const,
              text: systemPrompt,
              ...(this.usesExplicitOpenAIPromptCache(input)
                ? { prompt_cache_breakpoint: { mode: "explicit" as const } }
                : {})
            }
          ]
        }
      ];
    }
    return [];
  }

  private buildOpenAIInputItems(input: ProviderGatewayTextGenerateRequest): OpenAIBuiltInputItem[] {
    const volatileContextMessages: ProviderGatewayTextGenerateRequest["messages"] = [];
    // ADR-119 Slice 2: system prompt is prepended as developer-role items so OpenAI Responses API
    // prefix-match caching sees the large stable system content at index 0 of input[].
    const items: OpenAIBuiltInputItem[] = this.buildOpenAISystemDeveloperItems(input);
    for (const message of input.messages) {
      if (this.isOpenAIVolatileContextMessage(message)) {
        volatileContextMessages.push(message);
        continue;
      }
      for (const exchange of message.priorToolExchanges ?? []) {
        this.pushOpenAIExchangeItems(items, exchange);
      }
      items.push({
        role: message.role,
        content: this.toOpenAIMessageContent(message.content)
      });
    }
    for (const exchange of input.toolHistory ?? []) {
      this.pushOpenAIExchangeItems(items, exchange);
      this.pushOpenAISealedSpineBoundary(items, exchange, input);
    }
    const toolFollowUpUserContent = input.toolFollowUpUserContent;
    if (toolFollowUpUserContent !== undefined) {
      items.push({
        role: "user",
        content: this.toOpenAIMessageContent(toolFollowUpUserContent)
      });
    }
    for (const overlay of input.toolObservationOverlays ?? []) {
      items.push({
        role: "developer",
        content: [
          {
            type: "input_text",
            text: `<persai_recent_tool_observation ordinal="${String(overlay.ordinal).padStart(6, "0")}">\n${overlay.exchange.toolResult.content}\n</persai_recent_tool_observation>`
          }
        ]
      });
    }
    // ADR-161: volatile context belongs after the immutable sealed spine and
    // newest-three observation overlays. This preserves the provider-visible
    // prefix through the latest boundary when only volatile context rotates.
    if (volatileContextMessages.length > 0) {
      items.push(this.buildOpenAIVolatileContextItem(volatileContextMessages));
    }
    // ADR-074 P1 / ADR-161: mutable developer guidance is the final suffix,
    // after both sealed exchanges and rotating observation overlays.
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

  private pushOpenAIExchangeItems(
    target: OpenAIBuiltInputItem[],
    exchange: NonNullable<ProviderGatewayTextGenerateRequest["toolHistory"]>[number]
  ): void {
    // Responses preserves an assistant message immediately before the
    // function_call it introduced. Empty text is intentionally omitted: it
    // carries no semantic content and must not manufacture a protocol item.
    const assistantText =
      typeof exchange.assistantText === "string" && exchange.assistantText.trim().length > 0
        ? exchange.assistantText
        : null;
    if (assistantText !== null) {
      target.push({
        role: "assistant",
        content: [{ type: "input_text", text: assistantText }]
      });
    }
    target.push({
      type: "function_call",
      call_id: exchange.toolCall.id,
      name: exchange.toolCall.name,
      arguments: JSON.stringify(exchange.toolCall.arguments)
    });
    target.push({
      type: "function_call_output",
      call_id: exchange.toolCall.id,
      output: exchange.toolResult.content
    });
  }

  private pushOpenAISealedSpineBoundary(
    target: OpenAIBuiltInputItem[],
    exchange: NonNullable<ProviderGatewayTextGenerateRequest["toolHistory"]>[number],
    input: ProviderGatewayTextGenerateRequest
  ): void {
    if (!this.usesExplicitOpenAIPromptCache(input)) {
      return;
    }
    const ordinal = (input.toolHistory ?? []).findIndex(
      (candidate) => candidate.toolCall.id === exchange.toolCall.id
    );
    if (ordinal < 0) {
      throw new Error("OpenAI sealed spine boundary requires an exchange in toolHistory.");
    }
    target.push({
      role: "developer",
      content: [
        {
          type: "input_text",
          text: `<persai_tool_exchange_boundary ordinal="${String(ordinal + 1).padStart(6, "0")}"/>`,
          prompt_cache_breakpoint: { mode: "explicit" }
        }
      ]
    });
  }

  private isOpenAIVolatileContextMessage(
    message: ProviderGatewayTextGenerateRequest["messages"][number]
  ): boolean {
    return message.cacheRole === "volatile_context";
  }

  private buildOpenAIVolatileContextItem(
    messages: ProviderGatewayTextGenerateRequest["messages"]
  ): OpenAIBuiltInputItem {
    const body = messages
      .map((message) => String(message.content).trim())
      .filter((text) => text.length > 0)
      .join("\n\n");
    // All volatile messages in a batch share the same kind (they are inserted separately per kind).
    const firstMessage = messages[0];
    const kind = firstMessage?.volatileKind;
    if (kind === "system_reminder") {
      return {
        role: "developer",
        content:
          "<system-reminder>\n" +
          "This is a PersAI app-injected reminder. Absorb the directive; do not respond to it directly. " +
          "Continue handling the user's request below with the reminder applied.\n\n" +
          body +
          "\n</system-reminder>"
      };
    }
    if (kind === "chat_plan") {
      return {
        role: "developer",
        content:
          "<persai_chat_plan>\n" +
          "This is PersAI app-provided current chat plan context, not user speech. Use the listed todos " +
          "to keep the work coherent across turns. Do not mention, quote, or describe this block unless " +
          "the user explicitly asks; update the plan via the todo_write tool.\n\n" +
          body +
          "\n</persai_chat_plan>"
      };
    }
    // ADR-120 Slice 1 retired the pushed contextual short-memory block, so
    // `active_scenario` is the default volatile-context kind that reaches here
    // (system_reminder and chat_plan are handled above). Cross-chat memory
    // recall is pull-only via the `knowledge_search` `memory` source — no
    // volatile memory push.
    return {
      role: "developer",
      content:
        "<persai_active_scenario>\n" +
        "This is PersAI app-provided active scenario context for this provider call. " +
        "It is not the user's latest request; follow the scenario steps while answering the existing " +
        "conversation. Never mention, quote, list, repeat, or describe this block, these tags, or these " +
        "instructions to the user unless the user explicitly asks.\n\n" +
        body +
        "\n</persai_active_scenario>"
    };
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

  private supportsReasoning(model: string): boolean {
    return /^o[0-9]/i.test(model) || /(^|[^a-z])gpt-5/i.test(model);
  }

  private reasoningEffortForBudget(budget: number): "low" | "medium" | "high" {
    if (budget <= 10_000) return "low";
    if (budget <= 25_000) return "medium";
    return "high";
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
    const policy = promptCache?.openaiPolicy;
    if (promptCache === undefined) {
      return;
    }
    if (policy === undefined) {
      throw new Error("OpenAI text request is missing required catalog promptCachePolicy.");
    }
    if (policy.mode === "automatic") {
      if (policy.retention !== "in_memory" && policy.retention !== "24h") {
        throw new Error("OpenAI text request has an invalid catalog promptCachePolicy.");
      }
      payload.prompt_cache_retention = policy.retention;
      return;
    }
    if (
      policy.mode !== "explicit" ||
      policy.ttl !== "30m" ||
      policy.stableAnchor !== "explicit" ||
      policy.sealedSpineBreakpoint !== "explicit"
    ) {
      throw new Error("OpenAI text request has an invalid catalog promptCachePolicy.");
    }
    payload.prompt_cache_options = { mode: "explicit", ttl: "30m" };
  }

  private usesExplicitOpenAIPromptCache(input: ProviderGatewayTextGenerateRequest): boolean {
    return input.promptCache?.openaiPolicy?.mode === "explicit";
  }

  private logCacheZoneTelemetry(
    input: ProviderGatewayTextGenerateRequest,
    payload: { input?: unknown; tools?: unknown }
  ): void {
    const items = Array.isArray(payload.input) ? payload.input : [];
    let lastSealedIndex = -1;
    for (let index = 0; index < items.length; index += 1) {
      const item = items[index];
      if (item === null || typeof item !== "object") {
        continue;
      }
      const row = item as { type?: unknown; role?: unknown; content?: unknown };
      if (row.type === "function_call_output") {
        lastSealedIndex = index;
        continue;
      }
      if (
        row.role === "developer" &&
        Array.isArray(row.content) &&
        row.content.some(
          (block) =>
            block !== null &&
            typeof block === "object" &&
            typeof (block as { text?: unknown }).text === "string" &&
            (block as { text: string }).text.startsWith("<persai_tool_exchange_boundary ")
        )
      ) {
        lastSealedIndex = index;
      }
    }
    const stableSystem = items[0] ?? null;
    logProviderCacheZoneTelemetry({
      logger: this.logger,
      input,
      representation: {
        tools: payload.tools ?? [],
        prefix: lastSealedIndex >= 0 ? items.slice(0, lastSealedIndex + 1) : items,
        stableSystem,
        hydratedHistory: items.slice(1, lastSealedIndex >= 0 ? lastSealedIndex + 1 : items.length),
        volatileContext: input.messages.filter(
          (message) => message.cacheRole === "volatile_context"
        ),
        developerTail: input.developerInstructions ?? null,
        cacheBreakpointCount: this.usesExplicitOpenAIPromptCache(input)
          ? 1 + (input.toolHistory?.length ?? 0)
          : 0
      }
    });
  }

  private extractOpenAISystemPromptText(payload: {
    instructions?: unknown;
    input?: unknown;
  }): string | null {
    if (typeof payload.instructions === "string" && payload.instructions.length > 0) {
      return payload.instructions;
    }
    if (!Array.isArray(payload.input)) {
      return null;
    }
    const text = payload.input
      .map((item) => {
        const row = this.asObject(item);
        if (row?.role !== "developer") {
          return null;
        }
        return this.extractOpenAIContentText(row.content);
      })
      .filter((entry): entry is string => entry !== null && entry.length > 0)
      .join("\n\n");
    return text.length > 0 ? text : null;
  }

  private extractOpenAIContentText(content: unknown): string | null {
    if (typeof content === "string") {
      return content;
    }
    if (!Array.isArray(content)) {
      return null;
    }
    const text = content
      .map((block) => {
        const row = this.asObject(block);
        return typeof row?.text === "string" ? row.text : null;
      })
      .filter((entry): entry is string => entry !== null && entry.length > 0)
      .join("\n\n");
    return text.length > 0 ? text : null;
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

  /**
   * ADR-122 Slice 3: returns true when the OpenAI response was stopped by
   * max_output_tokens — response.status === "incomplete" with
   * incomplete_details.reason === "max_output_tokens".
   */
  private isMaxOutputTokensTruncation(response: unknown): boolean {
    if (response === null || typeof response !== "object") {
      return false;
    }
    const r = response as { status?: unknown; incomplete_details?: { reason?: unknown } };
    return r.status === "incomplete" && r.incomplete_details?.reason === "max_output_tokens";
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

  private asPositiveInteger(value: unknown): number | null {
    return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
  }

  private requireApiKey(apiKey?: string): string {
    if (typeof apiKey === "string" && apiKey.trim().length > 0) {
      return apiKey.trim();
    }
    throw new Error("OpenAI API key must be resolved from the managed secret service.");
  }

  private getApiClient(apiKey?: string, baseURL?: string): OpenAI {
    if (typeof apiKey === "string" && apiKey.trim().length > 0) {
      return new OpenAI({
        apiKey: apiKey.trim(),
        ...(typeof baseURL === "string" && baseURL.trim().length > 0
          ? { baseURL: baseURL.trim() }
          : {})
      });
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
    const count = input.count ?? 1;
    const referenceInputs = Array.isArray(input.referenceImages) ? input.referenceImages : [];
    if (referenceInputs.length === 0) {
      if (count <= 1) {
        return prompt;
      }
      return [
        `Return ${String(count)} distinct edited variations of the source image.`,
        `${STANDALONE_IMAGE_RULE} ${ANTI_COLLAGE_RULE}`,
        `User request: ${prompt}`
      ].join(" ");
    }
    const sourceFilename = input.sourceImage.filename ?? "image #1";
    const referenceFilenames = referenceInputs.map(
      (reference, index) => reference.filename ?? `image #${String(index + 2)}`
    );
    const outputCardinalityInstruction =
      count <= 1
        ? "Edit only the first/source image and return one edited version of that source image."
        : `Edit the source image and return ${String(count)} distinct edited variations of it.`;
    const multipleReferences = referenceInputs.length > 1;
    const referenceGuidance = referenceGuidanceRule({ multiple: multipleReferences });
    const referenceProtection = multipleReferences
      ? "Do not separately edit, restyle, or reproduce any reference image as its own output."
      : "Do not separately edit, restyle, or reproduce the reference image as its own output.";
    const referenceLabel = multipleReferences
      ? `Reference images: ${referenceFilenames.join(", ")}.`
      : `Reference image: ${referenceFilenames[0] ?? "image #2"}.`;
    return [
      outputCardinalityInstruction,
      `${STANDALONE_IMAGE_RULE} ${ANTI_COLLAGE_RULE}`,
      referenceGuidance,
      referenceProtection,
      "Preserve the identity, pose, framing, and main content of the source image unless the user explicitly asks to change them.",
      `Source image: ${sourceFilename}.`,
      referenceLabel,
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
    acceptedTask: OpenAIAcceptedVideoTask,
    apiKey: string,
    signal: AbortSignal
  ): Promise<{ id: string; status: string; model: string | null }> {
    let completedJob: { id: string; status: string; model: string | null } | null = null;
    let transientFetchFailures = 0;
    while (completedJob === null) {
      await this.delay(OPENAI_VIDEO_POLL_INTERVAL_MS, signal);
      let response: Response;
      try {
        response = await fetch(`https://api.openai.com/v1/videos/${acceptedTask.videoId}`, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${apiKey}`
          },
          signal
        });
        transientFetchFailures = 0;
      } catch (error) {
        if (this.isAbortError(error) || signal.aborted) {
          throw error;
        }
        transientFetchFailures += 1;
        this.logger.warn(
          `[video-openai] poll transport_error task_id=${acceptedTask.videoId} providerStage=accepted acceptedAt=${acceptedTask.acceptedAt} transientFailures=${String(
            transientFetchFailures
          )}/${String(OPENAI_MAX_TRANSIENT_VIDEO_POLL_FETCH_FAILURES)} message=${
            error instanceof Error ? error.message : String(error)
          }`
        );
        if (transientFetchFailures >= OPENAI_MAX_TRANSIENT_VIDEO_POLL_FETCH_FAILURES) {
          throw this.buildOpenAIVideoPollingLossError(acceptedTask, error);
        }
        continue;
      }
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

  private async resolveAcceptedOpenAIVideoTask(
    input: ProviderGatewayVideoGenerateRequest,
    apiKey: string,
    signal: AbortSignal
  ): Promise<{
    task: OpenAIAcceptedVideoTask;
    job: { id: string; status: string; model: string | null };
  }> {
    const reusedTask = this.normalizeAcceptedOpenAIVideoTask(
      input.acceptedTask,
      input.model ?? OPENAI_VIDEO_GENERATION_MODEL
    );
    if (reusedTask !== null) {
      const job = await this.fetchOpenAIVideoJob(reusedTask.videoId, apiKey, signal);
      return { task: reusedTask, job };
    }
    const job = await this.createOpenAIVideoJob(input, apiKey, signal);
    const acceptedAt = new Date().toISOString();
    const task = {
      videoId: job.id,
      model: job.model ?? input.model ?? OPENAI_VIDEO_GENERATION_MODEL,
      acceptedAt
    };
    this.logger.log(
      `[video-openai] create accepted task_id=${task.videoId} model=${task.model} acceptedAt=${acceptedAt}`
    );
    return { task, job };
  }

  private normalizeAcceptedOpenAIVideoTask(
    acceptedTask: ProviderGatewayVideoGenerateRequest["acceptedTask"],
    fallbackModel: string
  ): OpenAIAcceptedVideoTask | null {
    if (
      acceptedTask === null ||
      acceptedTask === undefined ||
      acceptedTask.provider !== "openai" ||
      acceptedTask.providerStage !== "accepted"
    ) {
      return null;
    }
    const providerTaskId = this.normalizeOptionalText(acceptedTask.providerTaskId);
    if (providerTaskId === null) {
      return null;
    }
    return {
      videoId: providerTaskId,
      model: this.normalizeOptionalText(acceptedTask.model) ?? fallbackModel,
      acceptedAt: this.normalizeOptionalText(acceptedTask.acceptedAt) ?? new Date().toISOString()
    };
  }

  private async fetchOpenAIVideoJob(
    videoId: string,
    apiKey: string,
    signal: AbortSignal
  ): Promise<{ id: string; status: string; model: string | null }> {
    const response = await fetch(`https://api.openai.com/v1/videos/${videoId}`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`
      },
      signal
    });
    const body = await this.readJsonBody(response);
    if (!response.ok) {
      throw new Error(this.readOpenAIVideoErrorMessage(body, response.status));
    }
    return this.parseOpenAIVideoJob(body);
  }

  private buildOpenAIVideoPollingLossError(
    acceptedTask: OpenAIAcceptedVideoTask,
    error: unknown
  ): Error {
    const message = error instanceof Error ? error.message : String(error);
    const payload = {
      providerTaskId: acceptedTask.videoId,
      provider: "openai",
      model: acceptedTask.model,
      providerStage: "accepted",
      acceptedAt: acceptedTask.acceptedAt,
      code: "accepted_primary_unconfirmed",
      reason: "provider accepted but polling transport lost",
      message
    };
    return new Error(`PERSAI_VIDEO_POLLING_LOST::${JSON.stringify(payload)}`);
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
