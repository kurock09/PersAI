import { Injectable, Logger } from "@nestjs/common";
import type { RuntimeTurnRequest, RuntimeTurnResult } from "@persai/runtime-contract";
import type { CompletedWebTurnReplayState } from "../domain/assistant-channel-surface-binding.repository";
import {
  AsyncContinuationDispatchAmbiguousError,
  AsyncContinuationInterruptedError,
  InternalRuntimeAsyncContinuationClientService
} from "./internal-runtime-async-continuation.client.service";
import { WebChatTurnAttemptService } from "./web-chat-turn-attempt.service";
import { WebChatTurnStopDispatchService } from "./web-chat-turn-stop-dispatch.service";
import { WebChatTurnStreamRegistry } from "./web-chat-turn-stream-registry.service";

const WEB_CONTINUATION_CLAIM_STALE_MS = 120_000;

type WebContinuationContext = {
  handle: {
    id: string;
    assistantId: string;
    workspaceId: string;
    userId: string;
    chatId: string;
    channel: "web" | "telegram";
    threadKey: string | null;
    continuationClientTurnId: string | null;
    sourceUserMessageId: string | null;
    retryCount: number;
  };
  sourceUserMessage: { id: string };
};

export type StreamWebAsyncContinuationCallbacks = {
  persistOutputOnce: (
    claim: { id: string; claimToken: string },
    context: WebContinuationContext,
    result: RuntimeTurnResult
  ) => Promise<{ outcome: "persisted" | "existing"; messageId: string } | { outcome: "lost" }>;
  finalizeContinuationChildren: (
    context: WebContinuationContext,
    outcome: "persisted" | "failed" | "stopped",
    assistantMessageId?: string
  ) => Promise<void>;
  deliverContinuationArtifactsOnce: (
    claim: { id: string; claimToken: string },
    context: WebContinuationContext,
    assistantMessageId: string,
    result: RuntimeTurnResult
  ) => Promise<void>;
  failClaimVisibly: (
    claim: { id: string; claimToken: string },
    error: { errorCode: string; errorMessage: string }
  ) => Promise<void>;
  requeueBusyNotStarted: (input: {
    id: string;
    claimToken: string;
    receiptRequestId: string;
    retryAt: Date;
  }) => Promise<unknown>;
  completeClaim: (claim: { id: string; claimToken: string }) => Promise<boolean>;
  deliveryAttemptsSettled: (
    claim: { id: string; claimToken: string },
    channel: "web" | "telegram"
  ) => Promise<boolean>;
  retryAt: (retryCount: number) => Date;
};

/**
 * ADR-152 — web notify continuation uses the same ADR-149 turn-attempt /
 * stream-registry / Stop path as ordinary web chat. Telegram keeps the
 * blocking runtime execute path on the scheduler.
 */
@Injectable()
export class StreamWebAsyncContinuationService {
  private readonly logger = new Logger(StreamWebAsyncContinuationService.name);

  constructor(
    private readonly runtimeClient: InternalRuntimeAsyncContinuationClientService,
    private readonly webChatTurnAttemptService: WebChatTurnAttemptService,
    private readonly webChatTurnStreamRegistry: WebChatTurnStreamRegistry,
    private readonly webChatTurnStopDispatchService: WebChatTurnStopDispatchService
  ) {}

