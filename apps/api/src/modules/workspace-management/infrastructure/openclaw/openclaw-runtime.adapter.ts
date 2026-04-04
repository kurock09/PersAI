import { Injectable } from "@nestjs/common";
import { loadApiConfig } from "@persai/config";
import {
  ApiErrorHttpException,
  type ApiErrorObject
} from "../../../platform-core/interface/http/api-error";
import {
  normalizeRuntimeBaseUrl,
  resolveRuntimeBaseUrl
} from "../../application/runtime-endpoint-routing";
import type {
  AssistantRuntimeAdapter,
  AssistantRuntimeApplyInput,
  AssistantRuntimeChannelTurnInput,
  AssistantRuntimeCronControlInput,
  AssistantRuntimeMediaDownloadResult,
  AssistantRuntimeMediaUploadInput,
  AssistantRuntimeMediaUploadResult,
  AssistantRuntimePreflightResult,
  AssistantRuntimeSetupPreviewTurnInput,
  AssistantRuntimeSetupPreviewTurnResult,
  AssistantRuntimeTranscribeResult,
  AssistantRuntimeWebChatSessionDeleteInput,
  AssistantRuntimeWebChatTurnStreamChunk,
  AssistantRuntimeWebChatTurnInput,
  AssistantRuntimeWebChatTurnResult,
  RuntimeMediaArtifact
} from "../../application/assistant-runtime-adapter.types";
import { AssistantRuntimeAdapterError } from "../../application/assistant-runtime-adapter.types";
import type { RuntimeTier } from "../../application/runtime-assignment";

type JsonObject = Record<string, unknown>;

interface OpenClawAdapterConfig {
  enabled: boolean;
  baseUrl: string;
  token: string;
  timeoutMs: number;
  maxRetries: number;
}

interface OpenClawRequestOptions {
  acceptedErrorStatuses?: number[];
}

function isObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

const VALID_MEDIA_TYPES = new Set(["image", "audio", "video", "document"]);

function parseMediaArray(raw: unknown): RuntimeMediaArtifact[] {
  if (!Array.isArray(raw)) return [];
  const result: RuntimeMediaArtifact[] = [];
  for (const item of raw) {
    if (!isObject(item)) continue;
    const url = typeof item.url === "string" ? item.url.trim() : "";
    const type = typeof item.type === "string" ? item.type.trim() : "";
    if (!url || !VALID_MEDIA_TYPES.has(type)) continue;
    result.push({
      url,
      type: type as RuntimeMediaArtifact["type"],
      ...(item.audioAsVoice === true ? { audioAsVoice: true } : {})
    });
  }
  return result;
}

function toBooleanValue(payload: JsonObject, key: string): boolean | null {
  const value = payload[key];
  return typeof value === "boolean" ? value : null;
}

function parseApiErrorResponse(payload: unknown): ApiErrorObject | null {
  if (!isObject(payload)) {
    return null;
  }
  const error = isObject(payload.error) ? payload.error : payload;
  if (
    typeof error.code !== "string" ||
    typeof error.category !== "string" ||
    typeof error.message !== "string"
  ) {
    return null;
  }

  return {
    code: error.code,
    category: error.category,
    message: error.message,
    ...(isObject(error.details) ? { details: error.details } : {})
  } as ApiErrorObject;
}

function toOpenClawAdapterConfig(runtimeTier?: RuntimeTier): OpenClawAdapterConfig {
  const config = loadApiConfig(process.env);
  const freeSharedRestrictedUrl = normalizeRuntimeBaseUrl(
    config.OPENCLAW_BASE_URL_FREE_SHARED_RESTRICTED
  );
  const paidSharedRestrictedUrl = normalizeRuntimeBaseUrl(
    config.OPENCLAW_BASE_URL_PAID_SHARED_RESTRICTED
  );
  const paidIsolatedUrl = normalizeRuntimeBaseUrl(config.OPENCLAW_BASE_URL_PAID_ISOLATED);
  if (!freeSharedRestrictedUrl || !paidSharedRestrictedUrl || !paidIsolatedUrl) {
    throw new Error("OpenClaw tier base URLs must be configured explicitly.");
  }
  const resolvedEndpoint = resolveRuntimeBaseUrl({
    config: {
      tierBaseUrls: {
        free_shared_restricted: freeSharedRestrictedUrl,
        paid_shared_restricted: paidSharedRestrictedUrl,
        paid_isolated: paidIsolatedUrl
      }
    },
    runtimeTier
  });
  return {
    enabled: config.OPENCLAW_ADAPTER_ENABLED,
    baseUrl: resolvedEndpoint.baseUrl,
    token: config.OPENCLAW_GATEWAY_TOKEN ?? "",
    timeoutMs: config.OPENCLAW_ADAPTER_TIMEOUT_MS,
    maxRetries: config.OPENCLAW_ADAPTER_MAX_RETRIES
  };
}

