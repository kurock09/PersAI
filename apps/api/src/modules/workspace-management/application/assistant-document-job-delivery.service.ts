import { Inject, Injectable, Logger } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { RuntimeOutputArtifact, RuntimeUsageSnapshot } from "@persai/runtime-contract";
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
import { applyFinalDeliveryHonestyCorrection } from "./final-delivery-honesty";
import { MediaDeliveryService } from "./media/media-delivery.service";
import { ResolveTelegramChannelRuntimeConfigService } from "./resolve-telegram-channel-runtime-config.service";
import { LEASE_HEARTBEAT_INTERVAL_MS } from "./scheduler-lease.constants";
import { TrackWorkspaceQuotaUsageService } from "./track-workspace-quota-usage.service";
import { AssistantDocumentJobCompletionTurnService } from "./assistant-document-job-completion-turn.service";
import { RecordModelCostLedgerService } from "./record-model-cost-ledger.service";
import {
  buildAssistantDocumentJobFailureMessage,
  buildAssistantDocumentJobSuccessFallbackMessage,
  inferAssistantDocumentJobLocale
} from "./assistant-document-job-failure-copy.service";

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
  descriptorMode?:
    | "create_pdf_document"
    | "create_presentation"
    | "revise_document"
    | "export_or_redeliver";
  outputFormat?: "pdf" | "pptx";
  sourceUserMessageId?: string;
  sourceUserMessageText?: string;
  sourceUserMessageCreatedAt?: string;
  artifacts: RuntimeOutputArtifact[];
  assistantText: string | null;
  externalDeliveryCommitted?: boolean;
  quotaConsumed?: boolean;
  quotaSettlementPending?: boolean;
  completionAssistantMessageId?: string | null;
  // Cached LLM-framed completion text. Persisted in the providerStatusJson
  // payload after the first successful framing call so that subsequent
  // deliverReadyJob runs (driven by deferRetry retries) do not re-spend
  // provider tokens generating the same user-visible completion message.
  // Without this cache, every deferred-then-replayed delivery (partial
  // attachment recovery, quota settlement defer, recovery_pending defer)
  // produces an additional OpenAI call with the same input and the same
  // output, which is wasted spend and shows up in provider logs as duplicate
  // "completion framing" requests for a single document job.
  completionAssistantText?: string | null;
  providerStatus?: Record<string, unknown> | null;
};

