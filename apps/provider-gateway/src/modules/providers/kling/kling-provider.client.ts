import { Inject, Injectable } from "@nestjs/common";
import type { ProviderGatewayConfig } from "@persai/config";
import type {
  ProviderGatewayVideoGenerateRequest,
  ProviderGatewayVideoGenerateResult,
  RuntimeBillingFacts
} from "@persai/runtime-contract";
import { PROVIDER_GATEWAY_CONFIG } from "../../../provider-gateway-config";

const KLING_API_BASE_URL = "https://api.kie.ai";
const KLING_UPLOAD_BASE_URL = "https://kieai.redpandaai.co";
const KLING_DEFAULT_VIDEO_MODEL = "kling-3.0/video";
const KLING_VIDEO_TIMEOUT_MS = 600_000;
const KLING_VIDEO_POLL_INTERVAL_MS = 5_000;

@Injectable()
export class KlingProviderClient {
  constructor(@Inject(PROVIDER_GATEWAY_CONFIG) private readonly config: ProviderGatewayConfig) {}

  async generateVideo(
    input: ProviderGatewayVideoGenerateRequest,
    options?: { apiKey?: string }
  ): Promise<ProviderGatewayVideoGenerateResult> {
    const apiKey = this.resolveApiKey(options?.apiKey);
    const model = input.model ?? KLING_DEFAULT_VIDEO_MODEL;
    const { signal, dispose } = this.createTimedSignal(
      Math.max(this.config.PROVIDER_GATEWAY_REQUEST_TIMEOUT_MS, KLING_VIDEO_TIMEOUT_MS)
    );

    try {
      const referenceImageUrl =
        input.referenceImage === null
          ? null
          : await this.uploadReferenceImage(input.referenceImage, apiKey, signal);
      const taskId = await this.createTask(input, model, referenceImageUrl, apiKey, signal);
      const completedTask = await this.pollTask(taskId, apiKey, signal);
      const outputUrl = this.readOutputUrl(completedTask);
      const video = await this.downloadVideo(outputUrl, signal);

      return {
        provider: "kling",
        model,
        prompt: input.prompt,
        size: input.size,
        seconds: input.seconds,
        video,
        respondedAt: new Date().toISOString(),
        usage: null,
        billingFacts: this.buildBillingFacts(model, input.seconds),
        warning: null
      };
    } catch (error) {
      if (this.isAbortError(error)) {
        throw new Error("Kling video generation timed out before the video was ready.");
      }
      throw error;
    } finally {
      dispose();
    }
  }