@Injectable()
export class OpenClawRuntimeAdapter implements AssistantRuntimeAdapter {
  async preflight(runtimeTier?: RuntimeTier): Promise<AssistantRuntimePreflightResult> {
    const config = toOpenClawAdapterConfig(runtimeTier);
    if (!config.enabled) {
      throw new AssistantRuntimeAdapterError(
        "runtime_unreachable",
        "OpenClaw adapter is disabled by configuration."
      );
    }

    const healthPayload = await this.requestWithRetries("GET", "/healthz", undefined, config);
    const readyPayload = await this.requestWithRetries("GET", "/readyz", undefined, config, {
      acceptedErrorStatuses: [503]
    });

    if (!isObject(healthPayload) || !isObject(readyPayload)) {
      throw new AssistantRuntimeAdapterError(
        "invalid_response",
        "OpenClaw preflight response is not a JSON object."
      );
    }

    const healthOk =
      toBooleanValue(healthPayload, "ok") ??
      (typeof healthPayload.status === "string" ? healthPayload.status === "live" : null);
    const ready = toBooleanValue(readyPayload, "ready");

    if (healthOk === null || ready === null) {
      throw new AssistantRuntimeAdapterError(
        "invalid_response",
        "OpenClaw preflight response is missing required boolean fields."
      );
    }

    return {
      live: healthOk,
      ready,
      checkedAt: new Date().toISOString()
    };
  }

  async applyMaterializedSpec(input: AssistantRuntimeApplyInput): Promise<void> {
    const config = toOpenClawAdapterConfig(input.runtimeTier);
    if (!config.enabled) {
      throw new AssistantRuntimeAdapterError(
        "runtime_unreachable",
        "OpenClaw adapter is disabled by configuration."
      );
    }

    const preflight = await this.preflight(input.runtimeTier);
    if (!preflight.live || !preflight.ready) {
      throw new AssistantRuntimeAdapterError(
        "runtime_degraded",
        `OpenClaw runtime degraded: live=${preflight.live}, ready=${preflight.ready}.`
      );
    }

    await this.requestWithRetries(
      "POST",
      "/api/v1/runtime/spec/apply",
      {
        assistantId: input.assistantId,
        publishedVersionId: input.publishedVersionId,
        contentHash: input.contentHash,
        reapply: input.reapply,
        spec: {
          bootstrap: input.openclawBootstrap,
          workspace: input.openclawWorkspace
        }
      },
      config
    );
  }

  async cleanupWorkspace(assistantId: string): Promise<void> {
    const config = toOpenClawAdapterConfig();
    if (!config.enabled) {
      return;
    }

    await this.requestWithRetries(
      "POST",
      "/api/v1/runtime/workspace/cleanup",
      { assistantId },
      config
    );
  }

  async consumeBootstrapWorkspace(assistantId: string): Promise<void> {
    const config = toOpenClawAdapterConfig();
    if (!config.enabled) {
      return;
    }

    await this.requestWithRetries(
      "POST",
      "/api/v1/runtime/workspace/bootstrap/consume",
      { assistantId },
      config
    );
  }

  async resetWorkspace(assistantId: string): Promise<void> {
    const config = toOpenClawAdapterConfig();
    if (!config.enabled) {
      return;
    }

    await this.requestWithRetries(
      "POST",
      "/api/v1/runtime/workspace/reset",
      { assistantId },
      config
    );
  }

  async resetMemoryWorkspace(assistantId: string): Promise<void> {
    const config = toOpenClawAdapterConfig();
    if (!config.enabled) {
      return;
    }

    await this.requestWithRetries(
      "POST",
      "/api/v1/runtime/workspace/memory/reset",
      { assistantId },
      config
    );
  }

  async deleteWebChatSession(input: AssistantRuntimeWebChatSessionDeleteInput): Promise<void> {
    const config = toOpenClawAdapterConfig();
    if (!config.enabled) {
      return;
    }

    await this.requestWithRetries(
      "POST",
      "/api/v1/runtime/chat/web/session/delete",
      {
        assistantId: input.assistantId,
        chatId: input.chatId,
        surfaceThreadKey: input.surfaceThreadKey
      },
      config
    );
  }

