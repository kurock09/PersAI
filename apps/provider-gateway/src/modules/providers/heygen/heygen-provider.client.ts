import { Inject, Injectable, Logger } from "@nestjs/common";
import type { ProviderGatewayConfig } from "@persai/config";
import type {
  ProviderGatewayVideoGenerateRequest,
  ProviderGatewayVideoGenerateResult,
  RuntimeBillingFacts
} from "@persai/runtime-contract";
import { PROVIDER_GATEWAY_CONFIG } from "../../../provider-gateway-config";

/**
 * Typed error thrown by HeyGenProviderClient for HTTP-level failures.
 * Callers (e.g. ProviderHeyGenAvatarsService) inspect `httpStatus` to
 * distinguish bad-input 4xx from outage 5xx.
 */
export class HeyGenProviderClientError extends Error {
  constructor(
    message: string,
    public readonly httpStatus: number,
    public readonly providerMessage: string
  ) {
    super(message);
    this.name = "HeyGenProviderClientError";
  }
}

// HeyGen v3 API — all endpoints are v3 per ADR-109 erratum E6.
// Auth: X-Api-Key header (single-string key, NOT JSON like Kling).
// Submit requests carry Idempotency-Key per erratum E6.
const HEYGEN_API_BASE_URL = "https://api.heygen.com";
const HEYGEN_DEFAULT_VIDEO_MODEL = "heygen-photo-avatar-v3";
const HEYGEN_VIDEO_TIMEOUT_MS = 600_000;
const HEYGEN_VIDEO_POLL_INTERVAL_MS = 10_000; // 10s cadence per erratum E10
const HEYGEN_MAX_TRANSIENT_POLL_FETCH_FAILURES = 3;
const HEYGEN_SUBMIT_VIDEO_PATH = "/v3/videos";
const HEYGEN_AVATAR_CREATE_PATH = "/v3/avatars";
const HEYGEN_ASSETS_UPLOAD_PATH = "/v3/assets";

type HeyGenAcceptedTask = {
  videoId: string;
  model: string;
  acceptedAt: string;
};

@Injectable()
export class HeyGenProviderClient {
  private readonly logger = new Logger(HeyGenProviderClient.name);

  constructor(@Inject(PROVIDER_GATEWAY_CONFIG) private readonly config: ProviderGatewayConfig) {}

  async generateVideo(
    input: ProviderGatewayVideoGenerateRequest,
    options?: { credentialValue?: string }
  ): Promise<ProviderGatewayVideoGenerateResult> {
    const apiKey = this.resolveApiKey(options?.credentialValue);
    const model = input.model ?? HEYGEN_DEFAULT_VIDEO_MODEL;
    const { signal, dispose } = this.createTimedSignal(
      Math.max(this.config.PROVIDER_GATEWAY_REQUEST_TIMEOUT_MS, HEYGEN_VIDEO_TIMEOUT_MS)
    );

    try {
      const acceptedTask = await this.resolveAcceptedTask(input, model, apiKey, signal);
      const completedBody = await this.pollTask(acceptedTask, apiKey, signal);
      const videoUrl = this.readVideoUrl(completedBody);
      const durationSeconds = this.readRequiredDuration(completedBody);
      const video = await this.downloadVideo(videoUrl, signal);

      return {
        provider: "heygen",
        model,
        prompt: input.prompt,
        size: input.size,
        seconds: durationSeconds,
        video,
        respondedAt: new Date().toISOString(),
        usage: null,
        billingFacts: this.buildBillingFacts(model, durationSeconds),
        warning: null,
        lazyCreatedHeygenAvatarId: acceptedTask.lazyCreatedAvatarId ?? null
      };
    } catch (error) {
      if (this.isAbortError(error)) {
        throw new Error("HeyGen video generation timed out before the video was ready.");
      }
      throw error;
    } finally {
      dispose();
    }
  }

  // ── Scenario resolution ──────────────────────────────────────────────────

