import { randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { loadApiConfig } from "@persai/config";
import type {
  RuntimeAttachmentRef,
  RuntimeTurnRequest,
  RuntimeTurnResult
} from "@persai/runtime-contract";
import {
  ASSISTANT_MATERIALIZED_SPEC_REPOSITORY,
  type AssistantMaterializedSpecRepository
} from "../domain/assistant-materialized-spec.repository";
import {
  AssistantRuntimeError,
  runtimeOutputArtifactsToMediaArtifacts,
  type AssistantRuntimeWebChatTurnResult
} from "./assistant-runtime.facade";
import {
  createAssistantInboundConflict,
  createAssistantInboundValidationError
} from "./assistant-inbound-error";
import type { RuntimeTier } from "./runtime-assignment";

export interface SendNativeTelegramTurnInput {
  assistantId: string;
  publishedVersionId: string;
  runtimeTier: RuntimeTier;
  workspaceId: string;
  threadId: string;
  externalUserKey: string | null;
  mode: "direct" | "group";
  userMessageId: string;
  userMessage: string;
  attachments: RuntimeAttachmentRef[];
  userTimezone?: string;
  currentTimeIso?: string;
  providerOverride?: "openai" | "anthropic";
  modelOverride?: string;
}

interface JsonResponse {
  ok: boolean;
  status: number;
  body: unknown;
}

@Injectable()
export class SendNativeTelegramTurnService {
  constructor(
    @Inject(ASSISTANT_MATERIALIZED_SPEC_REPOSITORY)
    private readonly assistantMaterializedSpecRepository: AssistantMaterializedSpecRepository
  ) {}

  async execute(input: SendNativeTelegramTurnInput): Promise<AssistantRuntimeWebChatTurnResult> {
    const config = loadApiConfig(process.env);
    const baseUrl = config.PERSAI_RUNTIME_BASE_URL?.trim();
    if (!baseUrl) {
      throw new AssistantRuntimeError(
        "runtime_degraded",
        "Native runtime Telegram execution requires PERSAI_RUNTIME_BASE_URL."
      );
    }

    const materializedSpec =
      await this.assistantMaterializedSpecRepository.findByPublishedVersionId(
        input.publishedVersionId
      );
    if (materializedSpec === null) {
      throw new AssistantRuntimeError(
        "runtime_degraded",
        "Native runtime materialized spec is missing for the current published version."
      );
    }
    if (materializedSpec.assistantId !== input.assistantId) {
      throw new AssistantRuntimeError(
        "runtime_degraded",
        "Native runtime materialized spec assistant identity does not match the prepared Telegram turn."
      );
    }

    const bundleHash = materializedSpec.runtimeBundleHash?.trim() ?? "";
    if (!bundleHash) {
      throw new AssistantRuntimeError(
        "runtime_degraded",
        "Native runtime bundle hash is missing for the current published version."
      );
    }

    const request: RuntimeTurnRequest = {
      requestId: randomUUID(),
      idempotencyKey: input.userMessageId,
      runtimeTier: input.runtimeTier,
      bundle: {
        bundleId: materializedSpec.id,
        assistantId: input.assistantId,
        workspaceId: input.workspaceId,
        publishedVersionId: input.publishedVersionId,
        bundleHash,
        compiledAt: materializedSpec.createdAt.toISOString()
      },
      conversation: {
        assistantId: input.assistantId,
        workspaceId: input.workspaceId,
        channel: "telegram",
        externalThreadKey: input.threadId,
        externalUserKey: input.externalUserKey,
        mode: input.mode
      },
      message: {
        text: input.userMessage,
        attachments: input.attachments,
        locale: null,
        timezone: input.userTimezone ?? null,
        receivedAt: input.currentTimeIso ?? new Date().toISOString()
      },
      ...(input.providerOverride === undefined ? {} : { providerOverride: input.providerOverride }),
      ...(input.modelOverride === undefined ? {} : { modelOverride: input.modelOverride })
    };

    const response = await this.postJson(
      new URL("/api/v1/turns/create", baseUrl).toString(),
      request,
      config.PERSAI_RUNTIME_TURN_TIMEOUT_MS
    );
    if (!response.ok) {
      this.throwForFailedResponse(response);
    }
    if (!this.isRuntimeTurnResult(response.body)) {
      throw new AssistantRuntimeError(
        "invalid_response",
        "Native runtime returned an invalid Telegram turn response."
      );
    }
    return {
      assistantMessage: response.body.assistantText,
      respondedAt: response.body.respondedAt,
      media: runtimeOutputArtifactsToMediaArtifacts(response.body.artifacts),
      ...(response.body.trace === undefined ? {} : { runtimeTrace: response.body.trace })
    };
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
          `Native runtime Telegram turn timed out after ${timeoutMs}ms.`
        );
      }
      const message =
        error instanceof Error ? error.message : "Unknown native runtime Telegram failure.";
      throw new AssistantRuntimeError(
        "runtime_unreachable",
        `Native runtime Telegram turn failed: ${message}`
      );
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private throwForFailedResponse(response: JsonResponse): never {
    const message =
      this.extractErrorMessage(response.body) ??
      `Native runtime Telegram turn failed with HTTP ${response.status}.`;

    if (response.status === 400 || response.status === 413) {
      throw createAssistantInboundValidationError("native_runtime_request_invalid", message);
    }
    if (response.status === 409) {
      throw createAssistantInboundConflict("native_runtime_conflict", message);
    }
    if (response.status === 401 || response.status === 403) {
      throw new AssistantRuntimeError("auth_failure", message);
    }
    if (response.status === 408 || response.status === 504) {
      throw new AssistantRuntimeError("timeout", message);
    }
    if (response.status >= 500) {
      throw new AssistantRuntimeError("runtime_unreachable", message);
    }

    throw new AssistantRuntimeError("runtime_degraded", message);
  }

  private extractErrorMessage(body: unknown): string | null {
    if (typeof body === "string" && body.trim().length > 0) {
      return body;
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

  private isRuntimeTurnResult(value: unknown): value is RuntimeTurnResult {
    const row = this.asObject(value);
    return (
      typeof row?.requestId === "string" &&
      typeof row.sessionId === "string" &&
      typeof row.assistantText === "string" &&
      Array.isArray(row.artifacts) &&
      typeof row.respondedAt === "string"
    );
  }
}