type TerminalExecutionFailureInput = {
  job: {
    id: string;
    docId: string;
    versionId: string;
    assistantId: string;
    workspaceId: string;
    chatId: string;
    surface: "web" | "telegram";
    outputFormat: "pdf" | "pptx";
    sourceUserMessageId: string;
    attemptCount: number;
    maxAttempts: number;
  };
  descriptorMode:
    | "create_pdf_document"
    | "create_presentation"
    | "revise_document"
    | "export_or_redeliver";
  sourceUserMessageText: string;
  sourceUserMessageCreatedAt: string;
  failure: {
    code: string;
    message: string;
    retryable: boolean;
  };
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
    private readonly trackWorkspaceQuotaUsageService: TrackWorkspaceQuotaUsageService,
    private readonly assistantDocumentJobCompletionTurnService: AssistantDocumentJobCompletionTurnService,
    private readonly recordModelCostLedgerService: RecordModelCostLedgerService
  ) {}

  private async persistDocumentRenderBillingFacts(input: {
    job: Pick<ClaimedReadyDocumentJob, "id" | "assistantId" | "workspaceId" | "surface">;
    artifacts: RuntimeOutputArtifact[];
  }): Promise<void> {
    const billingFacts =
      input.artifacts.find((artifact) => artifact.billingFacts)?.billingFacts ?? null;
    if (billingFacts === null) {
      return;
    }
    const assistant = await this.assistantRepository.findById(input.job.assistantId);
    if (assistant === null) {
      return;
    }
    try {
      await this.recordModelCostLedgerService.recordPersistedBillingFactsEvent({
        workspaceId: input.job.workspaceId,
        assistantId: input.job.assistantId,
        userId: assistant.userId,
        surface: input.job.surface,
        source: "document_job_completion",
        sourceEventId: `document_job:${input.job.id}`,
        billingFacts
      });
    } catch (error) {
      this.logger.warn(
        `document_job_render_ledger_append_failed jobId=${input.job.id} message=${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  private async persistDocumentCompletionFramingLedger(input: {
    job: Pick<ClaimedReadyDocumentJob, "id" | "assistantId" | "workspaceId" | "surface">;
    userId: string;
    usage: RuntimeUsageSnapshot | null;
  }): Promise<void> {
    if (input.usage === null) {
      return;
    }
    try {
      await this.recordModelCostLedgerService.recordCompletionFramingUsageEvent({
        workspaceId: input.job.workspaceId,
        assistantId: input.job.assistantId,
        userId: input.userId,
        surface: input.job.surface,
        occurredAt: new Date().toISOString(),
        sourceEventId: `document_render_job:${input.job.id}:completion_framing`,
        source: "document_job_completion_framing",
        usage: input.usage
      });
    } catch (error) {
      this.logger.warn(
        `document_job_completion_framing_ledger_append_failed jobId=${input.job.id} message=${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  async createTerminalExecutionFailureMessage(
    input: TerminalExecutionFailureInput
  ): Promise<string | null> {
    const locale = inferAssistantDocumentJobLocale({
      preferredLocale: null,
      sourceText: input.sourceUserMessageText
    });
    const llmAuthored = await this.tryLlmAuthoredExecutionFailureCopy(input);
    const failureMessage =
      llmAuthored ??
      buildAssistantDocumentJobFailureMessage({
        code: input.failure.code,
        message: input.failure.message,
        locale
      });

    try {
      const created = await this.assistantChatRepository.createMessage({
        chatId: input.job.chatId,
        assistantId: input.job.assistantId,
        author: "assistant",
        content: failureMessage
      });
      return created.id;
    } catch (error) {
      this.logger.warn(
        `Failed to create terminal document execution-failure message for ${input.job.id}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      return null;
    }
  }

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

      await this.persistDocumentRenderBillingFacts({
        job,
        artifacts: currentPayload.artifacts
      });

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

      const framingOutcome = await this.resolveCompletionAssistantText({
        job,
        payload: currentPayload
      });
      const completionAssistantText = framingOutcome.text;
      currentPayload = framingOutcome.payload;
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

      const finalAssistantText = completionAssistantText.trim();
      const finalLocale = inferAssistantDocumentJobLocale({
        preferredLocale: null,
        sourceText: this.readSourceUserMessageText(finalPayload)
      });
      const finalText = applyFinalDeliveryHonestyCorrection({
        assistantText:
          finalAssistantText.length > 0
            ? finalAssistantText
            : buildAssistantDocumentJobSuccessFallbackMessage(finalLocale),
        attemptedArtifactCount: finalPayload.artifacts.length,
        deliveredAttachmentCount: deliveredAttachments.length,
        deliveredAttachmentFilenames: []
      });
      await this.assistantChatRepository
        .updateMessageContent(completionAssistantMessageId, job.assistantId, finalText)
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
      } else {
        const completionAssistantMessageId =
          typeof currentPayload?.completionAssistantMessageId === "string"
            ? currentPayload.completionAssistantMessageId
            : null;
        await this.failDelivery(
          job,
          "document_delivery_failed",
          error instanceof Error ? error.message : "Document delivery failed.",
          currentPayload,
          completionAssistantMessageId
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
    const payload: PersistedDeliveryPayload = {
      artifacts: row.artifacts as RuntimeOutputArtifact[],
      assistantText: typeof row.assistantText === "string" ? row.assistantText : null,
      externalDeliveryCommitted: row.externalDeliveryCommitted === true,
      quotaConsumed: row.quotaConsumed === true,
      quotaSettlementPending: row.quotaSettlementPending === true,
      completionAssistantMessageId:
        typeof row.completionAssistantMessageId === "string"
          ? row.completionAssistantMessageId
          : null,
      completionAssistantText:
        typeof row.completionAssistantText === "string" ? row.completionAssistantText : null
    };
    if (
      row.providerStatus !== null &&
      typeof row.providerStatus === "object" &&
      !Array.isArray(row.providerStatus)
    ) {
      payload.providerStatus = row.providerStatus as Record<string, unknown>;
    }
    if (
      row.descriptorMode === "create_pdf_document" ||
      row.descriptorMode === "create_presentation" ||
      row.descriptorMode === "revise_document" ||
      row.descriptorMode === "export_or_redeliver"
    ) {
      payload.descriptorMode = row.descriptorMode;
    }
    if (row.outputFormat === "pdf" || row.outputFormat === "pptx") {
      payload.outputFormat = row.outputFormat;
    }
    if (typeof row.sourceUserMessageId === "string") {
      payload.sourceUserMessageId = row.sourceUserMessageId;
    }
    if (typeof row.sourceUserMessageText === "string") {
      payload.sourceUserMessageText = row.sourceUserMessageText;
    }
    if (typeof row.sourceUserMessageCreatedAt === "string") {
      payload.sourceUserMessageCreatedAt = row.sourceUserMessageCreatedAt;
    }
    return payload;
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
      await this.failDelivery(
        job,
        "document_delivery_failed",
        "Generated document could not be delivered to the chat.",
        payload,
        completionAssistantMessageId
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

  private async resolveCompletionAssistantText(input: {
    job: ClaimedReadyDocumentJob;
    payload: PersistedDeliveryPayload;
  }): Promise<{ text: string; payload: PersistedDeliveryPayload }> {
    const rawAssistantText = input.payload.assistantText?.trim() ?? "";
    const cached =
      typeof input.payload.completionAssistantText === "string"
        ? input.payload.completionAssistantText.trim()
        : "";
    if (cached.length > 0) {
      this.logger.log(
        `[document-delivery-framing-cached] jobId=${input.job.id} reusing cached framed completion text (length=${String(cached.length)}) — skipping provider framing call.`
      );
      return { text: cached, payload: input.payload };
    }
    const completionService = this.assistantDocumentJobCompletionTurnService as
      | AssistantDocumentJobCompletionTurnService
      | undefined;
    const framedResult = await completionService?.maybeFrame({
      id: input.job.id,
      docId: input.job.docId,
      versionId: input.job.versionId,
      assistantId: input.job.assistantId,
      workspaceId: input.job.workspaceId,
      chatId: input.job.chatId,
      surface: input.job.surface,
      outputFormat: this.readOutputFormat(input.payload),
      descriptorMode: this.readDescriptorMode(input.payload),
      sourceUserMessageId: this.readSourceUserMessageId(input.payload),
      sourceUserMessageText: this.readSourceUserMessageText(input.payload),
      sourceUserMessageCreatedAt: this.readSourceUserMessageCreatedAt(input.payload),
      resultText: rawAssistantText,
      artifacts: input.payload.artifacts
    });
    const framedText = framedResult?.text?.trim() ?? "";
    if (framedResult?.usage) {
      const assistant = await this.assistantRepository.findById(input.job.assistantId);
      if (assistant !== null) {
        await this.prisma.assistantDocumentRenderJob.updateMany({
          where: { id: input.job.id },
          data: {
            completionUsageJson: framedResult.usage as unknown as Prisma.InputJsonValue
          }
        });
        await this.persistDocumentCompletionFramingLedger({
          job: input.job,
          userId: assistant.userId,
          usage: framedResult.usage
        });
      }
    }
    const fallbackLocale = inferAssistantDocumentJobLocale({
      preferredLocale: null,
      sourceText: this.readSourceUserMessageText(input.payload)
    });
    const text =
      framedText.length > 0
        ? framedText
        : buildAssistantDocumentJobSuccessFallbackMessage(fallbackLocale);
    let nextPayload = input.payload;
    if (framedText.length > 0 && framedText !== cached) {
      nextPayload = {
        ...input.payload,
        completionAssistantText: framedText
      };
      await this.rememberFramedCompletionText(input.job, nextPayload).catch((error) => {
        this.logger.warn(
          `Failed to persist cached framed completion text for ${input.job.id}: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      });
    }
    return { text, payload: nextPayload };
  }

  private async rememberFramedCompletionText(
    job: ClaimedReadyDocumentJob,
    payload: PersistedDeliveryPayload
  ): Promise<void> {
    await this.prisma.assistantDocumentRenderJob.updateMany({
      where: {
        id: job.id,
        schedulerClaimToken: job.schedulerClaimToken,
        status: "ready_for_delivery"
      },
      data: {
        providerStatusJson: payload as never
      }
    });
  }

  private readDescriptorMode(
    payload: PersistedDeliveryPayload
  ): "create_pdf_document" | "create_presentation" | "revise_document" | "export_or_redeliver" {
    const row = payload as unknown as Record<string, unknown>;
    const descriptorMode = row.descriptorMode;
    if (
      descriptorMode === "create_pdf_document" ||
      descriptorMode === "create_presentation" ||
      descriptorMode === "revise_document" ||
      descriptorMode === "export_or_redeliver"
    ) {
      return descriptorMode;
    }
    return "create_pdf_document";
  }

  private readOutputFormat(payload: PersistedDeliveryPayload): "pdf" | "pptx" {
    return payload.outputFormat === "pptx" ? "pptx" : "pdf";
  }

  private readSourceUserMessageId(payload: PersistedDeliveryPayload): string {
    return payload.sourceUserMessageId ?? "unknown";
  }

  private readSourceUserMessageText(payload: PersistedDeliveryPayload): string {
    return payload.sourceUserMessageText ?? "";
  }

  private readSourceUserMessageCreatedAt(payload: PersistedDeliveryPayload): string {
    return payload.sourceUserMessageCreatedAt ?? new Date(0).toISOString();
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

      const deliveredMimeTypes = Array.from(
        new Set(input.attachments.map((attachment) => attachment.mimeType))
      ).filter((mimeType) => mimeType.trim().length > 0);

      await tx.assistantDocumentDeliveredFile.updateMany({
        where: {
          docId: input.job.docId,
          versionId: input.job.versionId,
          isCurrentOutput: true,
          renderJobId: { not: input.job.id },
          ...(deliveredMimeTypes.length === 0 ? {} : { outputMimeType: { in: deliveredMimeTypes } })
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
      const attachmentMetadataWriter = (
        tx as unknown as {
          assistantChatMessageAttachment?: {
            updateMany(input: {
              where: { assistantFileId: string; messageId: string };
              data: { metadata: unknown };
            }): Promise<unknown>;
          };
        }
      ).assistantChatMessageAttachment;
      const resolvedDescriptorMode = this.readDescriptorMode(input.payload);
      const resolvedDocumentType = this.inferDocumentType(input.payload);
      const companionOriginalStatus = this.readCompanionOriginalStatus(input.payload);
      this.logger.log(
        `[document-delivery] persisting documentLink docId=${input.job.docId} versionId=${
          input.job.versionId
        } descriptorMode=${resolvedDescriptorMode} documentType=${
          resolvedDocumentType ?? "null"
        } companionOriginalStatus=${companionOriginalStatus} attachmentCount=${input.attachments.length}`
      );
      for (const attachment of input.attachments) {
        if (attachmentMetadataWriter !== undefined) {
          this.logger.log(
            `[document-delivery] attachment fileRef=${attachment.fileRef} mimeType=${
              attachment.mimeType
            } messageId=${input.completionAssistantMessageId}`
          );
          await attachmentMetadataWriter.updateMany({
            where: {
              assistantFileId: attachment.fileRef,
              messageId: input.completionAssistantMessageId
            },
            data: {
              metadata: {
                source: "tool_output",
                documentLink: {
                  docId: input.job.docId,
                  versionId: input.job.versionId,
                  descriptorMode: resolvedDescriptorMode,
                  documentType: resolvedDocumentType,
                  renderJobId: input.job.id,
                  isCurrentOutput: true
                }
              }
            }
          });
        }
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

  private async tryLlmAuthoredFailureCopy(input: {
    job: ClaimedReadyDocumentJob;
    payload: PersistedDeliveryPayload | null;
    code: string;
    message: string;
  }): Promise<string | null> {
    const payload = input.payload;
    if (payload === null) {
      return null;
    }
    try {
      return await this.assistantDocumentJobCompletionTurnService.maybeFrameFailure({
        id: input.job.id,
        docId: input.job.docId,
        versionId: input.job.versionId,
        assistantId: input.job.assistantId,
        workspaceId: input.job.workspaceId,
        chatId: input.job.chatId,
        surface: input.job.surface,
        outputFormat: this.readOutputFormat(payload),
        descriptorMode: this.readDescriptorMode(payload),
        sourceUserMessageId: this.readSourceUserMessageId(payload),
        sourceUserMessageText: this.readSourceUserMessageText(payload),
        sourceUserMessageCreatedAt: this.readSourceUserMessageCreatedAt(payload),
        failure: {
          code: input.code,
          message: input.message,
          attemptCount: 1,
          maxAttempts: 1,
          retryable: false,
          stage: "delivery"
        }
      });
    } catch (error) {
      this.logger.warn(
        `LLM document failure-framing threw for job ${input.job.id}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      return null;
    }
  }

  private async tryLlmAuthoredExecutionFailureCopy(
    input: TerminalExecutionFailureInput
  ): Promise<string | null> {
    try {
      return await this.assistantDocumentJobCompletionTurnService.maybeFrameFailure({
        id: input.job.id,
        docId: input.job.docId,
        versionId: input.job.versionId,
        assistantId: input.job.assistantId,
        workspaceId: input.job.workspaceId,
        chatId: input.job.chatId,
        surface: input.job.surface,
        outputFormat: input.job.outputFormat,
        descriptorMode: input.descriptorMode,
        sourceUserMessageId: input.job.sourceUserMessageId,
        sourceUserMessageText: input.sourceUserMessageText,
        sourceUserMessageCreatedAt: input.sourceUserMessageCreatedAt,
        failure: {
          code: input.failure.code,
          message: input.failure.message,
          attemptCount: input.job.attemptCount,
          maxAttempts: input.job.maxAttempts,
          retryable: input.failure.retryable,
          stage: "execution"
        }
      });
    } catch (error) {
      this.logger.warn(
        `LLM document execution-failure framing threw for job ${input.job.id}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      return null;
    }
  }

  private async ensureFailureMessage(input: {
    job: ClaimedReadyDocumentJob;
    failureMessage: string;
    completionAssistantMessageId: string | null;
  }): Promise<string | null> {
    if (input.completionAssistantMessageId !== null) {
      try {
        await this.assistantChatRepository.updateMessageContent(
          input.completionAssistantMessageId,
          input.job.assistantId,
          input.failureMessage
        );
        return input.completionAssistantMessageId;
      } catch (error) {
        this.logger.warn(
          `Failed to update terminal document-job failure message for ${input.job.id}: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
        return input.completionAssistantMessageId;
      }
    }

    try {
      const created = await this.assistantChatRepository.createMessage({
        chatId: input.job.chatId,
        assistantId: input.job.assistantId,
        author: "assistant",
        content: input.failureMessage
      });
      return created.id;
    } catch (error) {
      this.logger.warn(
        `Failed to create terminal document-job failure message for ${input.job.id}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      return null;
    }
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

  private async failDelivery(
    job: ClaimedReadyDocumentJob,
    code: string,
    message: string,
    payload: PersistedDeliveryPayload | null,
    completionAssistantMessageId: string | null
  ): Promise<void> {
    const locale = inferAssistantDocumentJobLocale({
      preferredLocale: null,
      sourceText: payload?.sourceUserMessageText ?? null
    });
    const llmAuthored = await this.tryLlmAuthoredFailureCopy({
      job,
      payload,
      code,
      message
    });
    const failureMessage =
      llmAuthored ??
      buildAssistantDocumentJobFailureMessage({
        code,
        message,
        locale
      });
    const persistedMessageId = await this.ensureFailureMessage({
      job,
      failureMessage,
      completionAssistantMessageId
    });
    const persistedPayload =
      payload === null
        ? persistedMessageId === null
          ? null
          : ({
              completionAssistantMessageId: persistedMessageId
            } satisfies Partial<PersistedDeliveryPayload>)
        : ({
            ...payload,
            completionAssistantMessageId: persistedMessageId
          } satisfies PersistedDeliveryPayload);
    await this.failJob(job, code, message, persistedPayload);
  }

  private async failJob(
    job: ClaimedReadyDocumentJob,
    code: string,
    message: string,
    payload?: PersistedDeliveryPayload | Partial<PersistedDeliveryPayload> | null
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
          lastErrorMessage: this.truncateLastError(message),
          ...(payload === undefined
            ? {}
            : {
                providerStatusJson: (payload ?? {}) as never
              })
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

  private inferDocumentType(payload: PersistedDeliveryPayload): "document" | "presentation" | null {
    if (payload.descriptorMode === "create_presentation") {
      return "presentation";
    }
    const row = payload as Record<string, unknown>;
    const provider =
      typeof payload.providerStatus?.provider === "string"
        ? payload.providerStatus.provider
        : row.provider;
    return provider === "gamma" ? "presentation" : "document";
  }

  private readCompanionOriginalStatus(payload: PersistedDeliveryPayload): string {
    const providerStatus = payload.providerStatus;
    if (providerStatus === null || providerStatus === undefined) {
      return "no_provider_status";
    }
    const candidate = (providerStatus as Record<string, unknown>).companionOriginal;
    if (candidate === null || candidate === undefined) {
      return "absent";
    }
    if (typeof candidate !== "object" || Array.isArray(candidate)) {
      return "malformed";
    }
    const status = (candidate as Record<string, unknown>).status;
    return typeof status === "string" ? status : "unknown";
  }
}
