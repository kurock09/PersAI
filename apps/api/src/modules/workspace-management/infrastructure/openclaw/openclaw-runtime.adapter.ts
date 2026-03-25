import { Injectable } from "@nestjs/common";
import { loadApiConfig } from "@persai/config";
import type {
  AssistantRuntimeAdapter,
  AssistantRuntimeApplyInput,
  AssistantRuntimePreflightResult,
  AssistantRuntimeWebChatTurnStreamChunk,
  AssistantRuntimeWebChatTurnInput,
  AssistantRuntimeWebChatTurnResult
} from "../../application/assistant-runtime-adapter.types";
import { AssistantRuntimeAdapterError } from "../../application/assistant-runtime-adapter.types";

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

function toBooleanValue(payload: JsonObject, key: string): boolean | null {
  const value = payload[key];
  return typeof value === "boolean" ? value : null;
}

function toOpenClawAdapterConfig(): OpenClawAdapterConfig {
  const config = loadApiConfig(process.env);
  return {
    enabled: config.OPENCLAW_ADAPTER_ENABLED,
    baseUrl: config.OPENCLAW_BASE_URL,
    token: config.OPENCLAW_GATEWAY_TOKEN ?? "",
    timeoutMs: config.OPENCLAW_ADAPTER_TIMEOUT_MS,
    maxRetries: config.OPENCLAW_ADAPTER_MAX_RETRIES
  };
}

@Injectable()
export class OpenClawRuntimeAdapter implements AssistantRuntimeAdapter {
  async preflight(): Promise<AssistantRuntimePreflightResult> {
    const config = toOpenClawAdapterConfig();
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
    const config = toOpenClawAdapterConfig();
    if (!config.enabled) {
      throw new AssistantRuntimeAdapterError(
        "runtime_unreachable",
        "OpenClaw adapter is disabled by configuration."
      );
    }

    const preflight = await this.preflight();
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

  async sendWebChatTurn(
    input: AssistantRuntimeWebChatTurnInput
  ): Promise<AssistantRuntimeWebChatTurnResult> {
    const config = toOpenClawAdapterConfig();
    if (!config.enabled) {
      throw new AssistantRuntimeAdapterError(
        "runtime_unreachable",
        "OpenClaw adapter is disabled by configuration."
      );
    }

    const preflight = await this.preflight();
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
        userMessage: input.userMessage
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
      respondedAt: respondedAt.trim()
    };
  }

  async *streamWebChatTurn(
    input: AssistantRuntimeWebChatTurnInput
  ): AsyncGenerator<AssistantRuntimeWebChatTurnStreamChunk> {
    const config = toOpenClawAdapterConfig();
    if (!config.enabled) {
      throw new AssistantRuntimeAdapterError(
        "runtime_unreachable",
        "OpenClaw adapter is disabled by configuration."
      );
    }

    const preflight = await this.preflight();
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
        userMessage: input.userMessage
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
