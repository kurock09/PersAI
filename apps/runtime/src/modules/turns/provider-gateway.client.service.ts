import {
  BadGatewayException,
  HttpException,
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException
} from "@nestjs/common";
import type { RuntimeConfig } from "@persai/config";
import type {
  ProviderGatewayBrowserActionRequest,
  ProviderGatewayBrowserActionResult,
  ProviderGatewayAudioTranscriptionResult,
  RuntimeBillingFacts,
  ProviderGatewayDocumentGenerateRequest,
  ProviderGatewayDocumentGenerateResult,
  ProviderGatewayImageEditRequest,
  ProviderGatewayImageEditResult,
  ProviderGatewayImageGenerateRequest,
  ProviderGatewayImageGenerateResult,
  ProviderGatewayVideoGenerateRequest,
  ProviderGatewayVideoGenerateResult,
  ProviderGatewaySpeechGenerateRequest,
  ProviderGatewaySpeechGenerateResult,
  ProviderGatewayTextGenerateRequest,
  ProviderGatewayTextGenerateResult,
  ProviderGatewayTextErrorKind,
  ProviderGatewayTextErrorResponse,
  ProviderGatewayTextStreamEvent,
  ProviderGatewayWebSearchRequest,
  ProviderGatewayWebSearchResult,
  ProviderGatewayWebFetchRequest,
  ProviderGatewayWebFetchResult
} from "@persai/runtime-contract";
import { RUNTIME_CONFIG } from "../../runtime-config";

export interface ProviderGatewayDependencyReadiness {
  ready: boolean;
  providerCacheReady: boolean;
}

export type ProviderGatewayDocumentGenerateOutcome =
  | {
      ok: true;
      result: ProviderGatewayDocumentGenerateResult;
    }
  | {
      ok: false;
      status: number;
      message: string;
      retryable: boolean;
      code: string | null;
      providerStatus: Record<string, unknown> | null;
    };

interface JsonResponse {
  ok: boolean;
  status: number;
  body: unknown;
}

const DIRECT_INPUT_PAYLOAD_TOO_LARGE_MESSAGE =
  "Current-turn file payload is too large for direct model input. Remove some files or send a smaller file.";
const PROVIDER_GATEWAY_READY_TIMEOUT_MS = 10_000;

/**
 * ADR-097 Slice 3 — typed timeout error from the provider gateway HTTP client.
 * Thrown instead of ServiceUnavailableException when a request to the gateway
 * times out so callers (e.g. document adapter) can distinguish a clean timeout
 * from other gateway errors without parsing freeform message text.
 */
export class ProviderGatewayTimeoutError extends Error {
  readonly timeoutMs: number;
  constructor(timeoutMs: number) {
    super(`Provider gateway request timed out after ${timeoutMs}ms.`);
    this.name = "ProviderGatewayTimeoutError";
    this.timeoutMs = timeoutMs;
  }
}

export class ProviderGatewayHttpError extends HttpException {
  readonly httpStatus: number;
  readonly providerErrorKind: ProviderGatewayTextErrorKind | null;
  readonly providerErrorCode: string | null;
  readonly providerErrorType: string | null;
  readonly providerErrorStatus: number | null;

  constructor(
    status: number,
    message: string,
    details?: {
      providerErrorKind?: ProviderGatewayTextErrorKind | null;
      providerErrorCode?: string | null;
      providerErrorType?: string | null;
      providerErrorStatus?: number | null;
    }
  ) {
    super(message, status);
    this.name = "ProviderGatewayHttpError";
    this.httpStatus = status;
    this.providerErrorKind = details?.providerErrorKind ?? null;
    this.providerErrorCode = details?.providerErrorCode ?? null;
    this.providerErrorType = details?.providerErrorType ?? null;
    this.providerErrorStatus = details?.providerErrorStatus ?? null;
  }
}

export class ProviderGatewaySafetyRejectedError extends Error {
  readonly status: number;
  readonly code: string;
  readonly providerStatus: Record<string, unknown> | null;
  readonly requestId: string | null;

  constructor(input: {
    status: number;
    code: string;
    message: string;
    providerStatus: Record<string, unknown> | null;
  }) {
    super(input.message);
    this.name = "ProviderGatewaySafetyRejectedError";
    this.status = input.status;
    this.code = input.code;
    this.providerStatus = input.providerStatus;
    this.requestId = ProviderGatewaySafetyRejectedError.readRequestId(input.providerStatus);
  }

  private static readRequestId(providerStatus: Record<string, unknown> | null): string | null {
    if (providerStatus === null) {
      return null;
    }
    const candidate = providerStatus.requestId;
    return typeof candidate === "string" && candidate.trim().length > 0 ? candidate.trim() : null;
  }
}

@Injectable()
export class ProviderGatewayClientService {
  private readonly logger = new Logger(ProviderGatewayClientService.name);

  constructor(@Inject(RUNTIME_CONFIG) private readonly config: RuntimeConfig) {}

  isConfigured(): boolean {
    return this.getBaseUrl() !== null;
  }