  async processWebClaim(input: {
    claim: { id: string; claimToken: string };
    context: WebContinuationContext;
    request: RuntimeTurnRequest;
    timeoutMs: number;
    callbacks: StreamWebAsyncContinuationCallbacks;
  }): Promise<void> {
    const { claim, context, request, timeoutMs, callbacks } = input;
    const continuationClientTurnId = context.handle.continuationClientTurnId;
    const threadKey = context.handle.threadKey;
    if (continuationClientTurnId === null || threadKey === null) {
      await callbacks.failClaimVisibly(claim, {
        errorCode: "continuation_context_invalid",
        errorMessage: "Web continuation is missing clientTurnId or threadKey."
      });
      return;
    }

    const claimResult = await this.webChatTurnAttemptService.claim({
      assistantId: context.handle.assistantId,
      userId: context.handle.userId,
      workspaceId: context.handle.workspaceId,
      surfaceThreadKey: threadKey,
      clientTurnId: continuationClientTurnId,
      claimedAt: new Date(),
      staleAfterMs: WEB_CONTINUATION_CLAIM_STALE_MS,
      surfaceClient: "async_continuation"
    });
    if (claimResult === "duplicate_handled") {
      this.logger.log(
        `web_async_continuation_attempt_already_completed clientTurnId=${continuationClientTurnId}`
      );
      return;
    }
    if (claimResult === "duplicate_inflight") {
      this.logger.warn(
        `web_async_continuation_attempt_inflight clientTurnId=${continuationClientTurnId}; leaving dispatched for reconcile`
      );
      return;
    }

    // Null userMessageId: continuations open a new assistant bubble without a
    // new user row. Binding sourceUserMessageId made history merge treat the
    // prior assistant (after that user) as "already committed" and kill reattach.
    await this.webChatTurnAttemptService.markRunning({
      assistantId: context.handle.assistantId,
      userId: context.handle.userId,
      surfaceThreadKey: threadKey,
      clientTurnId: continuationClientTurnId,
      chatId: context.handle.chatId,
      userMessageId: null,
      surfaceClient: "async_continuation"
    });

    const abortController = new AbortController();
    const registryIdentity = {
      assistantId: context.handle.assistantId,
      clientTurnId: continuationClientTurnId,
      userId: context.handle.userId
    };
    this.webChatTurnStopDispatchService.register({
      ...registryIdentity,
      controller: abortController
    });
    this.webChatTurnStreamRegistry.register(registryIdentity);

    const publish = (event: string, payload: unknown): void => {
      this.webChatTurnStreamRegistry.publish({
        ...registryIdentity,
        event,
        payload
      });
    };

    const attemptIdentity = {
      assistantId: context.handle.assistantId,
      userId: context.handle.userId,
      surfaceThreadKey: threadKey,
      clientTurnId: continuationClientTurnId
    };

    const isInterruptedError = (error: unknown): boolean =>
      error instanceof AsyncContinuationInterruptedError ||
      abortController.signal.aborted ||
      this.webChatTurnStopDispatchService.wasUserStopped(
        context.handle.assistantId,
        continuationClientTurnId
      );

    const finalizeInterrupted = async (): Promise<void> => {
      await callbacks.finalizeContinuationChildren(context, "stopped");
      await this.webChatTurnAttemptService.markInterrupted({
        ...attemptIdentity,
        code: "continuation_interrupted",
        message: "Web async continuation was interrupted."
      });
      publish("interrupted", { transport: null });
      await callbacks.failClaimVisibly(claim, {
        errorCode: "continuation_interrupted",
        errorMessage: "Web async continuation was interrupted."
      });
    };

    const leaveDispatchedAmbiguous = async (message: string): Promise<void> => {
      this.logger.warn(`web_async_continuation_dispatch_ambiguous id=${claim.id}: ${message}`);
      await this.webChatTurnAttemptService.markFailed({
        ...attemptIdentity,
        code: "continuation_dispatch_ambiguous",
        message
      });
      publish("failed", {
        code: "continuation_dispatch_ambiguous",
        message,
        transport: null
      });
    };

    const terminalizeAttemptBeforeRethrow = async (error: unknown): Promise<void> => {
      const message = error instanceof Error ? error.message : String(error);
      await this.webChatTurnAttemptService.markFailed({
        ...attemptIdentity,
        code: "continuation_dispatch_failed",
        message
      });
      publish("failed", {
        code: "continuation_dispatch_failed",
        message,
        transport: null
      });
    };

    try {
      let started;
      try {
        started = await this.runtimeClient.stream(request, {
          timeoutMs,
          signal: abortController.signal
        });
      } catch (error) {
        if (isInterruptedError(error)) {
          await finalizeInterrupted();
          return;
        }
        if (error instanceof AsyncContinuationDispatchAmbiguousError) {
          await leaveDispatchedAmbiguous(error.message);
          return;
        }
        await terminalizeAttemptBeforeRethrow(error);
        throw error;
      }

      if (started.mode === "outcome") {
        await this.handleOutcome({
          claim,
          context,
          threadKey,
          continuationClientTurnId,
          outcome: started.result,
          receiptRequestId: request.requestId,
          callbacks,
          publish
        });
        return;
      }

      let terminal: RuntimeTurnResult | null = null;
      let failedCode: string | null = null;
      let failedMessage: string | null = null;
      let interrupted = false;

      try {
        for await (const event of started.events) {
          if (abortController.signal.aborted) {
            interrupted = true;
            break;
          }
          switch (event.type) {
            case "started":
              publish("started", {
                requestId: event.requestId,
                chat: { id: context.handle.chatId },
                userMessage: { id: context.sourceUserMessage.id }
              });
              break;
            case "text_delta":
              if (event.delta.length > 0) {
                publish("delta", { delta: event.delta });
              }
              break;
            case "tool_started":
              publish("tool", {
                phase: "start",
                toolName: event.toolName,
                toolCallId: event.toolCallId,
                isError: false,
                ...(typeof event.toolInputPreview === "string" && event.toolInputPreview.length > 0
                  ? { toolInputPreview: event.toolInputPreview }
                  : {})
              });
              await this.webChatTurnAttemptService.markCurrentActivity({
                ...attemptIdentity,
                toolName: event.toolName,
                toolCallId: event.toolCallId,
                phase: "start",
                isError: false,
                ...(typeof event.toolInputPreview === "string" && event.toolInputPreview.length > 0
                  ? { toolInputPreview: event.toolInputPreview }
                  : {})
              });
              break;
            case "tool_finished":
              publish("tool", {
                phase: "end",
                toolName: event.toolName,
                toolCallId: event.toolCallId,
                isError: event.isError
              });
              await this.webChatTurnAttemptService.markCurrentActivity({
                ...attemptIdentity,
                toolName: event.toolName,
                toolCallId: event.toolCallId,
                phase: "end",
                isError: event.isError
              });
              break;
            case "tool_progress":
              publish("tool_progress", {
                toolName: event.toolName,
                toolCallId: event.toolCallId,
                kind: event.kind,
                ...(event.line === undefined ? {} : { line: event.line }),
                ...(event.step === undefined ? {} : { step: event.step }),
                seq: event.seq
              });
              await this.webChatTurnAttemptService.touchRunningAttempt(attemptIdentity);
              break;
            case "async_job_accepted":
              publish("async_job_accepted", {
                kind: event.kind,
                jobRef: event.jobRef,
                ...(event.mediaJob === undefined ? {} : { mediaJob: event.mediaJob }),
                ...(event.documentJob === undefined ? {} : { documentJob: event.documentJob }),
                ...(event.sandboxJob === undefined ? {} : { sandboxJob: event.sandboxJob })
              });
              break;
            case "retrieval_activity":
              publish("activity", {
                source: event.source,
                phase: event.phase,
                resultCount: event.resultCount,
                ...(event.skillName === undefined ? {} : { skillName: event.skillName }),
                ...(event.skillIconEmoji === undefined
                  ? {}
                  : { skillIconEmoji: event.skillIconEmoji })
              });
              break;
            case "project_activity":
              publish("project_activity", {
                stage: event.stage,
                status: event.status,
                summary: event.summary,
                ...(event.detail === undefined ? {} : { detail: event.detail }),
                ...(event.sourceClass === undefined ? {} : { sourceClass: event.sourceClass }),
                ...(event.resultCount === undefined ? {} : { resultCount: event.resultCount })
              });
              break;
            case "project_reasoning_summary":
              publish("project_reasoning_summary", {
                kind: event.kind,
                summary: event.summary,
                ...(event.detail === undefined ? {} : { detail: event.detail })
              });
              break;
            case "completed":
              terminal = event.result;
              break;
            case "failed":
              failedCode = event.code;
              failedMessage = event.message;
              break;
            case "interrupted":
              interrupted = true;
              break;
            default:
              break;
          }
        }
      } catch (error) {
        if (isInterruptedError(error)) {
          await finalizeInterrupted();
          return;
        }
        if (error instanceof AsyncContinuationDispatchAmbiguousError) {
          await leaveDispatchedAmbiguous(error.message);
          return;
        }
        await terminalizeAttemptBeforeRethrow(error);
        throw error;
      }

      if (
        this.webChatTurnStopDispatchService.wasUserStopped(
          context.handle.assistantId,
          continuationClientTurnId
        )
      ) {
        interrupted = true;
      }

      if (terminal !== null) {
        await this.completeSuccessfully({
          claim,
          context,
          threadKey,
          continuationClientTurnId,
          result: terminal,
          callbacks,
          publish
        });
        return;
      }

      if (interrupted) {
        await finalizeInterrupted();
        return;
      }

      if (failedCode !== null) {
        await callbacks.finalizeContinuationChildren(context, "failed");
        await this.webChatTurnAttemptService.markFailed({
          ...attemptIdentity,
          code: failedCode,
          message: failedMessage ?? "Runtime continuation failed."
        });
        publish("failed", {
          code: failedCode,
          message: failedMessage ?? "Runtime continuation failed.",
          transport: null
        });
        await callbacks.failClaimVisibly(claim, {
          errorCode: failedCode,
          errorMessage: failedMessage ?? "Runtime continuation failed."
        });
        return;
      }

      this.logger.warn(
        `web_async_continuation_stream_unterminated id=${claim.id}; failing claim visibly`
      );
      await this.webChatTurnAttemptService.markFailed({
        ...attemptIdentity,
        code: "continuation_stream_unterminated",
        message: "Runtime continuation stream ended without a terminal event."
      });
      publish("failed", {
        code: "continuation_stream_unterminated",
        message: "Runtime continuation stream ended without a terminal event.",
        transport: null
      });
      await callbacks.failClaimVisibly(claim, {
        errorCode: "continuation_stream_unterminated",
        errorMessage: "Runtime continuation stream ended without a terminal event."
      });
    } catch (error) {
      if (isInterruptedError(error)) {
        await finalizeInterrupted();
        return;
      }
      if (error instanceof AsyncContinuationDispatchAmbiguousError) {
        await leaveDispatchedAmbiguous(error.message);
        return;
      }
      // Non-ambiguous errors already terminalized the attempt before rethrow
      // from inner catches; scheduler requeues the handle.
      throw error;
    } finally {
      this.webChatTurnStopDispatchService.release({
        assistantId: context.handle.assistantId,
        clientTurnId: continuationClientTurnId,
        controller: abortController
      });
      this.webChatTurnStreamRegistry.release(registryIdentity);
    }
  }

