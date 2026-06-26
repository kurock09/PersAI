import { Inject, Injectable, Logger } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { type RuntimeOutputArtifact, type RuntimeUsageSnapshot } from "@persai/runtime-contract";
import {
  ASSISTANT_CHAT_REPOSITORY,
  type AssistantChatRepository
} from "../domain/assistant-chat.repository";
import { ASSISTANT_REPOSITORY, type AssistantRepository } from "../domain/assistant.repository";
import type { WorkspaceMonthlyToolQuotaToolCode } from "../domain/workspace-quota-accounting.repository";
import { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";
import { runtimeOutputArtifactsToMediaArtifacts } from "./assistant-runtime.facade";
import {
  applyFinalDeliveryHonestyCorrection,
  buildPartialDeliveryShortfallLine
} from "./final-delivery-honesty";
import { MediaDeliveryService } from "./media/media-delivery.service";
import { ResolveTelegramChannelRuntimeConfigService } from "./resolve-telegram-channel-runtime-config.service";
import {
  parseTelegramChatIdFromSurfaceThreadKey,
  TelegramAssistantChatOutboundService
} from "./telegram-assistant-chat-outbound.service";
import { AssistantMediaJobCompletionTurnService } from "./workspace-media-job-completion-turn.service";
import { RecordModelCostLedgerService } from "./record-model-cost-ledger.service";
import { TrackWorkspaceQuotaUsageService } from "./track-workspace-quota-usage.service";
import {
  buildAssistantMediaJobFailureMessage,
  inferAssistantMediaJobFailureLocale
} from "./workspace-media-job-failure-copy.service";

const COMPLETION_DELIVERY_BATCH_SIZE = 4;
const COMPLETION_DELIVERY_CLAIM_TTL_MS = 5 * 60 * 1000;
const COMPLETION_DELIVERY_RETRY_BASE_DELAY_MS = 30_000;
const COMPLETION_DELIVERY_RETRY_MAX_DELAY_MS = 30 * 60 * 1000;
const COMPLETION_DELIVERY_LAST_ERROR_MAX_CHARS = 1_000;

type ClaimedCompletionPendingMediaJob = {
  id: string;
  assistantId: string;
  userId: string;
  workspaceId: string;
  chatId: string;
  surface: "web" | "telegram";
  kind: "image" | "audio" | "video";
  sourceUserMessageId: string;
  requestJson: unknown;
  resultText: string | null;
  artifactsJson: unknown;
  completionAssistantMessageId: string | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  attemptCount: number;
  maxAttempts: number;
  claimToken: string;
};

type CompletionRequestPayload = {
  attachments: unknown[];
  sourceUserMessageText: string;
  sourceUserMessageCreatedAt: string;
};

type CompletionAssistantTextResolution = {
  text: string;
  shouldUpdateExistingMessage: boolean;
};

function truncateLastError(message: string): string {
  if (message.length <= COMPLETION_DELIVERY_LAST_ERROR_MAX_CHARS) {
    return message;
  }
  return `${message.slice(0, COMPLETION_DELIVERY_LAST_ERROR_MAX_CHARS - 3)}...`;
}

function computeRetryBackoffMs(attempt: number): number {
  const safeAttempt = Math.max(1, Math.floor(attempt));
  return Math.min(
    COMPLETION_DELIVERY_RETRY_MAX_DELAY_MS,
    COMPLETION_DELIVERY_RETRY_BASE_DELAY_MS * 2 ** (safeAttempt - 1)
  );
}

@Injectable()
export class AssistantMediaJobCompletionDeliveryService {
  private readonly logger = new Logger(AssistantMediaJobCompletionDeliveryService.name);

  constructor(
    private readonly prisma: WorkspaceManagementPrismaService,
    @Inject(ASSISTANT_CHAT_REPOSITORY)
    private readonly assistantChatRepository: AssistantChatRepository,
    private readonly mediaDeliveryService: MediaDeliveryService,
    private readonly telegramAssistantChatOutboundService: TelegramAssistantChatOutboundService,
    private readonly resolveTelegramChannelRuntimeConfigService: ResolveTelegramChannelRuntimeConfigService,
    private readonly assistantMediaJobCompletionTurnService: AssistantMediaJobCompletionTurnService,
    private readonly recordModelCostLedgerService: RecordModelCostLedgerService,
    @Inject(ASSISTANT_REPOSITORY)
    private readonly assistantRepository: AssistantRepository,
    private readonly trackWorkspaceQuotaUsageService: TrackWorkspaceQuotaUsageService
  ) {}

  private async persistCompletionFramingLedger(input: {
    job: Pick<
      ClaimedCompletionPendingMediaJob,
      "id" | "assistantId" | "userId" | "workspaceId" | "surface"
    >;
    usage: RuntimeUsageSnapshot | null;
  }): Promise<void> {
    if (input.usage === null) {
      return;
    }
    try {
      await this.recordModelCostLedgerService.recordCompletionFramingUsageEvent({
        workspaceId: input.job.workspaceId,
        assistantId: input.job.assistantId,
        userId: input.job.userId,
        surface: input.job.surface,
        occurredAt: new Date().toISOString(),
        sourceEventId: `media_job:${input.job.id}:completion_framing`,
        source: "media_job_completion_framing",
        usage: input.usage
      });
    } catch (error) {
      this.logger.warn(
        `media_job_completion_framing_ledger_append_failed jobId=${input.job.id} message=${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  private async tryLlmAuthoredDeliveryFailureCopy(
    job: ClaimedCompletionPendingMediaJob,
    code: string,
    message: string,
    context: { sourceUserMessageText: string; sourceUserMessageCreatedAt: string }
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
          retryable: false,
          stage: "delivery"
        }
      });
    } catch (error) {
      this.logger.warn(
        `LLM failure-framing threw for media-delivery job ${job.id}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      return null;
    }
  }

  async processPendingBatch(limit = COMPLETION_DELIVERY_BATCH_SIZE): Promise<number> {
    const claimed = await this.claimPendingDeliveries(limit);
    for (const job of claimed) {
      await this.processClaimedCompletionPendingJob(job);
    }
    return claimed.length;
  }

  private async claimPendingDeliveries(limit: number): Promise<ClaimedCompletionPendingMediaJob[]> {
    const now = new Date();
    const claimExpiresAt = new Date(now.getTime() + COMPLETION_DELIVERY_CLAIM_TTL_MS);
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<
        Array<{
          id: string;
          assistantId: string;
          userId: string;
          workspaceId: string;
          chatId: string;
          surface: "web" | "telegram";
          kind: "image" | "audio" | "video";
          sourceUserMessageId: string;
          requestJson: unknown;
          resultText: string | null;
          artifactsJson: unknown;
          completionAssistantMessageId: string | null;
          lastErrorCode: string | null;
          lastErrorMessage: string | null;
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
          "result_text" AS "resultText",
          "artifacts_json" AS "artifactsJson",
          "completion_assistant_message_id" AS "completionAssistantMessageId",
          "last_error_code" AS "lastErrorCode",
          "last_error_message" AS "lastErrorMessage",
          "attempt_count" AS "attemptCount",
          "max_attempts" AS "maxAttempts"
        FROM "assistant_media_jobs"
        WHERE "status" = 'completion_pending'
          AND ("next_retry_at" IS NULL OR "next_retry_at" <= NOW())
          AND (
            "scheduler_claim_expires_at" IS NULL
            OR "scheduler_claim_expires_at" <= NOW()
          )
        ORDER BY "updated_at" ASC
        FOR UPDATE SKIP LOCKED
        LIMIT ${Math.max(1, Math.floor(limit))}
      `);

      const claimed: ClaimedCompletionPendingMediaJob[] = [];
      for (const row of rows) {
        if (typeof row.userId !== "string" || row.userId.length === 0) {
          continue;
        }
        const claimToken = `${row.id}:${Date.now()}`;
        await tx.assistantMediaJob.update({
          where: { id: row.id },
          data: {
            schedulerClaimToken: claimToken,
            schedulerClaimedAt: now,
            schedulerClaimExpiresAt: claimExpiresAt,
            attemptCount: {
              increment: 1
            }
          }
        });
        claimed.push({
          ...row,
          attemptCount: row.attemptCount + 1,
          claimToken
        });
      }
      return claimed;
    });
  }

  private async processClaimedCompletionPendingJob(
    job: ClaimedCompletionPendingMediaJob
  ): Promise<void> {
    const requestPayload = this.parseRequestPayload(job.requestJson);
    if (requestPayload === null) {
      // ADR-105 §5: pre-delivery-loop terminal failure. Provider cost was
      // incurred (the job reached completion_pending with artifacts) but
      // nothing is deliverable, so reconcile the full reserved N once.
      await this.failDelivery(
        job,
        false,
        "completion_request_missing",
        "Media job completion request payload is invalid.",
        "en",
        true
        // No LLM framing: the original user-message context is missing from the persisted payload.
      );
      return;
    }

    const failContext = {
      sourceUserMessageText: requestPayload.sourceUserMessageText,
      sourceUserMessageCreatedAt: requestPayload.sourceUserMessageCreatedAt
    };

    const artifacts = this.parseArtifacts(job.artifactsJson);
    if (artifacts === null || artifacts.length === 0) {
      const code =
        job.surface === "telegram" && typeof job.lastErrorCode === "string"
          ? job.lastErrorCode
          : "completion_artifacts_missing";
      const message =
        job.surface === "telegram" && typeof job.lastErrorMessage === "string"
          ? job.lastErrorMessage
          : "Media job has no artifacts to deliver.";
      // For Telegram, the scheduler can intentionally put terminal execution
      // failures into completion_pending with zero artifacts so the user-visible
      // failure notice is delivered by the retryable delivery worker.
      await this.failDelivery(
        job,
        false,
        code,
        message,
        inferAssistantMediaJobFailureLocale({
          sourceText: requestPayload.sourceUserMessageText
        }),
        job.surface !== "telegram",
        failContext
      );
      return;
    }

    const failureLocale = inferAssistantMediaJobFailureLocale({
      sourceText: requestPayload.sourceUserMessageText
    });

    // ADR-105 §5: tracks whether `MediaDeliveryService.deliver()` ran to
    // completion. Once it returns, the delivery loop has already resolved ALL
    // N reserved units per-artifact (settle on delivered, reconcile on failed),
    // so a later exception (e.g. a post-delivery message update) must NOT
    // trigger another reconcile here — that would double-count.
    const deliveryState = { loopResolved: false };

    try {
      const completionAssistantText = await this.resolveCompletionAssistantText({
        job,
        sourceUserMessageText: requestPayload.sourceUserMessageText,
        sourceUserMessageCreatedAt: requestPayload.sourceUserMessageCreatedAt,
        artifacts
      });
      const messageId = await this.ensureCompletionMessage(job, completionAssistantText);
      if (completionAssistantText.shouldUpdateExistingMessage) {
        await this.assistantChatRepository.updateMessageContent(
          messageId,
          job.assistantId,
          completionAssistantText.text
        );
      }

      if (job.surface === "telegram") {
        await this.processTelegramCompletionPendingJob({
          job,
          artifacts,
          messageId,
          rawAssistantText: completionAssistantText.text,
          deliveryState
        });
        return;
      }

      const delivered = await this.mediaDeliveryService.deliver({
        artifacts: runtimeOutputArtifactsToMediaArtifacts(artifacts),
        channel: "web",
        assistantId: job.assistantId,
        chatId: job.chatId,
        messageId,
        workspaceId: job.workspaceId
      });
      deliveryState.loopResolved = true;
      await this.releaseUnproducedRemainderBestEffort(job, artifacts.length);
      let finalText = applyFinalDeliveryHonestyCorrection({
        assistantText: completionAssistantText.text,
        attemptedArtifactCount: artifacts.length,
        deliveredAttachmentCount: delivered.attachments.length,
        deliveredAttachmentFilenames: delivered.attachments
          .map((attachment) => attachment.originalFilename)
          .filter((filename): filename is string => typeof filename === "string"),
        attemptedArtifactKind: "media",
        locale: failureLocale
      });
      // ADR-105 FIX B: system-authored structural truth for partial under-delivery.
      const webReservationN =
        this.extractReservationInfoFromRequestJson(job.requestJson)?.units ?? null;
      const webShortfallLine =
        webReservationN !== null
          ? buildPartialDeliveryShortfallLine(artifacts.length, webReservationN, failureLocale)
          : null;
      if (webShortfallLine !== null) {
        finalText = `${finalText}\n\n${webShortfallLine}`;
      }

      if (completionAssistantText.text !== finalText) {
        await this.assistantChatRepository.updateMessageContent(
          messageId,
          job.assistantId,
          finalText
        );
      }

      const terminalStatus = delivered.attachments.length > 0 ? "delivered" : "failed";
      await this.finalizeJob(job, {
        status: terminalStatus,
        code: terminalStatus === "failed" ? "media_delivery_failed" : null,
        message:
          terminalStatus === "failed"
            ? "Generated media could not be delivered to the user-visible chat."
            : null
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Media delivery failed.";
      const canRetry = job.attemptCount < job.maxAttempts;
      if (!canRetry) {
        // ADR-105 §5: terminal delivery failure. Reconcile the reserved N ONLY
        // if the delivery loop never resolved the units (exception thrown
        // before/while reaching `deliver()`). If the loop already ran, it has
        // resolved all N per-artifact and we must not reconcile again.
        await this.failDelivery(
          job,
          false,
          "media_delivery_failed",
          message,
          failureLocale,
          !deliveryState.loopResolved,
          failContext
        );
        return;
      }
      await this.prisma.assistantMediaJob.updateMany({
        where: { id: job.id, schedulerClaimToken: job.claimToken },
        data: {
          nextRetryAt: new Date(Date.now() + computeRetryBackoffMs(job.attemptCount)),
          schedulerClaimToken: null,
          schedulerClaimedAt: null,
          schedulerClaimExpiresAt: null,
          lastErrorCode: "media_delivery_failed",
          lastErrorMessage: truncateLastError(message)
        }
      });
      this.logger.warn(`Completion delivery retry scheduled for media job ${job.id}: ${message}`);
    }
  }

  private async resolveCompletionAssistantText(input: {
    job: ClaimedCompletionPendingMediaJob;
    sourceUserMessageText: string;
    sourceUserMessageCreatedAt: string;
    artifacts: RuntimeOutputArtifact[];
  }): Promise<CompletionAssistantTextResolution> {
    const rawAssistantText = input.job.resultText?.trim() ?? "";
    let existingContent = "";
    if (input.job.completionAssistantMessageId !== null) {
      const existing = await this.assistantChatRepository.findMessageByIdForAssistant(
        input.job.completionAssistantMessageId,
        input.job.assistantId
      );
      existingContent = existing?.content.trim() ?? "";
    }

    let framed: { text: string | null; usage: RuntimeUsageSnapshot | null } = {
      text: null,
      usage: null
    };
    try {
      framed = await this.assistantMediaJobCompletionTurnService.maybeFrame({
        id: input.job.id,
        assistantId: input.job.assistantId,
        workspaceId: input.job.workspaceId,
        chatId: input.job.chatId,
        surface: input.job.surface,
        kind: input.job.kind,
        sourceUserMessageId: input.job.sourceUserMessageId,
        sourceUserMessageText: input.sourceUserMessageText,
        sourceUserMessageCreatedAt: input.sourceUserMessageCreatedAt,
        resultText: rawAssistantText,
        artifacts: input.artifacts,
        requestJson: input.job.requestJson
      });
    } catch (error) {
      this.logger.warn(
        `Media completion framing failed for job ${input.job.id}; falling back to stored text: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
    const framedText = framed.text?.trim() ?? "";
    const completionText =
      framedText.length > 0
        ? framedText
        : rawAssistantText.length > 0
          ? rawAssistantText
          : existingContent;
    if (framed.usage !== null) {
      await this.prisma.assistantMediaJob.updateMany({
        where: { id: input.job.id },
        data: {
          completionUsageJson: framed.usage as unknown as Prisma.InputJsonValue
        }
      });
      await this.persistCompletionFramingLedger({
        job: input.job,
        usage: framed.usage
      });
    }

    return {
      text: completionText,
      shouldUpdateExistingMessage:
        input.job.completionAssistantMessageId !== null && completionText !== existingContent
    };
  }

  private async failDelivery(
    job: ClaimedCompletionPendingMediaJob,
    _retryable: boolean,
    code: string,
    message: string,
    locale: "ru" | "en",
    reconcileReservation: boolean,
    context?: { sourceUserMessageText: string; sourceUserMessageCreatedAt: string }
  ): Promise<void> {
    // ADR-105 §5: when the delivery loop never resolved the reservation, the
    // provider cost was incurred but nothing was delivered — mark the full
    // reserved N as reconciliation-required exactly once.
    if (reconcileReservation) {
      await this.reconcileEnqueueReservationBestEffort(job);
    }

    const llmAuthored =
      context === undefined
        ? null
        : await this.tryLlmAuthoredDeliveryFailureCopy(job, code, message, context);
    const failureMessage =
      llmAuthored ??
      buildAssistantMediaJobFailureMessage({
        kind: job.kind,
        code,
        message,
        locale
      });
    const completionAssistantMessageId =
      (await this.ensureFailureMessage(job, failureMessage)) ?? job.completionAssistantMessageId;

    let deliveredAt: Date | null = null;
    if (job.surface === "telegram" && completionAssistantMessageId !== null) {
      const noticeResult =
        await this.telegramAssistantChatOutboundService.deliverPersistedAssistantMessageBestEffort({
          assistantId: job.assistantId,
          chatId: job.chatId,
          workspaceId: job.workspaceId,
          assistantMessageId: completionAssistantMessageId,
          text: failureMessage
        });
      if (noticeResult.status !== "delivered") {
        const canRetryNotice = job.attemptCount < job.maxAttempts;
        const noticeMessage = `Telegram failure notice ${noticeResult.status}: ${noticeResult.reason}`;
        await this.prisma.assistantMediaJob.updateMany({
          where: { id: job.id, schedulerClaimToken: job.claimToken },
          data: {
            status: canRetryNotice ? "completion_pending" : "failed",
            failedAt: canRetryNotice ? null : new Date(),
            nextRetryAt: canRetryNotice
              ? new Date(Date.now() + computeRetryBackoffMs(job.attemptCount))
              : null,
            schedulerClaimToken: null,
            schedulerClaimedAt: null,
            schedulerClaimExpiresAt: null,
            lastErrorCode: code,
            lastErrorMessage: truncateLastError(message),
            completionAssistantMessageId
          }
        });
        this.logger.warn(
          `Telegram terminal media failure notice not delivered jobId=${job.id} attempt=${job.attemptCount}/${job.maxAttempts}: ${noticeMessage}`
        );
        return;
      }
      deliveredAt = new Date();
    }

    await this.prisma.assistantMediaJob.updateMany({
      where: { id: job.id, schedulerClaimToken: job.claimToken },
      data: {
        status: "failed",
        failedAt: new Date(),
        deliveredAt,
        schedulerClaimToken: null,
        schedulerClaimedAt: null,
        schedulerClaimExpiresAt: null,
        lastErrorCode: code,
        lastErrorMessage: truncateLastError(message),
        ...(completionAssistantMessageId === null ? {} : { completionAssistantMessageId })
      }
    });
  }

  /**
   * ADR-105 §5 — mark the job's full enqueue-time monthly media reservation as
   * reconciliation-required exactly once, for terminal failures reached BEFORE
   * the delivery loop ran (provider cost incurred, nothing delivered). Reuses
   * the same `requestJson` extraction style as the scheduler / enqueue seam: N
   * = `count` for image tools, 1 for video. Best-effort: a missing assistant
   * entity is the only path where the reservation cannot be resolved here.
   */
  private async reconcileEnqueueReservationBestEffort(
    job: ClaimedCompletionPendingMediaJob
  ): Promise<void> {
    const reservation = this.extractReservationInfoFromRequestJson(job.requestJson);
    if (reservation === null) {
      this.logger.warn(
        `ADR-105 reconcile skipped: could not resolve toolCode/units from requestJson jobId=${job.id}`
      );
      return;
    }
    const assistant = await this.assistantRepository.findById(job.assistantId);
    if (assistant === null) {
      this.logger.warn(
        `ADR-105 reconcile skipped: assistant missing for jobId=${job.id} toolCode=${reservation.toolCode} units=${String(reservation.units)} (reserved units stranded for workspace reconciliation)`
      );
      return;
    }
    try {
      await this.trackWorkspaceQuotaUsageService.markAssistantMonthlyMediaQuotaReconciliationRequired(
        {
          assistant,
          toolCode: reservation.toolCode,
          units: reservation.units
        }
      );
    } catch (error) {
      this.logger.warn(
        `ADR-105 monthly media quota reconcile failed jobId=${job.id} toolCode=${reservation.toolCode} units=${String(reservation.units)}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * ADR-105 §5 — after the delivery loop resolves the M produced artifacts,
   * release the remainder (N − M) that the provider never produced. Called
   * only after `deliveryState.loopResolved = true` so per-artifact accounting
   * is already complete; this covers only the never-produced units. When M ≥ N
   * (full delivery), `releaseAssistantMonthlyMediaQuota` is a no-op for units≤0.
   * Best-effort: quota service failures are logged and swallowed.
   */
  private async releaseUnproducedRemainderBestEffort(
    job: ClaimedCompletionPendingMediaJob,
    producedArtifactCount: number
  ): Promise<void> {
    const reservation = this.extractReservationInfoFromRequestJson(job.requestJson);
    if (reservation === null) {
      return;
    }
    const remainder = reservation.units - producedArtifactCount;
    if (remainder <= 0) {
      return;
    }
    const assistant = await this.assistantRepository.findById(job.assistantId);
    if (assistant === null) {
      this.logger.warn(
        `ADR-105 remainder-release skipped: assistant missing for jobId=${job.id} toolCode=${reservation.toolCode} remainder=${String(remainder)}`
      );
      return;
    }
    try {
      await this.trackWorkspaceQuotaUsageService.releaseAssistantMonthlyMediaQuota({
        assistant,
        toolCode: reservation.toolCode,
        units: remainder
      });
    } catch (error) {
      this.logger.warn(
        `ADR-105 remainder-release failed jobId=${job.id} toolCode=${reservation.toolCode} remainder=${String(remainder)}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

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
    // monthly media units, so terminal-failure reconciliation and
    // remainder-release best-effort paths skip it entirely.
    return null;
  }

  private async ensureFailureMessage(
    job: ClaimedCompletionPendingMediaJob,
    failureMessage: string
  ): Promise<string | null> {
    if (job.completionAssistantMessageId !== null) {
      try {
        await this.assistantChatRepository.updateMessageContent(
          job.completionAssistantMessageId,
          job.assistantId,
          failureMessage
        );
        return job.completionAssistantMessageId;
      } catch (error) {
        this.logger.warn(
          `Failed to update terminal media-job failure message for ${job.id}: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
        return job.completionAssistantMessageId;
      }
    }

    try {
      const created = await this.assistantChatRepository.createMessage({
        chatId: job.chatId,
        assistantId: job.assistantId,
        author: "assistant",
        content: failureMessage
      });
      return created.id;
    } catch (error) {
      this.logger.warn(
        `Failed to create terminal media-job failure message for ${job.id}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      return null;
    }
  }

  private async ensureCompletionMessage(
    job: ClaimedCompletionPendingMediaJob,
    assistantText: CompletionAssistantTextResolution
  ): Promise<string> {
    if (job.completionAssistantMessageId !== null) {
      return job.completionAssistantMessageId;
    }
    const message = await this.assistantChatRepository.createMessage({
      chatId: job.chatId,
      assistantId: job.assistantId,
      author: "assistant",
      content: assistantText.text
    });
    await this.prisma.assistantMediaJob.updateMany({
      where: { id: job.id, schedulerClaimToken: job.claimToken },
      data: {
        completionAssistantMessageId: message.id
      }
    });
    return message.id;
  }

  private async processTelegramCompletionPendingJob(params: {
    job: ClaimedCompletionPendingMediaJob;
    artifacts: RuntimeOutputArtifact[];
    messageId: string;
    rawAssistantText: string;
    deliveryState: { loopResolved: boolean };
  }): Promise<void> {
    const deliveryContext = await this.resolveTelegramDeliveryContext(params.job);
    const delivered = await this.mediaDeliveryService.deliver({
      artifacts: runtimeOutputArtifactsToMediaArtifacts(params.artifacts),
      channel: "telegram",
      assistantId: params.job.assistantId,
      chatId: params.job.chatId,
      messageId: params.messageId,
      workspaceId: params.job.workspaceId,
      channelTarget: {
        channel: "telegram",
        chatId: deliveryContext.chatId,
        metadata: {
          botToken: deliveryContext.botToken
        }
      }
    });
    // ADR-105 §5: the delivery loop has now resolved all N reserved units
    // per-artifact; any later exception in this method must not reconcile again.
    params.deliveryState.loopResolved = true;
    await this.releaseUnproducedRemainderBestEffort(params.job, params.artifacts.length);
    let finalText = applyFinalDeliveryHonestyCorrection({
      assistantText: params.rawAssistantText,
      attemptedArtifactCount: params.artifacts.length,
      deliveredAttachmentCount: delivered.attachments.length,
      deliveredAttachmentFilenames: delivered.attachments
        .map((attachment) => attachment.originalFilename)
        .filter((filename): filename is string => typeof filename === "string"),
      attemptedArtifactKind: "media",
      locale: deliveryContext.locale
    });
    // ADR-105 FIX B: system-authored structural truth for partial under-delivery.
    const tgReservationN =
      this.extractReservationInfoFromRequestJson(params.job.requestJson)?.units ?? null;
    const tgShortfallLine =
      tgReservationN !== null
        ? buildPartialDeliveryShortfallLine(
            params.artifacts.length,
            tgReservationN,
            deliveryContext.locale
          )
        : null;
    if (tgShortfallLine !== null) {
      finalText = `${finalText}\n\n${tgShortfallLine}`;
    }

    if (params.rawAssistantText !== finalText) {
      await this.assistantChatRepository.updateMessageContent(
        params.messageId,
        params.job.assistantId,
        finalText
      );
    }

    if (delivered.attachments.length === 0) {
      await this.telegramAssistantChatOutboundService.deliverPersistedAssistantMessageBestEffort({
        assistantId: params.job.assistantId,
        chatId: params.job.chatId,
        workspaceId: params.job.workspaceId,
        assistantMessageId: params.messageId,
        text: finalText,
        mediaAlreadyDelivered: false
      });
      await this.finalizeJob(params.job, {
        status: "failed",
        code: "media_delivery_failed",
        message: "Generated media could not be delivered to the Telegram chat."
      });
      return;
    }

    await this.telegramAssistantChatOutboundService.deliverPersistedAssistantMessageBestEffort({
      assistantId: params.job.assistantId,
      chatId: params.job.chatId,
      workspaceId: params.job.workspaceId,
      assistantMessageId: params.messageId,
      text: finalText,
      mediaAlreadyDelivered: true
    });

    await this.finalizeJob(params.job, {
      status: "delivered",
      code: null,
      message: null
    });
  }

  private async resolveTelegramDeliveryContext(job: ClaimedCompletionPendingMediaJob): Promise<{
    chatId: string;
    botToken: string;
    parseMode: string;
    locale: "ru" | "en";
  }> {
    const chat = await this.assistantChatRepository.findChatById(job.chatId);
    if (chat === null || chat.surface !== "telegram") {
      throw new Error("Telegram media job chat is missing or no longer belongs to Telegram.");
    }
    const config = await this.resolveTelegramChannelRuntimeConfigService.resolveByAssistantId(
      job.assistantId
    );
    if (config === null || config.outbound !== true) {
      throw new Error("Telegram outbound delivery is not available for this assistant.");
    }
    return {
      chatId: parseTelegramChatIdFromSurfaceThreadKey(chat.surfaceThreadKey),
      botToken: config.botToken,
      parseMode: config.parseMode,
      locale: config.locale
    };
  }

  private async finalizeJob(
    job: ClaimedCompletionPendingMediaJob,
    input: {
      status: "delivered" | "failed";
      code: string | null;
      message: string | null;
    }
  ): Promise<void> {
    await this.prisma.assistantMediaJob.updateMany({
      where: { id: job.id, schedulerClaimToken: job.claimToken },
      data: {
        status: input.status,
        deliveredAt: input.status === "delivered" ? new Date() : null,
        failedAt: input.status === "failed" ? new Date() : null,
        schedulerClaimToken: null,
        schedulerClaimedAt: null,
        schedulerClaimExpiresAt: null,
        nextRetryAt: null,
        lastErrorCode: input.code,
        lastErrorMessage: input.message === null ? null : truncateLastError(input.message)
      }
    });
  }

  private parseArtifacts(value: unknown): RuntimeOutputArtifact[] | null {
    return Array.isArray(value) ? (value as RuntimeOutputArtifact[]) : null;
  }

  private parseRequestPayload(value: unknown): CompletionRequestPayload | null {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      return null;
    }
    const row = value as Record<string, unknown>;
    if (
      !Array.isArray(row.attachments) ||
      typeof row.sourceUserMessageText !== "string" ||
      typeof row.sourceUserMessageCreatedAt !== "string"
    ) {
      return null;
    }
    return {
      attachments: row.attachments,
      sourceUserMessageText: row.sourceUserMessageText,
      sourceUserMessageCreatedAt: row.sourceUserMessageCreatedAt
    };
  }
}
