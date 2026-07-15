import { randomUUID } from "node:crypto";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { loadApiConfig } from "@persai/config";
import type {
  RuntimeFailedEvent,
  RuntimeAttachmentRef,
  RuntimeInterruptedEvent,
  RuntimeChannelContext,
  RuntimeJobDeliveryUpdate,
  RuntimeOpenMediaJobContext,
  RuntimeOpenDocumentJobContext,
  RuntimeOutputArtifact,
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
  type AssistantRuntimeWebChatTurnResult
} from "./assistant-runtime.facade";
import {
  createAssistantInboundConflict,
  createAssistantInboundValidationError
} from "./assistant-inbound-error";
import { resolveNativeRuntimeTurnTimeoutMs } from "./native-runtime-turn-timeout";
import { createRuntimeTurnWallClockDeadline } from "./runtime-turn-deadline";
import { resolveMaterializedNativeRuntimeBundle } from "./native-runtime-bundle-hash";
import type { RuntimeTier } from "./runtime-assignment";

const HIDDEN_RUNTIME_TOOL_NAMES = new Set<string>();
const DEGRADED_TOOL_OUTPUT_MESSAGE = "Tool completed, but follow-up text was interrupted.";
const ACCEPTED_TURN_REPLAY_POLL_INTERVAL_MS = 1_000;
const ACCEPTED_TURN_REPLAY_MAX_WAIT_MS = 60_000;

export interface SendNativeTelegramTurnInput {
  assistantId: string;
  publishedVersionId: string;
  runtimeTier: RuntimeTier;
  workspaceId: string;
  threadId: string;
  externalUserKey: string | null;
  mode: "direct" | "group";
  channelContext?: RuntimeChannelContext;
  userMessageId: string;
  userMessage: string;
  attachments: RuntimeAttachmentRef[];
  openMediaJobs?: RuntimeOpenMediaJobContext[];
  openDocumentJobs?: RuntimeOpenDocumentJobContext[];
  jobDeliveryUpdates?: RuntimeJobDeliveryUpdate[];
  userTimezone?: string;
  currentTimeIso?: string;
  deepMode?: RuntimeTurnRequest["deepMode"];
  providerOverride?: "openai" | "anthropic" | "deepseek";
  modelOverride?: string;
}

export interface SendNativeTelegramTurnCallbacks {
  onTool?:
    | ((payload: {
        phase: "start" | "end";
        toolName: string;
        toolCallId: string;
        isError: boolean;
      }) => Promise<void> | void)
    | undefined;
}

interface JsonResponse {
  ok: boolean;
  status: number;
  body: unknown;
}

@Injectable()
export class SendNativeTelegramTurnService {
  private readonly logger = new Logger(SendNativeTelegramTurnService.name);

  constructor(
    @Inject(ASSISTANT_MATERIALIZED_SPEC_REPOSITORY)
    private readonly assistantMaterializedSpecRepository: AssistantMaterializedSpecRepository
  ) {}

  async execute(
    input: SendNativeTelegramTurnInput,
    callbacks?: SendNativeTelegramTurnCallbacks
  ): Promise<AssistantRuntimeWebChatTurnResult> {
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

    const { bundleHash } = resolveMaterializedNativeRuntimeBundle({
      materializedSpec,
      context: "Native runtime"
    });

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
      ...(input.channelContext === undefined ? {} : { channelContext: input.channelContext }),
      message: {
        text: input.userMessage,
        attachments: input.attachments,
        locale: null,
        timezone: input.userTimezone ?? null,
        receivedAt: input.currentTimeIso ?? new Date().toISOString()
      },
      ...(input.openMediaJobs === undefined ? {} : { openMediaJobs: input.openMediaJobs }),
      ...(input.openDocumentJobs === undefined ? {} : { openDocumentJobs: input.openDocumentJobs }),
      ...(input.jobDeliveryUpdates === undefined
        ? {}
        : { jobDeliveryUpdates: input.jobDeliveryUpdates }),
      ...(input.deepMode === undefined ? {} : { deepMode: input.deepMode }),
      ...(input.providerOverride === undefined ? {} : { providerOverride: input.providerOverride }),
      ...(input.modelOverride === undefined ? {} : { modelOverride: input.modelOverride })
    };
    const wallClockMs = resolveNativeRuntimeTurnTimeoutMs(
      materializedSpec.runtimeBundle,
      config.PERSAI_RUNTIME_TURN_WALL_CLOCK_MS
    );