  async sendWebChatTurn(
    input: AssistantRuntimeWebChatTurnInput
  ): Promise<AssistantRuntimeWebChatTurnResult> {
    const config = toOpenClawAdapterConfig(input.runtimeTier);
    if (!config.enabled) {
      throw new AssistantRuntimeAdapterError(
        "runtime_unreachable",
        "OpenClaw adapter is disabled by configuration."
      );
    }

    const preflight = await this.preflight(input.runtimeTier);
    if (!preflight.live || !preflight.ready) {
      throw new AssistantRuntimeAdapterError(
        "runtime_degraded",
        `OpenClaw runtime degraded: live=${preflight.live}, ready=${preflight.ready}.`
      );
    }

    const payload = await this.requestWithRetries(
      "POST",
      "/api/v1/runtime/chat/web",
      {
        assistantId: input.assistantId,
        publishedVersionId: input.publishedVersionId,
        chatId: input.chatId,
        surfaceThreadKey: input.surfaceThreadKey,
        userMessageId: input.userMessageId,
        userMessage: input.userMessage,
        ...(input.userTimezone ? { userTimezone: input.userTimezone } : {}),
        ...(input.currentTimeIso ? { currentTimeIso: input.currentTimeIso } : {})
      },
      config
    );

    if (!isObject(payload)) {
      throw new AssistantRuntimeAdapterError(
        "invalid_response",
        "OpenClaw web chat response is not a JSON object."
      );
    }

    const assistantMessage = payload.assistantMessage;
    const respondedAt = payload.respondedAt;
    if (typeof assistantMessage !== "string" || assistantMessage.trim().length === 0) {
      throw new AssistantRuntimeAdapterError(
        "invalid_response",
        "OpenClaw web chat response is missing assistantMessage."
      );
    }
    if (typeof respondedAt !== "string" || respondedAt.trim().length === 0) {
      throw new AssistantRuntimeAdapterError(
        "invalid_response",
        "OpenClaw web chat response is missing respondedAt."
      );
    }

    return {
      assistantMessage: assistantMessage.trim(),
      respondedAt: respondedAt.trim(),
      media: parseMediaArray(payload.media)
    };
  }

  async previewSetupTurn(
    input: AssistantRuntimeSetupPreviewTurnInput
  ): Promise<AssistantRuntimeSetupPreviewTurnResult> {
    const config = toOpenClawAdapterConfig(input.runtimeTier);
    if (!config.enabled) {
      throw new AssistantRuntimeAdapterError(
        "runtime_unreachable",
        "OpenClaw adapter is disabled by configuration."
      );
    }

    const preflight = await this.preflight(input.runtimeTier);
    if (!preflight.live || !preflight.ready) {
      throw new AssistantRuntimeAdapterError(
        "runtime_degraded",
        `OpenClaw runtime degraded: live=${preflight.live}, ready=${preflight.ready}.`
      );
    }

    const payload = await this.requestWithRetries(
      "POST",
      "/api/v1/runtime/chat/web/preview",
      {
        assistantId: input.assistantId,
        userMessage: input.userMessage,
        spec: {
          bootstrap: input.openclawBootstrap,
          workspace: input.openclawWorkspace
        },
        ...(input.userTimezone ? { userTimezone: input.userTimezone } : {}),
        ...(input.currentTimeIso ? { currentTimeIso: input.currentTimeIso } : {})
      },
      config
    );

    if (!isObject(payload)) {
      throw new AssistantRuntimeAdapterError(
        "invalid_response",
        "OpenClaw setup preview response is not a JSON object."
      );
    }

    const assistantMessage = payload.assistantMessage;
    const respondedAt = payload.respondedAt;
    if (typeof assistantMessage !== "string" || assistantMessage.trim().length === 0) {
      throw new AssistantRuntimeAdapterError(
        "invalid_response",
        "OpenClaw setup preview response is missing assistantMessage."
      );
    }
    if (typeof respondedAt !== "string" || respondedAt.trim().length === 0) {
      throw new AssistantRuntimeAdapterError(
        "invalid_response",
        "OpenClaw setup preview response is missing respondedAt."
      );
    }

    return {
      assistantMessage: assistantMessage.trim(),
      respondedAt: respondedAt.trim(),
      media: parseMediaArray(payload.media)
    };
  }

