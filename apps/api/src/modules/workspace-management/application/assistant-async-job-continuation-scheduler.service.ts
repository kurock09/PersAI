import { randomUUID } from "node:crypto";
import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  Optional
} from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { loadApiConfig } from "@persai/config";
import type { RuntimeTurnRequest, RuntimeTurnResult } from "@persai/runtime-contract";
import {
  ASSISTANT_MATERIALIZED_SPEC_REPOSITORY,
  type AssistantMaterializedSpecRepository
} from "../domain/assistant-materialized-spec.repository";
import { ASSISTANT_REPOSITORY, type AssistantRepository } from "../domain/assistant.repository";
import { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";
import {
  ASYNC_CONTINUATION_PERMANENT_FAILURE_TEXT,
  AssistantAsyncJobHandleStateService,
  MAX_ASYNC_CONTINUATION_DEPTH,
  type PermanentFailureObservation
} from "./assistant-async-job-handle-state.service";
import { runtimeOutputArtifactsToMediaArtifacts } from "./assistant-runtime.facade";
import { BackgroundSchedulerMetricsService } from "./background-scheduler-metrics.service";
import { EnforceAssistantCapabilityAndQuotaService } from "./enforce-assistant-capability-and-quota.service";
import {
  AsyncContinuationDispatchAmbiguousError,
  InternalRuntimeAsyncContinuationClientService
} from "./internal-runtime-async-continuation.client.service";
import { MediaDeliveryService } from "./media/media-delivery.service";
import { resolveMaterializedNativeRuntimeBundle } from "./native-runtime-bundle-hash";
import { resolveNativeRuntimeTurnTimeoutMs } from "./native-runtime-turn-timeout";
import { ResolveAssistantRuntimeTierService } from "./resolve-assistant-runtime-tier.service";
import { ChatWakeCoordinator, type CatchUpClaim } from "./chat-wake-coordinator.service";
import { LEASE_HEARTBEAT_INTERVAL_MS } from "./scheduler-lease.constants";
import { SchedulerLeaseService } from "./scheduler-lease.service";
import { SandboxControlPlaneClientService } from "./sandbox-control-plane.client.service";
import { StreamWebAsyncContinuationService } from "./stream-web-async-continuation.service";
import { TelegramAssistantChatOutboundService } from "./telegram-assistant-chat-outbound.service";

const SCHEDULER_KEY = "assistant_async_job_continuation";
const POLL_INTERVAL_MS = 3_000;
const PRE_DISPATCH_CLAIM_TTL_MS = 2 * 60_000;
const DISPATCH_DEADLINE_GRACE_MS = 60_000;
const BATCH_SIZE = 8;

@Injectable()
export class AssistantAsyncJobContinuationSchedulerService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(AssistantAsyncJobContinuationSchedulerService.name);
  private stopped = false;
  private running = false;
  private timer: NodeJS.Timeout | null = null;
  private leaseLost = false;

  constructor(
    private readonly prisma: WorkspaceManagementPrismaService,
    private readonly handleState: AssistantAsyncJobHandleStateService,
    private readonly chatWakeCoordinator: ChatWakeCoordinator,
    private readonly runtimeClient: InternalRuntimeAsyncContinuationClientService,
    private readonly runtimeTier: ResolveAssistantRuntimeTierService,
    private readonly capabilityAndQuota: EnforceAssistantCapabilityAndQuotaService,
    private readonly telegramOutbound: TelegramAssistantChatOutboundService,
    private readonly mediaDelivery: MediaDeliveryService,
    private readonly schedulerLease: SchedulerLeaseService,
    private readonly metrics: BackgroundSchedulerMetricsService,
    @Inject(ASSISTANT_REPOSITORY)
    private readonly assistants: AssistantRepository,
    @Inject(ASSISTANT_MATERIALIZED_SPEC_REPOSITORY)
    private readonly materializedSpecs: AssistantMaterializedSpecRepository,
    @Optional()
    private readonly sandboxControlPlane?: SandboxControlPlaneClientService,
    @Optional()
    private readonly streamWebAsyncContinuation?: StreamWebAsyncContinuationService
  ) {}

  onModuleInit(): void {
    this.scheduleNext(POLL_INTERVAL_MS);
  }

  onModuleDestroy(): void {
    this.stopped = true;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  async processDueBatch(limit = BATCH_SIZE): Promise<number> {
    await this.reconcileSubscribedSandboxHandles(limit);
    await this.reconcileSubscribedDeliveryVisibleHandles(limit);
    await this.reconcileUnfinalizedSourceTurns(limit);
    await this.reconcileExpiredClaims(limit);
    // ADR-159 — ChatWakeCoordinator: per-chat lock + FIFO head claim.
    const claims = await this.chatWakeCoordinator.claimReadyCatchUps({
      limit,
      claimTtlMs: PRE_DISPATCH_CLAIM_TTL_MS
    });
    for (const claim of claims) {
      let heartbeat: NodeJS.Timeout | null = null;
      try {
        heartbeat = setInterval(() => {
          void this.chatWakeCoordinator
            .heartbeatCatchUp(claim.chatId, claim.lockToken)
            .catch(() => undefined);
        }, this.chatWakeCoordinator.catchUpHeartbeatIntervalMs());
        heartbeat.unref?.();
        await this.processClaim(claim);
      } finally {
        if (heartbeat !== null) clearInterval(heartbeat);
        await this.chatWakeCoordinator.releaseCatchUp(claim.chatId, claim.lockToken);
      }
    }
    return claims.length;
  }

  private async reconcileSubscribedSandboxHandles(limit: number): Promise<void> {
    if (this.sandboxControlPlane === undefined) return;
    if (
      typeof (this.prisma.assistantAsyncJobHandle as { findMany?: unknown }).findMany !== "function"
    ) {
      return;
    }
    const rows = await this.prisma.assistantAsyncJobHandle.findMany({
      // Include state=none so completed unobserved sandbox jobs finalize and
      // cannot linger as open-handle snapshot candidates. Also heal historical
      // legacy terminal rows into continuation-ready wake.
      where: {
        kind: "sandbox",
        OR: [
          { state: { in: ["none", "subscribed"] } },
          {
            narrationOwner: "legacy",
            state: { in: ["completed", "failed", "cancelled"] },
            sourceFinalizedAt: { not: null }
          }
        ]
      },
      orderBy: { updatedAt: "asc" },
      take: limit,
      select: { canonicalJobId: true }
    });
    for (const row of rows) {
      const inspected = await this.sandboxControlPlane.inspectJob(row.canonicalJobId);
      if (!inspected) {
        this.logger.warn(
          `async_sandbox_reconcile_inspect_failed canonicalJobId=${row.canonicalJobId}`
        );
      }
      const job = await this.prisma.sandboxJob.findUnique({
        where: { id: row.canonicalJobId },
        select: { status: true, resultPayload: true }
      });
      if (job === null || !["completed", "failed", "blocked", "cancelled"].includes(job.status)) {
        // Rotate fairness: touch updatedAt so a stuck detached row cannot
        // monopolize the oldest-first reconcile window forever.
        if (
          typeof (this.prisma.assistantAsyncJobHandle as { updateMany?: unknown }).updateMany ===
          "function"
        ) {
          await this.prisma.assistantAsyncJobHandle.updateMany({
            where: {
              kind: "sandbox",
              canonicalJobId: row.canonicalJobId,
              state: { in: ["none", "subscribed"] }
            },
            data: { updatedAt: new Date() }
          });
        }
        continue;
      }
      const terminalStatus =
        job.status === "completed"
          ? ("completed" as const)
          : job.status === "cancelled"
            ? ("cancelled" as const)
            : ("failed" as const);
      await this.handleState.recordCanonicalCompletion({
        kind: "sandbox",
        canonicalJobId: row.canonicalJobId,
        terminalStatus,
        terminalSnapshot: {
          status: terminalStatus,
          result: job.resultPayload ?? null
        }
      });
    }
  }

  /**
   * Promote media/document subscribed|none handles when canonical truth is
   * already delivery-visible (or terminal failed/canceled), matching observe.
   * Sandbox reconcile is separate (needs control-plane inspect).
   */
  private async reconcileSubscribedDeliveryVisibleHandles(limit: number): Promise<void> {
    if (
      typeof (this.prisma.assistantAsyncJobHandle as { findMany?: unknown }).findMany !== "function"
    ) {
      return;
    }
    const rows = await this.prisma.assistantAsyncJobHandle.findMany({
      where: {
        kind: { in: ["media", "document"] },
        OR: [
          { state: { in: ["none", "subscribed"] } },
          {
            narrationOwner: "legacy",
            state: { in: ["completed", "failed", "cancelled"] },
            sourceFinalizedAt: { not: null }
          }
        ]
      },
      orderBy: { updatedAt: "asc" },
      take: limit,
      select: { kind: true, canonicalJobId: true, runtimeSessionId: true }
    });
    for (const row of rows) {
      if (row.kind !== "media" && row.kind !== "document") continue;
      const terminal = await this.handleState.readCanonicalTerminal({
        kind: row.kind,
        canonicalJobId: row.canonicalJobId,
        runtimeSessionId: row.runtimeSessionId
      });
      if (terminal === null || terminal.status === "pending") continue;
      await this.handleState.recordCanonicalCompletion({
        kind: row.kind,
        canonicalJobId: row.canonicalJobId,
        terminalStatus: terminal.status,
        terminalSnapshot: {
          status: terminal.status,
          errorCode: terminal.errorCode,
          message: terminal.message
        }
      });
    }
  }

  private async processClaim(
    claim: Pick<CatchUpClaim, "id" | "claimToken"> | { id: string; claimToken: string }
  ): Promise<void> {
    try {
      const context = await this.loadAndValidateContext(claim.id);
      if (context === null) {
        await this.failClaimVisibly(claim, {
          errorCode: "continuation_context_invalid",
          errorMessage:
            "Continuation ownership, binding, entitlement, or canonical truth failed validation."
        });
        return;
      }
      const dispatch = await this.buildRequest(context);
      const markDispatched = async (receiptRequestId: string): Promise<boolean> =>
        this.handleState.markDispatched({
          ...claim,
          receiptRequestId,
          dispatchExpiresAt: new Date(Date.now() + dispatch.timeoutMs + DISPATCH_DEADLINE_GRACE_MS)
        });
      // Web prefers the resumable ADR-149 stream path; Telegram (and unit
      // tests without the stream helper) keep blocking execute.
      // ADR-159: never markDispatched until runtime lease + (web) attempt running.
      if (context.handle.channel === "web" && this.streamWebAsyncContinuation !== undefined) {
        await this.streamWebAsyncContinuation.processWebClaim({
          claim,
          context: {
            handle: {
              id: context.handle.id,
              assistantId: context.handle.assistantId,
              workspaceId: context.handle.workspaceId,
              userId: context.handle.userId,
              chatId: context.handle.chatId,
              channel: context.handle.channel,
              threadKey: context.handle.threadKey,
              continuationClientTurnId: context.handle.continuationClientTurnId,
              sourceUserMessageId: context.handle.sourceUserMessageId,
              retryCount: context.handle.retryCount
            },
            sourceUserMessage: context.sourceUserMessage
          },
          request: dispatch.request,
          timeoutMs: dispatch.timeoutMs,
          callbacks: {
            persistOutputOnce: (c, ctx, result) => this.persistOutputOnce(c, ctx as never, result),
            finalizeContinuationChildren: (ctx, outcome, assistantMessageId) =>
              this.finalizeContinuationChildren(ctx as never, outcome, assistantMessageId),
            deliverContinuationArtifactsOnce: (c, ctx, assistantMessageId, result) =>
              this.deliverContinuationArtifactsOnce(c, ctx as never, assistantMessageId, result),
            failClaimVisibly: (c, error) => this.failClaimVisibly(c, error),
            markDispatched: (value) => markDispatched(value.receiptRequestId),
            releasePreDispatchBusy: (value) => this.handleState.releaseClaimToReady(value),
            completeClaim: (c) => this.handleState.completeClaim(c),
            deliveryAttemptsSettled: (c, channel) => this.deliveryAttemptsSettled(c, channel),
            retryAt: (retryCount) => this.retryAt(retryCount)
          }
        });
        return;
      }
      // ADR-159 S2 TOCTOU — Telegram blocking path: re-check gate before runtime.
      const preRuntimeGate = await this.chatWakeCoordinator.evaluateCatchUpGate({
        chatId: context.handle.chatId,
        assistantId: context.handle.assistantId,
        userId: context.handle.userId,
        surfaceThreadKey: context.handle.threadKey
      });
      if (!preRuntimeGate.allowed) {
        this.logger.log(
          `async_continuation_pre_runtime_gate id=${claim.id} reason=${preRuntimeGate.reason}`
        );
        await this.handleState.releaseClaimToReady({
          ...claim,
          retryAt: this.retryAt(context.handle.retryCount)
        });
        return;
      }
      let outcome;
      try {
        outcome = await this.runtimeClient.execute(dispatch.request, {
          timeoutMs: dispatch.timeoutMs
        });
      } catch (error) {
        if (error instanceof AsyncContinuationDispatchAmbiguousError) {
          // ADR-159 P2 residual (Telegram blocking path): acceptance may have
          // landed before the transport error — stamp dispatched so ordinary
          // claim TTL / orphan reconcile can finish. Web uses
          // leaveDispatchedAmbiguous after accept.
          await markDispatched(dispatch.request.requestId);
          this.logger.warn(
            `Async continuation dispatch is ambiguous; stamped dispatched id=${claim.id}: ${error.message}`
          );
          return;
        }
        throw error;
      }
      if (outcome.outcome === "busy" || outcome.outcome === "duplicate") {
        // ADR-159 — busy / runtime duplicate (acceptTurn in_flight elsewhere):
        // no markDispatched; releaseClaimToReady (not completeClaim).
        await this.handleState.releaseClaimToReady({
          ...claim,
          retryAt: this.retryAt(context.handle.retryCount)
        });
        return;
      }
      const marked = await markDispatched(dispatch.request.requestId);
      if (!marked) return;
      if (outcome.outcome === "failed") {
        await this.finalizeContinuationChildren(context, "failed");
        await this.failClaimVisibly(claim, {
          errorCode: outcome.code,
          errorMessage: "Runtime continuation failed."
        });
        return;
      }
      if (outcome.outcome !== "completed") return;
      const persisted = await this.persistOutputOnce(claim, context, outcome.result);
      if (persisted.outcome === "lost") return;
      const assistantMessageId = persisted.messageId;
      await this.finalizeContinuationChildren(context, "persisted", assistantMessageId);
      await this.deliverContinuationArtifactsOnce(
        claim,
        context,
        assistantMessageId,
        outcome.result
      );
      if (context.handle.channel === "telegram") {
        await this.deliverTelegramOnce(claim, context, assistantMessageId, outcome.result);
      }
      if (!(await this.deliveryAttemptsSettled(claim, context.handle.channel))) return;
      const completed = await this.handleState.completeClaim(claim);
      if (!completed) {
        this.logger.warn(`Late continuation completion lost its claim id=${claim.id}.`);
      }
    } catch (error) {
      await this.requeue(
        claim,
        "continuation_dispatch_failed",
        error instanceof Error ? error.message : String(error)
      );
    }
  }

  private async loadAndValidateContext(id: string) {
    const handle = await this.prisma.assistantAsyncJobHandle.findUnique({
      where: { id },
      include: { assistant: true, chat: true }
    });
    if (
      handle === null ||
      !["claimed", "dispatched"].includes(handle.state) ||
      handle.threadKey === null ||
      handle.continuationClientTurnId === null ||
      handle.sourceUserMessageId === null ||
      handle.continuationDepth < 0 ||
      handle.continuationDepth >= MAX_ASYNC_CONTINUATION_DEPTH ||
      handle.chat.archivedAt !== null ||
      handle.chat.assistantId !== handle.assistantId ||
      handle.chat.workspaceId !== handle.workspaceId ||
      handle.chat.userId !== handle.userId ||
      handle.chat.surface !== handle.channel ||
      handle.chat.surfaceThreadKey !== handle.threadKey ||
      handle.assistant.workspaceId !== handle.workspaceId ||
      handle.assistant.userId !== handle.userId ||
      handle.assistant.applyAppliedVersionId === null
    ) {
      return null;
    }
    if (handle.channel === "telegram") {
      const binding = await this.prisma.assistantChannelSurfaceBinding.findUnique({
        where: {
          assistantId_providerKey_surfaceType: {
            assistantId: handle.assistantId,
            providerKey: "telegram",
            surfaceType: "telegram_bot"
          }
        }
      });
      if (binding?.bindingState !== "active") return null;
    }
    // Same delivery-visible / failure-first predicate as observe/subscribe.
    const terminal = await this.handleState.readCanonicalTerminal({
      kind: handle.kind,
      canonicalJobId: handle.canonicalJobId,
      runtimeSessionId: handle.runtimeSessionId
    });
    if (terminal === null || terminal.status === "pending") {
      return null;
    }
    const assistant = await this.assistants.findById(handle.assistantId);
    if (assistant === null) return null;
    await this.capabilityAndQuota.enforceInboundTurn({
      assistant,
      surface: handle.channel === "web" ? "web_chat" : "telegram",
      isNewThread: false,
      activeSurfaceChatsCount: 0
    });
    const session = await this.prisma.runtimeSession.findFirst({
      where: {
        assistantId: handle.assistantId,
        workspaceId: handle.workspaceId,
        channel: handle.channel,
        externalThreadKey: handle.threadKey,
        closedAt: null
      },
      orderBy: { updatedAt: "desc" }
    });
    if (session === null) return null;
    const sourceUserMessage = await this.prisma.assistantChatMessage.findFirst({
      where: {
        id: handle.sourceUserMessageId as string,
        chatId: handle.chatId,
        assistantId: handle.assistantId,
        author: "user"
      },
      select: { id: true, createdAt: true }
    });
    if (sourceUserMessage === null) return null;
    const catchUpMarkers = await this.resolveCatchUpWakeMarkers({
      handleId: handle.id,
      chatId: handle.chatId,
      assistantId: handle.assistantId,
      readyAt: handle.readyAt,
      updatedAt: handle.updatedAt,
      sourceFinalizedAt: handle.sourceFinalizedAt,
      catchUpOrdinal: handle.catchUpOrdinal,
      catchUpWaveTotal: handle.catchUpWaveTotal,
      catchUpWaveId: handle.catchUpWaveId,
      originatingUserMessageId: sourceUserMessage.id,
      sourceUserMessageCreatedAt: sourceUserMessage.createdAt
    });
    // Include sandboxResult (stdout/stderr/exitCode/paths) so notify wake has the
    // same job outcome await wait would have returned inline. Without it the model
    // only sees "Sandbox job completed." and invents / stalls.
    // ADR-159 S3 — structured wake markers (wakeKind/ordinal/interleaved/…) so the
    // model does not rely on the synthetic "[internal async completion]" strip alone.
    const facts = {
      kind: handle.kind,
      status: terminal.status,
      errorCode: terminal.errorCode,
      message: terminal.message,
      jobRef: handle.jobRef,
      ...catchUpMarkers,
      ...(terminal.sandboxResult !== null ? { sandboxResult: terminal.sandboxResult } : {})
    };
    return { handle, session, sourceUserMessage, facts };
  }

  /** Quiet message.metadata projection from continuation facts (S3). */
  private catchUpMessageMetadataFromFacts(
    facts: ({ jobRef?: string } & Record<string, unknown>) | null | undefined
  ): Record<string, unknown> {
    if (facts === null || facts === undefined) {
      return { wakeKind: "job_catchup" };
    }
    return {
      wakeKind: "job_catchup",
      ...(typeof facts.jobRef === "string" ? { jobRef: facts.jobRef } : {}),
      ...(typeof facts.queueOrdinal === "number" ? { queueOrdinal: facts.queueOrdinal } : {}),
      ...(typeof facts.queueTotal === "number" ? { queueTotal: facts.queueTotal } : {}),
      ...(typeof facts.interleaved === "boolean" ? { interleaved: facts.interleaved } : {}),
      ...(typeof facts.originatingUserMessageId === "string"
        ? { originatingUserMessageId: facts.originatingUserMessageId }
        : {}),
      ...(typeof facts.latestUserMessageId === "string"
        ? { latestUserMessageId: facts.latestUserMessageId }
        : {})
    };
  }

  /**
   * ADR-159 — catch-up markers at dispatch. Prefer durable
   * `catchUpOrdinal` / `catchUpWaveTotal` stamped at ready-promotion (stable
   * N across sequential dispatches). Historical unstamped rows fall back to
   * wave membership by catchUpWaveId or ready/claimed/dispatched/completed
   * siblings ordered by readyAt.
   */
  private async resolveCatchUpWakeMarkers(input: {
    handleId: string;
    chatId: string;
    assistantId: string;
    readyAt: Date | null;
    updatedAt: Date;
    sourceFinalizedAt: Date | null;
    catchUpOrdinal?: number | null;
    catchUpWaveTotal?: number | null;
    catchUpWaveId?: string | null;
    originatingUserMessageId: string;
    sourceUserMessageCreatedAt: Date;
  }): Promise<{
    wakeKind: "job_catchup";
    queueOrdinal: number;
    queueTotal: number;
    interleaved: boolean;
    originatingUserMessageId: string;
    latestUserMessageId?: string;
  }> {
    let queueOrdinal =
      typeof input.catchUpOrdinal === "number" && input.catchUpOrdinal >= 1
        ? input.catchUpOrdinal
        : null;
    let queueTotal =
      typeof input.catchUpWaveTotal === "number" && input.catchUpWaveTotal >= 1
        ? input.catchUpWaveTotal
        : null;

    if (
      (queueOrdinal === null || queueTotal === null) &&
      typeof (this.prisma.assistantAsyncJobHandle as { findMany?: unknown }).findMany === "function"
    ) {
      const queueRows = await this.prisma.assistantAsyncJobHandle.findMany({
        where:
          typeof input.catchUpWaveId === "string" && input.catchUpWaveId.length > 0
            ? { chatId: input.chatId, catchUpWaveId: input.catchUpWaveId }
            : {
                chatId: input.chatId,
                OR: [{ state: { in: ["ready", "claimed", "dispatched"] } }, { id: input.handleId }]
              },
        select: {
          id: true,
          readyAt: true,
          updatedAt: true,
          catchUpOrdinal: true,
          catchUpWaveTotal: true
        },
        orderBy: [{ readyAt: "asc" }, { updatedAt: "asc" }]
      });
      if (queueTotal === null) {
        const stampedTotal = queueRows.find(
          (row) => typeof row.catchUpWaveTotal === "number" && row.catchUpWaveTotal >= 1
        )?.catchUpWaveTotal;
        queueTotal = Math.max(1, stampedTotal ?? queueRows.length);
      }
      if (queueOrdinal === null) {
        const self = queueRows.find((row) => row.id === input.handleId);
        if (typeof self?.catchUpOrdinal === "number" && self.catchUpOrdinal >= 1) {
          queueOrdinal = self.catchUpOrdinal;
        } else {
          const ordinalIndex = queueRows.findIndex((row) => row.id === input.handleId);
          queueOrdinal = ordinalIndex >= 0 ? ordinalIndex + 1 : 1;
        }
      }
    }
    if (queueOrdinal === null) queueOrdinal = 1;
    if (queueTotal === null) queueTotal = 1;
    if (queueOrdinal > queueTotal) queueTotal = queueOrdinal;

    const interleaveAfter =
      input.sourceFinalizedAt instanceof Date
        ? input.sourceFinalizedAt
        : input.sourceUserMessageCreatedAt;
    let interleaved = false;
    let latestUserMessageId: string | undefined;
    if (
      typeof (this.prisma.assistantChatMessage as { findFirst?: unknown }).findFirst === "function"
    ) {
      const laterUser = await this.prisma.assistantChatMessage.findFirst({
        where: {
          chatId: input.chatId,
          assistantId: input.assistantId,
          author: "user",
          createdAt: { gt: interleaveAfter },
          NOT: { id: input.originatingUserMessageId }
        },
        select: { id: true },
        orderBy: { createdAt: "asc" }
      });
      interleaved = laterUser !== null;
      const latestUser = await this.prisma.assistantChatMessage.findFirst({
        where: {
          chatId: input.chatId,
          assistantId: input.assistantId,
          author: "user"
        },
        select: { id: true },
        orderBy: { createdAt: "desc" }
      });
      if (latestUser !== null && latestUser.id !== input.originatingUserMessageId) {
        latestUserMessageId = latestUser.id;
      }
    }

    return {
      wakeKind: "job_catchup",
      queueOrdinal,
      queueTotal,
      interleaved,
      originatingUserMessageId: input.originatingUserMessageId,
      ...(latestUserMessageId === undefined ? {} : { latestUserMessageId })
    };
  }

  private async buildRequest(
    context: NonNullable<Awaited<ReturnType<typeof this.loadAndValidateContext>>>
  ): Promise<{ request: RuntimeTurnRequest; timeoutMs: number }> {
    const publishedVersionId = context.handle.assistant.applyAppliedVersionId as string;
    const spec = await this.materializedSpecs.findByPublishedVersionId(publishedVersionId);
    if (spec === null || spec.assistantId !== context.handle.assistantId) {
      throw new Error("Current materialized Assistant bundle is unavailable.");
    }
    const { bundleHash } = resolveMaterializedNativeRuntimeBundle({
      materializedSpec: spec,
      context: "Async continuation"
    });
    const runtimeTier = await this.runtimeTier.resolveByAssistantId(context.handle.assistantId);
    const config = loadApiConfig(process.env);
    const request: RuntimeTurnRequest = {
      requestId: randomUUID(),
      idempotencyKey: context.handle.continuationClientTurnId as string,
      runtimeTier,
      bundle: {
        bundleId: spec.id,
        assistantId: context.handle.assistantId,
        workspaceId: context.handle.workspaceId,
        publishedVersionId,
        bundleHash,
        compiledAt: spec.createdAt.toISOString()
      },
      conversation: {
        assistantId: context.handle.assistantId,
        workspaceId: context.handle.workspaceId,
        channel: context.handle.channel,
        externalThreadKey: context.handle.threadKey as string,
        externalUserKey: context.session.externalUserKey,
        mode: context.session.mode
      },
      message: {
        text: "[internal async completion]",
        attachments: [],
        locale: null,
        timezone: null,
        receivedAt: new Date().toISOString()
      },
      chatMode: context.handle.chat.chatMode,
      deepMode: context.handle.chat.deepModeEnabled,
      skillStateContext: {
        decision: (context.handle.chat.skillDecisionState ?? null) as never
      },
      continuation: {
        depth: context.handle.continuationDepth + 1,
        sourceUserMessageId: context.sourceUserMessage.id,
        sourceClientTurnId: context.handle.continuationClientTurnId as string,
        facts: context.facts
      }
    };
    return {
      request,
      timeoutMs: resolveNativeRuntimeTurnTimeoutMs(
        spec.runtimeBundle,
        config.PERSAI_RUNTIME_TURN_WALL_CLOCK_MS
      )
    };
  }

  private async persistOutputOnce(
    claim: { id: string; claimToken: string },
    context: NonNullable<Awaited<ReturnType<typeof this.loadAndValidateContext>>>,
    result: RuntimeTurnResult
  ): Promise<{ outcome: "persisted" | "existing"; messageId: string } | { outcome: "lost" }> {
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{ messageId: string | null }>>`
        SELECT "continuation_assistant_message_id" AS "messageId"
        FROM "assistant_async_job_handles"
        WHERE "id" = ${claim.id}::uuid
          AND "claim_token" = ${claim.claimToken}
          AND "state" = 'dispatched'
        FOR UPDATE
      `;
      if (rows[0] === undefined) return { outcome: "lost" as const };
      const existing = rows[0]?.messageId;
      if (existing) return { outcome: "existing" as const, messageId: existing };
      const message = await tx.assistantChatMessage.create({
        data: {
          chatId: context.handle.chatId,
          assistantId: context.handle.assistantId,
          author: "assistant",
          content: result.answerText ?? result.assistantText,
          // Quiet ADR-159 S3 catch-up markers for web clients (no UX redesign).
          metadata: {
            asyncContinuationClientTurnId: context.handle.continuationClientTurnId,
            ...this.catchUpMessageMetadataFromFacts(context.facts)
          } as Prisma.InputJsonValue,
          ...(result.toolExchanges && result.toolExchanges.length > 0
            ? {
                toolExchanges: result.toolExchanges as unknown as Prisma.InputJsonValue
              }
            : {})
        }
      });
      const updated = await tx.assistantAsyncJobHandle.updateMany({
        where: { id: claim.id, claimToken: claim.claimToken, state: "dispatched" },
        data: { continuationAssistantMessageId: message.id }
      });
      if (updated.count !== 1) {
        throw new Error("Continuation claim was lost while persisting output.");
      }
      return { outcome: "persisted" as const, messageId: message.id };
    });
  }

  private async finalizeContinuationChildren(
    context: NonNullable<Awaited<ReturnType<typeof this.loadAndValidateContext>>>,
    outcome: "persisted" | "failed" | "stopped",
    assistantMessageId?: string
  ): Promise<void> {
    await this.handleState.finalizeSourceTurn({
      assistantId: context.handle.assistantId,
      chatId: context.handle.chatId,
      sourceClientTurnId: context.handle.continuationClientTurnId as string,
      outcome,
      ...(assistantMessageId === undefined ? {} : { assistantMessageId })
    });
  }

  private async deliverContinuationArtifactsOnce(
    claim: { id: string; claimToken: string },
    context: NonNullable<Awaited<ReturnType<typeof this.loadAndValidateContext>>>,
    assistantMessageId: string,
    result: RuntimeTurnResult
  ): Promise<void> {
    const attempt = await this.handleState.claimDeliveryAttempt({
      ...claim,
      kind: "artifacts"
    });
    if (attempt !== "claimed") return;
    const artifacts = runtimeOutputArtifactsToMediaArtifacts(result.artifacts);
    if (artifacts.length === 0) {
      await this.handleState.recordDeliveryAttemptResult({
        ...claim,
        kind: "artifacts",
        result: "not_needed"
      });
      return;
    }
    try {
      await this.mediaDelivery.deliver({
        artifacts,
        channel: context.handle.channel,
        assistantId: context.handle.assistantId,
        workspaceId: context.handle.workspaceId,
        chatId: context.handle.chatId,
        messageId: assistantMessageId,
        runtimeSessionId: result.sessionId
      });
      await this.handleState.recordDeliveryAttemptResult({
        ...claim,
        kind: "artifacts",
        result: "delivered"
      });
    } catch (error) {
      await this.handleState.recordDeliveryAttemptResult({
        ...claim,
        kind: "artifacts",
        result: "ambiguous",
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  private async deliverTelegramOnce(
    claim: { id: string; claimToken: string },
    context: NonNullable<Awaited<ReturnType<typeof this.loadAndValidateContext>>>,
    assistantMessageId: string,
    result: RuntimeTurnResult
  ): Promise<void> {
    const attempt = await this.handleState.claimDeliveryAttempt({
      ...claim,
      kind: "external"
    });
    if (attempt !== "claimed") return;
    try {
      const delivery = await this.telegramOutbound.deliverPersistedAssistantMessageBestEffort({
        assistantId: context.handle.assistantId,
        workspaceId: context.handle.workspaceId,
        chatId: context.handle.chatId,
        assistantMessageId,
        text: result.answerText ?? result.assistantText,
        mediaAlreadyDelivered: true
      });
      await this.handleState.recordDeliveryAttemptResult({
        ...claim,
        kind: "external",
        result: delivery.status === "delivered" ? "delivered" : "failed",
        ...(delivery.status === "delivered" ? {} : { error: delivery.reason })
      });
    } catch (error) {
      await this.handleState.recordDeliveryAttemptResult({
        ...claim,
        kind: "external",
        result: "ambiguous",
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  private async deliveryAttemptsSettled(
    claim: { id: string; claimToken: string },
    channel: "web" | "telegram"
  ): Promise<boolean> {
    const row = await this.prisma.assistantAsyncJobHandle.findFirst({
      where: {
        id: claim.id,
        state: "dispatched",
        claimToken: claim.claimToken
      },
      select: {
        continuationArtifactsResult: true,
        continuationExternalResult: true
      }
    });
    if (
      row === null ||
      row.continuationArtifactsResult === null ||
      row.continuationArtifactsResult === "attempting"
    ) {
      return false;
    }
    return (
      channel !== "telegram" ||
      (row.continuationExternalResult !== null && row.continuationExternalResult !== "attempting")
    );
  }

  private async reconcileExpiredClaims(limit: number): Promise<void> {
    const rows = await this.prisma.assistantAsyncJobHandle.findMany({
      where: {
        state: { in: ["claimed", "dispatched"] },
        claimExpiresAt: { lte: new Date() },
        claimToken: { not: null }
      },
      orderBy: { claimExpiresAt: "asc" },
      take: limit
    });
    for (const row of rows) {
      if (!row.claimToken) continue;
      if (row.state === "claimed") {
        await this.requeue(
          { id: row.id, claimToken: row.claimToken },
          "continuation_claim_expired",
          "Continuation claim expired before dispatch."
        );
        continue;
      }
      if (
        (row.continuationArtifactsResult === "attempting" ||
          row.continuationExternalResult === "attempting") &&
        (await this.settleExpiredDeliveryAttempts(row.id, row.claimToken))
      ) {
        continue;
      }
      if (
        row.continuationAssistantMessageId !== null &&
        row.continuationArtifactsResult !== null &&
        row.continuationArtifactsResult !== "attempting" &&
        (row.channel !== "telegram" ||
          (row.continuationExternalResult !== null &&
            row.continuationExternalResult !== "attempting"))
      ) {
        await this.handleState.completeClaim({ id: row.id, claimToken: row.claimToken });
        continue;
      }
      const receipt =
        row.dispatchReceiptRequestId === null
          ? null
          : await this.prisma.runtimeTurnReceipt.findUnique({
              where: { requestId: row.dispatchReceiptRequestId }
            });
      if (receipt?.status === "completed" && this.isRuntimeTurnResult(receipt.resultPayload)) {
        const context = await this.loadAndValidateContext(row.id);
        if (context === null) {
          await this.failClaimVisibly(
            { id: row.id, claimToken: row.claimToken },
            {
              errorCode: "continuation_context_invalid",
              errorMessage:
                "Continuation ownership, binding, entitlement, or canonical truth failed validation."
            }
          );
          continue;
        }
        const persisted = await this.persistOutputOnce(
          { id: row.id, claimToken: row.claimToken },
          context,
          receipt.resultPayload
        );
        if (persisted.outcome === "lost") continue;
        const messageId = persisted.messageId;
        await this.finalizeContinuationChildren(context, "persisted", messageId);
        await this.deliverContinuationArtifactsOnce(
          { id: row.id, claimToken: row.claimToken },
          context,
          messageId,
          receipt.resultPayload
        );
        if (row.channel === "telegram") {
          await this.deliverTelegramOnce(
            { id: row.id, claimToken: row.claimToken },
            context,
            messageId,
            receipt.resultPayload
          );
        }
        if (
          !(await this.deliveryAttemptsSettled(
            { id: row.id, claimToken: row.claimToken },
            row.channel
          ))
        ) {
          continue;
        }
        const completed = await this.handleState.completeClaim({
          id: row.id,
          claimToken: row.claimToken
        });
        if (!completed) {
          this.logger.warn(`Reconciled continuation lost its claim id=${row.id}.`);
        }
        continue;
      }
      if (receipt?.status === "failed" || receipt?.status === "interrupted") {
        const context = await this.loadAndValidateContext(row.id);
        if (context !== null) {
          await this.finalizeContinuationChildren(
            context,
            receipt.status === "interrupted" ? "stopped" : "failed"
          );
        }
        await this.failClaimVisibly(
          { id: row.id, claimToken: row.claimToken },
          {
            errorCode: `continuation_receipt_${receipt.status}`,
            errorMessage: `Runtime continuation receipt is ${receipt.status}.`
          }
        );
        continue;
      }
      if (receipt !== null) continue;
      if (row.dispatchReceiptRequestId === null) continue;
      const context = await this.loadAndValidateContext(row.id);
      if (context === null) {
        await this.failClaimVisibly(
          { id: row.id, claimToken: row.claimToken },
          {
            errorCode: "continuation_context_invalid",
            errorMessage:
              "Continuation ownership, binding, entitlement, or canonical truth failed validation."
          }
        );
        continue;
      }
      const rebuilt = await this.buildRequest(context);
      const runtimeStatus = await this.runtimeClient.inspect({
        ...rebuilt.request,
        requestId: row.dispatchReceiptRequestId,
        sessionId: context.session.id
      });
      if (
        runtimeStatus.proof !== "proven" ||
        runtimeStatus.receiptStatus !== "absent" ||
        runtimeStatus.exactInFlight
      ) {
        continue;
      }
      const requeued = await this.handleState.requeueClaim({
        id: row.id,
        claimToken: row.claimToken,
        retryAt: this.retryAt(row.retryCount),
        errorCode: "continuation_dispatch_orphaned",
        errorMessage: "No runtime receipt, live accepted turn, or persisted output exists.",
        dispatchedProof: { receiptAbsent: true, leaseAbsent: true, outputAbsent: true }
      });
      if (requeued === "exhausted") {
        await this.deliverPermanentFailureTelegramOnce(
          await this.handleState.getPermanentFailureObservation(row.id)
        );
      }
    }
  }

  private async reconcileUnfinalizedSourceTurns(limit: number): Promise<void> {
    const rows = await this.prisma.assistantAsyncJobHandle.findMany({
      where: {
        sourceFinalizedAt: null,
        sourceClientTurnId: { not: null },
        updatedAt: { lte: new Date(Date.now() - 2 * 60_000) }
      },
      orderBy: { updatedAt: "asc" },
      take: limit,
      select: {
        assistantId: true,
        chatId: true,
        sourceClientTurnId: true,
        sourceUserMessageId: true,
        createdAt: true
      }
    });
    for (const row of rows) {
      if (!row.sourceClientTurnId || !row.sourceUserMessageId) continue;
      const continuationSource = row.sourceClientTurnId.startsWith("async-cont:");
      const metadataKey = continuationSource
        ? "asyncContinuationClientTurnId"
        : "sourceUserMessageId";
      const metadataValue = continuationSource ? row.sourceClientTurnId : row.sourceUserMessageId;
      const messages = await this.prisma.$queryRaw<Array<{ id: string }>>`
        SELECT "id"
        FROM "assistant_chat_messages"
        WHERE "chat_id" = ${row.chatId}::uuid
          AND "assistant_id" = ${row.assistantId}::uuid
          AND "author" = 'assistant'
          AND "metadata"->>${metadataKey} = ${metadataValue}
        ORDER BY "created_at" ASC
        LIMIT 1
      `;
      const message = messages[0];
      if (message !== undefined) {
        await this.handleState.finalizeSourceTurn({
          assistantId: row.assistantId,
          chatId: row.chatId,
          sourceClientTurnId: row.sourceClientTurnId,
          outcome: "persisted",
          assistantMessageId: message.id
        });
        continue;
      }
      const receipt = await this.prisma.runtimeTurnReceipt.findFirst({
        where: {
          assistantId: row.assistantId,
          idempotencyKey: row.sourceClientTurnId
        },
        orderBy: { createdAt: "desc" }
      });
      if (
        receipt?.status === "failed" ||
        receipt?.status === "interrupted" ||
        (receipt === null && row.createdAt.getTime() < Date.now() - 15 * 60_000)
      ) {
        await this.handleState.finalizeSourceTurn({
          assistantId: row.assistantId,
          chatId: row.chatId,
          sourceClientTurnId: row.sourceClientTurnId,
          outcome: receipt?.status === "interrupted" ? "stopped" : "failed"
        });
      }
    }
  }

  private async settleExpiredDeliveryAttempts(id: string, claimToken: string): Promise<boolean> {
    const [artifacts, external] = await this.prisma.$transaction([
      this.prisma.assistantAsyncJobHandle.updateMany({
        where: {
          id,
          state: "dispatched",
          claimToken,
          continuationArtifactsResult: "attempting"
        },
        data: {
          continuationArtifactsResult: "ambiguous",
          continuationArtifactsError:
            "The artifact delivery attempt outlived the dispatch deadline and will not be retried."
        }
      }),
      this.prisma.assistantAsyncJobHandle.updateMany({
        where: {
          id,
          state: "dispatched",
          claimToken,
          continuationExternalResult: "attempting"
        },
        data: {
          continuationExternalResult: "ambiguous",
          continuationExternalError:
            "The external delivery attempt outlived the dispatch deadline and will not be retried."
        }
      })
    ]);
    return artifacts.count > 0 || external.count > 0;
  }

  private async failClaimVisibly(
    claim: { id: string; claimToken: string },
    error: { errorCode: string; errorMessage: string }
  ): Promise<void> {
    const result = await this.handleState.failClaim({
      ...claim,
      errorCode: error.errorCode,
      errorMessage: error.errorMessage
    });
    const observation =
      result.observation ?? (await this.handleState.getPermanentFailureObservation(claim.id));
    await this.deliverPermanentFailureTelegramOnce(observation);
  }

  private async deliverPermanentFailureTelegramOnce(
    observation: PermanentFailureObservation | null
  ): Promise<void> {
    if (observation === null || observation.channel !== "telegram") return;
    const claimed = await this.handleState.claimFailedHandleExternalNotice(observation.handleId);
    if (!claimed) return;
    try {
      const delivery = await this.telegramOutbound.deliverPersistedAssistantMessageBestEffort({
        assistantId: observation.assistantId,
        workspaceId: observation.workspaceId,
        chatId: observation.chatId,
        assistantMessageId: observation.assistantMessageId,
        text: ASYNC_CONTINUATION_PERMANENT_FAILURE_TEXT,
        mediaAlreadyDelivered: true
      });
      await this.handleState.recordFailedHandleExternalNoticeResult({
        id: observation.handleId,
        result: delivery.status === "delivered" ? "delivered" : "failed",
        ...(delivery.status === "delivered" ? {} : { error: delivery.reason })
      });
    } catch (error) {
      await this.handleState.recordFailedHandleExternalNoticeResult({
        id: observation.handleId,
        result: "ambiguous",
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  private async requeue(
    claim: { id: string; claimToken: string },
    code: string,
    message: string
  ): Promise<void> {
    const row = await this.prisma.assistantAsyncJobHandle.findUnique({
      where: { id: claim.id },
      select: { retryCount: true, state: true }
    });
    const outcome = await this.handleState.requeueClaim({
      ...claim,
      retryAt: this.retryAt(row?.retryCount ?? 0),
      errorCode: code,
      errorMessage: message,
      ...(row?.state === "dispatched"
        ? {
            dispatchedProof: {
              receiptAbsent: false,
              leaseAbsent: false,
              outputAbsent: false
            }
          }
        : {})
    });
    if (outcome === "exhausted") {
      await this.deliverPermanentFailureTelegramOnce(
        await this.handleState.getPermanentFailureObservation(claim.id)
      );
    }
  }

  private retryAt(retryCount: number): Date {
    return new Date(Date.now() + Math.min(5 * 60_000, 2_000 * 2 ** Math.min(retryCount, 7)));
  }

  private isRuntimeTurnResult(value: unknown): value is RuntimeTurnResult {
    return (
      typeof value === "object" &&
      value !== null &&
      "assistantText" in value &&
      typeof value.assistantText === "string" &&
      "requestId" in value &&
      typeof value.requestId === "string"
    );
  }

  private scheduleNext(delay: number): void {
    if (this.stopped) return;
    this.timer = setTimeout(() => void this.tick(), delay);
    this.timer.unref?.();
  }

  private async tick(): Promise<void> {
    if (this.stopped || this.running) return this.scheduleNext(POLL_INTERVAL_MS);
    this.running = true;
    this.leaseLost = false;
    const startedAt = Date.now();
    let leaseToken: string | null = null;
    let heartbeat: NodeJS.Timeout | null = null;
    let processed = 0;
    try {
      const lease = await this.schedulerLease.acquire(SCHEDULER_KEY);
      if (lease === null) {
        this.metrics.recordTickSkipped(SCHEDULER_KEY);
        return;
      }
      leaseToken = lease.token;
      heartbeat = setInterval(() => {
        void this.schedulerLease
          .heartbeat(SCHEDULER_KEY, lease.token)
          .then((held) => (this.leaseLost = !held))
          .catch(() => (this.leaseLost = true));
      }, LEASE_HEARTBEAT_INTERVAL_MS);
      heartbeat.unref?.();
      while (!this.stopped && !this.leaseLost) {
        const count = await this.processDueBatch(BATCH_SIZE);
        processed += count;
        if (count < BATCH_SIZE) break;
      }
      this.metrics.recordTickAcquired(SCHEDULER_KEY, Date.now() - startedAt, processed);
    } catch (error) {
      this.logger.error(
        `Async continuation scheduler failed: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error.stack : undefined
      );
    } finally {
      if (heartbeat !== null) clearInterval(heartbeat);
      if (leaseToken !== null) await this.schedulerLease.release(SCHEDULER_KEY, leaseToken);
      this.running = false;
      this.leaseLost = false;
      this.scheduleNext(POLL_INTERVAL_MS);
    }
  }
}
