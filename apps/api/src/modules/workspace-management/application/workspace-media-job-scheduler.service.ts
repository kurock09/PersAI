import { randomUUID } from "node:crypto";
import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type {
  RuntimeAttachmentRef,
  RuntimeImageEditRequest,
  RuntimeImageGenerateRequest,
  RuntimeMediaJobRunRequest,
  RuntimeVideoGenerateRequest
} from "@persai/runtime-contract";
import { ASSISTANT_REPOSITORY, type AssistantRepository } from "../domain/assistant.repository";
import {
  ASSISTANT_CHAT_REPOSITORY,
  type AssistantChatRepository
} from "../domain/assistant-chat.repository";
import type { WorkspaceMonthlyToolQuotaToolCode } from "../domain/workspace-quota-accounting.repository";
import { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";
import { EnsureAssistantMaterializedSpecCurrentService } from "./ensure-assistant-materialized-spec-current.service";
import {
  InternalRuntimeMediaJobClientService,
  type InternalRuntimeMediaJobRunOutcome
} from "./internal-runtime-media-job.client.service";
import { ResolveAssistantInboundRuntimeContextService } from "./resolve-assistant-inbound-runtime-context.service";
import { AssistantMediaJobCompletionDeliveryService } from "./workspace-media-job-completion-delivery.service";
import { AssistantMediaJobCompletionTurnService } from "./workspace-media-job-completion-turn.service";
import {
  buildAssistantMediaJobFailureMessage,
  inferAssistantMediaJobFailureLocale
} from "./workspace-media-job-failure-copy.service";
import { BackgroundSchedulerMetricsService } from "./background-scheduler-metrics.service";
import { LEASE_HEARTBEAT_INTERVAL_MS } from "./scheduler-lease.constants";
import { SchedulerLeaseService } from "./scheduler-lease.service";
import { RecordModelCostLedgerService } from "./record-model-cost-ledger.service";
import { TrackWorkspaceQuotaUsageService } from "./track-workspace-quota-usage.service";
import { TelegramAssistantChatOutboundService } from "./telegram-assistant-chat-outbound.service";

type FailJobContext = {
  sourceUserMessageText: string;
  sourceUserMessageCreatedAt: string;
};

// ADR-091 audit: scheduler cadence / batch / retry knobs stay centralized in this
// constants block until we have enough production evidence to justify env tuning.
const MEDIA_JOB_POLL_INTERVAL_MS = 5_000;
const MEDIA_JOB_BATCH_SIZE = 4;
const MEDIA_JOB_CLAIM_TTL_MS = 10 * 60 * 1000;
const MEDIA_JOB_RETRY_BASE_DELAY_MS = 30_000;
const MEDIA_JOB_RETRY_MAX_DELAY_MS = 60 * 60 * 1000;
const MEDIA_JOB_LAST_ERROR_MAX_CHARS = 1_000;
const MEDIA_JOB_SCHEDULER_KEY = "media_job";

type MediaJobKind = "image" | "audio" | "video";

type DirectToolExecutionPayload =
  | {
      toolCode: "image_generate";
      request: RuntimeImageGenerateRequest;
    }
  | {
      toolCode: "image_edit";
      request: RuntimeImageEditRequest;
    }
  | {
      toolCode: "video_generate";
      request: RuntimeVideoGenerateRequest;
    };

type MediaJobRequestPayload = {
  attachments: RuntimeAttachmentRef[];
  sourceUserMessageText: string;
  sourceUserMessageCreatedAt: string;
  directToolExecution: DirectToolExecutionPayload;
};

type AcceptedPrimaryUnconfirmedStatus = {
  providerTaskId: string;
  provider: "openai" | "runway" | "kling" | "heygen";
  model: string | null;
  acceptedAt: string;
  providerStage: "accepted";
  code: "accepted_primary_unconfirmed";
  reason: string;
  message: string;
  taskKind: string | null;
};

type ClaimedMediaJob = {
  id: string;
  assistantId: string;
  userId: string;
  workspaceId: string;
  chatId: string;
  surface: "web" | "telegram";
  kind: MediaJobKind;
  sourceUserMessageId: string;
  requestJson: unknown;
  attemptCount: number;
  maxAttempts: number;
  claimToken: string;
};

function truncateLastError(message: string): string {
  if (message.length <= MEDIA_JOB_LAST_ERROR_MAX_CHARS) {
    return message;
  }
  return `${message.slice(0, MEDIA_JOB_LAST_ERROR_MAX_CHARS - 3)}...`;
}

function computeRetryBackoffMs(attempt: number): number {
  const safeAttempt = Math.max(1, Math.floor(attempt));
  return Math.min(
    MEDIA_JOB_RETRY_MAX_DELAY_MS,
    MEDIA_JOB_RETRY_BASE_DELAY_MS * 2 ** (safeAttempt - 1)
  );
}

function isAcceptedPrimaryUnconfirmedProvider(
  provider: unknown
): provider is AcceptedPrimaryUnconfirmedStatus["provider"] {
  return (
    provider === "openai" || provider === "runway" || provider === "kling" || provider === "heygen"
  );
}

@Injectable()
export class AssistantMediaJobSchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AssistantMediaJobSchedulerService.name);
  private stopped = false;
  private running = false;
  private timer: NodeJS.Timeout | null = null;
  private leaseLost = false;

  constructor(
    private readonly prisma: WorkspaceManagementPrismaService,
    @Inject(ASSISTANT_REPOSITORY)
    private readonly assistantRepository: AssistantRepository,
    @Inject(ASSISTANT_CHAT_REPOSITORY)
    private readonly assistantChatRepository: AssistantChatRepository,
    private readonly ensureAssistantMaterializedSpecCurrentService: EnsureAssistantMaterializedSpecCurrentService,
    private readonly resolveAssistantInboundRuntimeContextService: ResolveAssistantInboundRuntimeContextService,
    private readonly internalRuntimeMediaJobClientService: InternalRuntimeMediaJobClientService,
    private readonly assistantMediaJobCompletionDeliveryService: AssistantMediaJobCompletionDeliveryService,
    private readonly assistantMediaJobCompletionTurnService: AssistantMediaJobCompletionTurnService,
    private readonly schedulerLeaseService: SchedulerLeaseService,
    private readonly backgroundSchedulerMetricsService: BackgroundSchedulerMetricsService,
    private readonly recordModelCostLedgerService: RecordModelCostLedgerService,
    private readonly trackWorkspaceQuotaUsageService: TrackWorkspaceQuotaUsageService,
    private readonly telegramAssistantChatOutboundService: TelegramAssistantChatOutboundService
  ) {}

  onModuleInit(): void {
    this.scheduleNext(MEDIA_JOB_POLL_INTERVAL_MS);
  }

  onModuleDestroy(): void {
    this.stopped = true;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  async processDueJobsBatch(limit = MEDIA_JOB_BATCH_SIZE): Promise<number> {
    const claimed = await this.claimDueJobs(limit);
    let processed = 0;
    for (const job of claimed) {
      if (this.leaseLost) {
        break;
      }
      await this.processClaimedJob(job);
      processed += 1;
    }
    return processed;
  }

  private scheduleNext(delayMs: number): void {
    if (this.stopped) {
      return;
    }
    this.timer = setTimeout(() => void this.tick(), delayMs);
    this.timer.unref?.();
  }

  private async tick(): Promise<void> {
    if (this.stopped) {
      return;
    }
    if (this.running) {
      this.scheduleNext(MEDIA_JOB_POLL_INTERVAL_MS);
      return;
    }
    this.running = true;
    this.leaseLost = false;
    const startedAt = Date.now();
    let processed = 0;
    let heartbeatTimer: NodeJS.Timeout | null = null;
    let leaseToken: string | null = null;
    let leaseLostReported = false;
    const markLeaseLost = (reason: string): void => {
      if (leaseLostReported) {
        return;
      }
      leaseLostReported = true;
      this.leaseLost = true;
      this.backgroundSchedulerMetricsService.recordLeaseLost(MEDIA_JOB_SCHEDULER_KEY);
      this.logger.warn(`Assistant media-job scheduler lease lost: ${reason}`);
    };
    try {
      const previousLease = await this.schedulerLeaseService.getLeaseState(MEDIA_JOB_SCHEDULER_KEY);
      const lease = await this.schedulerLeaseService.acquire(MEDIA_JOB_SCHEDULER_KEY);
      if (lease === null) {
        this.backgroundSchedulerMetricsService.recordTickSkipped(MEDIA_JOB_SCHEDULER_KEY);
        return;
      }
      leaseToken = lease.token;

      if (
        previousLease !== null &&
        previousLease.holderId !== "" &&
        previousLease.expiresAt.getTime() <= startedAt
      ) {
        this.backgroundSchedulerMetricsService.recordLeaseExpiredRecovered(MEDIA_JOB_SCHEDULER_KEY);
      }

      heartbeatTimer = setInterval(() => {
        void this.schedulerLeaseService
          .heartbeat(MEDIA_JOB_SCHEDULER_KEY, lease.token)
          .then((stillLeader) => {
            if (!stillLeader) {
              markLeaseLost("heartbeat token no longer matched active leader");
            }
          })
          .catch((error) => {
            markLeaseLost(error instanceof Error ? error.message : String(error));
          });
      }, LEASE_HEARTBEAT_INTERVAL_MS);
      heartbeatTimer.unref?.();

      while (!this.stopped && !this.leaseLost) {
        const [runCount, deliveryCount] = await Promise.all([
          this.processDueJobsBatch(),
          this.assistantMediaJobCompletionDeliveryService.processPendingBatch()
        ]);
        processed += runCount + deliveryCount;
        if (runCount < MEDIA_JOB_BATCH_SIZE && deliveryCount < MEDIA_JOB_BATCH_SIZE) {
          break;
        }
      }
      if (processed > 0) {
        this.logger.log(`Processed ${processed} assistant media job(s).`);
      }
      this.backgroundSchedulerMetricsService.recordTickAcquired(
        MEDIA_JOB_SCHEDULER_KEY,
        Date.now() - startedAt,
        processed
      );
    } catch (error) {
      const stack = error instanceof Error ? error.stack : undefined;
      this.logger.error(
        `Assistant media-job scheduler tick failed: ${error instanceof Error ? error.message : String(error)}`,
        stack
      );
    } finally {
      if (heartbeatTimer !== null) {
        clearInterval(heartbeatTimer);
      }
      if (leaseToken !== null) {
        await this.schedulerLeaseService.release(MEDIA_JOB_SCHEDULER_KEY, leaseToken);
      }
      this.leaseLost = false;
      this.running = false;
      this.scheduleNext(MEDIA_JOB_POLL_INTERVAL_MS);
    }
  }

  private async claimDueJobs(limit: number): Promise<ClaimedMediaJob[]> {
    const now = new Date();
    const claimExpiresAt = new Date(now.getTime() + MEDIA_JOB_CLAIM_TTL_MS);
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<
        Array<{
          id: string;
          assistantId: string;
          userId: string;
          workspaceId: string;
          chatId: string;
          surface: "web" | "telegram";
          kind: MediaJobKind;
          sourceUserMessageId: string | null;
          requestJson: unknown;
          attemptCount: number;
          maxAttempts: number;
        }>
      >(Prisma.sql`
        SELECT
          "id",
          "assistant_id" AS "assistantId",
          "user_id" AS "userId",
          "workspace_id" AS "workspaceId",
          "chat_id" AS "chatId",
          "surface"::text AS "surface",
          "kind"::text AS "kind",
          "source_user_message_id" AS "sourceUserMessageId",
          "request_json" AS "requestJson",
          "attempt_count" AS "attemptCount",
          "max_attempts" AS "maxAttempts"
        FROM "assistant_media_jobs"
        WHERE (
            "status" = 'queued'
            AND ("next_retry_at" IS NULL OR "next_retry_at" <= NOW())
          )
          OR (
            "status" = 'running'
            AND "scheduler_claim_expires_at" IS NOT NULL
            AND "scheduler_claim_expires_at" <= NOW()
          )
        ORDER BY "created_at" ASC
        FOR UPDATE SKIP LOCKED
        LIMIT ${Math.max(1, Math.floor(limit))}
      `);

      const claimed: ClaimedMediaJob[] = [];
      for (const row of rows) {
        if (typeof row.sourceUserMessageId !== "string" || row.sourceUserMessageId.length === 0) {
          continue;
        }
        const claimToken = randomUUID();
        const nextAttemptCount = row.attemptCount + 1;
        await tx.assistantMediaJob.update({
          where: { id: row.id },
          data: {
            status: "running",
            attemptCount: nextAttemptCount,
            schedulerClaimToken: claimToken,
            schedulerClaimedAt: now,
            schedulerClaimExpiresAt: claimExpiresAt,
            ...(row.attemptCount === 0 ? { startedAt: now } : {}),
            completedAt: null,
            failedAt: null,
            lastErrorCode: null,
            lastErrorMessage: null
          }
        });
        if (typeof row.userId !== "string" || row.userId.length === 0) {
          continue;
        }
        claimed.push({
          id: row.id,
          assistantId: row.assistantId,
          userId: row.userId,
          workspaceId: row.workspaceId,
          chatId: row.chatId,
          surface: row.surface,
          kind: row.kind,
          sourceUserMessageId: row.sourceUserMessageId,
          requestJson: row.requestJson,
          attemptCount: nextAttemptCount,
          maxAttempts: row.maxAttempts,
          claimToken
        });
      }
      return claimed;
    });
  }

  private async processClaimedJob(job: ClaimedMediaJob): Promise<void> {
    const requestPayload = this.parseRequestPayload(job.requestJson);
    if (requestPayload === null) {
      await this.failJob(
        job,
        false,
        "invalid_request_payload",
        "Media job request payload is invalid.",
        "en"
      );
      return;
    }

    const failContext: FailJobContext = {
      sourceUserMessageText: requestPayload.sourceUserMessageText,
      sourceUserMessageCreatedAt: requestPayload.sourceUserMessageCreatedAt
    };

    const assistant = await this.assistantRepository.findById(job.assistantId);
    if (assistant === null) {
      await this.failJob(
        job,
        false,
        "assistant_not_found",
        "Assistant not found.",
        inferAssistantMediaJobFailureLocale({ sourceText: requestPayload.sourceUserMessageText })
        // No LLM framing: the assistant record itself is missing, so bundle hydration would fail.
      );
      return;
    }

    const resolvedRuntimeContext =
      await this.resolveAssistantInboundRuntimeContextService.resolveByAssistantId(job.assistantId);
    const spec = await this.ensureAssistantMaterializedSpecCurrentService.resolveCurrent(assistant);
    if (spec?.runtimeBundleDocument === null || spec?.runtimeBundleDocument === undefined) {
      await this.failJob(
        job,
        false,
        "runtime_bundle_missing",
        "Assistant runtime bundle is not materialized.",
        inferAssistantMediaJobFailureLocale({ sourceText: requestPayload.sourceUserMessageText })
        // No LLM framing: the runtime bundle isn't available, so the framing call cannot succeed.
      );
      return;
    }

    const locale = inferAssistantMediaJobFailureLocale({
      preferredLocale: this.extractPreferredLocale(spec.runtimeBundleDocument),
      sourceText: requestPayload.sourceUserMessageText
    });

    const outcome = await this.internalRuntimeMediaJobClientService.run({
      assistantId: job.assistantId,
      workspaceId: job.workspaceId,
      runtimeTier: resolvedRuntimeContext.runtimeTier,
      runtimeBundleDocument: spec.runtimeBundleDocument,
      job: {
        id: job.id,
        surface: job.surface,
        kind: job.kind,
        chatId: job.chatId,
        sourceUserMessageId: job.sourceUserMessageId,
        sourceUserMessageText: requestPayload.sourceUserMessageText,
        sourceUserMessageCreatedAt: requestPayload.sourceUserMessageCreatedAt
      },
      attachments: requestPayload.attachments,
      directToolExecution: requestPayload.directToolExecution
    } satisfies RuntimeMediaJobRunRequest);

    if (!outcome.ok) {
      await this.handleFailedExecution(job, outcome, locale, failContext);
      return;
    }

    if (outcome.result.artifacts.length === 0) {
      // ADR-105 §5: worker-execution terminal failure with no deliverable
      // artifacts. The job never reaches the delivery loop, so this is a clean
      // release path — `failJob` releases the full reserved N exactly once.
      await this.failJob(
        job,
        false,
        "media_job_artifacts_missing",
        "Media job worker completed without any deliverable artifacts.",
        locale,
        failContext
      );
      return;
    }

    await this.prisma.assistantMediaJob.updateMany({
      where: { id: job.id, schedulerClaimToken: job.claimToken },
      data: {
        status: "completion_pending",
        resultText: outcome.result.assistantText,
        artifactsJson: outcome.result.artifacts as unknown as Prisma.InputJsonValue,
        billingFactsJson:
          outcome.result.billingFacts === null
            ? Prisma.DbNull
            : (outcome.result.billingFacts as unknown as Prisma.InputJsonValue),
        completedAt: new Date(),
        nextRetryAt: null,
        schedulerClaimToken: null,
        schedulerClaimedAt: null,
        schedulerClaimExpiresAt: null,
        lastErrorCode: null,
        lastErrorMessage: null
      }
    });

    if (outcome.result.billingFacts !== null) {
      try {
        await this.recordModelCostLedgerService.recordPersistedBillingFactsEvent({
          workspaceId: job.workspaceId,
          assistantId: job.assistantId,
          userId: job.userId,
          surface: job.surface,
          source: "media_job_completion",
          sourceEventId: `media_job:${job.id}`,
          billingFacts: outcome.result.billingFacts
        });
      } catch (error) {
        this.logger.warn(
          `media_job_ledger_append_failed jobId=${job.id} message=${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
  }

  private async handleFailedExecution(
    job: ClaimedMediaJob,
    outcome: Extract<InternalRuntimeMediaJobRunOutcome, { ok: false }>,
    locale: "ru" | "en",
    context: FailJobContext
  ): Promise<void> {
    const acceptedPrimaryUnconfirmed = this.readAcceptedPrimaryUnconfirmed(outcome);
    if (acceptedPrimaryUnconfirmed !== null) {
      const movedToRecovery = await this.markAcceptedPrimaryUnconfirmedForRecovery(
        job,
        acceptedPrimaryUnconfirmed,
        outcome.message
      );
      if (movedToRecovery) {
        return;
      }
    }
    const canRetry = outcome.retryable && job.attemptCount < job.maxAttempts;
    if (canRetry) {
      // ADR-105 §5: retryable failure — requeue WITHOUT touching the quota. The
      // enqueue reservation stays held across retries and is resolved exactly
      // once at the eventual terminal transition (success delivery settles, or
      // `failJob` releases). Releasing here would multi-release the shared
      // aggregate counter across retry attempts.
      const retryAfterAt = new Date(Date.now() + computeRetryBackoffMs(job.attemptCount));
      await this.prisma.assistantMediaJob.updateMany({
        where: { id: job.id, schedulerClaimToken: job.claimToken },
        data: {
          status: "queued",
          nextRetryAt: retryAfterAt,
          schedulerClaimToken: null,
          schedulerClaimedAt: null,
          schedulerClaimExpiresAt: null,
          lastErrorCode: outcome.code,
          lastErrorMessage: truncateLastError(outcome.message)
        }
      });
      return;
    }

    // ADR-105 §5: terminal worker-execution failure (incl.
    // image_provider_safety_rejected). The worker no longer releases; `failJob`
    // releases the full reserved N exactly once.
    await this.failJob(job, false, outcome.code, outcome.message, locale, context);
  }

  private readAcceptedPrimaryUnconfirmed(
    outcome: Extract<InternalRuntimeMediaJobRunOutcome, { ok: false }>
  ): AcceptedPrimaryUnconfirmedStatus | null {
    if (outcome.code !== "accepted_primary_unconfirmed") {
      return null;
    }
    if (
      outcome.providerStatus !== null &&
      typeof outcome.providerStatus.providerTaskId === "string" &&
      outcome.providerStatus.providerTaskId.trim().length > 0 &&
      isAcceptedPrimaryUnconfirmedProvider(outcome.providerStatus.provider)
    ) {
      return {
        providerTaskId: outcome.providerStatus.providerTaskId.trim(),
        provider: outcome.providerStatus.provider,
        model:
          typeof outcome.providerStatus.model === "string" &&
          outcome.providerStatus.model.trim().length > 0
            ? outcome.providerStatus.model.trim()
            : null,
        acceptedAt:
          typeof outcome.providerStatus.acceptedAt === "string" &&
          outcome.providerStatus.acceptedAt.trim().length > 0
            ? outcome.providerStatus.acceptedAt
            : new Date().toISOString(),
        providerStage: "accepted",
        code: "accepted_primary_unconfirmed",
        reason:
          typeof outcome.providerStatus.reason === "string" &&
          outcome.providerStatus.reason.trim().length > 0
            ? outcome.providerStatus.reason
            : "provider accepted but polling transport lost",
        message:
          typeof outcome.providerStatus.message === "string" &&
          outcome.providerStatus.message.trim().length > 0
            ? outcome.providerStatus.message
            : outcome.message,
        taskKind:
          typeof outcome.providerStatus.taskKind === "string" &&
          outcome.providerStatus.taskKind.trim().length > 0
            ? outcome.providerStatus.taskKind.trim()
            : null
      };
    }
    const payloadMatch = /PERSAI_VIDEO_ACCEPTED_PRIMARY_UNCONFIRMED::(\{[\s\S]*\})/.exec(
      outcome.message
    );
    const parsedText = payloadMatch?.[1] ?? null;
    const fallbackStatus = this.parseProviderStatusFromOutcomeMessage(outcome.message);
    if (parsedText === null && fallbackStatus === null) {
      return null;
    }
    if (parsedText !== null) {
      try {
        const parsed = JSON.parse(parsedText);
        if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
          return null;
        }
        const row = parsed as Record<string, unknown>;
        if (
          isAcceptedPrimaryUnconfirmedProvider(row.provider) &&
          row.providerStage === "accepted" &&
          row.code === "accepted_primary_unconfirmed" &&
          typeof row.providerTaskId === "string" &&
          row.providerTaskId.trim().length > 0
        ) {
          return {
            providerTaskId: row.providerTaskId.trim(),
            provider: row.provider,
            model:
              typeof row.model === "string" && row.model.trim().length > 0
                ? row.model.trim()
                : null,
            acceptedAt:
              typeof row.acceptedAt === "string" && row.acceptedAt.trim().length > 0
                ? row.acceptedAt
                : new Date().toISOString(),
            providerStage: "accepted",
            code: "accepted_primary_unconfirmed",
            reason:
              typeof row.reason === "string" && row.reason.trim().length > 0
                ? row.reason
                : "provider accepted but polling transport lost",
            message:
              typeof row.message === "string" && row.message.trim().length > 0
                ? row.message
                : outcome.message,
            taskKind:
              typeof row.taskKind === "string" && row.taskKind.trim().length > 0
                ? row.taskKind.trim()
                : null
          };
        }
      } catch {
        // fall through to providerStatus fallback parse
      }
    }
    if (fallbackStatus === null) {
      return null;
    }
    try {
      const parsed = fallbackStatus;
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
        return null;
      }
      const row = parsed as Record<string, unknown>;
      if (
        isAcceptedPrimaryUnconfirmedProvider(row.provider) &&
        row.providerStage === "accepted" &&
        typeof row.providerTaskId === "string" &&
        row.providerTaskId.trim().length > 0
      ) {
        return {
          providerTaskId: row.providerTaskId.trim(),
          provider: row.provider,
          model:
            typeof row.model === "string" && row.model.trim().length > 0 ? row.model.trim() : null,
          acceptedAt:
            typeof row.acceptedAt === "string" && row.acceptedAt.trim().length > 0
              ? row.acceptedAt
              : new Date().toISOString(),
          providerStage: "accepted",
          code: "accepted_primary_unconfirmed",
          reason:
            typeof row.reason === "string" && row.reason.trim().length > 0
              ? row.reason
              : "provider accepted but polling transport lost",
          message:
            typeof row.message === "string" && row.message.trim().length > 0
              ? row.message
              : outcome.message,
          taskKind:
            typeof row.taskKind === "string" && row.taskKind.trim().length > 0
              ? row.taskKind.trim()
              : null
        };
      }
      return null;
    } catch {
      return null;
    }
  }

  private parseProviderStatusFromOutcomeMessage(message: string): Record<string, unknown> | null {
    const marker = 'providerStatus":';
    const markerIndex = message.indexOf(marker);
    if (markerIndex < 0) {
      return null;
    }
    const jsonStart = message.indexOf("{", markerIndex);
    if (jsonStart < 0) {
      return null;
    }
    for (let end = message.length; end > jsonStart; end -= 1) {
      const candidate = message.slice(jsonStart, end).trim();
      try {
        const parsed = JSON.parse(candidate);
        if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
          return parsed as Record<string, unknown>;
        }
      } catch {
        // continue shrinking
      }
    }
    return null;
  }

  private async markAcceptedPrimaryUnconfirmedForRecovery(
    job: ClaimedMediaJob,
    accepted: AcceptedPrimaryUnconfirmedStatus,
    transportMessage: string
  ): Promise<boolean> {
    const updated = await this.prisma.assistantMediaJob.updateMany({
      where: { id: job.id, schedulerClaimToken: job.claimToken },
      data: {
        status: "queued",
        nextRetryAt: new Date(Date.now() + MEDIA_JOB_POLL_INTERVAL_MS),
        schedulerClaimToken: null,
        schedulerClaimedAt: null,
        schedulerClaimExpiresAt: null,
        lastErrorCode: "accepted_primary_unconfirmed",
        lastErrorMessage: truncateLastError(transportMessage),
        requestJson: this.withAcceptedProviderTask(job.requestJson, accepted) as never
      }
    });
    if (updated.count > 0) {
      this.logger.warn(
        `Media job ${job.id} recovery queued: provider task already accepted provider=${accepted.provider} model=${accepted.model ?? "unknown"} taskId=${accepted.providerTaskId}. Fallback forbidden until terminal outcome.`
      );
      return true;
    }
    return false;
  }

  private withAcceptedProviderTask(
    requestJson: unknown,
    accepted: AcceptedPrimaryUnconfirmedStatus
  ): unknown {
    if (requestJson === null || typeof requestJson !== "object" || Array.isArray(requestJson)) {
      return requestJson;
    }
    const row = requestJson as Record<string, unknown>;
    const directToolExecution = row.directToolExecution;
    if (
      directToolExecution === null ||
      typeof directToolExecution !== "object" ||
      Array.isArray(directToolExecution)
    ) {
      return requestJson;
    }
    const direct = directToolExecution as Record<string, unknown>;
    if (direct.toolCode !== "video_generate") {
      return requestJson;
    }
    const request = direct.request;
    if (request === null || typeof request !== "object" || Array.isArray(request)) {
      return requestJson;
    }
    return {
      ...row,
      directToolExecution: {
        ...direct,
        request: {
          ...(request as Record<string, unknown>),
          acceptedProviderTask: {
            provider: accepted.provider,
            model: accepted.model,
            providerTaskId: accepted.providerTaskId,
            acceptedAt: accepted.acceptedAt,
            providerStage: "accepted",
            taskKind: accepted.taskKind
          }
        }
      }
    };
  }

  private extractDirectToolExecution(requestJson: unknown): {
    toolCode: WorkspaceMonthlyToolQuotaToolCode | null;
    request: Record<string, unknown>;
  } | null {
    if (requestJson === null || typeof requestJson !== "object" || Array.isArray(requestJson)) {
      return null;
    }
    const direct = (requestJson as Record<string, unknown>).directToolExecution;
    if (direct === null || typeof direct !== "object" || Array.isArray(direct)) {
      return null;
    }
    const row = direct as Record<string, unknown>;
    const request = row.request;
    if (request === null || typeof request !== "object" || Array.isArray(request)) {
      return null;
    }
    const toolCode =
      row.toolCode === "image_generate" ||
      row.toolCode === "image_edit" ||
      row.toolCode === "video_generate"
        ? (row.toolCode as WorkspaceMonthlyToolQuotaToolCode)
        : null;
    return {
      toolCode,
      request: request as Record<string, unknown>
    };
  }

  private async failJob(
    job: ClaimedMediaJob,
    retryable: boolean,
    code: string | null,
    message: string,
    locale: "ru" | "en",
    context?: FailJobContext
  ): Promise<void> {
    const llmAuthored =
      context === undefined
        ? null
        : await this.tryLlmAuthoredFailureCopy(job, retryable, code, message, context);
    const failureMessage =
      llmAuthored ??
      buildAssistantMediaJobFailureMessage({
        kind: job.kind,
        code,
        message,
        locale
      });

    // ADR-105 §5 (single-owner reservation): `failJob` is the single terminal
    // failure transition for a media job that never reached the delivery loop.
    // The enqueue reservation (N units) has not been settled or reconciled by
    // any other actor — the worker no longer touches the quota and the API
    // delivery loop never ran — so we release the full reserved N here exactly
    // once. Covers every failJob caller: invalid_request_payload,
    // assistant_not_found, runtime_bundle_missing, media_job_artifacts_missing,
    // and terminal worker failures (incl. image_provider_safety_rejected).
    await this.releaseEnqueueReservationBestEffort(job);

    let completionAssistantMessageId: string | null = null;

    try {
      const created = await this.assistantChatRepository.createMessage({
        chatId: job.chatId,
        assistantId: job.assistantId,
        author: "assistant",
        content: failureMessage
      });
      completionAssistantMessageId = created.id;
    } catch (error) {
      this.logger.warn(
        `Failed to create terminal media-job failure message for ${job.id}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }

    await this.prisma.assistantMediaJob.updateMany({
      where: { id: job.id, schedulerClaimToken: job.claimToken },
      data: {
        status: "failed",
        failedAt: new Date(),
        schedulerClaimToken: null,
        schedulerClaimedAt: null,
        schedulerClaimExpiresAt: null,
        lastErrorCode: code,
        lastErrorMessage: truncateLastError(message),
        ...(completionAssistantMessageId === null ? {} : { completionAssistantMessageId })
      }
    });

    if (job.surface === "telegram" && completionAssistantMessageId !== null) {
      await this.telegramAssistantChatOutboundService.deliverPersistedAssistantMessageBestEffort({
        assistantId: job.assistantId,
        chatId: job.chatId,
        workspaceId: job.workspaceId,
        assistantMessageId: completionAssistantMessageId,
        text: failureMessage
      });
    }
  }

  /**
   * ADR-105 §5 — release the job's full enqueue-time monthly media reservation
   * exactly once on a terminal scheduler failure. Best-effort: the failure
   * transition must still complete even if the quota release throws, and a
   * missing assistant entity (deleted mid-flight) is the only path where the
   * reservation cannot be resolved here (it requires the Assistant entity to
   * resolve governance + subscription period); that rare edge is logged.
   */
  private async releaseEnqueueReservationBestEffort(job: ClaimedMediaJob): Promise<void> {
    const reservation = this.extractReservationInfoFromRequestJson(job.requestJson);
    if (reservation === null) {
      this.logger.warn(
        `ADR-105 release skipped: could not resolve toolCode/units from requestJson jobId=${job.id}`
      );
      return;
    }
    const assistant = await this.assistantRepository.findById(job.assistantId);
    if (assistant === null) {
      this.logger.warn(
        `ADR-105 release skipped: assistant missing for jobId=${job.id} toolCode=${reservation.toolCode} units=${String(reservation.units)} (reserved units stranded for workspace reconciliation)`
      );
      return;
    }
    try {
      await this.trackWorkspaceQuotaUsageService.releaseAssistantMonthlyMediaQuota({
        assistant,
        toolCode: reservation.toolCode,
        units: reservation.units
      });
    } catch (error) {
      this.logger.warn(
        `ADR-105 monthly media quota release failed jobId=${job.id} toolCode=${reservation.toolCode} units=${String(reservation.units)}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  private async tryLlmAuthoredFailureCopy(
    job: ClaimedMediaJob,
    retryable: boolean,
    code: string | null,
    message: string,
    context: FailJobContext
  ): Promise<string | null> {
    try {
      return await this.assistantMediaJobCompletionTurnService.maybeFrameFailure({
        id: job.id,
        assistantId: job.assistantId,
        workspaceId: job.workspaceId,
        chatId: job.chatId,
        surface: job.surface,
        kind: job.kind,
        sourceUserMessageId: job.sourceUserMessageId,
        sourceUserMessageText: context.sourceUserMessageText,
        sourceUserMessageCreatedAt: context.sourceUserMessageCreatedAt,
        failure: {
          code,
          message,
          attemptCount: job.attemptCount,
          maxAttempts: job.maxAttempts,
          retryable,
          stage: "execution"
        }
      });
    } catch (error) {
      this.logger.warn(
        `LLM failure-framing threw for media job ${job.id}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      return null;
    }
  }

  /**
   * ADR-105 §5 — recover the reservation tuple (toolCode + N units) from the
   * persisted `requestJson`, mirroring the enqueue-time extraction
   * (`EnqueueRuntimeDeferredMediaJobService.extractRequestedUnitCount`): N =
   * `count` for image_generate / image_edit, 1 for video_generate. Reads the
   * raw JSON defensively so it works even on the invalid_request_payload path
   * where the structured parse failed.
   */
  private extractReservationInfoFromRequestJson(
    requestJson: unknown
  ): { toolCode: WorkspaceMonthlyToolQuotaToolCode; units: number } | null {
    if (requestJson === null || typeof requestJson !== "object" || Array.isArray(requestJson)) {
      return null;
    }
    const exec = (requestJson as Record<string, unknown>).directToolExecution;
    if (exec === null || typeof exec !== "object" || Array.isArray(exec)) {
      return null;
    }
    const row = exec as Record<string, unknown>;
    const toolCode = row.toolCode;
    if (toolCode === "image_generate" || toolCode === "image_edit") {
      const request = row.request;
      if (request === null || typeof request !== "object" || Array.isArray(request)) {
        return null;
      }
      const count = (request as Record<string, unknown>).count;
      if (typeof count === "number" && Number.isInteger(count) && count > 0) {
        return { toolCode, units: count };
      }
      return null;
    }
    // ADR-108 Slice 8 — `video_generate` is VC-priced and never reserves
    // monthly media units, so the terminal-failure release path skips
    // it entirely.
    return null;
  }

  private extractPreferredLocale(runtimeBundleDocument: string): string | null {
    try {
      const parsed = JSON.parse(runtimeBundleDocument) as {
        userContext?: { locale?: unknown };
      };
      return typeof parsed.userContext?.locale === "string" ? parsed.userContext.locale : null;
    } catch {
      return null;
    }
  }

  private parseRequestPayload(value: unknown): MediaJobRequestPayload | null {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      return null;
    }
    const row = value as Record<string, unknown>;
    if (
      typeof row.sourceUserMessageText !== "string" ||
      row.sourceUserMessageText.trim().length === 0 ||
      typeof row.sourceUserMessageCreatedAt !== "string" ||
      !Array.isArray(row.attachments)
    ) {
      return null;
    }
    const attachments = row.attachments;
    if (!attachments.every((entry) => this.isAttachmentRef(entry))) {
      return null;
    }
    const directToolExecution = this.parseDirectToolExecution(row.directToolExecution);
    if (directToolExecution === null) {
      return null;
    }
    return {
      attachments,
      sourceUserMessageText: row.sourceUserMessageText,
      sourceUserMessageCreatedAt: row.sourceUserMessageCreatedAt,
      directToolExecution
    };
  }

  private parseDirectToolExecution(value: unknown): DirectToolExecutionPayload | null {
    if (value === undefined) {
      return null;
    }
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      return null;
    }
    const row = value as Record<string, unknown>;
    if (row.toolCode === "image_generate" && this.isObject(row.request)) {
      return {
        toolCode: "image_generate",
        request: row.request as unknown as RuntimeImageGenerateRequest
      };
    }
    if (row.toolCode === "image_edit" && this.isObject(row.request)) {
      return {
        toolCode: "image_edit",
        request: row.request as unknown as RuntimeImageEditRequest
      };
    }
    if (row.toolCode === "video_generate" && this.isObject(row.request)) {
      return {
        toolCode: "video_generate",
        request: row.request as unknown as RuntimeVideoGenerateRequest
      };
    }
    return null;
  }

  private isAttachmentRef(value: unknown): value is RuntimeAttachmentRef {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      return false;
    }
    const row = value as Record<string, unknown>;
    if (typeof row.storagePath !== "string" || row.storagePath.trim().length === 0) {
      return false;
    }
    const displayNameOk =
      row.displayName === null ||
      typeof row.displayName === "string" ||
      row.filename === null ||
      typeof row.filename === "string" ||
      row.displayName === undefined;
    return (
      typeof row.attachmentId === "string" &&
      typeof row.kind === "string" &&
      typeof row.mimeType === "string" &&
      displayNameOk &&
      typeof row.sizeBytes === "number"
    );
  }

  private isObject(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }
}
