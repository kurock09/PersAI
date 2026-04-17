import {
  BadGatewayException,
  BadRequestException,
  Inject,
  Injectable,
  ServiceUnavailableException
} from "@nestjs/common";
import type { RuntimeConfig } from "@persai/config";
import type {
  ProviderGatewayBrowserActionRequest,
  ProviderGatewayBrowserActionResult,
  ProviderGatewayAudioTranscriptionResult,
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

interface JsonResponse {
  ok: boolean;
  status: number;
  body: unknown;
}

const DIRECT_INPUT_PAYLOAD_TOO_LARGE_MESSAGE =
  "Current-turn file payload is too large for direct model input. Remove some files or send a smaller file.";
const PROVIDER_GATEWAY_READY_TIMEOUT_MS = 10_000;

@Injectable()
export class ProviderGatewayClientService {
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

    const response = await this.fetchJson(
      this.buildUrl("/api/v1/providers/generate-text"),
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

  async generateImage(
    input: ProviderGatewayImageGenerateRequest
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
        body: JSON.stringify(input)
      },
      this.config.RUNTIME_PROVIDER_GATEWAY_TIMEOUT_MS
    );
    if (!response.ok) {
      throw this.toGatewayException(response);
    }
    if (!this.isImageGenerateResult(response.body)) {
      throw new BadGatewayException(
        "Provider gateway returned an invalid image generation response."
      );
    }

    return response.body;
  }

  async editImage(input: ProviderGatewayImageEditRequest): Promise<ProviderGatewayImageEditResult> {
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
        body: JSON.stringify(input)
      },
      this.config.RUNTIME_PROVIDER_GATEWAY_TIMEOUT_MS
    );
    if (!response.ok) {
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
      throw this.toGatewayException(response);
    }
    if (!this.isVideoGenerateResult(response.body)) {
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

  async webFetch(input: ProviderGatewayWebFetchRequest): Promise<ProviderGatewayWebFetchResult> {
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
      this.config.RUNTIME_PROVIDER_GATEWAY_TIMEOUT_MS
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
    options?: { signal?: AbortSignal }
  ): Promise<AsyncGenerator<ProviderGatewayTextStreamEvent>> {
    if (!this.isConfigured()) {
      throw new ServiceUnavailableException("Runtime provider gateway base URL is not configured.");
    }

    const { signal, dispose } = this.createTimedSignal(
      this.config.RUNTIME_PROVIDER_GATEWAY_STREAM_TIMEOUT_MS,
      options?.signal
    );
    let response: Response;
    try {
      response = await this.fetchWithSignal(
        this.buildUrl("/api/v1/providers/stream-text"),
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify(input)
        },
        signal,
        this.config.RUNTIME_PROVIDER_GATEWAY_STREAM_TIMEOUT_MS,
        options?.signal
      );
    } catch (error) {
      dispose();
      throw error;
    }
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

    return this.readTextStreamEvents(response, dispose, options?.signal);
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
        throw new ServiceUnavailableException(
          `Provider gateway request timed out after ${timeoutMs}ms.`
        );
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
    dispose: () => void,
    externalSignal?: AbortSignal
  ): AsyncGenerator<ProviderGatewayTextStreamEvent> {
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
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
      dispose();
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
  ): BadGatewayException | BadRequestException | ServiceUnavailableException {
    const message = this.extractErrorMessage(response.body);
    if (this.isPayloadTooLargeFailure(response.status, message)) {
      return new BadRequestException(DIRECT_INPUT_PAYLOAD_TOO_LARGE_MESSAGE);
    }
    if (response.status === 400) {
      return new BadRequestException(
        message ?? `Provider gateway rejected the request with status ${response.status}.`
      );
    }
    if (response.status >= 500) {
      return new ServiceUnavailableException(
        message ?? `Provider gateway request failed with status ${response.status}.`
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
      (row.provider === "openai" || row.provider === "anthropic") &&
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
      typeof row.respondedAt === "string"
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
      (typeof row.warning === "string" || row.warning === null)
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
      (typeof row.warning === "string" || row.warning === null)
    );
  }

  private isVideoGenerateResult(value: unknown): value is ProviderGatewayVideoGenerateResult {
    const row = this.asObject(value);
    const video = this.asObject(row?.video);
    return (
      row?.provider === "openai" &&
      typeof row.model === "string" &&
      typeof row.prompt === "string" &&
      (row.size === "720x1280" ||
        row.size === "1280x720" ||
        row.size === "1024x1792" ||
        row.size === "1792x1024" ||
        row.size === null) &&
      (row.seconds === 4 || row.seconds === 8 || row.seconds === 12) &&
      typeof video?.bytesBase64 === "string" &&
      typeof video.mimeType === "string" &&
      typeof row.respondedAt === "string" &&
      (row.usage === null ||
        (typeof row.usage === "object" && row.usage !== null && !Array.isArray(row.usage))) &&
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
      (typeof row.warning === "string" || row.warning === null)
    );
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
      externalContent.provider === row.provider
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
      externalContent.provider === "firecrawl"
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
      externalContent.provider === "browserless"
    );
  }

  private isTextStreamEvent(value: unknown): value is ProviderGatewayTextStreamEvent {
    const row = this.asObject(value);
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
      return typeof row.code === "string" && typeof row.message === "string";
    }
    return false;
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