    const streamUrl = new URL("/api/v1/turns/stream", baseUrl).toString();
    const streamState = { accepted: false };
    const deadline = createRuntimeTurnWallClockDeadline({ wallClockMs });
    try {
      return await this.executeRuntimeStreamOnce({
        url: streamUrl,
        request,
        signal: deadline.signal,
        callbacks,
        streamState
      });
    } catch (error) {
      if (this.isAbortError(error)) {
        throw new AssistantRuntimeError(
          "timeout",
          `Native runtime Telegram stream timed out after ${wallClockMs}ms.`
        );
      }
      if (streamState.accepted && this.shouldReplayAcceptedTurnAfterStreamError(error)) {
        this.logger.warn(
          `[telegram-runtime-stream] accepted stream failed before terminal event; attempting idempotent replay assistantId=${input.assistantId} threadId=${input.threadId} requestId=${request.requestId} idempotencyKey=${request.idempotencyKey}: ${this.formatError(error)}`
        );
        return await this.replayAcceptedTurnUntilTerminal({
          url: streamUrl,
          request,
          signal: deadline.signal,
          callbacks,
          timeoutMs: wallClockMs,
          originalError: error
        });
      }
      if (error instanceof AssistantRuntimeError) {
        throw error;
      }
      throw error;
    } finally {
      deadline.dispose();
    }
  }

  private async replayAcceptedTurnUntilTerminal(params: {
    url: string;
    request: RuntimeTurnRequest;
    signal: AbortSignal;
    callbacks: SendNativeTelegramTurnCallbacks | undefined;
    timeoutMs: number;
    originalError: unknown;
  }): Promise<AssistantRuntimeWebChatTurnResult> {
    const deadlineAt = Date.now() + Math.min(params.timeoutMs, ACCEPTED_TURN_REPLAY_MAX_WAIT_MS);
    let lastError: unknown = params.originalError;

    while (!params.signal.aborted && Date.now() <= deadlineAt) {
      await this.sleep(ACCEPTED_TURN_REPLAY_POLL_INTERVAL_MS, params.signal);
      const replayState = { accepted: false };
      try {
        return await this.executeRuntimeStreamOnce({
          url: params.url,
          request: params.request,
          signal: params.signal,
          callbacks: params.callbacks,
          streamState: replayState
        });
      } catch (error) {
        lastError = error;
        if (!this.isReplayPendingConflict(error)) {
          throw error;
        }
      }
    }

    if (this.isAbortError(lastError)) {
      throw lastError;
    }
    if (lastError instanceof AssistantRuntimeError) {
      throw lastError;
    }
    throw params.originalError;
  }

  private async executeRuntimeStreamOnce(params: {
    url: string;
    request: RuntimeTurnRequest;
    signal: AbortSignal;
    callbacks: SendNativeTelegramTurnCallbacks | undefined;
    streamState: { accepted: boolean };
  }): Promise<AssistantRuntimeWebChatTurnResult> {
    const response = await this.fetchStreamResponse(params.url, params.request, params.signal);
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
        "Native runtime returned an empty Telegram stream response body."
      );
    }

    const emittedArtifactIds = new Set<string>();
    const collectedMedia: AssistantRuntimeWebChatTurnResult["media"] = [];
    const collectArtifacts = (artifacts: RuntimeOutputArtifact[]) => {
      const remainingArtifacts = artifacts.filter((artifact) => {
        if (emittedArtifactIds.has(artifact.artifactId)) {
          return false;
        }
        emittedArtifactIds.add(artifact.artifactId);
        return true;
      });
      if (remainingArtifacts.length > 0) {
        collectedMedia.push(...runtimeOutputArtifactsToMediaArtifacts(remainingArtifacts));
      }
    };

    for await (const event of this.readRuntimeStream(response)) {
      switch (event.type) {
        case "started":
          params.streamState.accepted = true;
          continue;
        case "text_delta":
          continue;
        case "tool_started":
          if (HIDDEN_RUNTIME_TOOL_NAMES.has(event.toolName)) {
            continue;
          }
          await this.emitToolEvent(params.callbacks, {
            phase: "start",
            toolName: event.toolName,
            toolCallId: event.toolCallId,
            isError: false
          });
          continue;
        case "tool_finished":
          if (HIDDEN_RUNTIME_TOOL_NAMES.has(event.toolName)) {
            continue;
          }
          await this.emitToolEvent(params.callbacks, {
            phase: "end",
            toolName: event.toolName,
            toolCallId: event.toolCallId,
            isError: event.isError
          });
          continue;
        case "artifact":
          if (!emittedArtifactIds.has(event.artifact.artifactId)) {
            emittedArtifactIds.add(event.artifact.artifactId);
            collectedMedia.push(...runtimeOutputArtifactsToMediaArtifacts([event.artifact]));
          }
          continue;
        case "interrupted": {
          collectArtifacts(event.artifacts ?? []);
          if (collectedMedia.length > 0) {
            return {
              assistantMessage: this.resolveDegradedAssistantMessage(event.assistantText),
              respondedAt: event.respondedAt ?? new Date().toISOString(),
              media: collectedMedia,
              ...(event.trace === undefined ? {} : { runtimeTrace: event.trace })
            };
          }
          throw this.toInterruptedRuntimeError(event);
        }
        case "failed": {
          collectArtifacts(event.artifacts ?? []);
          if (collectedMedia.length > 0) {
            return {
              assistantMessage: DEGRADED_TOOL_OUTPUT_MESSAGE,
              respondedAt: new Date().toISOString(),
              media: collectedMedia,
              ...(event.trace === undefined ? {} : { runtimeTrace: event.trace })
            };
          }
          throw this.toRuntimeFailedError(event);
        }
        case "completed": {
          collectArtifacts(event.result.artifacts);
          return {
            assistantMessage: event.result.assistantText,
            respondedAt: event.result.respondedAt,
            media: collectedMedia,
            ...(event.result.usageAccounting === undefined
              ? {}
              : { usageAccounting: event.result.usageAccounting }),
            ...(event.result.toolInvocations === undefined
              ? {}
              : { toolInvocations: event.result.toolInvocations }),
            ...(event.result.toolExchanges === undefined
              ? {}
              : { toolExchanges: event.result.toolExchanges }),
            ...(event.result.deferredMediaJobs === undefined
              ? {}
              : { deferredMediaJobs: event.result.deferredMediaJobs }),
            ...(event.result.autoCompaction === undefined
              ? {}
              : { autoCompaction: event.result.autoCompaction }),
            ...(event.result.trace === undefined ? {} : { runtimeTrace: event.result.trace })
          };
        }
      }
    }

    throw new AssistantRuntimeError(
      "invalid_response",
      "Native runtime Telegram stream completed without a terminal done event."
    );
  }

  private async emitToolEvent(
    callbacks: SendNativeTelegramTurnCallbacks | undefined,
    payload: {
      phase: "start" | "end";
      toolName: string;
      toolCallId: string;
      isError: boolean;
    }
  ): Promise<void> {
    try {
      await callbacks?.onTool?.(payload);
    } catch (error) {
      this.logger.warn(
        `[telegram-runtime-stream] ignored Telegram tool callback failure tool=${payload.toolName} phase=${payload.phase}: ${this.formatError(error)}`
      );
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
        error instanceof Error ? error.message : "Unknown native runtime Telegram stream failure.";
      throw new AssistantRuntimeError(
        "runtime_unreachable",
        `Native runtime Telegram stream failed: ${message}`
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
      "Native runtime returned an invalid Telegram stream event."
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
        ? "Native runtime Telegram stream interrupted before completion."
        : "Native runtime Telegram stream interrupted without assistant output."
    );
  }

  private resolveDegradedAssistantMessage(assistantText: string): string {
    const trimmed = assistantText.trim();
    return trimmed.length > 0 ? trimmed : DEGRADED_TOOL_OUTPUT_MESSAGE;
  }

  private throwForFailedResponse(response: JsonResponse): never {
    const message =
      this.extractErrorMessage(response.body) ??
      `Native runtime Telegram stream failed with HTTP ${response.status}.`;

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
      (row.turnRouting === undefined ||
        row.turnRouting === null ||
        this.isRuntimeTurnRoutingSnapshot(row.turnRouting)) &&
      (row.usage === null ||
        (typeof row.usage === "object" && row.usage !== null && !Array.isArray(row.usage)))
    );
  }

  private isRuntimeTurnRoutingSnapshot(
    value: unknown
  ): value is NonNullable<RuntimeTurnResult["turnRouting"]> {
    const row = this.asObject(value);
    return (
      (row?.mode === "shadow" || row?.mode === "active") &&
      (row.executionMode === "normal" ||
        row.executionMode === "premium" ||
        row.executionMode === "reasoning") &&
      (row.source === "precheck" || row.source === "llm" || row.source === "fallback")
    );
  }

  private shouldReplayAcceptedTurnAfterStreamError(error: unknown): boolean {
    if (this.isAbortError(error)) {
      return false;
    }
    if (error instanceof AssistantRuntimeError) {
      return error.code === "invalid_response";
    }
    if (this.readInboundErrorCode(error) !== null) {
      return false;
    }
    return true;
  }

  private isReplayPendingConflict(error: unknown): boolean {
    return this.readInboundErrorCode(error) === "native_runtime_conflict";
  }

  private readInboundErrorCode(error: unknown): string | null {
    const row = this.asObject(error);
    const errorObject = this.asObject(row?.errorObject);
    const code = errorObject?.code;
    return typeof code === "string" && code.trim().length > 0 ? code : null;
  }

  private async sleep(ms: number, signal: AbortSignal): Promise<void> {
    if (signal.aborted) {
      throw this.createAbortError();
    }
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(resolve, ms);
      const onAbort = () => {
        clearTimeout(timeout);
        reject(this.createAbortError());
      };
      signal.addEventListener("abort", onAbort, { once: true });
    });
  }

  private createAbortError(): Error {
    const error = new Error("Operation aborted.");
    error.name = "AbortError";
    return error;
  }

  private formatError(error: unknown): string {
    if (error instanceof Error) {
      return `${error.name}: ${error.message}`;
    }
    return String(error);
  }

  private isAbortError(error: unknown): boolean {
    return error instanceof Error && error.name === "AbortError";
  }
}