  async sendChannelTurn(
    input: AssistantRuntimeChannelTurnInput
  ): Promise<AssistantRuntimeWebChatTurnResult> {
    const config = toOpenClawAdapterConfig(input.runtimeTier);
    if (!config.enabled) {
      throw new AssistantRuntimeAdapterError(
        "runtime_unreachable",
        "OpenClaw adapter is disabled by configuration."
      );
    }

    const preflight = await this.preflight(input.runtimeTier);
    if (!preflight.live || !preflight.ready) {
      throw new AssistantRuntimeAdapterError(
        "runtime_degraded",
        `OpenClaw runtime degraded: live=${preflight.live}, ready=${preflight.ready}.`
      );
    }

    const payload = await this.requestWithRetries(
      "POST",
      "/api/v1/runtime/chat/channel",
      {
        assistantId: input.assistantId,
        publishedVersionId: input.publishedVersionId,
        surface: input.surface,
        threadId: input.threadId,
        userMessage: input.userMessage,
        ...(input.userTimezone ? { userTimezone: input.userTimezone } : {}),
        ...(input.currentTimeIso ? { currentTimeIso: input.currentTimeIso } : {})
      },
      config
    );

    if (!isObject(payload)) {
      throw new AssistantRuntimeAdapterError(
        "invalid_response",
        "OpenClaw channel chat response is not a JSON object."
      );
    }

    const assistantMessage = payload.assistantMessage;
    const respondedAt = payload.respondedAt;
    if (typeof assistantMessage !== "string" || assistantMessage.trim().length === 0) {
      throw new AssistantRuntimeAdapterError(
        "invalid_response",
        "OpenClaw channel chat response is missing assistantMessage."
      );
    }
    if (typeof respondedAt !== "string" || respondedAt.trim().length === 0) {
      throw new AssistantRuntimeAdapterError(
        "invalid_response",
        "OpenClaw channel chat response is missing respondedAt."
      );
    }

    return {
      assistantMessage: assistantMessage.trim(),
      respondedAt: respondedAt.trim(),
      media: parseMediaArray(payload.media)
    };
  }

  async *streamWebChatTurn(
    input: AssistantRuntimeWebChatTurnInput
  ): AsyncGenerator<AssistantRuntimeWebChatTurnStreamChunk> {
    const config = toOpenClawAdapterConfig(input.runtimeTier);
    if (!config.enabled) {
      throw new AssistantRuntimeAdapterError(
        "runtime_unreachable",
        "OpenClaw adapter is disabled by configuration."
      );
    }

    const preflight = await this.preflight(input.runtimeTier);
    if (!preflight.live || !preflight.ready) {
      throw new AssistantRuntimeAdapterError(
        "runtime_degraded",
        `OpenClaw runtime degraded: live=${preflight.live}, ready=${preflight.ready}.`
      );
    }

    const streamResponse = await this.requestStreamWithRetries(
      "/api/v1/runtime/chat/web/stream",
      {
        assistantId: input.assistantId,
        publishedVersionId: input.publishedVersionId,
        chatId: input.chatId,
        surfaceThreadKey: input.surfaceThreadKey,
        userMessageId: input.userMessageId,
        userMessage: input.userMessage,
        ...(input.userTimezone ? { userTimezone: input.userTimezone } : {}),
        ...(input.currentTimeIso ? { currentTimeIso: input.currentTimeIso } : {})
      },
      config
    );

    let hasDone = false;
    for await (const payload of this.readNdjsonStream(streamResponse)) {
      if (!isObject(payload)) {
        throw new AssistantRuntimeAdapterError(
          "invalid_response",
          "OpenClaw streaming payload is not a JSON object."
        );
      }

      const type = payload.type;
      if (type === "delta") {
        const delta = payload.delta;
        if (typeof delta !== "string") {
          throw new AssistantRuntimeAdapterError(
            "invalid_response",
            "OpenClaw stream delta payload is missing delta string."
          );
        }
        yield { type: "delta", delta };
        continue;
      }

      if (type === "thinking") {
        const delta = payload.delta;
        const text = payload.text;
        if (typeof delta !== "string" || typeof text !== "string") {
          throw new AssistantRuntimeAdapterError(
            "invalid_response",
            "OpenClaw thinking payload is missing delta/text strings."
          );
        }
        yield { type: "thinking", delta, accumulated: text };
        continue;
      }

      if (type === "done") {
        const respondedAt = payload.respondedAt;
        if (typeof respondedAt !== "string" || respondedAt.trim().length === 0) {
          throw new AssistantRuntimeAdapterError(
            "invalid_response",
            "OpenClaw stream done payload is missing respondedAt."
          );
        }
        hasDone = true;
        yield { type: "done", respondedAt: respondedAt.trim() };
        break;
      }

      if (type === "media") {
        const media = parseMediaArray(payload.media);
        if (media.length > 0) {
          yield { type: "media", media };
        }
        continue;
      }

      if (type === "failed") {
        const code = typeof payload.code === "string" ? payload.code.trim() : "";
        const message = typeof payload.message === "string" ? payload.message.trim() : "";
        if (!code || !message) {
          throw new AssistantRuntimeAdapterError(
            "invalid_response",
            "OpenClaw failed payload is missing code/message."
          );
        }
        throw new ApiErrorHttpException(code === "tool_daily_limit_reached" ? 409 : 500, {
          code,
          category: code === "tool_daily_limit_reached" ? "conflict" : "infra",
          message
        });
      }

      throw new AssistantRuntimeAdapterError(
        "invalid_response",
        "OpenClaw streaming payload has unsupported type."
      );
    }

    if (!hasDone) {
      throw new AssistantRuntimeAdapterError(
        "invalid_response",
        "OpenClaw stream completed without done event."
      );
    }
  }