  private async resolveAcceptedTask(
    input: ProviderGatewayVideoGenerateRequest,
    model: string,
    apiKey: string,
    signal: AbortSignal
  ): Promise<HeyGenAcceptedTask & { lazyCreatedAvatarId: string | null }> {
    // Resume path: skip submit entirely when the task was already accepted.
    const existing = this.normalizeAcceptedTask(input.acceptedTask, model);
    if (existing !== null) {
      return { ...existing, lazyCreatedAvatarId: null };
    }

    const cachedAvatarId = this.asNonEmptyString(input.cachedHeygenAvatarId);
    const personaId = this.asNonEmptyString(input.personaId);

    if (cachedAvatarId !== null) {
      // Scenario C (cached): avatar_id already known — use directly.
      const videoId = await this.submitAvatarVideo(cachedAvatarId, input, apiKey, signal);
      const acceptedAt = new Date().toISOString();
      this.logAccepted({ videoId, model, scenario: "C_cached", acceptedAt });
      return { videoId, model, acceptedAt, lazyCreatedAvatarId: null };
    }

    if (input.cachedHeygenAvatarId === null && personaId !== null) {
      // Scenario C (lazy create): persona exists but HeyGen avatar not yet created.
      const newAvatarId = await this.lazyCreateAvatar(input, apiKey, signal);
      const videoId = await this.submitAvatarVideo(newAvatarId, input, apiKey, signal);
      const acceptedAt = new Date().toISOString();
      this.logAccepted({ videoId, model, scenario: "C_lazy", acceptedAt });
      return { videoId, model, acceptedAt, lazyCreatedAvatarId: newAvatarId };
    }

    if (personaId === null) {
      // Scenario A: ad-hoc, portrait supplied directly (no persona row).
      const videoId = await this.submitImageVideo(input, apiKey, signal);
      const acceptedAt = new Date().toISOString();
      this.logAccepted({ videoId, model, scenario: "A_adhoc", acceptedAt });
      return { videoId, model, acceptedAt, lazyCreatedAvatarId: null };
    }

    throw new Error(
      "talking_avatar_scenario_invalid: Cannot resolve HeyGen scenario from request fields. " +
        "Supply cachedHeygenAvatarId, (cachedHeygenAvatarId=null + personaId), or " +
        "(personaId=null + portraitImageBytesBase64)."
    );
  }

  private normalizeAcceptedTask(
    acceptedTask: ProviderGatewayVideoGenerateRequest["acceptedTask"],
    fallbackModel: string
  ): HeyGenAcceptedTask | null {
    if (
      acceptedTask === null ||
      acceptedTask === undefined ||
      acceptedTask.provider !== "heygen" ||
      acceptedTask.providerStage !== "accepted"
    ) {
      return null;
    }
    const videoId = this.asNonEmptyString(acceptedTask.providerTaskId);
    if (videoId === null) {
      return null;
    }
    return {
      videoId,
      model: this.asNonEmptyString(acceptedTask.model) ?? fallbackModel,
      acceptedAt: this.asNonEmptyString(acceptedTask.acceptedAt) ?? new Date().toISOString()
    };
  }

  // ── Public: standalone photo-avatar creation (ADR-109 Slice 5b / E12) ───────

