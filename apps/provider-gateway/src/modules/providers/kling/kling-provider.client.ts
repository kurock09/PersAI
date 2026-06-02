import { createHmac } from "node:crypto";
import { Inject, Injectable, Logger } from "@nestjs/common";
import type { ProviderGatewayConfig } from "@persai/config";
import type {
  ProviderGatewayVideoGenerateRequest,
  ProviderGatewayVideoGenerateResult,
  RuntimeBillingFacts
} from "@persai/runtime-contract";
import { PROVIDER_GATEWAY_CONFIG } from "../../../provider-gateway-config";

const KLING_API_BASE_URL = "https://api-singapore.klingai.com";
const KLING_DEFAULT_VIDEO_MODEL = "kling-v3";
const KLING_VIDEO_TIMEOUT_MS = 600_000;
const KLING_VIDEO_POLL_INTERVAL_MS = 5_000;
const KLING_MAX_TRANSIENT_POLL_FETCH_FAILURES = 3;
const KLING_JWT_TTL_SECONDS = 1_800;
const KLING_JWT_NOT_BEFORE_SKEW_SECONDS = 5;
const KLING_TEXT_TO_VIDEO_PATH = "/v1/videos/text2video";
const KLING_IMAGE_TO_VIDEO_PATH = "/v1/videos/image2video";

type KlingCredentials = {
  accessKey: string;
  secretKey: string;
};

type KlingTaskKind = "text2video" | "image2video";

type KlingAcceptedTask = {
  taskId: string;
  taskKind: KlingTaskKind;
  model: string;
  acceptedAt: string;
};

@Injectable()
export class KlingProviderClient {
  private readonly logger = new Logger(KlingProviderClient.name);

  constructor(@Inject(PROVIDER_GATEWAY_CONFIG) private readonly config: ProviderGatewayConfig) {}