  async controlCronJob(input: AssistantRuntimeCronControlInput): Promise<unknown> {
    const config = toOpenClawAdapterConfig(input.runtimeTier);
    if (!config.enabled) {
      throw new AssistantRuntimeAdapterError("runtime_unreachable", "OpenClaw adapter disabled.");
    }

    const payload = await this.requestWithRetries(
      "POST",
      "/api/v1/runtime/cron/control",
      {
        ...(input.action ? { action: input.action } : {}),
        ...(input.args ? { args: input.args } : {}),
        ...(input.sessionKey ? { sessionKey: input.sessionKey } : {}),
        ...(input.contextSessionKey ? { contextSessionKey: input.contextSessionKey } : {})
      },
      config,
      { acceptedErrorStatuses: [400] }
    );

    if (!isObject(payload)) {
      throw new AssistantRuntimeAdapterError(
        "invalid_response",
        "OpenClaw cron control response is not a JSON object."
      );
    }

    if (payload.ok !== true) {
      const errorMessage =
        typeof payload.error === "string"
          ? payload.error
          : isObject(payload.error) && typeof payload.error.message === "string"
            ? payload.error.message
            : "OpenClaw cron control failed.";
      throw new AssistantRuntimeAdapterError("invalid_response", errorMessage);
    }

    return payload.result;
  }

  async listMemoryItems(assistantId: string, runtimeTier?: RuntimeTier): Promise<unknown> {
    const config = toOpenClawAdapterConfig(runtimeTier);
    if (!config.enabled) {
      throw new AssistantRuntimeAdapterError("runtime_unreachable", "OpenClaw adapter disabled.");
    }
    return this.requestWithRetries(
      "GET",
      `/api/v1/runtime/memory/items?assistantId=${encodeURIComponent(assistantId)}`,
      undefined,
      config
    );
  }

  async addMemoryItem(
    assistantId: string,
    content: string,
    runtimeTier?: RuntimeTier
  ): Promise<unknown> {
    const config = toOpenClawAdapterConfig(runtimeTier);
    if (!config.enabled) {
      throw new AssistantRuntimeAdapterError("runtime_unreachable", "OpenClaw adapter disabled.");
    }
    return this.requestWithRetries(
      "POST",
      "/api/v1/runtime/memory/add",
      { assistantId, content },
      config
    );
  }

  async editMemoryItem(
    assistantId: string,
    itemId: string,
    content: string,
    runtimeTier?: RuntimeTier
  ): Promise<unknown> {
    const config = toOpenClawAdapterConfig(runtimeTier);
    if (!config.enabled) {
      throw new AssistantRuntimeAdapterError("runtime_unreachable", "OpenClaw adapter disabled.");
    }
    return this.requestWithPatch(
      "/api/v1/runtime/memory/edit",
      { assistantId, itemId, content },
      config
    );
  }

  async forgetMemoryItem(
    assistantId: string,
    itemId: string,
    runtimeTier?: RuntimeTier
  ): Promise<unknown> {
    const config = toOpenClawAdapterConfig(runtimeTier);
    if (!config.enabled) {
      throw new AssistantRuntimeAdapterError("runtime_unreachable", "OpenClaw adapter disabled.");
    }
    return this.requestWithRetries(
      "POST",
      "/api/v1/runtime/memory/forget",
      { assistantId, itemId },
      config
    );
  }

  async searchMemory(
    assistantId: string,
    query: string,
    runtimeTier?: RuntimeTier
  ): Promise<unknown> {
    const config = toOpenClawAdapterConfig(runtimeTier);
    if (!config.enabled) {
      throw new AssistantRuntimeAdapterError("runtime_unreachable", "OpenClaw adapter disabled.");
    }
    return this.requestWithRetries(
      "GET",
      `/api/v1/runtime/memory/search?assistantId=${encodeURIComponent(assistantId)}&q=${encodeURIComponent(query)}`,
      undefined,
      config
    );
  }

  async uploadChatMedia(
    input: AssistantRuntimeMediaUploadInput
  ): Promise<AssistantRuntimeMediaUploadResult> {
    const config = toOpenClawAdapterConfig(input.runtimeTier);
    if (!config.enabled) {
      throw new AssistantRuntimeAdapterError(
        "runtime_unreachable",
        "OpenClaw adapter is disabled by configuration."
      );
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), config.timeoutMs);