  /**
   * Creates a HeyGen Photo Avatar from a portrait image (asset upload + avatar
   * create) WITHOUT submitting a video job. Called by `ProviderHeyGenAvatarsService`
   * for eager avatar creation at persona POST time.
   *
   * The same logic also backs the lazy-create defensive fallback path inside
   * `generateVideo` — `lazyCreateAvatar` delegates to this method.
   *
   * POST /v3/avatars is synchronous: the response body contains the avatar ID
   * ready to use. No polling is required. (Confirmed by Slice 6 lazy-create
   * behaviour; HeyGen docs were unreachable for independent verification.)
   *
   * @param options.signal  Optional abort signal. When omitted, a fresh 60s
   *   timeout is created internally. Pass the outer signal when calling from
   *   inside `generateVideo` so the overall timeout still applies.
   */
  async createPhotoAvatar(
    input: {
      name: string;
      portraitImageBytesBase64: string;
      portraitImageMimeType: string;
    },
    options: { credentialValue: string; signal?: AbortSignal }
  ): Promise<{ avatarId: string }> {
    const apiKey = this.resolveApiKey(options.credentialValue);

    // Use caller-supplied signal or create a 60s local timeout.
    let ownSignal: AbortSignal | undefined;
    let dispose: (() => void) | undefined;
    if (options.signal === undefined) {
      const timed = this.createTimedSignal(60_000);
      ownSignal = timed.signal;
      dispose = timed.dispose;
    }
    const signal = options.signal ?? ownSignal!;

    try {
      const mimeType = this.asNonEmptyString(input.portraitImageMimeType) ?? "image/jpeg";
      const assetId = await this.uploadAsset(
        input.portraitImageBytesBase64,
        mimeType,
        apiKey,
        signal
      );

      const idempotencyKey = crypto.randomUUID();
      this.logger.log(
        `[avatar-heygen] create name=${input.name} idempotency_key=${idempotencyKey}`
      );

      const body = {
        type: "photo",
        name: input.name,
        file: { type: "asset_id", asset_id: assetId }
      };

      const response = await fetch(`${HEYGEN_API_BASE_URL}${HEYGEN_AVATAR_CREATE_PATH}`, {
        method: "POST",
        headers: {
          "X-Api-Key": apiKey,
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey
        },
        body: JSON.stringify(body),
        signal
      });

      const responseBody = await this.readJsonBody(response);
      if (!response.ok) {
        const providerMessage = this.readHeyGenErrorMessage(responseBody, response.status);
        throw new HeyGenProviderClientError(providerMessage, response.status, providerMessage);
      }

      const avatarId =
        this.readString(responseBody, ["data", "avatar_item", "id"]) ??
        this.readString(responseBody, ["data", "avatar_item", "look_id"]) ??
        this.readString(responseBody, ["data", "id"]);
      if (avatarId === null) {
        throw new Error("HeyGen avatar creation returned a response missing avatar_item.id.");
      }

      this.logger.debug(`[avatar-heygen] created name=${input.name} avatar_id=${avatarId}`);
      return { avatarId };
    } finally {
      dispose?.();
    }
  }

  // ── Lazy avatar creation (Scenario C first-use defensive fallback) ────────

  private async lazyCreateAvatar(
    input: ProviderGatewayVideoGenerateRequest,
    apiKey: string,
    signal: AbortSignal
  ): Promise<string> {
    const portraitBytesBase64 = this.asNonEmptyString(input.portraitImageBytesBase64);
    if (portraitBytesBase64 === null) {
      throw new Error(
        "HeyGen lazy avatar creation requires portraitImageBytesBase64 to be non-empty."
      );
    }
    const mimeType = this.asNonEmptyString(input.portraitImageMimeType) ?? "image/jpeg";
    // Delegate to the public helper, threading the outer generateVideo signal
    // so the overall 600s timeout still governs this sub-step.
    const { avatarId } = await this.createPhotoAvatar(
      {
        name: `PersAI-persona-${String(input.personaId)}`,
        portraitImageBytesBase64: portraitBytesBase64,
        portraitImageMimeType: mimeType
      },
      { credentialValue: apiKey, signal }
    );
    return avatarId;
  }

