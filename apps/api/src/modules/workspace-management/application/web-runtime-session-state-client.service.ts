import { Injectable } from "@nestjs/common";
import { loadApiConfig } from "@persai/config";
import type {
  RuntimeSessionResolveInput,
  RuntimeSessionResolveResult
} from "@persai/runtime-contract";
import { AssistantRuntimeError } from "./assistant-runtime.facade";
import type { RuntimeTier } from "./runtime-assignment";

export interface WebRuntimeSessionStateClientInput {
  assistantId: string;
  workspaceId: string;
  runtimeTier: RuntimeTier;
  surfaceThreadKey: string;
  userId: string;
}

interface JsonResponse {
  ok: boolean;
  status: number;
  body: unknown;
}

@Injectable()
export class WebRuntimeSessionStateClientService {
  async execute(input: WebRuntimeSessionStateClientInput): Promise<RuntimeSessionResolveResult> {
    const config = loadApiConfig(process.env);
    const baseUrl = config.PERSAI_RUNTIME_BASE_URL?.trim();
    if (!baseUrl) {
      throw new AssistantRuntimeError(
        "runtime_degraded",
        "Internal web runtime session-state client requires PERSAI_RUNTIME_BASE_URL."
      );
    }

    const request: RuntimeSessionResolveInput = {
      runtimeTier: input.runtimeTier,
      conversation: {
        assistantId: input.assistantId,
        workspaceId: input.workspaceId,
        channel: "web",
        externalThreadKey: input.surfaceThreadKey,
        externalUserKey: input.userId,
        mode: "direct"
      }
    };

    const response = await this.postJson(
      new URL("/api/v1/turns/session/resolve", baseUrl).toString(),
      request,
      config.PERSAI_RUNTIME_TURN_TIMEOUT_MS
    );
    if (!response.ok) {
      this.throwForFailedResponse(response);
    }
    if (!this.isRuntimeSessionResolveResult(response.body)) {
      throw new AssistantRuntimeError(
        "invalid_response",
        "Internal web runtime session-state client returned an invalid response."
      );
    }
    return response.body;
  }

  private async postJson(url: string, body: unknown, timeoutMs: number): Promise<JsonResponse> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify(body),
        signal: controller.signal
      });
      const contentType = response.headers.get("content-type") ?? "";
      let responseBody: unknown = null;

      if (contentType.includes("application/json")) {
        responseBody = await response.json();
      } else {
        const text = await response.text();
        responseBody = text.length > 0 ? text : null;
      }

      return {
        ok: response.ok,
        status: response.status,
        body: responseBody
      };
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new AssistantRuntimeError(
          "timeout",
          `Internal web runtime session-state client timed out after ${timeoutMs}ms.`
        );
      }
      const message =
        error instanceof Error
          ? error.message
          : "Unknown internal web runtime session-state client failure.";
      throw new AssistantRuntimeError(
        "runtime_unreachable",
        `Internal web runtime session-state client failed: ${message}`
      );
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private throwForFailedResponse(response: JsonResponse): never {
    const message =
      this.extractErrorMessage(response.body) ??
      `Internal web runtime session-state client failed with HTTP ${response.status}.`;

    if (response.status === 401 || response.status === 403) {
      throw new AssistantRuntimeError("auth_failure", message);
    }
    if (response.status === 408 || response.status === 504) {
      throw new AssistantRuntimeError("timeout", message);
    }
    if (response.status >= 500) {
      throw new AssistantRuntimeError("runtime_degraded", message);
    }

    throw new AssistantRuntimeError("invalid_response", message);
  }

  private extractErrorMessage(body: unknown): string | null {
    if (typeof body === "string" && body.trim().length > 0) {
      return body.trim();
    }

    const row = this.asObject(body);
    const nestedError = this.asObject(row?.error);
    const nestedErrorMessage = this.readMessageField(nestedError?.message);
    if (nestedErrorMessage !== null) {
      return nestedErrorMessage;
    }

    return this.readMessageField(row?.message);
  }

  private readMessageField(value: unknown): string | null {
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
    if (Array.isArray(value)) {
      const messages = value.filter((entry): entry is string => typeof entry === "string");
      return messages.length > 0 ? messages.join("; ") : null;
    }
    return null;
  }

  private asObject(value: unknown): Record<string, unknown> | null {
    return value !== null && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  }

  private isRuntimeSessionResolveResult(value: unknown): value is RuntimeSessionResolveResult {
    const row = this.asObject(value);
    return (
      typeof row?.found === "boolean" &&
      (row.session === null || this.asObject(row.session) !== null)
    );
  }
}