    try {
      const qs = new URLSearchParams({
        assistantId: input.assistantId,
        chatId: input.chatId,
        messageId: input.messageId
      });
      const response = await fetch(
        `${config.baseUrl}/api/v1/runtime/workspace/media/upload?${qs.toString()}`,
        {
          method: "POST",
          headers: {
            ...(config.token.length > 0 ? { Authorization: `Bearer ${config.token}` } : {}),
            "Content-Type": input.mimeType
          },
          body: new Uint8Array(input.fileBuffer),
          signal: controller.signal
        }
      );

      if (!response.ok) {
        throw new AssistantRuntimeAdapterError(
          "invalid_response",
          `OpenClaw media upload responded ${response.status}.`
        );
      }

      const payload = (await response.json()) as {
        storagePath: string;
        sizeBytes: number;
        mimeType: string;
      };
      return {
        storagePath: payload.storagePath,
        sizeBytes: payload.sizeBytes,
        mimeType: payload.mimeType
      };
    } catch (error) {
      if (error instanceof AssistantRuntimeAdapterError) throw error;
      throw new AssistantRuntimeAdapterError(
        "runtime_unreachable",
        "OpenClaw runtime unreachable during media upload."
      );
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async downloadChatMedia(
    assistantId: string,
    storagePath: string,
    runtimeTier?: RuntimeTier
  ): Promise<AssistantRuntimeMediaDownloadResult | null> {
    const config = toOpenClawAdapterConfig(runtimeTier);
    if (!config.enabled) {
      return null;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), config.timeoutMs);

    try {
      const qs = new URLSearchParams({ assistantId, storagePath });
      const response = await fetch(
        `${config.baseUrl}/api/v1/runtime/workspace/media/download?${qs.toString()}`,
        {
          method: "GET",
          headers: {
            ...(config.token.length > 0 ? { Authorization: `Bearer ${config.token}` } : {})
          },
          signal: controller.signal
        }
      );

      if (response.status === 404) return null;
      if (!response.ok) return null;

      const contentType = response.headers.get("content-type") ?? "application/octet-stream";
      const arrayBuffer = await response.arrayBuffer();
      return { buffer: Buffer.from(arrayBuffer), contentType };
    } catch {
      return null;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async deleteChatMedia(
    assistantId: string,
    storagePath: string,
    runtimeTier?: RuntimeTier
  ): Promise<void> {
    const config = toOpenClawAdapterConfig(runtimeTier);
    if (!config.enabled) return;

    try {
      const qs = new URLSearchParams({ assistantId, storagePath });
      await this.requestWithRetries(
        "POST",
        `/api/v1/runtime/workspace/media/delete?${qs.toString()}`,
        undefined,
        config
      );
    } catch {
      // Non-fatal: file might already be deleted
    }
  }

  async deleteChatMediaBatch(
    assistantId: string,
    chatId: string,
    runtimeTier?: RuntimeTier
  ): Promise<void> {
    const config = toOpenClawAdapterConfig(runtimeTier);
    if (!config.enabled) return;

    try {
      const qs = new URLSearchParams({ assistantId, chatId });
      await this.requestWithRetries(
        "POST",
        `/api/v1/runtime/workspace/media/delete-chat?${qs.toString()}`,
        undefined,
        config
      );
    } catch {
      // Non-fatal: directory might already be deleted
    }
  }

  async transcribeMedia(
    assistantId: string,
    storagePath: string,
    runtimeTier?: RuntimeTier
  ): Promise<AssistantRuntimeTranscribeResult> {
    const config = toOpenClawAdapterConfig(runtimeTier);
    if (!config.enabled) {
      throw new AssistantRuntimeAdapterError(
        "runtime_unreachable",
        "OpenClaw adapter is disabled by configuration."
      );
    }

    const qs = new URLSearchParams({ assistantId, storagePath });
    const payload = await this.requestWithRetries(
      "POST",
      `/api/v1/runtime/workspace/media/transcribe?${qs.toString()}`,
      undefined,
      config
    );

    if (!isObject(payload)) {
      throw new AssistantRuntimeAdapterError(
        "invalid_response",
        "OpenClaw transcribe response is not a JSON object."
      );
    }

    const text = typeof payload.text === "string" ? payload.text : "";
    return { text };
  }

  private async requestWithPatch(
    path: string,
    body: unknown,
    config: OpenClawAdapterConfig
  ): Promise<unknown> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), config.timeoutMs);