  private async uploadAsset(
    bytesBase64: string,
    mimeType: string,
    apiKey: string,
    signal: AbortSignal
  ): Promise<string> {
    const buffer = Buffer.from(bytesBase64, "base64");
    const ext = mimeType === "image/png" ? "png" : "jpg";
    const filename = `portrait.${ext}`;

    const formData = new FormData();
    formData.append("file", new Blob([buffer], { type: mimeType }), filename);

    const response = await fetch(`${HEYGEN_API_BASE_URL}${HEYGEN_ASSETS_UPLOAD_PATH}`, {
      method: "POST",
      headers: {
        "X-Api-Key": apiKey
      },
      body: formData,
      signal
    });

    const responseBody = await this.readJsonBody(response);
    if (!response.ok) {
      throw new Error(this.readHeyGenErrorMessage(responseBody, response.status));
    }

    const assetId =
      this.readString(responseBody, ["data", "asset_id"]) ??
      this.readString(responseBody, ["data", "assetId"]);
    if (assetId === null) {
      throw new Error("HeyGen asset upload returned a response missing data.asset_id.");
    }
    return assetId;
  }

  // ── Video submission ──────────────────────────────────────────────────────

  private async submitAvatarVideo(
    avatarId: string,
    input: ProviderGatewayVideoGenerateRequest,
    apiKey: string,
    signal: AbortSignal
  ): Promise<string> {
    const voiceId = this.resolveVoiceId(input);
    const speechText = this.asNonEmptyString(input.speechText);

    if (voiceId === null) {
      throw new Error(
        "voice_required: HeyGen talking-avatar requires a voice_id. " +
          "Provide voiceKey (resolved from the HeyGen voice catalog) in the request."
      );
    }
    if (speechText === null) {
      throw new Error(
        "HeyGen talking-avatar requires non-empty speechText to synthesize the spoken script."
      );
    }

    const idempotencyKey = crypto.randomUUID();
    this.logger.log(
      `[video-heygen] submit type=avatar avatar_id=${avatarId} idempotency_key=${idempotencyKey}`
    );

    const body: Record<string, unknown> = {
      type: "avatar",
      avatar_id: avatarId,
      script: speechText,
      voice_id: voiceId,
      resolution: "1080p",
      aspect_ratio: "auto"
    };

    return this.submitVideoRequest(body, apiKey, idempotencyKey, signal);
  }

  private async submitImageVideo(
    input: ProviderGatewayVideoGenerateRequest,
    apiKey: string,
    signal: AbortSignal
  ): Promise<string> {
    const voiceId = this.resolveVoiceId(input);
    const speechText = this.asNonEmptyString(input.speechText);

    if (voiceId === null) {
      throw new Error(
        "voice_required: HeyGen talking-avatar requires a voice_id. " +
          "Provide voiceKey (resolved from the HeyGen voice catalog) in the request."
      );
    }
    if (speechText === null) {
      throw new Error(
        "HeyGen talking-avatar requires non-empty speechText to synthesize the spoken script."
      );
    }

    const portraitBytesBase64 = this.asNonEmptyString(input.portraitImageBytesBase64);
    if (portraitBytesBase64 === null) {
      throw new Error(
        "HeyGen ad-hoc Scenario A requires portraitImageBytesBase64 to be non-empty."
      );
    }

    // For type: "image", HeyGen accepts image input as an inline file object.
    // We use base64 format to avoid needing a pre-uploaded asset for ad-hoc requests.
    // Ref: https://developers.heygen.com/docs/upload-assets.md (base64 format section)
    const mimeType = this.asNonEmptyString(input.portraitImageMimeType) ?? "image/jpeg";
    const idempotencyKey = crypto.randomUUID();
    this.logger.log(`[video-heygen] submit type=image idempotency_key=${idempotencyKey}`);

    const body: Record<string, unknown> = {
      type: "image",
      image: {
        type: "base64",
        media_type: mimeType,
        data: portraitBytesBase64
      },
      script: speechText,
      voice_id: voiceId,
      resolution: "1080p",
      aspect_ratio: "auto"
    };

    return this.submitVideoRequest(body, apiKey, idempotencyKey, signal);
  }