  private async handleOutcome(input: {
    claim: { id: string; claimToken: string };
    context: WebContinuationContext;
    threadKey: string;
    continuationClientTurnId: string;
    outcome: Awaited<ReturnType<InternalRuntimeAsyncContinuationClientService["execute"]>>;
    receiptRequestId: string;
    callbacks: StreamWebAsyncContinuationCallbacks;
    publish: (event: string, payload: unknown) => void;
  }): Promise<void> {
    const { claim, context, threadKey, continuationClientTurnId, outcome, callbacks, publish } =
      input;
    if (outcome.outcome === "duplicate") {
      return;
    }
    if (outcome.outcome === "busy") {
      // Retriable: no user-visible fail, no failed SSE. Reset attempt so reclaim
      // is not stuck on duplicate_inflight / terminal failed.
      await this.webChatTurnAttemptService.resetToAccepted({
        assistantId: context.handle.assistantId,
        userId: context.handle.userId,
        surfaceThreadKey: threadKey,
        clientTurnId: continuationClientTurnId
      });
      await callbacks.requeueBusyNotStarted({
        ...claim,
        receiptRequestId: input.receiptRequestId,
        retryAt: callbacks.retryAt(context.handle.retryCount)
      });
      return;
    }
    if (outcome.outcome === "failed") {
      await callbacks.finalizeContinuationChildren(context, "failed");
      await this.webChatTurnAttemptService.markFailed({
        assistantId: context.handle.assistantId,
        userId: context.handle.userId,
        surfaceThreadKey: threadKey,
        clientTurnId: continuationClientTurnId,
        code: outcome.code,
        message: "Runtime continuation failed."
      });
      publish("failed", {
        code: outcome.code,
        message: "Runtime continuation failed.",
        transport: null
      });
      await callbacks.failClaimVisibly(claim, {
        errorCode: outcome.code,
        errorMessage: "Runtime continuation failed."
      });
      return;
    }
    if (outcome.outcome !== "completed") {
      return;
    }
    await this.completeSuccessfully({
      claim,
      context,
      threadKey,
      continuationClientTurnId,
      result: outcome.result,
      callbacks,
      publish
    });
  }

