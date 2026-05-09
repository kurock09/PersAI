import { Inject, Injectable, Logger } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { type RuntimeOutputArtifact } from "@persai/runtime-contract";
import {
  ASSISTANT_CHAT_REPOSITORY,
  type AssistantChatRepository
} from "../domain/assistant-chat.repository";
import { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";
import { runtimeOutputArtifactsToMediaArtifacts } from "./assistant-runtime.facade";
import { applyFinalDeliveryHonestyCorrection } from "./final-delivery-honesty";
import { MediaDeliveryService } from "./media/media-delivery.service";
import { TelegramBotClientService } from "./telegram-bot.client.service";
import { ResolveTelegramChannelRuntimeConfigService } from "./resolve-telegram-channel-runtime-config.service";
import { AssistantMediaJobCompletionTurnService } from "./assistant-media-job-completion-turn.service";
import {
  buildAssistantMediaJobFailureMessage,
  inferAssistantMediaJobFailureLocale
} from "./assistant-media-job-failure-copy.service";

const COMPLETION_DELIVERY_BATCH_SIZE = 4;
const COMPLETION_DELIVERY_CLAIM_TTL_MS = 5 * 60 * 1000;
const COMPLETION_DELIVERY_RETRY_BASE_DELAY_MS = 30_000;
const COMPLETION_DELIVERY_RETRY_MAX_DELAY_MS = 30 * 60 * 1000;
const COMPLETION_DELIVERY_LAST_ERROR_MAX_CHARS = 1_000;

type ClaimedCompletionPendingMediaJob = {
  id: string;
  assistantId: string;
  workspaceId: string;
  chatId: string;
  surface: "web" | "telegram";
  kind: "image" | "audio" | "video";
  sourceUserMessageId: string;
  requestJson: unknown;
  resultText: string | null;
  artifactsJson: unknown;
  completionAssistantMessageId: string | null;
  attemptCount: number;
  maxAttempts: number;
  claimToken: string;
};

type CompletionRequestPayload = {
  attachments: unknown[];
  sourceUserMessageText: string;
  sourceUserMessageCreatedAt: string;
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
    private readonly telegramBotClientService: TelegramBotClientService,
    private readonly resolveTelegramChannelRuntimeConfigService: ResolveTelegramChannelRuntimeConfigService,
    private readonly assistantMediaJobCompletionTurnService: AssistantMediaJobCompletionTurnService
  ) {}

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
          workspaceId: string;
          chatId: string;
          surface: "web" | "telegram";
          kind: "image" | "audio" | "video";
          sourceUserMessageId: string;
          requestJson: unknown;
          resultText: string | null;
          artifactsJson: unknown;
          completionAssistantMessageId: string | null;
          attemptCount: number;
          maxAttempts: number;
        }>
      >(Prisma.sql`
        SELECT
          "id",
          "assistant_id" AS "assistantId",
          "workspace_id" AS "workspaceId",
          "chat_id" AS "chatId",
          "surface"::text AS "surface",
          "kind"::text AS "kind",
          "source_user_message_id" AS "sourceUserMessageId",
          "request_json" AS "requestJson",
          "result_text" AS "resultText",
          "artifacts_json" AS "artifactsJson",
          "completion_assistant_message_id" AS "completionAssistantMessageId",
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
        const claimToken = `${row.id}:${Date.now()}`;
        await tx.assistantMediaJob.update({
          where: { id: row.id },
          data: {
            schedulerClaimToken: claimToken,
            schedulerClaimedAt: now,
            schedulerClaimExpiresAt: claimExpiresAt
          }
        });
        claimed.push({
          ...row,
          claimToken
        });
      }
      return claimed;
    });
  }

  private async processClaimedCompletionPendingJob(
    job: ClaimedCompletionPendingMediaJob
  ): Promise<void> {
    const artifacts = this.parseArtifacts(job.artifactsJson);
    if (artifacts === null || artifacts.length === 0) {
      await this.failDelivery(
        job,
        false,
        "completion_artifacts_missing",
        "Media job has no artifacts to deliver.",
        "en"
      );
      return;
    }

    const requestPayload = this.parseRequestPayload(job.requestJson);
    if (requestPayload === null) {
      await this.failDelivery(
        job,
        false,
        "completion_request_missing",
        "Media job completion request payload is invalid.",
        "en"
      );
      return;
    }

    const failureLocale = inferAssistantMediaJobFailureLocale({
      sourceText: requestPayload.sourceUserMessageText
    });

    const rawAssistantText = job.resultText?.trim() ?? "";

    try {
      const completionAssistantText =
        (await this.assistantMediaJobCompletionTurnService.maybeFrame({
          id: job.id,
          assistantId: job.assistantId,
          workspaceId: job.workspaceId,
          chatId: job.chatId,
          surface: job.surface,
          kind: job.kind,
          sourceUserMessageId: job.sourceUserMessageId,
          sourceUserMessageText: requestPayload.sourceUserMessageText,
          sourceUserMessageCreatedAt: requestPayload.sourceUserMessageCreatedAt,
          resultText: rawAssistantText,
          artifacts
        })) ?? rawAssistantText;
      const messageId = await this.ensureCompletionMessage(job, completionAssistantText);
      if (completionAssistantText !== rawAssistantText) {
        await this.assistantChatRepository.updateMessageContent(
          messageId,
          job.assistantId,
          completionAssistantText
        );
      }

      if (job.surface === "telegram") {
        await this.processTelegramCompletionPendingJob({
          job,
          artifacts,
          messageId,
          rawAssistantText: completionAssistantText
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
      const finalText = applyFinalDeliveryHonestyCorrection({
        assistantText: completionAssistantText,
        attemptedArtifactCount: artifacts.length,
        deliveredAttachmentCount: delivered.attachments.length,
        deliveredAttachmentFilenames: delivered.attachments
          .map((attachment) => attachment.originalFilename)
          .filter((filename): filename is string => typeof filename === "string")
      });

      if (completionAssistantText !== finalText) {
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
        await this.failDelivery(job, false, "media_delivery_failed", message, failureLocale);
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

  private async failDelivery(
    job: ClaimedCompletionPendingMediaJob,
    _retryable: boolean,
    code: string,
    message: string,
    locale: "ru" | "en"
  ): Promise<void> {
    const failureMessage = buildAssistantMediaJobFailureMessage({
      kind: job.kind,
      code,
      message,
      locale
    });
    const completionAssistantMessageId =
      (await this.ensureFailureMessage(job, failureMessage)) ?? job.completionAssistantMessageId;

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
    assistantText: string
  ): Promise<string> {
    if (job.completionAssistantMessageId !== null) {
      return job.completionAssistantMessageId;
    }
    const message = await this.assistantChatRepository.createMessage({
      chatId: job.chatId,
      assistantId: job.assistantId,
      author: "assistant",
      content: assistantText
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
    const finalText = applyFinalDeliveryHonestyCorrection({
      assistantText: params.rawAssistantText,
      attemptedArtifactCount: params.artifacts.length,
      deliveredAttachmentCount: delivered.attachments.length,
      deliveredAttachmentFilenames: delivered.attachments
        .map((attachment) => attachment.originalFilename)
        .filter((filename): filename is string => typeof filename === "string"),
      locale: deliveryContext.locale
    });

    if (params.rawAssistantText !== finalText) {
      await this.assistantChatRepository.updateMessageContent(
        params.messageId,
        params.job.assistantId,
        finalText
      );
    }

    if (delivered.attachments.length === 0) {
      await this.telegramBotClientService.sendAssistantTurnReply({
        botToken: deliveryContext.botToken,
        chatId: deliveryContext.chatId,
        assistantId: params.job.assistantId,
        parseMode: deliveryContext.parseMode,
        turnResult: {
          assistantMessage: finalText,
          respondedAt: new Date().toISOString(),
          media: [],
          assistantMessageId: params.messageId,
          chatId: params.job.chatId,
          workspaceId: params.job.workspaceId
        },
        mediaAlreadyDelivered: false
      });
      await this.finalizeJob(params.job, {
        status: "failed",
        code: "media_delivery_failed",
        message: "Generated media could not be delivered to the Telegram chat."
      });
      return;
    }

    try {
      await this.telegramBotClientService.sendAssistantTurnReply({
        botToken: deliveryContext.botToken,
        chatId: deliveryContext.chatId,
        assistantId: params.job.assistantId,
        parseMode: deliveryContext.parseMode,
        turnResult: {
          assistantMessage: finalText,
          respondedAt: new Date().toISOString(),
          media: [],
          assistantMessageId: params.messageId,
          chatId: params.job.chatId,
          workspaceId: params.job.workspaceId
        },
        mediaAlreadyDelivered: true
      });
    } catch (error) {
      this.logger.warn(
        `Telegram completion follow-up text failed for media job ${params.job.id}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }

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
      chatId: chat.surfaceThreadKey,
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