  async getReadiness(): Promise<ProviderGatewayDependencyReadiness> {
    if (!this.isConfigured()) {
      return {
        ready: false,
        providerCacheReady: false
      };
    }

    try {
      const response = await this.fetchJson(
        this.buildUrl("/ready"),
        { method: "GET" },
        PROVIDER_GATEWAY_READY_TIMEOUT_MS
      );
      const body = this.asObject(response.body);
      return {
        ready: response.ok && body?.ready === true,
        providerCacheReady: body?.providerCacheReady === true
      };
    } catch {
      return {
        ready: false,
        providerCacheReady: false
      };
    }
  }

  async generateText(
    input: ProviderGatewayTextGenerateRequest,
    options?: { signal?: AbortSignal }
  ): Promise<ProviderGatewayTextGenerateResult> {
    if (!this.isConfigured()) {
      throw new ServiceUnavailableException("Runtime provider gateway base URL is not configured.");
    }

    // ADR-097 Slice 3: use timeoutMsHint from the request if it is a valid positive integer
    // and larger than the default, capped at a defensive maximum (gateway also caps at 600s).
    const DOCUMENT_CLASSIFICATION_HTTP_CAP_MS = 600_000;
    const requestedTimeout =
      Number.isInteger(input.timeoutMsHint) && Number(input.timeoutMsHint) > 0
        ? Math.min(DOCUMENT_CLASSIFICATION_HTTP_CAP_MS, Number(input.timeoutMsHint))
        : null;
    const effectiveTimeoutMs = Math.max(
      this.config.RUNTIME_PROVIDER_GATEWAY_TIMEOUT_MS,
      requestedTimeout ?? 0
    );

    const response = await this.fetchJson(
      this.buildUrl("/api/v1/providers/generate-text"),
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(input)
      },
      effectiveTimeoutMs,
      options?.signal
    );
    if (!response.ok) {
      throw this.toGatewayException(response);
    }
    if (!this.isTextGenerateResult(response.body)) {
      throw new BadGatewayException(
        "Provider gateway returned an invalid text generation response."
      );
    }

