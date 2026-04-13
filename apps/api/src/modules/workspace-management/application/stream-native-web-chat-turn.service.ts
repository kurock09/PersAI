import { randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { loadApiConfig } from "@persai/config";
import type {
  RuntimeAttachmentRef,
  RuntimeFailedEvent,
  RuntimeInterruptedEvent,
  RuntimeTurnRequest,
  RuntimeTurnResult,
  RuntimeTurnStreamEvent
} from "@persai/runtime-contract";
import {
  ASSISTANT_MATERIALIZED_SPEC_REPOSITORY,
  type AssistantMaterializedSpecRepository
} from "../domain/assistant-materialized-spec.repository";
import {
  AssistantRuntimeError,
  runtimeOutputArtifactsToMediaArtifacts,
  type AssistantRuntimeWebChatTurnStreamChunk
} from "./assistant-runtime.facade";
import {
  createAssistantInboundConflict,
  createAssistantInboundValidationError
} from "./assistant-inbound-error";
import type { RuntimeTier } from "./runtime-assignment";
import { getWebChatStreamRuntimeMode, type WebChatRuntimeMode } from "./web-runtime-mode";

export interface StreamNativeWebChatTurnInput {
  assistantId: string;
  publishedVersionId: string;
  runtimeTier: RuntimeTier;
  surfaceThreadKey: string;
  userId: string;
  workspaceId: string;
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
export class StreamNativeWebChatTurnService {
  constructor(
    @Inject(ASSISTANT_MATERIALIZED_SPEC_REPOSITORY)
    private readonly assistantMaterializedSpecRepository: AssistantMaterializedSpecRepository
  ) {}

  getMode(): WebChatRuntimeMode {
    return getWebChatStreamRuntimeMode();
  }

  async *execute(
    input: StreamNativeWebChatTurnInput,
    options?: { signal?: AbortSignal }
  ): AsyncGenerator<AssistantRuntimeWebChatTurnStreamChunk> {
    const config = loadApiConfig(process.env);
    const baseUrl = config.PERSAI_RUNTIME_BASE_URL?.trim();
    if (!baseUrl) {
      throw new AssistantRuntimeError(
        "runtime_degraded",
        "Native runtime web stream is enabled but PERSAI_RUNTIME_BASE_URL is not configured."
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
        "Native runtime materialized spec assistant identity does not match the prepared turn."
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
        channel: "web",
        externalThreadKey: input.surfaceThreadKey,
        externalUserKey: input.userId,
        mode: "direct"
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

    const { signal, dispose } = this.createTimedSignal(
      config.PERSAI_RUNTIME_STREAM_TIMEOUT_MS,
      options?.signal
    );
    try {
      const response = await this.fetchStreamResponse(
        new URL("/api/v1/turns/stream", baseUrl).toString(),
        request,
        signal
      );
      if (!response.ok) {
        const body = await this.readBody(response);
        this.throwForFailedResponse({
          ok: false,
          status: response.status,
          body
        });
      }
      if (response.body === null) {
        throw new AssistantRuntimeError(
          "invalid_response",
          "Native runtime returned an empty stream response body."
        );
      }

      let accumulated = "";
      const emittedArtifactIds = new Set<string>();
      for await (const event of this.readRuntimeStream(response)) {
        switch (event.type) {
          case "started":
            continue;
          case "text_delta":
            if (event.delta.length === 0) {
              continue;
            }
            accumulated = event.accumulatedText;
            yield {
              type: "delta",
              delta: event.delta,
              accumulated: event.accumulatedText
            };
            continue;
          case "tool_started":
            yield {
              type: "tool",
              toolPhase: "start",
              toolName: event.toolName,
              toolCallId: event.toolCallId
            };
            continue;
          case "tool_finished":
            yield {
              type: "tool",
              toolPhase: "end",
              toolName: event.toolName,
              toolCallId: event.toolCallId,
              isError: event.isError
            };
            continue;
          case "artifact":
            if (!emittedArtifactIds.has(event.artifact.artifactId)) {
              emittedArtifactIds.add(event.artifact.artifactId);
              const media = runtimeOutputArtifactsToMediaArtifacts([event.artifact]);
              if (media.length > 0) {
                yield {
                  type: "media",
                  media
                };
              }
            }
            continue;
          case "interrupted":
            throw this.toInterruptedRuntimeError(event);
          case "failed":
            throw this.toRuntimeFailedError(event);
          case "completed": {
            const remainingArtifacts = event.result.artifacts.filter((artifact) => {
              if (emittedArtifactIds.has(artifact.artifactId)) {
                return false;
              }
              emittedArtifactIds.add(artifact.artifactId);
              return true;
            });
            if (remainingArtifacts.length > 0) {
              const media = runtimeOutputArtifactsToMediaArtifacts(remainingArtifacts);
              if (media.length > 0) {
                yield {
                  type: "media",
                  media
                };
              }
            }
            const assistantText = event.result.assistantText;
            if (
              assistantText.length > accumulated.length &&
              assistantText.startsWith(accumulated)
            ) {
              const tail = assistantText.slice(accumulated.length);
              if (tail.length > 0) {
                accumulated = assistantText;
                yield {
                  type: "delta",
                  delta: tail,
                  accumulated: assistantText
                };
              }
            }
            yield {
              type: "done",
              respondedAt: event.result.respondedAt,
              ...(event.result.trace === undefined ? {} : { runtimeTrace: event.result.trace })
            };
            return;
          }
        }
      }

      if (options?.signal?.aborted) {
        return;
      }
      throw new AssistantRuntimeError(
        "invalid_response",
        "Native runtime stream completed without a terminal done event."
      );
    } catch (error) {
      if (this.isAbortError(error) && options?.signal?.aborted) {
        return;
      }
      if (this.isAbortError(error)) {
        throw new AssistantRuntimeError(
          "timeout",
          `Native runtime stream timed out after ${config.PERSAI_RUNTIME_STREAM_TIMEOUT_MS}ms.`
        );
      }
      if (error instanceof AssistantRuntimeError) {
        throw error;
      }
      throw error;
    } finally {
      dispose();
    }
  }

  private async fetchStreamResponse(
    url: string,
    body: unknown,
    signal: AbortSignal
  ): Promise<Response> {
    try {
      return await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify(body),
        signal
      });
    } catch (error) {
      if (this.isAbortError(error)) {
        throw error;
      }
      const message =
        error instanceof Error ? error.message : "Unknown native runtime stream failure.";
      throw new AssistantRuntimeError(
        "runtime_unreachable",
        `Native runtime stream failed: ${message}`
      );
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

  private async *readRuntimeStream(response: Response): AsyncGenerator<RuntimeTurnStreamEvent> {
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

        while (true) {
          const newlineIndex = buffer.indexOf("\n");
          if (newlineIndex === -1) {
            break;
          }
          const line = buffer.slice(0, newlineIndex).trim();
          buffer = buffer.slice(newlineIndex + 1);
          if (line.length === 0) {
            continue;
          }
          yield this.parseRuntimeStreamEvent(line);
        }
      }

      buffer += decoder.decode();
      const tail = buffer.trim();
      if (tail.length > 0) {
        yield this.parseRuntimeStreamEvent(tail);
      }
    } finally {
      reader.releaseLock();
    }
  }

  private parseRuntimeStreamEvent(line: string): RuntimeTurnStreamEvent {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      throw new AssistantRuntimeError(
        "invalid_response",
        "Native runtime returned malformed NDJSON stream output."
      );
    }

    const row = this.asObject(parsed);
    switch (row?.type) {
      case "started":
        if (typeof row.requestId === "string" && typeof row.sessionId === "string") {
          return parsed as RuntimeTurnStreamEvent;
        }
        break;
      case "text_delta":
        if (
          typeof row.requestId === "string" &&
          typeof row.sessionId === "string" &&
          typeof row.delta === "string" &&
          typeof row.accumulatedText === "string"
        ) {
          return parsed as RuntimeTurnStreamEvent;
        }
        break;
      case "artifact":
        if (
          typeof row.requestId === "string" &&
          typeof row.sessionId === "string" &&
          this.asObject(row.artifact) !== null
        ) {
          return parsed as RuntimeTurnStreamEvent;
        }
        break;
      case "tool_started":
        if (
          typeof row.requestId === "string" &&
          typeof row.sessionId === "string" &&
          typeof row.toolCallId === "string" &&
          typeof row.toolName === "string"
        ) {
          return parsed as RuntimeTurnStreamEvent;
        }
        break;
      case "tool_finished":
        if (
          typeof row.requestId === "string" &&
          typeof row.sessionId === "string" &&
          typeof row.toolCallId === "string" &&
          typeof row.toolName === "string" &&
          typeof row.isError === "boolean"
        ) {
          return parsed as RuntimeTurnStreamEvent;
        }
        break;
      case "completed":
        if (this.isRuntimeTurnResult(row.result)) {
          return parsed as RuntimeTurnStreamEvent;
        }
        break;
      case "interrupted":
        if (
          typeof row.requestId === "string" &&
          typeof row.sessionId === "string" &&
          typeof row.assistantText === "string" &&
          (typeof row.respondedAt === "string" || row.respondedAt === null)
        ) {
          return parsed as RuntimeTurnStreamEvent;
        }
        break;
      case "failed":
        if (
          typeof row.requestId === "string" &&
          (typeof row.sessionId === "string" || row.sessionId === null) &&
          typeof row.code === "string" &&
          typeof row.message === "string" &&
          typeof row.willRetry === "boolean"
        ) {
          return parsed as RuntimeTurnStreamEvent;
        }
        break;
    }

    throw new AssistantRuntimeError(
      "invalid_response",
      "Native runtime returned an invalid text stream event."
    );
  }

  private toRuntimeFailedError(event: RuntimeFailedEvent): Error {
    if (
      event.code === "runtime_provider_routing_inactive" ||
      event.code === "native_runtime_request_invalid"
    ) {
      return createAssistantInboundValidationError("native_runtime_request_invalid", event.message);
    }
    if (
      event.code === "native_runtime_conflict" ||
      event.code === "native_runtime_conflict_in_flight" ||
      event.code === "native_runtime_busy"
    ) {
      return createAssistantInboundConflict("native_runtime_conflict", event.message);
    }
    if (event.code.includes("timeout")) {
      return new AssistantRuntimeError("timeout", event.message);
    }
    if (
      event.code === "runtime_bundle_missing" ||
      event.code === "runtime_bundle_hash_mismatch" ||
      event.code === "runtime_bundle_version_mismatch" ||
      event.code === "native_provider_selection_unavailable"
    ) {
      return new AssistantRuntimeError("runtime_degraded", event.message);
    }
    return new AssistantRuntimeError("runtime_unreachable", event.message);
  }

  private toInterruptedRuntimeError(event: RuntimeInterruptedEvent): AssistantRuntimeError {
    return new AssistantRuntimeError(
      "runtime_degraded",
      event.assistantText.trim().length > 0
        ? "Native runtime stream interrupted before completion."
        : "Native runtime stream interrupted without assistant output."
    );
  }

  private throwForFailedResponse(response: JsonResponse): never {
    const message =
      this.extractErrorMessage(response.body) ??
      `Native runtime stream failed with HTTP ${response.status}.`;

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
      typeof row.respondedAt === "string" &&
      (row.usage === null ||
        (typeof row.usage === "object" && row.usage !== null && !Array.isArray(row.usage)))
    );
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
}