  private async completeSuccessfully(input: {
    claim: { id: string; claimToken: string };
    context: WebContinuationContext;
    threadKey: string;
    continuationClientTurnId: string;
    result: RuntimeTurnResult;
    callbacks: StreamWebAsyncContinuationCallbacks;
    publish: (event: string, payload: unknown) => void;
  }): Promise<void> {
    const { claim, context, threadKey, continuationClientTurnId, result, callbacks, publish } =
      input;
    const persisted = await callbacks.persistOutputOnce(claim, context, result);
    if (persisted.outcome === "lost") return;
    const assistantMessageId = persisted.messageId;
    const respondedAt = result.respondedAt;
    const terminalPayload: CompletedWebTurnReplayState = {
      clientTurnId: continuationClientTurnId,
      chatId: context.handle.chatId,
      userMessageId: context.sourceUserMessage.id,
      assistantMessageId,
      respondedAt,
      degradedByQuotaFallback: false,
      quotaFallbackReason: null,
      quotaFallbackModel: null,
      completedAt: new Date().toISOString()
    };
    await this.webChatTurnAttemptService.markCompleted({
      assistantId: context.handle.assistantId,
      userId: context.handle.userId,
      surfaceThreadKey: threadKey,
      clientTurnId: continuationClientTurnId,
      assistantMessageId,
      respondedAt,
      terminalPayload
    });
    publish("completed", { transport: null });
    await callbacks.finalizeContinuationChildren(context, "persisted", assistantMessageId);
    await callbacks.deliverContinuationArtifactsOnce(claim, context, assistantMessageId, result);
    if (!(await callbacks.deliveryAttemptsSettled(claim, "web"))) return;
    const completed = await callbacks.completeClaim(claim);
    if (!completed) {
      this.logger.warn(`Late web continuation completion lost its claim id=${claim.id}.`);
    }
  }
}
