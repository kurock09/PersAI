import { Injectable, Logger, Optional } from "@nestjs/common";
import type { RuntimeTurnRequest, RuntimeTurnResult } from "@persai/runtime-contract";
import type { CompletedWebTurnReplayState } from "../domain/assistant-channel-surface-binding.repository";
import {
  AsyncContinuationCoordinationLostError,
  AsyncContinuationDispatchAmbiguousError,
  AsyncContinuationInterruptedError,
  InternalRuntimeAsyncContinuationClientService
} from "./internal-runtime-async-continuation.client.service";
import { ChatWakeCoordinator } from "./chat-wake-coordinator.service";
import { ConversationalPublishService } from "./conversational-publish.service";
import { WebChatTurnAttemptService } from "./web-chat-turn-attempt.service";
import { WebChatContinuationDiscoveryService } from "./web-chat-continuation-discovery.service";
import { WebChatTurnStopDispatchService } from "./web-chat-turn-stop-dispatch.service";
import { WebChatTurnStreamRegistry } from "./web-chat-turn-stream-registry.service";

const WEB_CONTINUATION_CLAIM_STALE_MS = 120_000;

type WebContinuationContext = {
  handle: {
    id: string;
    kind: "media" | "document" | "sandbox";
    canonicalJobId: string;
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
  sessionId: string;
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
  /**
   * When catch-up fails but the canonical job already delivered artifacts,
   * complete the handle on that delivery bubble without inventing system prose.
   * Returns null when settlement does not apply.
   */
  settleDeliveredCatchUpFailure: (claim: {
    id: string;
    claimToken: string;
  }) => Promise<{ assistantMessageId: string } | null>;
  /** ADR-159 — markDispatched only after runtime lease acquired + attempt running. */
  markDispatched: (input: {
    id: string;
    claimToken: string;
    receiptRequestId: string;
  }) => Promise<boolean>;
  /** ADR-159 — pre-accept busy / runtime duplicate: release claimed→ready. */
  releasePreDispatchBusy: (input: {
    id: string;
    claimToken: string;
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
 * ADR-152 / ADR-159 — web notify continuation uses the same ADR-149 turn-attempt /
 * stream-registry / Stop path as ordinary web chat. Dispatch proof
 * (`markDispatched`) is deferred until the runtime session lease is acquired
 * and the web attempt is running. Telegram keeps the blocking execute path on
 * the scheduler.
 */
@Injectable()
export class StreamWebAsyncContinuationService {
  private readonly logger = new Logger(StreamWebAsyncContinuationService.name);

  constructor(
    private readonly runtimeClient: InternalRuntimeAsyncContinuationClientService,
    private readonly webChatTurnAttemptService: WebChatTurnAttemptService,
    private readonly webChatTurnStreamRegistry: WebChatTurnStreamRegistry,
    private readonly webChatTurnStopDispatchService: WebChatTurnStopDispatchService,
    private readonly conversationalPublish: ConversationalPublishService,
    @Optional() private readonly chatWakeCoordinator?: ChatWakeCoordinator,
    @Optional()
    private readonly continuationDiscovery?: WebChatContinuationDiscoveryService
  ) {}

  async processWebClaim(input: {
    claim: { id: string; claimToken: string };
    context: WebContinuationContext;
    request: RuntimeTurnRequest;
    timeoutMs: number;
    coordinationSignal?: AbortSignal;
    isCatchUpLockHeld?: () => boolean;
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
      // ADR-159 — attempt already terminal; complete the handle now so the FIFO
      // head frees immediately (do not leave claimed for claim-TTL reconcile).
      const completed = await callbacks.completeClaim(claim);
      if (!completed) {
        this.logger.warn(
          `web_async_continuation_duplicate_handled_complete_lost id=${claim.id} clientTurnId=${continuationClientTurnId}`
        );
      }
      return;
    }
    if (claimResult === "duplicate_inflight") {
      this.logger.warn(
        `web_async_continuation_attempt_inflight clientTurnId=${continuationClientTurnId}; release claim to ready`
      );
      await callbacks.releasePreDispatchBusy({
        ...claim,
        retryAt: callbacks.retryAt(context.handle.retryCount)
      });
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
    const onCoordinationAbort = (): void =>
      abortController.abort(
        input.coordinationSignal?.reason instanceof Error
          ? input.coordinationSignal.reason
          : new AsyncContinuationCoordinationLostError()
      );
    input.coordinationSignal?.addEventListener("abort", onCoordinationAbort);
    if (input.coordinationSignal?.aborted) onCoordinationAbort();
    const coordinationLost = (): boolean =>
      input.coordinationSignal?.aborted === true || input.isCatchUpLockHeld?.() === false;
    const registryIdentity = {
      assistantId: context.handle.assistantId,
      clientTurnId: continuationClientTurnId,
      userId: context.handle.userId
    };
    try {
      // A continuation must not claim a running web attempt until a Stop from
      // another API replica can reach its local AbortController.
      await this.webChatTurnStopDispatchService.register({
        ...registryIdentity,
        controller: abortController
      });
      await this.webChatTurnStreamRegistry.register(registryIdentity);
      // The exact per-turn Redis stream now exists. Only now may the chat-level
      // discovery channel tell an already-open browser to attach to it.
      await this.continuationDiscovery?.publishReady({
        ...registryIdentity,
        chatId: context.handle.chatId,
        threadKey
      });
    } catch (error) {
      await this.webChatTurnAttemptService.abandonPreAcceptanceAttempt({
        assistantId: context.handle.assistantId,
        userId: context.handle.userId,
        surfaceThreadKey: threadKey,
        clientTurnId: continuationClientTurnId
      });
      await callbacks.releasePreDispatchBusy({
        ...claim,
        retryAt: callbacks.retryAt(context.handle.retryCount)
      });
      this.logger.warn(
        `web_async_continuation_stop_registration_failed id=${claim.id}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      return;
    }

    const touchStreamTtl = (): void => {
      void this.webChatTurnStreamRegistry.touch(registryIdentity).catch(() => undefined);
    };
    // Silent long waits (no deltas) must not expire Redis meta; tool_progress
    // also touches below. Interval mirrors primary-stream heartbeat cadence.
    const streamTtlHeartbeat = setInterval(touchStreamTtl, 10_000);
    if (typeof streamTtlHeartbeat.unref === "function") {
      streamTtlHeartbeat.unref();
    }

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
      (error instanceof AsyncContinuationInterruptedError && !coordinationLost()) ||
      abortController.signal.aborted ||
      this.webChatTurnStopDispatchService.wasUserStopped(
        context.handle.assistantId,
        continuationClientTurnId
      );

    const releaseBusyPreDispatch = async (): Promise<void> => {
      await this.webChatTurnAttemptService.abandonPreAcceptanceAttempt(attemptIdentity);
      await callbacks.releasePreDispatchBusy({
        ...claim,
        retryAt: callbacks.retryAt(context.handle.retryCount)
      });
    };

    const finalizeInterrupted = async (): Promise<void> => {
      // failClaim accepts claimed|dispatched; Stop may land before runtime accept.
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

    // ADR-159 — local proof that markDispatched already succeeded after runtime accept.
    // A later markDispatched false means already-dispatched, never pre-accept busy.
    let dispatched = false;
    let coordinationReconciled = false;

    const ensureDispatched = async (): Promise<boolean> => {
      if (dispatched) return true;
      const marked = await callbacks.markDispatched({
        ...claim,
        receiptRequestId: request.requestId
      });
      dispatched = marked;
      return marked;
    };

    const reconcileCoordinationLoss = async (): Promise<void> => {
      if (coordinationReconciled) return;
      coordinationReconciled = true;
      const status = await this.runtimeClient.inspect({
        ...request,
        sessionId: context.sessionId
      });
      if (
        status.proof === "proven" &&
        status.receiptStatus === "absent" &&
        !status.exactInFlight &&
        !status.logicalEverAccepted &&
        !dispatched
      ) {
        await releaseBusyPreDispatch();
        return;
      }
      await terminalizeAmbiguousContinuation(
        "Runtime coordination was lost after logical continuation acceptance became possible."
      );
    };

    const terminalizeFailedAttempt = async (code: string, message: string): Promise<boolean> => {
      // Returns true when already-delivered artifacts let us complete quietly
      // (caller must not requeue). False keeps the historical markFailed + throw
      // requeue path for genuine dispatch failures.
      const settled = await callbacks.settleDeliveredCatchUpFailure(claim);
      if (settled !== null) {
        const respondedAt = new Date().toISOString();
        const terminalPayload: CompletedWebTurnReplayState = {
          clientTurnId: continuationClientTurnId,
          chatId: context.handle.chatId,
          userMessageId: context.sourceUserMessage.id,
          assistantMessageId: settled.assistantMessageId,
          respondedAt,
          degradedByQuotaFallback: false,
          quotaFallbackReason: null,
          quotaFallbackModel: null,
          completedAt: new Date().toISOString()
        };
        await this.webChatTurnAttemptService.markCompleted({
          ...attemptIdentity,
          assistantMessageId: settled.assistantMessageId,
          respondedAt,
          terminalPayload,
          healFailedAsyncContinuation: true
        });
        publish("completed", { transport: null });
        await callbacks.finalizeContinuationChildren(
          context,
          "persisted",
          settled.assistantMessageId
        );
        this.logger.log(
          `web_async_continuation_settled_delivered id=${claim.id} assistantMessageId=${settled.assistantMessageId} priorError=${code}`
        );
        return true;
      }
      await this.webChatTurnAttemptService.markFailed({
        ...attemptIdentity,
        code,
        message
      });
      publish("failed", {
        code,
        message,
        transport: null
      });
      return false;
    };

    const terminalizeAmbiguousContinuation = async (detail: string): Promise<void> => {
      this.logger.warn(`web_async_continuation_dispatch_ambiguous id=${claim.id}: ${detail}`);
      await this.failOrSettleDelivered({
        claim,
        context,
        threadKey,
        continuationClientTurnId,
        attemptIdentity,
        callbacks,
        publish,
        code: "continuation_dispatch_ambiguous",
        message: "The continuation may have started but its result could not be recovered safely."
      });
    };

    const leaveDispatchedAmbiguous = async (message: string): Promise<void> => {
      const status = await this.runtimeClient.inspect({
        ...request,
        sessionId: context.sessionId
      });
      if (
        status.proof === "proven" &&
        status.receiptStatus === "absent" &&
        !status.exactInFlight &&
        !status.logicalEverAccepted
      ) {
        await releaseBusyPreDispatch();
        return;
      }
      await terminalizeAmbiguousContinuation(message);
    };

    const terminalizeAttemptBeforeRethrow = async (error: unknown): Promise<boolean> => {
      const message = error instanceof Error ? error.message : String(error);
      if (dispatched) {
        // Post-accept / mid-stream: markFailed + publish, or settle when delivered.
        // Returns true when settled — caller must not requeue the handle.
        return terminalizeFailedAttempt("continuation_dispatch_failed", message);
      }
      // Pre-accept clear error (e.g. runtime unconfigured): no markDispatched.
      await releaseBusyPreDispatch();
      return false;
    };

    try {
      if (coordinationLost()) {
        await releaseBusyPreDispatch();
        return;
      }
      // ADR-159 Slice 1 — durable CAS is the USER_TURN/JOB_CATCHUP admission
      // boundary immediately before runtime acceptance (not only lock/head claim).
      if (this.chatWakeCoordinator !== undefined) {
        const gate = await this.chatWakeCoordinator.admitCatchUpAtBoundary({
          chatId: context.handle.chatId,
          assistantId: context.handle.assistantId,
          userId: context.handle.userId,
          surfaceThreadKey: threadKey
        });
        if (!gate.allowed) {
          this.logger.log(
            `web_async_continuation_pre_runtime_gate id=${claim.id} reason=${gate.reason}`
          );
          await releaseBusyPreDispatch();
          return;
        }
      }

      // ADR-162 Phase 1 — ConversationalPublish before narration stream (required).
      let publishedAssistantMessageId: string | null = null;
      try {
        publishedAssistantMessageId = await this.conversationalPublish.publishForCatchUp({
          handleId: context.handle.id,
          kind: context.handle.kind,
          canonicalJobId: context.handle.canonicalJobId,
          assistantId: context.handle.assistantId,
          workspaceId: context.handle.workspaceId,
          chatId: context.handle.chatId,
          channel: context.handle.channel
        });
      } catch (error) {
        this.logger.warn(
          `web_async_continuation_conversational_publish_failed id=${claim.id}: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
        await releaseBusyPreDispatch();
        return;
      }
      if (publishedAssistantMessageId !== null) {
        await this.webChatTurnAttemptService.bindAssistantMessageId({
          ...attemptIdentity,
          assistantMessageId: publishedAssistantMessageId
        });
      }

      let started;
      try {
        started = await this.runtimeClient.stream(request, {
          timeoutMs,
          signal: abortController.signal
        });
      } catch (error) {
        if (coordinationLost() || error instanceof AsyncContinuationCoordinationLostError) {
          await reconcileCoordinationLoss();
          return;
        }
        if (isInterruptedError(error)) {
          await finalizeInterrupted();
          return;
        }
        if (error instanceof AsyncContinuationDispatchAmbiguousError) {
          await leaveDispatchedAmbiguous(error.message);
          return;
        }
        if (await terminalizeAttemptBeforeRethrow(error)) {
          return;
        }
        throw error;
      }

      if (started.mode === "outcome") {
        if (coordinationLost()) {
          await reconcileCoordinationLoss();
          return;
        }
        if (started.result.outcome === "busy") {
          // Runtime reported the session busy before accepting this continuation.
          await releaseBusyPreDispatch();
          return;
        }
        if (started.result.outcome === "duplicate") {
          // `in_flight` can be the same logical continuation under another
          // request id. Requeue only after durable logical absence proof.
          await leaveDispatchedAmbiguous(
            "Runtime reported an in-flight continuation for this logical key."
          );
          return;
        }
        if (!(await ensureDispatched())) return;
        await this.handleOutcome({
          claim,
          context,
          threadKey,
          continuationClientTurnId,
          outcome: started.result,
          request,
          receiptRequestId: request.requestId,
          callbacks,
          publish
        });
        return;
      }

      // NDJSON stream ⇒ runtime accepted and holds the session lease.
      if (coordinationLost()) {
        await reconcileCoordinationLoss();
        return;
      }
      if (!(await ensureDispatched())) return;

      let terminal: RuntimeTurnResult | null = null;
      let failedCode: string | null = null;
      let failedMessage: string | null = null;
      let interrupted = false;

      try {
        for await (const event of started.events) {
          if (coordinationLost()) {
            await reconcileCoordinationLoss();
            return;
          }
          if (abortController.signal.aborted) {
            interrupted = true;
            break;
          }
          switch (event.type) {
            case "started":
              publish("started", {
                requestId: event.requestId,
                chat: { id: context.handle.chatId },
                userMessage: { id: context.sourceUserMessage.id },
                ...(publishedAssistantMessageId === null
                  ? {}
                  : { assistantMessageId: publishedAssistantMessageId })
              });
              break;
            case "text_delta":
              if (event.delta.length > 0) {
                publish("delta", { delta: event.delta });
              }
              break;
            case "thinking":
              if (event.delta.length > 0 || event.accumulated.length > 0) {
                publish("thinking", {
                  delta: event.delta,
                  accumulated: event.accumulated
                });
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
              touchStreamTtl();
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
        if (coordinationLost() || error instanceof AsyncContinuationCoordinationLostError) {
          await reconcileCoordinationLoss();
          return;
        }
        if (isInterruptedError(error)) {
          await finalizeInterrupted();
          return;
        }
        if (error instanceof AsyncContinuationDispatchAmbiguousError) {
          await leaveDispatchedAmbiguous(error.message);
          return;
        }
        if (await terminalizeAttemptBeforeRethrow(error)) {
          return;
        }
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
      if (coordinationLost()) {
        await reconcileCoordinationLoss();
        return;
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
        await this.failOrSettleDelivered({
          claim,
          context,
          threadKey,
          continuationClientTurnId,
          attemptIdentity,
          callbacks,
          publish,
          code: failedCode,
          message: failedMessage ?? "Runtime continuation failed."
        });
        return;
      }

      this.logger.warn(
        `web_async_continuation_stream_unterminated id=${claim.id}; failing claim visibly`
      );
      await this.failOrSettleDelivered({
        claim,
        context,
        threadKey,
        continuationClientTurnId,
        attemptIdentity,
        callbacks,
        publish,
        code: "continuation_stream_unterminated",
        message: "Runtime continuation stream ended without a terminal event."
      });
    } catch (error) {
      if (coordinationLost() || error instanceof AsyncContinuationCoordinationLostError) {
        await reconcileCoordinationLoss();
        return;
      }
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
      input.coordinationSignal?.removeEventListener("abort", onCoordinationAbort);
      clearInterval(streamTtlHeartbeat);
      this.webChatTurnStopDispatchService.release({
        assistantId: context.handle.assistantId,
        clientTurnId: continuationClientTurnId,
        controller: abortController
      });
      await this.webChatTurnStreamRegistry.releaseAsync(registryIdentity);
    }
  }

  private async handleOutcome(input: {
    claim: { id: string; claimToken: string };
    context: WebContinuationContext;
    threadKey: string;
    continuationClientTurnId: string;
    outcome: Awaited<ReturnType<InternalRuntimeAsyncContinuationClientService["execute"]>>;
    request: RuntimeTurnRequest;
    receiptRequestId: string;
    callbacks: StreamWebAsyncContinuationCallbacks;
    publish: (event: string, payload: unknown) => void;
  }): Promise<void> {
    const {
      claim,
      context,
      threadKey,
      continuationClientTurnId,
      outcome,
      request,
      callbacks,
      publish
    } = input;
    if (outcome.outcome === "busy") {
      await this.webChatTurnAttemptService.abandonPreAcceptanceAttempt({
        assistantId: context.handle.assistantId,
        userId: context.handle.userId,
        surfaceThreadKey: threadKey,
        clientTurnId: continuationClientTurnId
      });
      await callbacks.releasePreDispatchBusy({
        ...claim,
        retryAt: callbacks.retryAt(context.handle.retryCount)
      });
      return;
    }
    if (outcome.outcome === "duplicate") {
      const status = await this.runtimeClient.inspect({
        ...request,
        sessionId: context.sessionId
      });
      if (
        status.proof === "proven" &&
        status.receiptStatus === "absent" &&
        !status.exactInFlight &&
        !status.logicalEverAccepted
      ) {
        await this.webChatTurnAttemptService.abandonPreAcceptanceAttempt({
          assistantId: context.handle.assistantId,
          userId: context.handle.userId,
          surfaceThreadKey: threadKey,
          clientTurnId: continuationClientTurnId
        });
        await callbacks.releasePreDispatchBusy({
          ...claim,
          retryAt: callbacks.retryAt(context.handle.retryCount)
        });
        return;
      }
      await this.failOrSettleDelivered({
        claim,
        context,
        threadKey,
        continuationClientTurnId,
        attemptIdentity: {
          assistantId: context.handle.assistantId,
          userId: context.handle.userId,
          surfaceThreadKey: threadKey,
          clientTurnId: continuationClientTurnId
        },
        callbacks,
        publish,
        code: "continuation_dispatch_ambiguous",
        message: "The continuation may have started but its result could not be recovered safely."
      });
      return;
    }
    if (outcome.outcome === "failed") {
      await this.failOrSettleDelivered({
        claim,
        context,
        threadKey,
        continuationClientTurnId,
        attemptIdentity: {
          assistantId: context.handle.assistantId,
          userId: context.handle.userId,
          surfaceThreadKey: threadKey,
          clientTurnId: continuationClientTurnId
        },
        callbacks,
        publish,
        code: outcome.code,
        message: "Runtime continuation failed."
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

  /**
   * Prefer completing on an already-delivered artifact bubble over leaving a
   * sticky failed web turn + empty composer banner after catch-up LLM death.
   */
  private async failOrSettleDelivered(input: {
    claim: { id: string; claimToken: string };
    context: WebContinuationContext;
    threadKey: string;
    continuationClientTurnId: string;
    attemptIdentity: {
      assistantId: string;
      userId: string;
      surfaceThreadKey: string;
      clientTurnId: string;
    };
    callbacks: StreamWebAsyncContinuationCallbacks;
    publish: (event: string, payload: unknown) => void;
    code: string;
    message: string;
  }): Promise<void> {
    const settled = await input.callbacks.settleDeliveredCatchUpFailure(input.claim);
    if (settled !== null) {
      const respondedAt = new Date().toISOString();
      const terminalPayload: CompletedWebTurnReplayState = {
        clientTurnId: input.continuationClientTurnId,
        chatId: input.context.handle.chatId,
        userMessageId: input.context.sourceUserMessage.id,
        assistantMessageId: settled.assistantMessageId,
        respondedAt,
        degradedByQuotaFallback: false,
        quotaFallbackReason: null,
        quotaFallbackModel: null,
        completedAt: new Date().toISOString()
      };
      await this.webChatTurnAttemptService.markCompleted({
        ...input.attemptIdentity,
        assistantMessageId: settled.assistantMessageId,
        respondedAt,
        terminalPayload,
        healFailedAsyncContinuation: true
      });
      input.publish("completed", { transport: null });
      await input.callbacks.finalizeContinuationChildren(
        input.context,
        "persisted",
        settled.assistantMessageId
      );
      this.logger.log(
        `web_async_continuation_settled_delivered id=${input.claim.id} assistantMessageId=${settled.assistantMessageId} priorError=${input.code}`
      );
      return;
    }
    await input.callbacks.finalizeContinuationChildren(input.context, "failed");
    await this.webChatTurnAttemptService.markFailed({
      ...input.attemptIdentity,
      code: input.code,
      message: input.message
    });
    input.publish("failed", {
      code: input.code,
      message: input.message,
      transport: null
    });
    await input.callbacks.failClaimVisibly(input.claim, {
      errorCode: input.code,
      errorMessage: input.message
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
