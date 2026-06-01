import { Inject, Injectable } from "@nestjs/common";
import type { ProviderGatewayConfig } from "@persai/config";
import type {
  ProviderGatewayVideoGenerateRequest,
  ProviderGatewayVideoGenerateResult,
  RuntimeBillingFacts
} from "@persai/runtime-contract";
import { PROVIDER_GATEWAY_CONFIG } from "../../../provider-gateway-config";

const RUNWAY_API_BASE_URL = "https://api.dev.runwayml.com/v1";
const RUNWAY_API_VERSION = "2024-11-06";
const RUNWAY_DEFAULT_VIDEO_MODEL = "gen4.5";
const RUNWAY_VIDEO_TIMEOUT_MS = 600_000;
const RUNWAY_VIDEO_POLL_INTERVAL_MS = 5_000;

@Injectable()
export class RunwayProviderClient {
  constructor(@Inject(PROVIDER_GATEWAY_CONFIG) private readonly config: ProviderGatewayConfig) {}

  async generateVideo(
    input: ProviderGatewayVideoGenerateRequest,
    options?: { apiKey?: string }
  ): Promise<ProviderGatewayVideoGenerateResult> {
    const apiKey = this.resolveApiKey(options?.apiKey);
    const model = input.model ?? RUNWAY_DEFAULT_VIDEO_MODEL;
    const { signal, dispose } = this.createTimedSignal(
      Math.max(this.config.PROVIDER_GATEWAY_REQUEST_TIMEOUT_MS, RUNWAY_VIDEO_TIMEOUT_MS)
    );

    try {
      const createdTaskId = await this.createTask(input, model, apiKey, signal);
      const completedTask = await this.pollTask(createdTaskId, apiKey, signal);
      const outputUrl = this.readOutputUrl(completedTask);
      const video = await this.downloadVideo(outputUrl, signal);

      return {
        provider: "runway",
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
        throw new Error("Runway video generation timed out before the video was ready.");
      }
      throw error;
    } finally {
      dispose();
    }
  }

  private async createTask(
    input: ProviderGatewayVideoGenerateRequest,
    model: string,
    apiKey: string,
    signal: AbortSignal
  ): Promise<string> {
    const response = await fetch(`${RUNWAY_API_BASE_URL}/image_to_video`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "X-Runway-Version": RUNWAY_API_VERSION
      },
      body: JSON.stringify({
        model,
        promptText: input.prompt,
        promptImage:
          input.referenceImage === null
            ? undefined
            : this.toDataUri(input.referenceImage.bytesBase64, input.referenceImage.mimeType),
        ratio: this.toRunwayRatio(input.size),
        duration: this.toRunwayDurationSeconds(input.seconds)
      }),
      signal
    });
    const body = await this.readJsonBody(response);
    if (!response.ok) {
      throw new Error(this.readRunwayErrorMessage(body, response.status));
    }
    const taskId = this.readString(body, ["id"]) ?? this.readString(body, ["taskId"]);
    if (taskId === null) {
      throw new Error("Runway video generation returned an invalid task response.");
    }
    return taskId;
  }

  private async pollTask(taskId: string, apiKey: string, signal: AbortSignal): Promise<unknown> {
    while (true) {
      await this.delay(RUNWAY_VIDEO_POLL_INTERVAL_MS, signal);
      const response = await fetch(`${RUNWAY_API_BASE_URL}/tasks/${encodeURIComponent(taskId)}`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "X-Runway-Version": RUNWAY_API_VERSION
        },
        signal
      });
      const body = await this.readJsonBody(response);
      if (!response.ok) {
        if (response.status === 408 || response.status === 429 || response.status >= 500) {
          continue;
        }
        throw new Error(this.readRunwayErrorMessage(body, response.status));
      }

      const status = this.readString(body, ["status"]);
      switch (status) {
        case "RUNNING":
        case "PENDING":
        case "THROTTLED":
        case "queued":
        case "processing":
          continue;
        case "SUCCEEDED":
        case "succeeded":
          return body;
        case "FAILED":
        case "failed":
        case "CANCELLED":
        case "cancelled":
          throw new Error(this.readRunwayTerminalStatusMessage(body, status ?? "failed"));
        default:
          if (status === null) {
            throw new Error("Runway task status response was missing the task status.");
          }
          continue;
      }
    }
  }

  private readOutputUrl(body: unknown): string {
    if (!Array.isArray((body as { output?: unknown[] } | null)?.output)) {
      throw new Error("Runway video generation completed without an output URL.");
    }
    const output = (body as { output: unknown[] }).output;
    const firstUrl = output.find(
      (entry): entry is string => typeof entry === "string" && entry.trim().length > 0
    );
    if (!firstUrl) {
      throw new Error("Runway video generation completed without a downloadable video URL.");
    }
    return firstUrl.trim();
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
      throw new Error(`Runway video download failed with status ${String(response.status)}.`);
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length === 0) {
      throw new Error("Runway video generation returned an empty video payload.");
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

  private toRunwayRatio(size: ProviderGatewayVideoGenerateRequest["size"]): string | undefined {
    switch (size) {
      case "1280x720":
      case "1792x1024":
        return "1280:768";
      case "720x1280":
      case "1024x1792":
        return "768:1280";
      case null:
      case undefined:
        return undefined;
    }
  }

  private toRunwayDurationSeconds(seconds: ProviderGatewayVideoGenerateRequest["seconds"]): number {
    const duration = Number(seconds);
    if (!Number.isInteger(duration) || duration <= 0 || duration > 10) {
      throw new Error(
        `Runway model "${RUNWAY_DEFAULT_VIDEO_MODEL}" supports durations up to 10 seconds; received ${String(seconds)}.`
      );
    }
    return duration;
  }

  private buildBillingFacts(
    model: string,
    seconds: ProviderGatewayVideoGenerateRequest["seconds"]
  ): RuntimeBillingFacts {
    const durationSeconds = Number(seconds);
    return {
      providerKey: "runway",
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

  private readRunwayErrorMessage(body: unknown, status: number): string {
    const message =
      this.readString(body, ["error", "message"]) ??
      this.readString(body, ["message"]) ??
      this.readString(body, ["title"]);
    return message ?? `Runway video generation request failed with status ${String(status)}.`;
  }

  private readRunwayTerminalStatusMessage(body: unknown, status: string): string {
    return (
      this.readString(body, ["failure", "reason"]) ??
      this.readString(body, ["failureCode"]) ??
      this.readString(body, ["error", "message"]) ??
      `Runway video generation ended with status "${status}".`
    );
  }

  private toDataUri(bytesBase64: string, mimeType: string): string {
    return `data:${mimeType};base64,${bytesBase64}`;
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
    throw new Error("Runway API key is required.");
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
