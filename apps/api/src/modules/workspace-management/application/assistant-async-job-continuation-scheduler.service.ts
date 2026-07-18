import { randomUUID } from "node:crypto";
import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
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
  AssistantAsyncJobHandleStateService,
  MAX_ASYNC_CONTINUATION_DEPTH
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
import { LEASE_HEARTBEAT_INTERVAL_MS } from "./scheduler-lease.constants";
import { SchedulerLeaseService } from "./scheduler-lease.service";
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
    private readonly materializedSpecs: AssistantMaterializedSpecRepository
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
    await this.reconcileUnfinalizedSourceTurns(limit);
    await this.reconcileExpiredClaims(limit);
    const claims = await this.handleState.claimReady({
      limit,
      claimTtlMs: PRE_DISPATCH_CLAIM_TTL_MS
    });
    for (const claim of claims) {
      await this.processClaim(claim);
    }
    return claims.length;
  }

  private async processClaim(claim: { id: string; claimToken: string }): Promise<void> {
    try {
      const context = await this.loadAndValidateContext(claim.id);
      if (context === null) {
        await this.handleState.failClaim({
          ...claim,
          errorCode: "continuation_context_invalid",
          errorMessage:
            "Continuation ownership, binding, entitlement, or canonical truth failed validation."
        });
        return;
      }
      const dispatch = await this.buildRequest(context);
      const marked = await this.handleState.markDispatched({
        ...claim,
        receiptRequestId: dispatch.request.requestId,
        dispatchExpiresAt: new Date(Date.now() + dispatch.timeoutMs + DISPATCH_DEADLINE_GRACE_MS)
      });
      if (!marked) return;
      let outcome;
      try {
        outcome = await this.runtimeClient.execute(dispatch.request, {
          timeoutMs: dispatch.timeoutMs
        });
      } catch (error) {
        if (error instanceof AsyncContinuationDispatchAmbiguousError) {
          this.logger.warn(
            `Async continuation dispatch is ambiguous; leaving dispatched id=${claim.id}: ${error.message}`
          );
          return;
        }
        throw error;
      }
      if (outcome.outcome === "duplicate") {
        return;
      }
      if (outcome.outcome === "busy") {
        await this.handleState.requeueBusyNotStarted({
          ...claim,
          receiptRequestId: dispatch.request.requestId,
          retryAt: this.retryAt(context.handle.retryCount)
        });
        return;
      }
      if (outcome.outcome === "failed") {
        await this.finalizeContinuationChildren(context, "failed");
        await this.handleState.failClaim({
          ...claim,
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
    const binding = await this.prisma.assistantChannelSurfaceBinding.findUnique({
      where: {
        assistantId_providerKey_surfaceType: {
          assistantId: handle.assistantId,
          providerKey: handle.channel === "web" ? "web_internal" : "telegram",
          surfaceType: handle.channel === "web" ? "web_chat" : "telegram_bot"
        }
      }
    });
    if (binding?.bindingState !== "active") return null;
    const canonical =
      handle.kind === "media"
        ? await this.prisma.assistantMediaJob.findUnique({
            where: { id: handle.canonicalJobId },
            select: { status: true, lastErrorCode: true }
          })
        : await this.prisma.assistantDocumentRenderJob.findUnique({
            where: { id: handle.canonicalJobId },
            select: { status: true, lastErrorCode: true }
          });
    if (
      canonical === null ||
      !["delivered", "failed", "expired", "canceled"].includes(canonical.status)
    ) {
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
      select: { id: true }
    });
    if (sourceUserMessage === null) return null;
    const facts = {
      kind: handle.kind,
      status:
        canonical.status === "delivered"
          ? ("completed" as const)
          : canonical.status === "canceled"
            ? ("cancelled" as const)
            : ("failed" as const),
      errorCode: canonical.lastErrorCode,
      message:
        canonical.status === "delivered"
          ? "Job completed and was delivered."
          : canonical.status === "canceled"
            ? "Job was cancelled."
            : "Job failed."
    };
    return { handle, session, sourceUserMessage, facts };
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
          metadata: {
            asyncContinuationClientTurnId: context.handle.continuationClientTurnId
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
        if (context === null) continue;
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
        if (context === null) continue;
        await this.finalizeContinuationChildren(
          context,
          receipt.status === "interrupted" ? "stopped" : "failed"
        );
        await this.handleState.failClaim({
          id: row.id,
          claimToken: row.claimToken,
          errorCode: `continuation_receipt_${receipt.status}`,
          errorMessage: `Runtime continuation receipt is ${receipt.status}.`
        });
        continue;
      }
      if (receipt !== null) continue;
      if (row.dispatchReceiptRequestId === null) continue;
      const context = await this.loadAndValidateContext(row.id);
      if (context === null) continue;
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
      await this.handleState.requeueClaim({
        id: row.id,
        claimToken: row.claimToken,
        retryAt: this.retryAt(row.retryCount),
        errorCode: "continuation_dispatch_orphaned",
        errorMessage: "No runtime receipt, live accepted turn, or persisted output exists.",
        dispatchedProof: { receiptAbsent: true, leaseAbsent: true, outputAbsent: true }
      });
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

  private async requeue(
    claim: { id: string; claimToken: string },
    code: string,
    message: string
  ): Promise<void> {
    const row = await this.prisma.assistantAsyncJobHandle.findUnique({
      where: { id: claim.id },
      select: { retryCount: true, state: true }
    });
    await this.handleState.requeueClaim({
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