    try {
      const response = await fetch(`${config.baseUrl}${path}`, {
        method: "PATCH",
        headers: {
          ...(config.token.length > 0 ? { Authorization: `Bearer ${config.token}` } : {}),
          "Content-Type": "application/json"
        },
        body: JSON.stringify(body),
        signal: controller.signal
      });

      if (!response.ok) {
        throw new AssistantRuntimeAdapterError(
          "invalid_response",
          `OpenClaw response status ${response.status} is not successful.`
        );
      }

      return await response.json();
    } catch (error) {
      if (error instanceof AssistantRuntimeAdapterError) throw error;
      throw new AssistantRuntimeAdapterError(
        "runtime_unreachable",
        "OpenClaw runtime unreachable."
      );
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private async requestWithRetries(
    method: "GET" | "POST",
    path: string,
    body: unknown,
    config: OpenClawAdapterConfig,
    options: OpenClawRequestOptions = {}
  ): Promise<unknown> {
    let attempt = 0;
    let lastError: AssistantRuntimeAdapterError | null = null;

    while (attempt <= config.maxRetries) {
      try {
        return await this.request(method, path, body, config, options);
      } catch (error) {
        if (!(error instanceof AssistantRuntimeAdapterError)) {
          throw error;
        }

        lastError = error;
        const retriable =
          error.code === "runtime_unreachable" ||
          error.code === "timeout" ||
          error.code === "runtime_degraded";
        if (!retriable || attempt >= config.maxRetries) {
          throw error;
        }
      }

      attempt += 1;
    }

    throw (
      lastError ??
      new AssistantRuntimeAdapterError(
        "runtime_unreachable",
        "OpenClaw request failed unexpectedly."
      )
    );
  }

  private async request(
    method: "GET" | "POST",
    path: string,
    body: unknown,
    config: OpenClawAdapterConfig,
    options: OpenClawRequestOptions
  ): Promise<unknown> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), config.timeoutMs);

    try {
      const requestInit: RequestInit = {
        method,
        headers: {
          ...(config.token.length > 0 ? { Authorization: `Bearer ${config.token}` } : {}),
          ...(body !== undefined ? { "Content-Type": "application/json" } : {})
        },
        signal: controller.signal
      };

      if (body !== undefined) {
        requestInit.body = JSON.stringify(body);
      }

      const response = await fetch(`${config.baseUrl}${path}`, requestInit);

      if (response.status === 401 || response.status === 403) {
        throw new AssistantRuntimeAdapterError(
          "auth_failure",
          `OpenClaw auth failure (${response.status}).`
        );
      }

      const acceptedErrorStatuses = new Set(options.acceptedErrorStatuses ?? []);
      if (!response.ok && !acceptedErrorStatuses.has(response.status)) {
        let responsePayload: unknown = null;
        try {
          responsePayload = await response.json();
        } catch {
          responsePayload = null;
        }

        const apiError = parseApiErrorResponse(responsePayload);
        if (apiError !== null) {
          throw new ApiErrorHttpException(response.status, apiError);
        }

        if (response.status === 502 || response.status === 503 || response.status === 504) {
          throw new AssistantRuntimeAdapterError(
            "runtime_degraded",
            `OpenClaw runtime degraded with HTTP ${response.status}.`
          );
        }
        throw new AssistantRuntimeAdapterError(
          "invalid_response",
          `OpenClaw response status ${response.status} is not successful.`
        );
      }

      try {
        return await response.json();
      } catch {
        throw new AssistantRuntimeAdapterError(
          "invalid_response",
          "OpenClaw response body is not valid JSON."
        );
      }
    } catch (error) {
      if (error instanceof AssistantRuntimeAdapterError) {
        throw error;
      }

      if (error instanceof DOMException && error.name === "AbortError") {
        throw new AssistantRuntimeAdapterError(
          "timeout",
          `OpenClaw request timed out after ${config.timeoutMs}ms.`
        );
      }

      throw new AssistantRuntimeAdapterError(
        "runtime_unreachable",
        "OpenClaw runtime is unreachable."
      );
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private async requestStreamWithRetries(
    path: string,
    body: unknown,
    config: OpenClawAdapterConfig
  ): Promise<Response> {
    let attempt = 0;
    let lastError: AssistantRuntimeAdapterError | null = null;

    while (attempt <= config.maxRetries) {
      try {
        return await this.requestStream(path, body, config);
      } catch (error) {
        if (!(error instanceof AssistantRuntimeAdapterError)) {
          throw error;
        }

        lastError = error;
        const retriable =
          error.code === "runtime_unreachable" ||
          error.code === "timeout" ||
          error.code === "runtime_degraded";
        if (!retriable || attempt >= config.maxRetries) {
          throw error;
        }
      }

      attempt += 1;
    }

    throw (
      lastError ??
      new AssistantRuntimeAdapterError(
        "runtime_unreachable",
        "OpenClaw stream request failed unexpectedly."
      )
    );
  }

  private async requestStream(
    path: string,
    body: unknown,
    config: OpenClawAdapterConfig
  ): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), config.timeoutMs);

    try {
      const response = await fetch(`${config.baseUrl}${path}`, {
        method: "POST",
        headers: {
          ...(config.token.length > 0 ? { Authorization: `Bearer ${config.token}` } : {}),
          "Content-Type": "application/json",
          Accept: "application/x-ndjson"
        },
        body: JSON.stringify(body),
        signal: controller.signal
      });

      if (response.status === 401 || response.status === 403) {
        throw new AssistantRuntimeAdapterError(
          "auth_failure",
          `OpenClaw auth failure (${response.status}).`
        );
      }

      if (!response.ok) {
        let responsePayload: unknown = null;
        try {
          responsePayload = await response.json();
        } catch {
          responsePayload = null;
        }

        const apiError = parseApiErrorResponse(responsePayload);
        if (apiError !== null) {
          throw new ApiErrorHttpException(response.status, apiError);
        }

        if (response.status === 502 || response.status === 503 || response.status === 504) {
          throw new AssistantRuntimeAdapterError(
            "runtime_degraded",
            `OpenClaw runtime degraded with HTTP ${response.status}.`
          );
        }
        throw new AssistantRuntimeAdapterError(
          "invalid_response",
          `OpenClaw response status ${response.status} is not successful.`
        );
      }

      if (response.body === null) {
        throw new AssistantRuntimeAdapterError(
          "invalid_response",
          "OpenClaw stream response has no body."
        );
      }

      return response;
    } catch (error) {
      if (error instanceof AssistantRuntimeAdapterError) {
        throw error;
      }

      if (error instanceof DOMException && error.name === "AbortError") {
        throw new AssistantRuntimeAdapterError(
          "timeout",
          `OpenClaw request timed out after ${config.timeoutMs}ms.`
        );
      }

      throw new AssistantRuntimeAdapterError(
        "runtime_unreachable",
        "OpenClaw runtime is unreachable."
      );
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async uploadWorkspaceAvatar(
    assistantId: string,
    fileBuffer: Buffer,
    mimeType: string,
    extension: string
  ): Promise<{ avatarUrl: string }> {
    const config = toOpenClawAdapterConfig();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), config.timeoutMs);

    try {
      const response = await fetch(
        `${config.baseUrl}/api/v1/runtime/workspace/avatar?assistantId=${encodeURIComponent(assistantId)}&ext=${encodeURIComponent(extension)}`,
        {
          method: "POST",
          headers: {
            ...(config.token.length > 0 ? { Authorization: `Bearer ${config.token}` } : {}),
            "Content-Type": mimeType
          },
          body: new Uint8Array(fileBuffer),
          signal: controller.signal
        }
      );

      if (!response.ok) {
        throw new AssistantRuntimeAdapterError(
          "invalid_response",
          `OpenClaw avatar upload responded ${response.status}.`
        );
      }

      return (await response.json()) as { avatarUrl: string };
    } catch (error) {
      if (error instanceof AssistantRuntimeAdapterError) throw error;
      throw new AssistantRuntimeAdapterError(
        "runtime_unreachable",
        "OpenClaw runtime unreachable during avatar upload."
      );
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async downloadWorkspaceAvatar(
    assistantId: string
  ): Promise<{ buffer: Buffer; contentType: string } | null> {
    const config = toOpenClawAdapterConfig();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), config.timeoutMs);

    try {
      const response = await fetch(
        `${config.baseUrl}/api/v1/runtime/workspace/avatar?assistantId=${encodeURIComponent(assistantId)}`,
        {
          method: "GET",
          headers: {
            ...(config.token.length > 0 ? { Authorization: `Bearer ${config.token}` } : {})
          },
          signal: controller.signal
        }
      );

      if (response.status === 404) return null;
      if (!response.ok) return null;

      const contentType = response.headers.get("content-type") ?? "image/png";
      const arrayBuffer = await response.arrayBuffer();
      return { buffer: Buffer.from(arrayBuffer), contentType };
    } catch {
      return null;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private async *readNdjsonStream(response: Response): AsyncGenerator<unknown> {
    if (response.body === null) {
      throw new AssistantRuntimeAdapterError(
        "invalid_response",
        "OpenClaw stream response has no readable body."
      );
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.length === 0) {
          continue;
        }

        try {
          yield JSON.parse(trimmed) as unknown;
        } catch {
          throw new AssistantRuntimeAdapterError(
            "invalid_response",
            "OpenClaw stream chunk is not valid JSON."
          );
        }
      }
    }

    const tail = buffer.trim();
    if (tail.length > 0) {
      try {
        yield JSON.parse(tail) as unknown;
      } catch {
        throw new AssistantRuntimeAdapterError(
          "invalid_response",
          "OpenClaw stream tail chunk is not valid JSON."
        );
      }
    }
  }
}
