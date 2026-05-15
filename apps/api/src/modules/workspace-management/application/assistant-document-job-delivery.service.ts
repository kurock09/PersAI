import { Inject, Injectable, Logger } from "@nestjs/common";
import type { RuntimeOutputArtifact } from "@persai/runtime-contract";
import {
  ASSISTANT_CHAT_MESSAGE_ATTACHMENT_REPOSITORY,
  type AssistantChatMessageAttachmentRepository
} from "../domain/assistant-chat-message-attachment.repository";
import {
  ASSISTANT_CHAT_REPOSITORY,
  type AssistantChatRepository
} from "../domain/assistant-chat.repository";
import { ASSISTANT_REPOSITORY, type AssistantRepository } from "../domain/assistant.repository";
import { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";
import { runtimeOutputArtifactsToMediaArtifacts } from "./assistant-runtime.facade";
import { MediaDeliveryService } from "./media/media-delivery.service";
import { ResolveTelegramChannelRuntimeConfigService } from "./resolve-telegram-channel-runtime-config.service";
import { LEASE_HEARTBEAT_INTERVAL_MS } from "./scheduler-lease.constants";
import { TrackWorkspaceQuotaUsageService } from "./track-workspace-quota-usage.service";

const DOCUMENT_DELIVERY_LAST_ERROR_MAX_CHARS = 1_000;
const DOCUMENT_JOB_CLAIM_TTL_MS = 10 * 60 * 1000;
const DOCUMENT_DELIVERY_RECOVERY_RETRY_DELAY_MS = 30_000;

type ClaimedReadyDocumentJob = {
  id: string;
  docId: string;
  versionId: string;
  assistantId: string;
  workspaceId: string;
  chatId: string;
  surface: "web" | "telegram";
  schedulerClaimToken: string;
  providerStatusJson: unknown;
};

type PersistedDeliveryPayload = {
  artifacts: RuntimeOutputArtifact[];
  assistantText: string | null;
  externalDeliveryCommitted?: boolean;
  quotaConsumed?: boolean;
  quotaSettlementPending?: boolean;
  completionAssistantMessageId?: string | null;
};

type CanonicalDeliveredAttachment = {
  fileRef: string;
  mimeType: string;
};

@Injectable()
export class AssistantDocumentJobDeliveryService {
  private readonly logger = new Logger(AssistantDocumentJobDeliveryService.name);

  constructor(
    private readonly prisma: WorkspaceManagementPrismaService,
    @Inject(ASSISTANT_CHAT_MESSAGE_ATTACHMENT_REPOSITORY)
    private readonly attachmentRepository: AssistantChatMessageAttachmentRepository,
    @Inject(ASSISTANT_CHAT_REPOSITORY)
    private readonly assistantChatRepository: AssistantChatRepository,
    @Inject(ASSISTANT_REPOSITORY)
    private readonly assistantRepository: AssistantRepository,
    private readonly mediaDeliveryService: MediaDeliveryService,
    private readonly resolveTelegramChannelRuntimeConfigService: ResolveTelegramChannelRuntimeConfigService,
    private readonly trackWorkspaceQuotaUsageService: TrackWorkspaceQuotaUsageService
  ) {}

  async deliverReadyJob(job: ClaimedReadyDocumentJob): Promise<void> {
    const heartbeat = setInterval(() => {
      void this.prisma.assistantDocumentRenderJob.updateMany({
        where: {
          id: job.id,
          schedulerClaimToken: job.schedulerClaimToken,
          status: "ready_for_delivery"
        },
        data: {
          schedulerClaimExpiresAt: new Date(Date.now() + DOCUMENT_JOB_CLAIM_TTL_MS)
        }
      });
    }, LEASE_HEARTBEAT_INTERVAL_MS);
    heartbeat.unref?.();

    let currentPayload: PersistedDeliveryPayload | null = null;
    try {
      currentPayload = this.parsePersistedPayload(job.providerStatusJson);
      if (currentPayload === null || currentPayload.artifacts.length === 0) {
        await this.failJob(
          job,
          "document_delivery_payload_missing",
          "Document delivery payload is missing."
        );
        return;
      }

      let completionAssistantMessageId = currentPayload.completionAssistantMessageId ?? null;
      if (
        currentPayload.externalDeliveryCommitted !== true &&
        completionAssistantMessageId === null
      ) {
        const completionMessage = await this.assistantChatRepository.createMessage({
          chatId: job.chatId,
          assistantId: job.assistantId,
          author: "assistant",
          content: "Preparing your document..."
        });
        completionAssistantMessageId = completionMessage.id;
        const remembered = await this.rememberCompletionMessage(
          job,
          currentPayload,
          completionAssistantMessageId
        );
        if (!remembered) {
          await this.assistantChatRepository
            .deleteMessage(completionAssistantMessageId, job.assistantId)
            .catch(() => {});
          return;
        }
        currentPayload = {
          ...currentPayload,
          completionAssistantMessageId
        };
      }

      const deliveredAttachments = await this.ensureDeliveredAttachments({
        job,
        payload: currentPayload,
        completionAssistantMessageId
      });
      if (deliveredAttachments === null || completionAssistantMessageId === null) {
        return;
      }

      const persistedPayload = {
        ...currentPayload,
        externalDeliveryCommitted: true,
        completionAssistantMessageId
      } satisfies PersistedDeliveryPayload;
      const recorded = await this.recordDeliveredFiles({
        job,
        payload: persistedPayload,
        completionAssistantMessageId,
        attachments: deliveredAttachments
      });
      if (!recorded) {
        return;
      }

      let finalPayload = persistedPayload;
      if (finalPayload.quotaConsumed !== true) {
        if (finalPayload.quotaSettlementPending === true) {
          await this.deferRetry(
            job,
            finalPayload,
            "document_quota_settlement_ambiguous",
            "Document output is delivered, but quota settlement is in an ambiguous recovery state after a prior crash or retry."
          );
          return;
        }
        const assistant = await this.assistantRepository.findById(job.assistantId);
        if (assistant === null) {
          await this.deferRetry(
            job,
            finalPayload,
            "document_delivery_recovery_pending",
            "Document output was delivered, but assistant quota context could not be resolved."
          );
          return;
        }
        try {
          finalPayload = {
            ...finalPayload,
            quotaSettlementPending: true
          };
          const markedPending = await this.markQuotaSettlementPending(job, finalPayload);
          if (!markedPending) {
            return;
          }
          await this.trackWorkspaceQuotaUsageService.consumeAssistantMonthlyToolQuotaSuccessOnly({
            assistant,
            toolCode: "document",
            units: 1
          });
        } catch (error) {
          await this.deferRetry(
            job,
            finalPayload,
            "document_quota_settlement_pending",
            error instanceof Error
              ? error.message
              : "Document quota settlement is temporarily unavailable."
          );
          return;
        }
        finalPayload = {
          ...finalPayload,
          quotaConsumed: true,
          quotaSettlementPending: false
        };
      }

      const finalized = await this.finalizeDelivery(job, finalPayload);
      if (!finalized) {
        return;
      }

      await this.assistantChatRepository
        .updateMessageContent(
          completionAssistantMessageId,
          job.assistantId,
          finalPayload.assistantText?.trim() || "Your document is ready."
        )
        .catch((error) => {
          this.logger.warn(
            `Document delivery finalized for ${job.id}, but success text update failed: ${
              error instanceof Error ? error.message : String(error)
            }`
          );
        });
    } catch (error) {
      if (currentPayload?.externalDeliveryCommitted === true) {
        await this.deferRetry(
          job,
          currentPayload,
          "document_delivery_recovery_pending",
          error instanceof Error ? error.message : "Document delivery recovery failed."
        );
      } else if (typeof currentPayload?.completionAssistantMessageId === "string") {
        await this.assistantChatRepository
          .deleteMessage(currentPayload.completionAssistantMessageId, job.assistantId)
          .catch(() => {});
        await this.failJob(
          job,
          "document_delivery_failed",
          error instanceof Error ? error.message : "Document delivery failed."
        );
      } else {
        await this.failJob(
          job,
          "document_delivery_failed",
          error instanceof Error ? error.message : "Document delivery failed."
        );
      }
    } finally {
      clearInterval(heartbeat);
    }
  }

  private async resolveTelegramChannelTarget(assistantId: string, chatId: string) {
    const config =
      await this.resolveTelegramChannelRuntimeConfigService.resolveByAssistantId(assistantId);
    if (config === null || config.outbound !== true) {
      throw new Error("Telegram outbound delivery is not available for this assistant.");
    }
    const chat = await this.assistantChatRepository.findChatById(chatId);
    if (chat === null) {
      throw new Error("Telegram document job chat is missing.");
    }
    const match = chat.surfaceThreadKey.match(/^telegram:(.+):session:[^:]+$/);
    return {
      channel: "telegram" as const,
      chatId: match?.[1]?.trim() || chat.surfaceThreadKey,
      metadata: {
        botToken: config.botToken
      }
    };
  }

  private parsePersistedPayload(value: unknown): PersistedDeliveryPayload | null {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      return null;
    }
    const row = value as Record<string, unknown>;
    if (!Array.isArray(row.artifacts)) {
      return null;
    }
    return {
      artifacts: row.artifacts as RuntimeOutputArtifact[],
      assistantText: typeof row.assistantText === "string" ? row.assistantText : null,
      externalDeliveryCommitted: row.externalDeliveryCommitted === true,
      quotaConsumed: row.quotaConsumed === true,
      quotaSettlementPending: row.quotaSettlementPending === true,
      completionAssistantMessageId:
        typeof row.completionAssistantMessageId === "string"
          ? row.completionAssistantMessageId
          : null
    };
  }

  private async rememberCompletionMessage(
    job: ClaimedReadyDocumentJob,
    payload: PersistedDeliveryPayload,
    completionAssistantMessageId: string
  ): Promise<boolean> {
    const result = await this.prisma.assistantDocumentRenderJob.updateMany({
      where: {
        id: job.id,
        schedulerClaimToken: job.schedulerClaimToken,
        status: "ready_for_delivery"
      },
      data: {
        providerStatusJson: {
          ...payload,
          completionAssistantMessageId
        } as never
      }
    });
    return result.count > 0;
  }

  private async ensureDeliveredAttachments(input: {
    job: ClaimedReadyDocumentJob;
    payload: PersistedDeliveryPayload;
    completionAssistantMessageId: string | null;
  }): Promise<CanonicalDeliveredAttachment[] | null> {
    const { job, payload, completionAssistantMessageId } = input;
    if (completionAssistantMessageId === null) {
      await this.failJob(
        job,
        "document_delivery_failed",
        "Document completion message is missing."
      );
      return null;
    }

    const recovered = await this.listCanonicalDeliveredAttachments(completionAssistantMessageId);
    if (recovered.length > 0) {
      if (recovered.length !== payload.artifacts.length) {
        await this.deferRetry(
          job,
          {
            ...payload,
            completionAssistantMessageId,
            externalDeliveryCommitted: true
          },
          "document_delivery_partial_recovery_pending",
          `Document delivery recovered ${recovered.length} of ${payload.artifacts.length} expected artifact(s).`
        );
        return null;
      }
      return recovered;
    }

    if (payload.externalDeliveryCommitted === true) {
      if (recovered.length === 0) {
        await this.deferRetry(
          job,
          payload,
          "document_delivery_recovery_pending",
          "Document output was delivered, but canonical chat attachments are not readable yet."
        );
        return null;
      }
      return recovered;
    }

    const channelTarget =
      job.surface === "telegram"
        ? await this.resolveTelegramChannelTarget(job.assistantId, job.chatId)
        : undefined;
    const delivered = await this.mediaDeliveryService.deliver({
      artifacts: runtimeOutputArtifactsToMediaArtifacts(payload.artifacts),
      channel: job.surface === "telegram" ? "telegram" : "web",
      assistantId: job.assistantId,
      chatId: job.chatId,
      messageId: completionAssistantMessageId,
      workspaceId: job.workspaceId,
      ...(channelTarget ? { channelTarget } : {})
    });
    const normalized = delivered.attachments
      .filter(
        (attachment) =>
          typeof attachment.fileRef === "string" && attachment.fileRef.trim().length > 0
      )
      .map((attachment) => ({
        fileRef: attachment.fileRef as string,
        mimeType: attachment.mimeType
      }));
    if (normalized.length === 0) {
      await this.assistantChatRepository
        .deleteMessage(completionAssistantMessageId, job.assistantId)
        .catch(() => {});
      await this.failJob(
        job,
        "document_delivery_failed",
        "Generated document could not be delivered to the chat."
      );
      return null;
    }
    if (normalized.length !== payload.artifacts.length) {
      await this.deferRetry(
        job,
        {
          ...payload,
          completionAssistantMessageId,
          externalDeliveryCommitted: true
        },
        "document_delivery_partial_recovery_pending",
        `Document delivery produced ${normalized.length} of ${payload.artifacts.length} expected artifact(s).`
      );
      return null;
    }
    return normalized;
  }

  private async listCanonicalDeliveredAttachments(
    completionAssistantMessageId: string
  ): Promise<CanonicalDeliveredAttachment[]> {
    const attachments = await this.attachmentRepository.listByMessageId(
      completionAssistantMessageId
    );
    return attachments
      .filter(
        (attachment) =>
          typeof attachment.assistantFileId === "string" &&
          attachment.assistantFileId.trim().length > 0
      )
      .map((attachment) => ({
        fileRef: attachment.assistantFileId as string,
        mimeType: attachment.mimeType
      }));
  }

  private async recordDeliveredFiles(input: {
    job: ClaimedReadyDocumentJob;
    payload: PersistedDeliveryPayload;
    completionAssistantMessageId: string;
    attachments: CanonicalDeliveredAttachment[];
  }): Promise<boolean> {
    const deliveredAt = new Date();
    return this.prisma.$transaction(async (tx) => {
      const claimed = await tx.assistantDocumentRenderJob.updateMany({
        where: {
          id: input.job.id,
          schedulerClaimToken: input.job.schedulerClaimToken,
          status: "ready_for_delivery"
        },
        data: {
          providerStatusJson: input.payload as never,
          lastErrorCode: null,
          lastErrorMessage: null
        }
      });
      if (claimed.count === 0) {
        return false;
      }

      await tx.assistantDocumentDeliveredFile.updateMany({
        where: {
          docId: input.job.docId,
          versionId: input.job.versionId,
          isCurrentOutput: true,
          renderJobId: { not: input.job.id }
        },
        data: {
          isCurrentOutput: false
        }
      });

      const existing = await tx.assistantDocumentDeliveredFile.findMany({
        where: {
          renderJobId: input.job.id
        },
        select: {
          id: true,
          assistantFileId: true
        }
      });
      const existingByFileRef = new Map(existing.map((row) => [row.assistantFileId, row.id]));
      for (const attachment of input.attachments) {
        const existingRowId = existingByFileRef.get(attachment.fileRef);
        if (existingRowId !== undefined) {
          await tx.assistantDocumentDeliveredFile.update({
            where: { id: existingRowId },
            data: {
              outputMimeType: attachment.mimeType,
              completionAssistantMessageId: input.completionAssistantMessageId,
              deliveredAt,
              isCurrentOutput: true
            }
          });
          continue;
        }
        await tx.assistantDocumentDeliveredFile.create({
          data: {
            docId: input.job.docId,
            versionId: input.job.versionId,
            renderJobId: input.job.id,
            workspaceId: input.job.workspaceId,
            assistantFileId: attachment.fileRef,
            outputMimeType: attachment.mimeType,
            completionAssistantMessageId: input.completionAssistantMessageId,
            deliveredAt,
            isCurrentOutput: true
          }
        });
      }
      return true;
    });
  }

  private async markQuotaSettlementPending(
    job: ClaimedReadyDocumentJob,
    payload: PersistedDeliveryPayload
  ): Promise<boolean> {
    const result = await this.prisma.assistantDocumentRenderJob.updateMany({
      where: {
        id: job.id,
        schedulerClaimToken: job.schedulerClaimToken,
        status: "ready_for_delivery"
      },
      data: {
        providerStatusJson: payload as never,
        lastErrorCode: null,
        lastErrorMessage: null
      }
    });
    return result.count > 0;
  }

  private async finalizeDelivery(
    job: ClaimedReadyDocumentJob,
    payload: PersistedDeliveryPayload
  ): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const claimed = await tx.assistantDocumentRenderJob.updateMany({
        where: {
          id: job.id,
          schedulerClaimToken: job.schedulerClaimToken,
          status: "ready_for_delivery"
        },
        data: {
          status: "delivered",
          deliveredAt: new Date(),
          completedAt: new Date(),
          schedulerClaimToken: null,
          schedulerClaimedAt: null,
          schedulerClaimExpiresAt: null,
          nextRetryAt: null,
          providerStatusJson: payload as never,
          lastErrorCode: null,
          lastErrorMessage: null
        }
      });
      if (claimed.count === 0) {
        return false;
      }

      await tx.assistantDocumentVersion.update({
        where: { id: job.versionId },
        data: {
          status: "ready"
        }
      });
      const currentVersion = await tx.assistantDocument.findUnique({
        where: { id: job.docId },
        select: { currentVersionId: true }
      });
      const previousVersionId =
        currentVersion !== null &&
        currentVersion.currentVersionId !== null &&
        currentVersion.currentVersionId !== job.versionId
          ? currentVersion.currentVersionId
          : null;
      if (previousVersionId !== null) {
        await tx.assistantDocumentVersion.updateMany({
          where: {
            id: previousVersionId,
            status: "ready"
          },
          data: {
            status: "superseded"
          }
        });
        await tx.assistantDocumentDeliveredFile.updateMany({
          where: {
            docId: job.docId,
            versionId: previousVersionId,
            isCurrentOutput: true
          },
          data: {
            isCurrentOutput: false
          }
        });
      }
      await tx.assistantDocument.update({
        where: { id: job.docId },
        data: {
          currentVersionId: job.versionId,
          status: "ready"
        }
      });
      return true;
    });
  }

  private async deferRetry(
    job: ClaimedReadyDocumentJob,
    payload: PersistedDeliveryPayload,
    code: string,
    message: string
  ): Promise<void> {
    await this.prisma.assistantDocumentRenderJob.updateMany({
      where: {
        id: job.id,
        schedulerClaimToken: job.schedulerClaimToken,
        status: "ready_for_delivery"
      },
      data: {
        nextRetryAt: new Date(Date.now() + DOCUMENT_DELIVERY_RECOVERY_RETRY_DELAY_MS),
        schedulerClaimToken: null,
        schedulerClaimedAt: null,
        schedulerClaimExpiresAt: null,
        lastErrorCode: code,
        lastErrorMessage: this.truncateLastError(message),
        providerStatusJson: payload as never
      }
    });
  }

  private async failJob(
    job: ClaimedReadyDocumentJob,
    code: string,
    message: string
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.assistantDocumentRenderJob.updateMany({
        where: {
          id: job.id,
          schedulerClaimToken: job.schedulerClaimToken,
          status: "ready_for_delivery"
        },
        data: {
          status: "failed",
          failedAt: new Date(),
          schedulerClaimToken: null,
          schedulerClaimedAt: null,
          schedulerClaimExpiresAt: null,
          nextRetryAt: null,
          lastErrorCode: code,
          lastErrorMessage: this.truncateLastError(message)
        }
      });
      if (claimed.count === 0) {
        return;
      }
      await tx.assistantDocumentVersion.update({
        where: { id: job.versionId },
        data: {
          status: "failed"
        }
      });
      const currentVersion = await tx.assistantDocument.findUnique({
        where: { id: job.docId },
        select: { currentVersionId: true }
      });
      await tx.assistantDocument.update({
        where: { id: job.docId },
        data: {
          status: currentVersion?.currentVersionId === job.versionId ? "failed" : "ready"
        }
      });
    });
    this.logger.warn(`Document delivery failed for ${job.id}: ${message}`);
  }

  private truncateLastError(message: string): string {
    if (message.length <= DOCUMENT_DELIVERY_LAST_ERROR_MAX_CHARS) {
      return message;
    }
    return `${message.slice(0, DOCUMENT_DELIVERY_LAST_ERROR_MAX_CHARS - 3)}...`;
  }
}