  async generateVideo(
    input: ProviderGatewayVideoGenerateRequest,
    options?: { credentialValue?: string }
  ): Promise<ProviderGatewayVideoGenerateResult> {
    const credentials = this.resolveCredentials(options?.credentialValue);
    const model = input.model ?? KLING_DEFAULT_VIDEO_MODEL;
    const taskKind: KlingTaskKind = input.referenceImage === null ? "text2video" : "image2video";
    const authToken = this.createAuthToken(credentials);
    const { signal, dispose } = this.createTimedSignal(
      Math.max(this.config.PROVIDER_GATEWAY_REQUEST_TIMEOUT_MS, KLING_VIDEO_TIMEOUT_MS)
    );

    try {
      const acceptedTask = await this.resolveAcceptedTask(
        input,
        model,
        taskKind,
        authToken,
        signal
      );
      const completedTask = await this.pollTask(acceptedTask, authToken, signal);
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

  private async createTask(
    input: ProviderGatewayVideoGenerateRequest,
    model: string,
    taskKind: KlingTaskKind,
    authToken: string,
    signal: AbortSignal
  ): Promise<string> {
    const response = await fetch(`${KLING_API_BASE_URL}${this.taskPath(taskKind)}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${authToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(this.buildCreateTaskBody(input, model, taskKind)),
      signal
    });
    const body = await this.readJsonBody(response);
    if (!response.ok) {
      throw new Error(this.readKlingErrorMessage(body, response.status));
    }
    const taskId =
      this.readString(body, ["data", "task_id"]) ?? this.readString(body, ["data", "taskId"]);
    if (taskId === null) {
      throw new Error("Kling video generation returned an invalid task response.");
    }
    return taskId;
  }

  private async pollTask(
    acceptedTask: KlingAcceptedTask,
    authToken: string,
    signal: AbortSignal
  ): Promise<unknown> {
    let transientFetchFailures = 0;
    while (!signal.aborted) {
      await this.delay(KLING_VIDEO_POLL_INTERVAL_MS, signal);
      let response: Response;
      try {
        response = await fetch(
          `${KLING_API_BASE_URL}${this.taskPath(acceptedTask.taskKind)}/${encodeURIComponent(
            acceptedTask.taskId
          )}`,
          {
            method: "GET",
            headers: {
              Authorization: `Bearer ${authToken}`
            },
            signal
          }
        );
        transientFetchFailures = 0;
      } catch (error) {
        if (this.isAbortError(error) || signal.aborted) {
          throw error;
        }
        transientFetchFailures += 1;
        this.logTransportError({
          providerTaskId: acceptedTask.taskId,
          providerStage: "accepted",
          acceptedAt: acceptedTask.acceptedAt,
          transientFetchFailures,
          maxTransientFetchFailures: KLING_MAX_TRANSIENT_POLL_FETCH_FAILURES,
          message: error instanceof Error ? error.message : String(error)
        });
        if (transientFetchFailures >= KLING_MAX_TRANSIENT_POLL_FETCH_FAILURES) {
          throw this.buildPollingLossError(acceptedTask, error);
        }
        continue;
      }
      const body = await this.readJsonBody(response);
      if (!response.ok) {
        if (response.status === 408 || response.status === 429 || response.status >= 500) {
          continue;
        }
        throw new Error(this.readKlingErrorMessage(body, response.status));
      }
      const status = this.readTaskStatus(body);
      if (status === null) {
        throw new Error("Kling task status response was missing the task state.");
      }
      if (this.isPendingTaskStatus(status)) {
        continue;
      }
      if (this.isSucceededTaskStatus(status)) {
        return body;
      }
      if (this.isFailedTaskStatus(status)) {
        throw new Error(this.readKlingTaskFailureMessage(body, status));
      }
      continue;
    }
    throw new Error("Kling video generation polling stopped before a terminal task response.");
  }

  private async resolveAcceptedTask(
    input: ProviderGatewayVideoGenerateRequest,
    model: string,
    taskKind: KlingTaskKind,
    authToken: string,
    signal: AbortSignal
  ): Promise<KlingAcceptedTask> {
    const existing = this.normalizeAcceptedTask(input.acceptedTask, model);
    if (existing !== null) {
      return existing;
    }
    const taskId = await this.createTask(input, model, taskKind, authToken, signal);
    const acceptedAt = new Date().toISOString();
    this.logAccepted({
      providerTaskId: taskId,
      model,
      taskKind,
      acceptedAt
    });
    return {
      taskId,
      taskKind,
      model,
      acceptedAt
    };
  }

  private normalizeAcceptedTask(
    acceptedTask: ProviderGatewayVideoGenerateRequest["acceptedTask"],
    fallbackModel: string
  ): KlingAcceptedTask | null {
    if (
      acceptedTask === null ||
      acceptedTask === undefined ||
      acceptedTask.provider !== "kling" ||
      acceptedTask.providerStage !== "accepted"
    ) {
      return null;
    }
    const providerTaskId = this.asNonEmptyString(acceptedTask.providerTaskId);
    if (providerTaskId === null) {
      return null;
    }
    const taskKind = acceptedTask.taskKind === "image2video" ? "image2video" : "text2video";
    return {
      taskId: providerTaskId,
      taskKind,
      model: this.asNonEmptyString(acceptedTask.model) ?? fallbackModel,
      acceptedAt: this.asNonEmptyString(acceptedTask.acceptedAt) ?? new Date().toISOString()
    };
  }

  private buildPollingLossError(acceptedTask: KlingAcceptedTask, error: unknown): Error {
    const message = error instanceof Error ? error.message : String(error);
    const payload = {
      providerTaskId: acceptedTask.taskId,
      provider: "kling",
      model: acceptedTask.model,
      providerStage: "accepted",
      acceptedAt: acceptedTask.acceptedAt,
      code: "accepted_primary_unconfirmed",
      reason: "provider accepted but polling transport lost",
      message
    };
    return new Error(`PERSAI_VIDEO_POLLING_LOST::${JSON.stringify(payload)}`);
  }

  private logAccepted(input: {
    providerTaskId: string;
    model: string;
    taskKind: KlingTaskKind;
    acceptedAt: string;
  }): void {
    this.logger.log(
      `[video-kling] create accepted task_id=${input.providerTaskId} model=${input.model} taskKind=${input.taskKind} acceptedAt=${input.acceptedAt}`
    );
  }

  private logTransportError(input: {
    providerTaskId: string;
    providerStage: "accepted";
    acceptedAt: string;
    transientFetchFailures: number;
    maxTransientFetchFailures: number;
    message: string;
  }): void {
    this.logger.warn(
      `[video-kling] poll transport_error task_id=${input.providerTaskId} providerStage=${input.providerStage} acceptedAt=${input.acceptedAt} transientFailures=${String(
        input.transientFetchFailures
      )}/${String(input.maxTransientFetchFailures)} message=${input.message}`
    );
  }

  private readOutputUrl(body: unknown): string {
    const videoUrl =
      this.readString(body, ["data", "task_result", "videos", "0", "url"]) ??
      this.readString(body, ["data", "task_result", "video", "url"]) ??
      this.readString(body, ["data", "task_result", "url"]) ??
      this.readString(body, ["data", "videos", "0", "url"]) ??
      this.readString(body, ["data", "video", "url"]) ??
      this.readString(body, ["data", "response", "0"]) ??
      this.readString(body, ["data", "videoUrl"]) ??
      this.readString(body, ["data", "video_url"]) ??
      this.readString(body, ["data", "url"]);
    if (videoUrl === null) {
      throw new Error("Kling video generation completed without a downloadable video URL.");
    }
    return videoUrl;
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

  private buildCreateTaskBody(
    input: ProviderGatewayVideoGenerateRequest,
    model: string,
    taskKind: KlingTaskKind
  ): Record<string, unknown> {
    const body: Record<string, unknown> = {
      model_name: model,
      prompt: input.prompt,
      duration: String(input.seconds),
      aspect_ratio: this.toKlingAspectRatio(input.size),
      negative_prompt: "",
      mode: input.providerParameters?.mode ?? "pro",
      sound: input.providerParameters?.sound ?? "off"
    };
    if (taskKind === "image2video") {
      body.image = input.referenceImage?.bytesBase64 ?? null;
      if (input.referenceTailImage !== null && input.referenceTailImage !== undefined) {
        body.image_tail = input.referenceTailImage.bytesBase64;
      }
    }
    if (input.voiceIds !== null && input.voiceIds !== undefined && input.voiceIds.length > 0) {
      body.voice_list = input.voiceIds.map((voiceId) => ({ voice_id: voiceId }));
      body.sound = "on";
    }
    return body;
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
      this.readString(body, ["error", "message"]) ??
      this.readString(body, ["msg"]) ??
      this.readString(body, ["message"]) ??
      `Kling video generation request failed with status ${String(status)}.`
    );
  }

  private readKlingTaskFailureMessage(body: unknown, status: string): string {
    return (
      this.readString(body, ["data", "task_status_msg"]) ??
      this.readString(body, ["data", "taskStatusMsg"]) ??
      this.readString(body, ["data", "fail_reason"]) ??
      this.readString(body, ["data", "failReason"]) ??
      this.readString(body, ["data", "status_msg"]) ??
      this.readString(body, ["data", "statusMsg"]) ??
      this.readString(body, ["error", "message"]) ??
      this.readString(body, ["message"]) ??
      `Kling video generation ended with state "${status}".`
    );
  }

  private readTaskStatus(body: unknown): string | null {
    return (
      this.readString(body, ["data", "task_status"]) ??
      this.readString(body, ["data", "taskStatus"]) ??
      this.readString(body, ["data", "status"]) ??
      this.readString(body, ["data", "state"])
    );
  }

  private isPendingTaskStatus(status: string): boolean {
    return [
      "submitted",
      "pending",
      "queued",
      "processing",
      "running",
      "waiting",
      "queuing"
    ].includes(status.toLowerCase());
  }

  private isSucceededTaskStatus(status: string): boolean {
    return ["succeed", "success", "completed"].includes(status.toLowerCase());
  }

  private isFailedTaskStatus(status: string): boolean {
    return ["failed", "fail", "error", "cancelled", "canceled"].includes(status.toLowerCase());
  }

  private readString(value: unknown, path: string[]): string | null {
    let current: unknown = value;
    for (const key of path) {
      if (Array.isArray(current)) {
        const index = Number(key);
        if (!Number.isInteger(index) || index < 0 || index >= current.length) {
          return null;
        }
        current = current[index];
        continue;
      }
      if (current === null || typeof current !== "object" || Array.isArray(current)) {
        return null;
      }
      current = (current as Record<string, unknown>)[key];
    }
    return typeof current === "string" && current.trim().length > 0 ? current.trim() : null;
  }

  private readNumber(value: unknown, path: string[]): number | null {
    let current: unknown = value;
    for (const key of path) {
      if (current === null || typeof current !== "object" || Array.isArray(current)) {
        return null;
      }
      current = (current as Record<string, unknown>)[key];
    }
    return typeof current === "number" && Number.isFinite(current) ? current : null;
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

  private resolveCredentials(credentialValue?: string): KlingCredentials {
    if (typeof credentialValue !== "string" || credentialValue.trim().length === 0) {
      throw new Error(
        'Kling credentials are required and must be stored as JSON: {"accessKey":"...","secretKey":"..."}.'
      );
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(credentialValue);
    } catch {
      throw new Error(
        'Kling credentials must be valid JSON: {"accessKey":"...","secretKey":"..."}.'
      );
    }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error(
        'Kling credentials must be a JSON object with "accessKey" and "secretKey" string fields.'
      );
    }
    const accessKey =
      this.asNonEmptyString((parsed as Record<string, unknown>).accessKey) ??
      this.asNonEmptyString((parsed as Record<string, unknown>).access_key);
    const secretKey =
      this.asNonEmptyString((parsed as Record<string, unknown>).secretKey) ??
      this.asNonEmptyString((parsed as Record<string, unknown>).secret_key);
    if (accessKey === null || secretKey === null) {
      throw new Error(
        'Kling credentials JSON must include non-empty "accessKey" and "secretKey" string fields.'
      );
    }
    return {
      accessKey,
      secretKey
    };
  }

  private createAuthToken(credentials: KlingCredentials): string {
    const nowSeconds = Math.floor(Date.now() / 1000);
    const header = {
      alg: "HS256",
      typ: "JWT"
    };
    const payload = {
      iss: credentials.accessKey,
      exp: nowSeconds + KLING_JWT_TTL_SECONDS,
      nbf: nowSeconds - KLING_JWT_NOT_BEFORE_SKEW_SECONDS
    };
    const encodedHeader = this.base64UrlEncode(JSON.stringify(header));
    const encodedPayload = this.base64UrlEncode(JSON.stringify(payload));
    const signature = createHmac("sha256", credentials.secretKey)
      .update(`${encodedHeader}.${encodedPayload}`)
      .digest("base64url");
    return `${encodedHeader}.${encodedPayload}.${signature}`;
  }

  private taskPath(taskKind: KlingTaskKind): string {
    return taskKind === "image2video" ? KLING_IMAGE_TO_VIDEO_PATH : KLING_TEXT_TO_VIDEO_PATH;
  }

  private asNonEmptyString(value: unknown): string | null {
    return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
  }

  private base64UrlEncode(value: string): string {
    return Buffer.from(value, "utf8").toString("base64url");
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