    return response.body;
  }

  async transcribeAudio(input: {
    buffer: Buffer;
    mimeType: string;
    filename: string | null;
  }): Promise<ProviderGatewayAudioTranscriptionResult> {
    if (!this.isConfigured()) {
      throw new ServiceUnavailableException("Runtime provider gateway base URL is not configured.");
    }

    const formData = new FormData();
    formData.append(
      "file",
      new Blob([Uint8Array.from(input.buffer)], { type: input.mimeType }),
      input.filename ?? this.defaultAudioFilename(input.mimeType)
    );

    const response = await this.fetchJson(
      this.buildUrl("/api/v1/providers/transcribe-audio"),
      {
        method: "POST",
        body: formData
      },
      this.config.RUNTIME_PROVIDER_GATEWAY_TIMEOUT_MS
    );
    if (!response.ok) {
      throw this.toGatewayException(response);
    }
    if (!this.isAudioTranscriptionResult(response.body)) {
      throw new BadGatewayException(
        "Provider gateway returned an invalid audio transcription response."
      );
    }

    return response.body;
  }

  async generateDocument(
    input: ProviderGatewayDocumentGenerateRequest,
    options?: { timeoutMs?: number }
  ): Promise<ProviderGatewayDocumentGenerateResult> {
    const outcome = await this.generateDocumentOutcome(input, options);
    if (!outcome.ok) {
      throw this.toGatewayException({
        ok: false,
        status: outcome.status,
        body: {
          error: {
            code: outcome.code,
            message: outcome.message,
            retryable: outcome.retryable,
            providerStatus: outcome.providerStatus
          }
        }
      });
    }
    return outcome.result;
  }

  async generateDocumentOutcome(
    input: ProviderGatewayDocumentGenerateRequest,
    options?: { timeoutMs?: number }
  ): Promise<ProviderGatewayDocumentGenerateOutcome> {
    if (!this.isConfigured()) {
      throw new ServiceUnavailableException("Runtime provider gateway base URL is not configured.");
    }

    const response = await this.fetchJson(
      this.buildUrl("/api/v1/providers/generate-document"),
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          ...input,
          ...(options?.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs })
        })
      },
      options?.timeoutMs ?? this.config.RUNTIME_PROVIDER_GATEWAY_TIMEOUT_MS
    );
    if (!response.ok) {
      const extracted = this.extractStructuredError(response.body);
      return {
        ok: false,
        status: response.status,
        message:
          extracted.message ??
          `Provider gateway rejected the document request with status ${response.status}.`,
        retryable:
          typeof extracted.retryable === "boolean"
            ? extracted.retryable
            : response.status >= 500 || response.status === 408 || response.status === 429,
        code: extracted.code,
        providerStatus: extracted.providerStatus
      };
    }
    if (!this.isDocumentGenerateResult(response.body)) {
      throw new BadGatewayException(
        "Provider gateway returned an invalid document generation response."
      );
    }

    return {
      ok: true,
      result: response.body
    };
  }

  async generateImage(
    input: ProviderGatewayImageGenerateRequest,
    options?: { timeoutMs?: number }
  ): Promise<ProviderGatewayImageGenerateResult> {
    if (!this.isConfigured()) {
      throw new ServiceUnavailableException("Runtime provider gateway base URL is not configured.");
    }

    const response = await this.fetchJson(
      this.buildUrl("/api/v1/providers/generate-image"),
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          ...input,
          ...(options?.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs })
        })
      },
      options?.timeoutMs ?? this.config.RUNTIME_PROVIDER_GATEWAY_TIMEOUT_MS
    );
    if (!response.ok) {
      const extracted = this.extractStructuredError(response.body);
      if (this.isImageProviderSafetyRejected(response.status, extracted.code)) {
        throw new ProviderGatewaySafetyRejectedError({
          status: response.status,
          code: extracted.code ?? "image_provider_safety_rejected",
          message:
            extracted.message ??
            `Provider gateway rejected the image request with status ${response.status}.`,
          providerStatus: extracted.providerStatus
        });
      }
      throw this.toGatewayException(response);
    }
    if (!this.isImageGenerateResult(response.body)) {
      throw new BadGatewayException(
        "Provider gateway returned an invalid image generation response."
      );
    }

    return response.body;
  }

  async editImage(
    input: ProviderGatewayImageEditRequest,
    options?: { timeoutMs?: number }
  ): Promise<ProviderGatewayImageEditResult> {
    if (!this.isConfigured()) {
      throw new ServiceUnavailableException("Runtime provider gateway base URL is not configured.");
    }

    const response = await this.fetchJson(
      this.buildUrl("/api/v1/providers/edit-image"),
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          ...input,
          ...(options?.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs })
        })
      },
      options?.timeoutMs ?? this.config.RUNTIME_PROVIDER_GATEWAY_TIMEOUT_MS
    );
    if (!response.ok) {
      const extracted = this.extractStructuredError(response.body);
      if (this.isImageProviderSafetyRejected(response.status, extracted.code)) {
        throw new ProviderGatewaySafetyRejectedError({
          status: response.status,
          code: extracted.code ?? "image_provider_safety_rejected",
          message:
            extracted.message ??
            `Provider gateway rejected the image-edit request with status ${response.status}.`,
          providerStatus: extracted.providerStatus
        });
      }
      throw this.toGatewayException(response);
    }
    if (!this.isImageEditResult(response.body)) {
      throw new BadGatewayException("Provider gateway returned an invalid image edit response.");
    }

    return response.body;
  }

  async generateVideo(
    input: ProviderGatewayVideoGenerateRequest,
    options?: { timeoutMs?: number }
  ): Promise<ProviderGatewayVideoGenerateResult> {
    if (!this.isConfigured()) {
      throw new ServiceUnavailableException("Runtime provider gateway base URL is not configured.");
    }

    const response = await this.fetchJson(
      this.buildUrl("/api/v1/providers/generate-video"),
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(input)
      },
      options?.timeoutMs ?? this.config.RUNTIME_PROVIDER_GATEWAY_TIMEOUT_MS
    );
    if (!response.ok) {
      const extracted = this.extractStructuredError(response.body);
      if (extracted.code === "accepted_primary_unconfirmed") {
        throw new ServiceUnavailableException({
          error: {
            code: extracted.code,
            message:
              extracted.message ??
              "Provider task was accepted, but polling continuity was lost before terminal status.",
            providerStatus: extracted.providerStatus
          }
        });
      }
      throw this.toGatewayException(response);
    }
    if (!this.isVideoGenerateResult(response.body, input.credential.providerId ?? null)) {
      throw new BadGatewayException(
        "Provider gateway returned an invalid video generation response."
      );
    }

    return response.body;
  }

  async generateSpeech(
    input: ProviderGatewaySpeechGenerateRequest
  ): Promise<ProviderGatewaySpeechGenerateResult> {
    if (!this.isConfigured()) {
      throw new ServiceUnavailableException("Runtime provider gateway base URL is not configured.");
    }

    const response = await this.fetchJson(
      this.buildUrl("/api/v1/providers/generate-speech"),
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(input)
      },
      this.config.RUNTIME_PROVIDER_GATEWAY_TIMEOUT_MS
    );
    if (!response.ok) {
      throw this.toGatewayException(response);
    }
    if (!this.isSpeechGenerateResult(response.body)) {
      throw new BadGatewayException(
        "Provider gateway returned an invalid speech generation response."
      );
    }

    return response.body;
  }

  async webSearch(input: ProviderGatewayWebSearchRequest): Promise<ProviderGatewayWebSearchResult> {
    if (!this.isConfigured()) {
      throw new ServiceUnavailableException("Runtime provider gateway base URL is not configured.");
    }

    const response = await this.fetchJson(
      this.buildUrl("/api/v1/providers/web-search"),
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(input)
      },
      this.config.RUNTIME_PROVIDER_GATEWAY_TIMEOUT_MS
    );
    if (!response.ok) {
      throw this.toGatewayException(response);
    }
    if (!this.isWebSearchResult(response.body)) {
      throw new BadGatewayException("Provider gateway returned an invalid web search response.");
    }

    return response.body;
  }

  async webFetch(
    input: ProviderGatewayWebFetchRequest,
    options?: { signal?: AbortSignal }
  ): Promise<ProviderGatewayWebFetchResult> {
    if (!this.isConfigured()) {
      throw new ServiceUnavailableException("Runtime provider gateway base URL is not configured.");
    }

    const response = await this.fetchJson(
      this.buildUrl("/api/v1/providers/web-fetch"),
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(input)
      },
      this.config.RUNTIME_PROVIDER_GATEWAY_TIMEOUT_MS,
      options?.signal
    );
    if (!response.ok) {
      throw this.toGatewayException(response);
    }
    if (!this.isWebFetchResult(response.body)) {
      throw new BadGatewayException("Provider gateway returned an invalid web fetch response.");
    }

    return response.body;
  }

  async browserAction(
    input: ProviderGatewayBrowserActionRequest,
    options?: { timeoutMs?: number }
  ): Promise<ProviderGatewayBrowserActionResult> {
    if (!this.isConfigured()) {
      throw new ServiceUnavailableException("Runtime provider gateway base URL is not configured.");
    }

    const response = await this.fetchJson(
      this.buildUrl("/api/v1/providers/browser-action"),
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(input)
      },
      options?.timeoutMs ?? this.config.RUNTIME_PROVIDER_GATEWAY_TIMEOUT_MS
    );
    if (!response.ok) {
      throw this.toGatewayException(response);
    }
    if (!this.isBrowserActionResult(response.body)) {
      throw new BadGatewayException(
        "Provider gateway returned an invalid browser action response."
      );
    }

    return response.body;
  }

  async streamText(
    input: ProviderGatewayTextGenerateRequest,
    options?: { signal?: AbortSignal; traceEnabled?: boolean }
  ): Promise<AsyncGenerator<ProviderGatewayTextStreamEvent>> {
    if (!this.isConfigured()) {
      throw new ServiceUnavailableException("Runtime provider gateway base URL is not configured.");
    }

    const { signal, reset, dispose } = this.createTimedSignal(
      this.config.RUNTIME_PROVIDER_GATEWAY_STREAM_TIMEOUT_MS,
      options?.signal
    );
    let response: Response;
    const requestId = input.requestMetadata?.runtimeRequestId ?? "unknown";
    const classification = input.requestMetadata?.classification ?? "unknown";
    const iteration =
      input.requestMetadata?.toolLoopIteration === null ||
      input.requestMetadata?.toolLoopIteration === undefined
        ? "null"
        : String(input.requestMetadata.toolLoopIteration);
    const startedAtMs = Date.now();
    try {
      this.logger.log(
        `[provider-gateway-stream] requestId=${requestId} classification=${classification} iteration=${iteration} provider=${input.provider} model=${input.model} toolCount=${String(input.tools?.length ?? 0)} toolHistoryCount=${String(input.toolHistory?.length ?? 0)}`
      );
      const headers: Record<string, string> = {
        "Content-Type": "application/json"
      };
      if (options?.traceEnabled === true) {
        headers["x-persai-trace"] = "on";
      }
      response = await this.fetchWithSignal(
        this.buildUrl("/api/v1/providers/stream-text"),
        {
          method: "POST",
          headers,
          body: JSON.stringify(input)
        },
        signal,
        this.config.RUNTIME_PROVIDER_GATEWAY_STREAM_TIMEOUT_MS,
        options?.signal
      );
    } catch (error) {
      this.logger.warn(
        `[provider-gateway-stream] requestId=${requestId} classification=${classification} iteration=${iteration} failed-before-headers elapsedMs=${String(Date.now() - startedAtMs)}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      dispose();
      throw error;
    }
    this.logger.log(
      `[provider-gateway-stream] requestId=${requestId} classification=${classification} iteration=${iteration} headers-received status=${String(response.status)} elapsedMs=${String(Date.now() - startedAtMs)}`
    );
    if (!response.ok) {
      const body = await this.readBody(response);
      dispose();
      throw this.toGatewayException({
        ok: false,
        status: response.status,
        body
      });
    }
    if (response.body === null) {
      dispose();
      throw new BadGatewayException(
        "Provider gateway returned an empty text stream response body."
      );
    }

    return this.readTextStreamEvents(response, { reset, dispose }, options?.signal);
  }

  private getBaseUrl(): string | null {
    return this.config.RUNTIME_PROVIDER_GATEWAY_BASE_URL ?? null;
  }

  private buildUrl(pathname: string): string {
    const baseUrl = this.getBaseUrl();
    if (baseUrl === null) {
      throw new ServiceUnavailableException("Runtime provider gateway base URL is not configured.");
    }
    return new URL(pathname, baseUrl).toString();
  }

  private async fetchJson(
    url: string,
    init: RequestInit,
    timeoutMs: number,
    externalSignal?: AbortSignal
  ): Promise<JsonResponse> {
    const { signal, dispose } = this.createTimedSignal(timeoutMs, externalSignal);
    try {
      const response = await this.fetchWithSignal(url, init, signal, timeoutMs, externalSignal);
      return {
        ok: response.ok,
        status: response.status,
        body: await this.readBody(response)
      };
    } finally {
      dispose();
    }
  }

  private async fetchWithSignal(
    url: string,
    init: RequestInit,
    signal: AbortSignal,
    timeoutMs: number,
    externalSignal?: AbortSignal
  ): Promise<Response> {
    try {
      return await fetch(url, {
        ...init,
        signal
      });
    } catch (error) {
      if (this.isAbortError(error) && !externalSignal?.aborted) {
        throw new ProviderGatewayTimeoutError(timeoutMs);
      }
      throw error;
    }
  }

  private async readBody(response: Response): Promise<unknown> {
    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      return response.json();
    }
    const text = await response.text();
    return text.length > 0 ? text : null;
  }

  private async *readTextStreamEvents(
    response: Response,
    timer: { reset: () => void; dispose: () => void },
    externalSignal?: AbortSignal
  ): AsyncGenerator<ProviderGatewayTextStreamEvent> {
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      timer.reset();
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        timer.reset();
        buffer += decoder.decode(value, { stream: true });
        yield* this.parseNdjsonLines(buffer, (remaining) => {
          buffer = remaining;
        });
      }

      buffer += decoder.decode();
      const tail = buffer.trim();
      if (tail.length > 0) {
        yield this.parseTextStreamEventLine(tail);
      }
    } catch (error) {
      if (this.isAbortError(error) && !externalSignal?.aborted) {
        throw new ServiceUnavailableException(
          `Provider gateway text stream timed out after ${this.config.RUNTIME_PROVIDER_GATEWAY_STREAM_TIMEOUT_MS}ms.`
        );
      }
      throw error;
    } finally {
      timer.dispose();
      reader.releaseLock();
    }
  }

  private *parseNdjsonLines(
    buffer: string,
    setRemaining: (remaining: string) => void
  ): Generator<ProviderGatewayTextStreamEvent> {
    let remaining = buffer;
    while (true) {
      const newlineIndex = remaining.indexOf("\n");
      if (newlineIndex === -1) {
        break;
      }
      const line = remaining.slice(0, newlineIndex).trim();
      remaining = remaining.slice(newlineIndex + 1);
      if (line.length === 0) {
        continue;
      }
      yield this.parseTextStreamEventLine(line);
    }
    setRemaining(remaining);
  }

  private parseTextStreamEventLine(line: string): ProviderGatewayTextStreamEvent {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      throw new BadGatewayException("Provider gateway returned malformed NDJSON stream output.");
    }
    if (!this.isTextStreamEvent(parsed)) {
      throw new BadGatewayException("Provider gateway returned an invalid text stream event.");
    }
    return parsed;
  }

  private toGatewayException(
    response: JsonResponse
  ): BadGatewayException | BadRequestException | ProviderGatewayHttpError {
    const message = this.extractErrorMessage(response.body);
    const structured = this.extractStructuredError(response.body);
    if (this.isPayloadTooLargeFailure(response.status, message)) {
      return new BadRequestException(DIRECT_INPUT_PAYLOAD_TOO_LARGE_MESSAGE);
    }
    if (response.status === 400) {
      if (this.hasTextProviderClassification(structured)) {
        return new ProviderGatewayHttpError(
          response.status,
          message ?? `Provider gateway rejected the request with status ${response.status}.`,
          structured
        );
      }
      return new BadRequestException(
        message ?? `Provider gateway rejected the request with status ${response.status}.`
      );
    }
    if (this.hasTextProviderClassification(structured) || response.status >= 500) {
      return new ProviderGatewayHttpError(
        response.status,
        message ?? `Provider gateway request failed with status ${response.status}.`,
        structured
      );
    }
    return new BadGatewayException(
      message ?? `Provider gateway rejected the request with status ${response.status}.`
    );
  }

  private extractErrorMessage(body: unknown): string | null {
    if (typeof body === "string" && body.trim().length > 0) {
      return body;
    }
    const row = this.asObject(body);
    const error = this.asObject(row?.error);
    if (typeof error?.message === "string" && error.message.trim().length > 0) {
      return error.message;
    }
    return null;
  }

  private extractStructuredError(body: unknown): {
    code: string | null;
    message: string | null;
    retryable: boolean | null;
    providerStatus: Record<string, unknown> | null;
    providerErrorKind: ProviderGatewayTextErrorKind | null;
    providerErrorCode: string | null;
    providerErrorType: string | null;
    providerErrorStatus: number | null;
  } {
    if (typeof body === "string" && body.trim().length > 0) {
      return {
        code: null,
        message: body.trim(),
        retryable: null,
        providerStatus: null,
        providerErrorKind: null,
        providerErrorCode: null,
        providerErrorType: null,
        providerErrorStatus: null
      };
    }
    const row = this.asObject(body) as
      | ProviderGatewayTextErrorResponse
      | Record<string, unknown>
      | null;
    const error = this.asObject(row?.error);
    return {
      code: typeof error?.code === "string" ? error.code : null,
      message: typeof error?.message === "string" ? error.message : null,
      retryable: typeof error?.retryable === "boolean" ? error.retryable : null,
      providerStatus: this.asObject(error?.providerStatus),
      providerErrorKind: this.asTextProviderErrorKind(error?.providerErrorKind),
      providerErrorCode:
        typeof error?.providerErrorCode === "string" ? error.providerErrorCode : null,
      providerErrorType:
        typeof error?.providerErrorType === "string" ? error.providerErrorType : null,
      providerErrorStatus:
        typeof error?.providerErrorStatus === "number" &&
        Number.isInteger(error.providerErrorStatus)
          ? error.providerErrorStatus
          : null
    };
  }

  private hasTextProviderClassification(input: {
    providerErrorKind: ProviderGatewayTextErrorKind | null;
    providerErrorCode: string | null;
    providerErrorType: string | null;
    providerErrorStatus: number | null;
  }): boolean {
    return (
      input.providerErrorKind !== null ||
      input.providerErrorCode !== null ||
      input.providerErrorType !== null ||
      input.providerErrorStatus !== null
    );
  }

  private isImageProviderSafetyRejected(status: number, code: string | null): boolean {
    return (
      status === 400 &&
      (code === "image_provider_safety_rejected" || code === "provider_safety_rejected")
    );
  }

  private isPayloadTooLargeFailure(status: number, message: string | null): boolean {
    if (status === 413) {
      return true;
    }
    const normalized = message?.trim().toLowerCase() ?? "";
    return (
      normalized.includes("request entity too large") ||
      normalized.includes("entity.too.large") ||
      normalized.includes("payload too large") ||
      normalized.includes("file too large")
    );
  }

  private asObject(value: unknown): Record<string, unknown> | null {
    return value !== null && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  }

  private isTextGenerateResult(value: unknown): value is ProviderGatewayTextGenerateResult {
    const row = this.asObject(value);
    return (
      row?.provider !== undefined &&
      row.provider !== null &&
      (row.provider === "openai" || row.provider === "anthropic" || row.provider === "deepseek") &&
      typeof row.model === "string" &&
      (typeof row.text === "string" || row.text === null) &&
      typeof row.respondedAt === "string" &&
      (row.stopReason === "completed" || row.stopReason === "tool_calls") &&
      Array.isArray(row.toolCalls) &&
      row.toolCalls.every(
        (toolCall) =>
          this.asObject(toolCall) !== null &&
          typeof this.asObject(toolCall)?.id === "string" &&
          typeof this.asObject(toolCall)?.name === "string" &&
          this.asObject(toolCall)?.arguments !== null &&
          typeof this.asObject(toolCall)?.arguments === "object" &&
          !Array.isArray(this.asObject(toolCall)?.arguments)
      ) &&
      (row.usage === null ||
        (typeof row.usage === "object" && row.usage !== null && !Array.isArray(row.usage)))
    );
  }

  private isAudioTranscriptionResult(
    value: unknown
  ): value is ProviderGatewayAudioTranscriptionResult {
    const row = this.asObject(value);
    return (
      row?.provider === "openai" &&
      typeof row.model === "string" &&
      typeof row.text === "string" &&
      typeof row.respondedAt === "string" &&
      this.isBillingFacts(row.billingFacts)
    );
  }

  private isImageGenerateResult(value: unknown): value is ProviderGatewayImageGenerateResult {
    const row = this.asObject(value);
    return (
      row?.provider === "openai" &&
      typeof row.model === "string" &&
      typeof row.prompt === "string" &&
      (row.size === "1024x1024" ||
        row.size === "1024x1536" ||
        row.size === "1536x1024" ||
        row.size === "auto" ||
        row.size === null) &&
      Array.isArray(row.images) &&
      row.images.every((entry) => {
        const image = this.asObject(entry);
        return (
          image !== null &&
          typeof image.bytesBase64 === "string" &&
          typeof image.mimeType === "string" &&
          (typeof image.revisedPrompt === "string" || image.revisedPrompt === null)
        );
      }) &&
      typeof row.respondedAt === "string" &&
      (row.usage === null ||
        (typeof row.usage === "object" && row.usage !== null && !Array.isArray(row.usage))) &&
      this.isBillingFacts(row.billingFacts) &&
      (typeof row.warning === "string" || row.warning === null)
    );
  }

  private isDocumentGenerateResult(value: unknown): value is ProviderGatewayDocumentGenerateResult {
    const row = this.asObject(value);
    const providerStatus = this.asObject(row?.providerStatus);
    return (
      row?.provider === "gamma" &&
      (row.outputFormat === "pdf" || row.outputFormat === "pptx") &&
      typeof row.documentId === "string" &&
      (typeof row.templateId === "string" || row.templateId === null) &&
      (row.filename === null || typeof row.filename === "string") &&
      typeof row.bytesBase64 === "string" &&
      typeof row.mimeType === "string" &&
      typeof row.respondedAt === "string" &&
      (row.warning === null || typeof row.warning === "string") &&
      providerStatus !== null &&
      providerStatus.provider === "gamma" &&
      providerStatus.state === "success" &&
      typeof providerStatus.generationId === "string" &&
      typeof providerStatus.gammaId === "string" &&
      (providerStatus.gammaUrl === null || typeof providerStatus.gammaUrl === "string") &&
      typeof providerStatus.exportUrl === "string" &&
      (providerStatus.filename === null || typeof providerStatus.filename === "string") &&
      (providerStatus.outputType === "pdf" || providerStatus.outputType === "pptx") &&
      providerStatus.status === "completed" &&
      (providerStatus.updatedAt === null || typeof providerStatus.updatedAt === "string") &&
      this.isBillingFacts(row.billingFacts)
    );
  }

  private isImageEditResult(value: unknown): value is ProviderGatewayImageEditResult {
    const row = this.asObject(value);
    return (
      row?.provider === "openai" &&
      typeof row.model === "string" &&
      typeof row.prompt === "string" &&
      (row.size === "1024x1024" ||
        row.size === "1024x1536" ||
        row.size === "1536x1024" ||
        row.size === "auto" ||
        row.size === null) &&
      Array.isArray(row.images) &&
      row.images.every((entry) => {
        const image = this.asObject(entry);
        return (
          image !== null &&
          typeof image.bytesBase64 === "string" &&
          typeof image.mimeType === "string" &&
          (typeof image.revisedPrompt === "string" || image.revisedPrompt === null)
        );
      }) &&
      typeof row.respondedAt === "string" &&
      (row.usage === null ||
        (typeof row.usage === "object" && row.usage !== null && !Array.isArray(row.usage))) &&
      this.isBillingFacts(row.billingFacts) &&
      (typeof row.warning === "string" || row.warning === null)
    );
  }

  private isVideoGenerateResult(
    value: unknown,
    expectedProviderId: ProviderGatewayVideoGenerateRequest["credential"]["providerId"] = null
  ): value is ProviderGatewayVideoGenerateResult {
    const row = this.asObject(value);
    if (row === null) {
      return false;
    }
    const video = this.asObject(row?.video);
    const provider = row?.provider;
    const seconds = row?.seconds;
    const providerMatchesExpected =
      expectedProviderId === null ? true : provider === expectedProviderId;
    return (
      (provider === "openai" ||
        provider === "runway" ||
        provider === "kling" ||
        provider === "heygen") &&
      providerMatchesExpected &&
      typeof row.model === "string" &&
      typeof row.prompt === "string" &&
      (row.size === "720x1280" ||
        row.size === "1280x720" ||
        row.size === "1024x1792" ||
        row.size === "1792x1024" ||
        row.size === null) &&
      typeof seconds === "number" &&
      Number.isFinite(seconds) &&
      seconds > 0 &&
      typeof video?.bytesBase64 === "string" &&
      typeof video.mimeType === "string" &&
      (video.downloadUrl === undefined ||
        video.downloadUrl === null ||
        typeof video.downloadUrl === "string") &&
      typeof row.respondedAt === "string" &&
      (row.usage === null ||
        (typeof row.usage === "object" && row.usage !== null && !Array.isArray(row.usage))) &&
      this.isBillingFacts(row.billingFacts) &&
      (typeof row.warning === "string" || row.warning === null)
    );
  }

  private isSpeechGenerateResult(value: unknown): value is ProviderGatewaySpeechGenerateResult {
    const row = this.asObject(value);
    return (
      row !== null &&
      (row.provider === "elevenlabs" || row.provider === "yandex" || row.provider === "openai") &&
      typeof row.model === "string" &&
      (row.deliveryKind === "voice_note" || row.deliveryKind === "audio") &&
      typeof row.bytesBase64 === "string" &&
      typeof row.mimeType === "string" &&
      typeof row.respondedAt === "string" &&
      (row.usage === null ||
        (typeof row.usage === "object" && row.usage !== null && !Array.isArray(row.usage))) &&
      this.isBillingFacts(row.billingFacts) &&
      (typeof row.warning === "string" || row.warning === null)
    );
  }

  private isBillingFacts(value: unknown): value is RuntimeBillingFacts | null {
    if (value === null || value === undefined) {
      return true;
    }
    return typeof value === "object" && !Array.isArray(value);
  }

  private isWebSearchResult(value: unknown): value is ProviderGatewayWebSearchResult {
    const row = this.asObject(value);
    const externalContent = this.asObject(row?.externalContent);
    return (
      row !== null &&
      (row.provider === "tavily" ||
        row.provider === "brave" ||
        row.provider === "perplexity" ||
        row.provider === "google") &&
      typeof row.query === "string" &&
      (typeof row.summary === "string" || row.summary === null) &&
      Array.isArray(row.hits) &&
      row.hits.every((hit) => {
        const searchHit = this.asObject(hit);
        return (
          searchHit !== null &&
          (typeof searchHit.title === "string" || searchHit.title === null) &&
          typeof searchHit.url === "string" &&
          (typeof searchHit.snippet === "string" || searchHit.snippet === null) &&
          (typeof searchHit.score === "number" || searchHit.score === null) &&
          (typeof searchHit.publishedAt === "string" || searchHit.publishedAt === null)
        );
      }) &&
      typeof row.tookMs === "number" &&
      (typeof row.warning === "string" || row.warning === null) &&
      externalContent?.untrusted === true &&
      externalContent.source === "web_search" &&
      externalContent.provider === row.provider &&
      this.isBillingFacts(row.billingFacts)
    );
  }

  private isWebFetchResult(value: unknown): value is ProviderGatewayWebFetchResult {
    const row = this.asObject(value);
    const externalContent = this.asObject(row?.externalContent);
    return (
      row?.provider === "firecrawl" &&
      typeof row.url === "string" &&
      (typeof row.finalUrl === "string" || row.finalUrl === null) &&
      (typeof row.title === "string" || row.title === null) &&
      typeof row.content === "string" &&
      (typeof row.contentType === "string" || row.contentType === null) &&
      (row.extractMode === "markdown" || row.extractMode === "text") &&
      (Number.isInteger(row.status) || row.status === null) &&
      typeof row.truncated === "boolean" &&
      typeof row.fetchedAt === "string" &&
      typeof row.tookMs === "number" &&
      (typeof row.warning === "string" || row.warning === null) &&
      externalContent?.untrusted === true &&
      externalContent.source === "web_fetch" &&
      externalContent.provider === "firecrawl" &&
      this.isBillingFacts(row.billingFacts)
    );
  }

  private isBrowserActionResult(value: unknown): value is ProviderGatewayBrowserActionResult {
    const row = this.asObject(value);
    const externalContent = this.asObject(row?.externalContent);
    return (
      row?.provider === "browserless" &&
      (row.action === "snapshot" || row.action === "act") &&
      typeof row.initialUrl === "string" &&
      typeof row.finalUrl === "string" &&
      (typeof row.title === "string" || row.title === null) &&
      typeof row.content === "string" &&
      typeof row.truncated === "boolean" &&
      Array.isArray(row.elements) &&
      row.elements.every((entry) => {
        const element = this.asObject(entry);
        return (
          element !== null &&
          typeof element.selector === "string" &&
          typeof element.tagName === "string" &&
          (typeof element.text === "string" || element.text === null) &&
          (typeof element.role === "string" || element.role === null) &&
          (typeof element.type === "string" || element.type === null) &&
          (typeof element.href === "string" || element.href === null) &&
          (typeof element.placeholder === "string" || element.placeholder === null) &&
          typeof element.disabled === "boolean"
        );
      }) &&
      typeof row.observedAt === "string" &&
      typeof row.tookMs === "number" &&
      (typeof row.warning === "string" || row.warning === null) &&
      externalContent?.untrusted === true &&
      externalContent.source === "browser" &&
      externalContent.provider === "browserless" &&
      this.isBillingFacts(row.billingFacts)
    );
  }

  private isTextStreamEvent(value: unknown): value is ProviderGatewayTextStreamEvent {
    const row = this.asObject(value);
    if (row?.type === "keepalive") {
      return true;
    }
    if (row?.type === "text_delta") {
      return typeof row.delta === "string" && typeof row.accumulatedText === "string";
    }
    if (row?.type === "completed") {
      return this.isTextGenerateResult(row.result);
    }
    if (row?.type === "tool_calls") {
      return this.isTextGenerateResult(row.result) && row.result.stopReason === "tool_calls";
    }
    if (row?.type === "failed") {
      return (
        typeof row.code === "string" &&
        typeof row.message === "string" &&
        (row.providerErrorKind === undefined ||
          row.providerErrorKind === null ||
          this.asTextProviderErrorKind(row.providerErrorKind) !== null) &&
        (row.providerErrorCode === undefined ||
          row.providerErrorCode === null ||
          typeof row.providerErrorCode === "string") &&
        (row.providerErrorType === undefined ||
          row.providerErrorType === null ||
          typeof row.providerErrorType === "string") &&
        (row.providerErrorStatus === undefined ||
          row.providerErrorStatus === null ||
          (typeof row.providerErrorStatus === "number" &&
            Number.isInteger(row.providerErrorStatus)))
      );
    }
    return false;
  }

  private asTextProviderErrorKind(value: unknown): ProviderGatewayTextErrorKind | null {
    switch (value) {
      case "billing_quota":
      case "rate_limit":
      case "capacity":
      case "provider_auth":
      case "invalid_request":
      case "timeout":
      case "server_error":
      case "unknown":
        return value;
      default:
        return null;
    }
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
}