  private async uploadReferenceImage(
    referenceImage: NonNullable<ProviderGatewayVideoGenerateRequest["referenceImage"]>,
    apiKey: string,
    signal: AbortSignal
  ): Promise<string> {
    const filename = this.normalizeFilename(referenceImage.filename, referenceImage.mimeType);
    const formData = new FormData();
    formData.append(
      "file",
      new Blob([Uint8Array.from(Buffer.from(referenceImage.bytesBase64, "base64"))], {
        type: referenceImage.mimeType
      }),
      filename
    );
    formData.append("uploadPath", "images/persai-video");
    formData.append("fileName", filename);

    const response = await fetch(`${KLING_UPLOAD_BASE_URL}/api/file-stream-upload`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`
      },
      body: formData,
      signal
    });
    const body = await this.readJsonBody(response);
    if (!response.ok) {
      throw new Error(this.readKlingUploadErrorMessage(body, response.status));
    }
    const downloadUrl = this.readString(body, ["data", "downloadUrl"]);
    if (downloadUrl === null) {
      throw new Error("Kling file upload completed without a download URL.");
    }
    return downloadUrl;
  }

  private async createTask(
    input: ProviderGatewayVideoGenerateRequest,
    model: string,
    referenceImageUrl: string | null,
    apiKey: string,
    signal: AbortSignal
  ): Promise<string> {
    const response = await fetch(`${KLING_API_BASE_URL}/api/v1/jobs/createTask`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model,
        input: {
          prompt: input.prompt,
          image_urls: referenceImageUrl === null ? undefined : [referenceImageUrl],
          sound: false,
          duration: String(input.seconds),
          aspect_ratio: this.toKlingAspectRatio(input.size),
          mode: "pro",
          multi_shots: false,
          multi_prompt: []
        }
      }),
      signal
    });
    const body = await this.readJsonBody(response);
    if (!response.ok) {
      throw new Error(this.readKlingErrorMessage(body, response.status));
    }
    const taskId = this.readString(body, ["data", "taskId"]);
    if (taskId === null) {
      throw new Error("Kling video generation returned an invalid task response.");
    }
    return taskId;
  }

  private async pollTask(taskId: string, apiKey: string, signal: AbortSignal): Promise<unknown> {
    while (!signal.aborted) {
      await this.delay(KLING_VIDEO_POLL_INTERVAL_MS, signal);
      const response = await fetch(
        `${KLING_API_BASE_URL}/api/v1/jobs/recordInfo?taskId=${encodeURIComponent(taskId)}`,
        {
          method: "GET",
          headers: {
            Authorization: `Bearer ${apiKey}`
          },
          signal
        }
      );
      const body = await this.readJsonBody(response);
      if (!response.ok) {
        if (response.status === 408 || response.status === 429 || response.status >= 500) {
          continue;
        }
        throw new Error(this.readKlingErrorMessage(body, response.status));
      }
      const state = this.readString(body, ["data", "state"]);
      switch (state) {
        case "waiting":
        case "queuing":
        case "generating":
          continue;
        case "success":
          return body;
        case "fail":
          throw new Error(
            this.readString(body, ["data", "failMsg"]) ??
              `Kling video generation ended with state "${state}".`
          );
        default:
          if (state === null) {
            throw new Error("Kling task status response was missing the task state.");
          }
          continue;
      }
    }
    throw new Error("Kling video generation polling stopped before a terminal task response.");
  }

  private readOutputUrl(body: unknown): string {
    const resultJson = this.readString(body, ["data", "resultJson"]);
    if (resultJson === null) {
      throw new Error("Kling video generation completed without resultJson.");
    }
    try {
      const parsed = JSON.parse(resultJson) as { resultUrls?: unknown[] };
      const firstUrl = parsed.resultUrls?.find(
        (entry): entry is string => typeof entry === "string" && entry.trim().length > 0
      );
      if (!firstUrl) {
        throw new Error();
      }
      return firstUrl.trim();
    } catch {
      throw new Error("Kling video generation completed without a downloadable video URL.");
    }
  }

  private async downloadVideo(
    url: string,
    signal: AbortSignal
  ): Promise<ProviderGatewayVideoGenerateResult["video"]> {
    const response = await fetch(url, {
      method: "GET",
      signal
    });
    if (!response.ok) {
      throw new Error(`Kling video download failed with status ${String(response.status)}.`);
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length === 0) {
      throw new Error("Kling video generation returned an empty video payload.");
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

  private toKlingAspectRatio(size: ProviderGatewayVideoGenerateRequest["size"]): string {
    switch (size) {
      case "1280x720":
      case "1792x1024":
        return "16:9";
      case "720x1280":
      case "1024x1792":
        return "9:16";
      case null:
      case undefined:
        return "16:9";
    }
  }

  private normalizeFilename(filename: string | null, mimeType: string): string {
    const trimmed = typeof filename === "string" ? filename.trim() : "";
    if (trimmed.length > 0) {
      return trimmed;
    }
    switch (mimeType) {
      case "image/jpeg":
      case "image/jpg":
        return "reference.jpg";
      case "image/webp":
        return "reference.webp";
      case "image/png":
      default:
        return "reference.png";
    }
  }

  private buildBillingFacts(
    model: string,
    seconds: ProviderGatewayVideoGenerateRequest["seconds"]
  ): RuntimeBillingFacts {
    const durationSeconds = Number(seconds);
    return {
      providerKey: "kling",
      modelKey: model,
      capability: "video",
      occurredAt: new Date().toISOString(),
      metering: {
        meteringKind: "time_metered",
        durationMs: Math.round(durationSeconds * 1000),
        durationSeconds
      }
    };
  }

  private readKlingErrorMessage(body: unknown, status: number): string {
    return (
      this.readString(body, ["msg"]) ??
      this.readString(body, ["message"]) ??
      `Kling video generation request failed with status ${String(status)}.`
    );
  }

  private readKlingUploadErrorMessage(body: unknown, status: number): string {
    return (
      this.readString(body, ["msg"]) ??
      `Kling reference-image upload failed with status ${String(status)}.`
    );
  }

  private readString(value: unknown, path: string[]): string | null {
    let current: unknown = value;
    for (const key of path) {
      if (current === null || typeof current !== "object" || Array.isArray(current)) {
        return null;
      }
      current = (current as Record<string, unknown>)[key];
    }
    return typeof current === "string" && current.trim().length > 0 ? current.trim() : null;
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

  private resolveApiKey(apiKey?: string): string {
    if (typeof apiKey === "string" && apiKey.trim().length > 0) {
      return apiKey.trim();
    }
    throw new Error("Kling API key is required.");
  }

  private createTimedSignal(timeoutMs: number): { signal: AbortSignal; dispose: () => void } {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    return {
      signal: controller.signal,
      dispose: () => clearTimeout(timeoutId)
    };
  }

  private async delay(ms: number, signal: AbortSignal): Promise<void> {
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

  private isAbortError(error: unknown): boolean {
    return error instanceof Error && error.name === "AbortError";
  }
}