  private async submitVideoRequest(
    body: Record<string, unknown>,
    apiKey: string,
    idempotencyKey: string,
    signal: AbortSignal
  ): Promise<string> {
    const response = await fetch(`${HEYGEN_API_BASE_URL}${HEYGEN_SUBMIT_VIDEO_PATH}`, {
      method: "POST",
      headers: {
        "X-Api-Key": apiKey,
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey
      },
      body: JSON.stringify(body),
      signal
    });

    const responseBody = await this.readJsonBody(response);
    if (!response.ok) {
      // 4xx (non-429): no retry, fail honestly with HeyGen's error message.
      // 5xx / 429 / 408: for submit, fail-fast (mirror Kling pattern).
      throw new Error(this.readHeyGenErrorMessage(responseBody, response.status));
    }

    const videoId =
      this.readString(responseBody, ["data", "video_id"]) ??
      this.readString(responseBody, ["data", "videoId"]);
    if (videoId === null) {
      throw new Error("HeyGen video submit returned a response missing data.video_id.");
    }
    return videoId;
  }

  // ── Polling ──────────────────────────────────────────────────────────────

  private async pollTask(
    acceptedTask: HeyGenAcceptedTask,
    apiKey: string,
    signal: AbortSignal
  ): Promise<unknown> {
    let transientFetchFailures = 0;
    while (!signal.aborted) {
      await this.delay(HEYGEN_VIDEO_POLL_INTERVAL_MS, signal);
      let response: Response;
      try {
        response = await fetch(
          `${HEYGEN_API_BASE_URL}${HEYGEN_SUBMIT_VIDEO_PATH}/${encodeURIComponent(acceptedTask.videoId)}`,
          {
            method: "GET",
            headers: {
              "X-Api-Key": apiKey
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
          videoId: acceptedTask.videoId,
          transientFetchFailures,
          maxTransientFetchFailures: HEYGEN_MAX_TRANSIENT_POLL_FETCH_FAILURES,
          message: error instanceof Error ? error.message : String(error)
        });
        if (transientFetchFailures >= HEYGEN_MAX_TRANSIENT_POLL_FETCH_FAILURES) {
          throw this.buildPollingLossError(acceptedTask, error);
        }
        continue;
      }

      const body = await this.readJsonBody(response);
      if (!response.ok) {
        if (response.status === 408 || response.status === 429 || response.status >= 500) {
          continue;
        }
        throw new Error(this.readHeyGenErrorMessage(body, response.status));
      }

      const status = this.readString(body, ["data", "status"]);
      if (status === null) {
        throw new Error("HeyGen poll response was missing data.status.");
      }

      // Invariant #15 (E7): defensive status parsing.
      // Terminal SUCCESS = exact string "completed" only.
      // Terminal FAILED  = exact string "failed" only.
      // EVERYTHING ELSE  = in-progress (continue polling).
      // This explicitly covers "pending", "processing", "waiting" (seen in create
      // responses) and any future undocumented value. NO regex, NO keyword list.
      if (status === "completed") {
        return body;
      }
      if (status === "failed") {
        const reason =
          this.readString(body, ["data", "failure_message"]) ??
          this.readString(body, ["data", "failureMessage"]) ??
          this.readString(body, ["data", "error"]) ??
          `HeyGen video generation ended with status "failed".`;
        throw new Error(reason);
      }
      // Any other value (pending, processing, waiting, or undocumented) → in-progress.
      continue;
    }
    throw new Error("HeyGen video generation polling stopped before a terminal status.");
  }

  // ── Result extraction ─────────────────────────────────────────────────────

  private readVideoUrl(body: unknown): string {
    const videoUrl =
      this.readString(body, ["data", "video_url"]) ??
      this.readString(body, ["data", "videoUrl"]) ??
      this.readString(body, ["data", "url"]);
    if (videoUrl === null) {
      throw new Error("HeyGen video generation completed without a downloadable video_url.");
    }
    return videoUrl;
  }

  private readRequiredDuration(body: unknown): number {
    // Per forbidden pattern: NO fake billingFacts when duration is missing.
    // Throw an honest error instead.
    const duration =
      this.readNumber(body, ["data", "duration"]) ??
      this.readNumber(body, ["data", "durationSeconds"]);
    if (duration === null || duration <= 0) {
      throw new Error(
        "heygen_duration_missing: HeyGen completed response did not include a positive duration. " +
          "Cannot build honest billingFacts without the actual render duration."
      );
    }
    return duration;
  }

  private async downloadVideo(
    url: string,
    signal: AbortSignal
  ): Promise<ProviderGatewayVideoGenerateResult["video"]> {
    const response = await fetch(url, { method: "GET", signal });
    if (!response.ok) {
      throw new Error(`HeyGen video download failed with status ${String(response.status)}.`);
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length === 0) {
      throw new Error("HeyGen video generation returned an empty video payload.");
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

  // ── Billing ───────────────────────────────────────────────────────────────

  private buildBillingFacts(model: string, durationSeconds: number): RuntimeBillingFacts {
    return {
      providerKey: "heygen",
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

  // ── Error helpers ─────────────────────────────────────────────────────────

  private buildPollingLossError(acceptedTask: HeyGenAcceptedTask, error: unknown): Error {
    const message = error instanceof Error ? error.message : String(error);
    const payload = {
      providerTaskId: acceptedTask.videoId,
      provider: "heygen",
      model: acceptedTask.model,
      providerStage: "accepted",
      acceptedAt: acceptedTask.acceptedAt,
      code: "accepted_primary_unconfirmed",
      reason: "provider accepted but polling transport lost",
      message
    };
    return new Error(`PERSAI_VIDEO_POLLING_LOST::${JSON.stringify(payload)}`);
  }

  private readHeyGenErrorMessage(body: unknown, status: number): string {
    return (
      this.readString(body, ["error", "message"]) ??
      this.readString(body, ["data", "error"]) ??
      this.readString(body, ["message"]) ??
      this.readString(body, ["msg"]) ??
      `HeyGen request failed with HTTP status ${String(status)}.`
    );
  }

  // ── Logging ───────────────────────────────────────────────────────────────

  private logAccepted(input: {
    videoId: string;
    model: string;
    scenario: string;
    acceptedAt: string;
  }): void {
    this.logger.log(
      `[video-heygen] submit accepted video_id=${input.videoId} model=${input.model} scenario=${input.scenario} acceptedAt=${input.acceptedAt}`
    );
  }

  private logTransportError(input: {
    videoId: string;
    transientFetchFailures: number;
    maxTransientFetchFailures: number;
    message: string;
  }): void {
    this.logger.warn(
      `[video-heygen] poll transport_error video_id=${input.videoId} transientFailures=${String(
        input.transientFetchFailures
      )}/${String(input.maxTransientFetchFailures)} message=${input.message}`
    );
  }

  // ── Field resolution ──────────────────────────────────────────────────────

  private resolveVoiceId(input: ProviderGatewayVideoGenerateRequest): string | null {
    // Prefer voiceKey (set by model from the HeyGen voice catalog per erratum E9).
    // Fallback to voiceIds[0] for compatibility with the existing pattern.
    const voiceKey = this.asNonEmptyString(input.voiceKey);
    if (voiceKey !== null) {
      return voiceKey;
    }
    if (
      Array.isArray(input.voiceIds) &&
      input.voiceIds.length > 0 &&
      typeof input.voiceIds[0] === "string" &&
      input.voiceIds[0].trim().length > 0
    ) {
      return input.voiceIds[0].trim();
    }
    return null;
  }

  private resolveApiKey(credentialValue?: string): string {
    if (typeof credentialValue !== "string" || credentialValue.trim().length === 0) {
      throw new Error(
        "HeyGen API key is required. Store it as a plain string in the HeyGen credential slot."
      );
    }
    return credentialValue.trim();
  }

  // ── Utility ───────────────────────────────────────────────────────────────

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

  private asNonEmptyString(value: unknown): string | null {
    return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
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
