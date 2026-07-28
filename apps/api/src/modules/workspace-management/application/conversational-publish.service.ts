import { Inject, Injectable, Logger } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { RuntimeOutputArtifact } from "@persai/runtime-contract";
import {
  ASSISTANT_CHAT_MESSAGE_ATTACHMENT_REPOSITORY,
  type AssistantChatMessageAttachmentRepository
} from "../domain/assistant-chat-message-attachment.repository";
import {
  ASSISTANT_CHAT_REPOSITORY,
  type AssistantChatRepository
} from "../domain/assistant-chat.repository";
import { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";
import { runtimeOutputArtifactsToMediaArtifacts } from "./assistant-runtime.facade";
import {
  buildAssistantDocumentLinkMetadata,
  normalizeDocumentWorkspaceFacts
} from "./assistant-document-link-metadata";
import { attachmentMatchesDeliveryIdentity } from "./deliver-chat-attachment-once.service";
import { MediaDeliveryService } from "./media/media-delivery.service";
import { ResolveTelegramChannelRuntimeConfigService } from "./resolve-telegram-channel-runtime-config.service";
import { parseTelegramChatIdFromSurfaceThreadKey } from "./telegram-assistant-chat-outbound.service";

export type ConversationalPublishInput = {
  handleId: string;
  kind: "media" | "document" | "sandbox";
  canonicalJobId: string;
  assistantId: string;
  workspaceId: string;
  chatId: string;
  channel: "web" | "telegram";
};

/**
 * ADR-162 / ADR-166 — sole chat-row create + artifact attach for ordinary
 * deferred media/document catch-up. Callers must invoke only after queue
 * admission and runtime acceptance; pre-accept busy/deny must leave no pin.
 */
@Injectable()
export class ConversationalPublishService {
  private readonly logger = new Logger(ConversationalPublishService.name);

  constructor(
    private readonly prisma: WorkspaceManagementPrismaService,
    @Inject(ASSISTANT_CHAT_REPOSITORY)
    private readonly assistantChatRepository: AssistantChatRepository,
    @Inject(ASSISTANT_CHAT_MESSAGE_ATTACHMENT_REPOSITORY)
    private readonly attachmentRepository: AssistantChatMessageAttachmentRepository,
    private readonly mediaDeliveryService: MediaDeliveryService,
    private readonly resolveTelegramChannelRuntimeConfigService: ResolveTelegramChannelRuntimeConfigService
  ) {}

  /**
   * Idempotent publish for the catch-up head. Sandbox returns null (no
   * artifact bubble). Media/document return the publish message id.
   */
  async publishForCatchUp(input: ConversationalPublishInput): Promise<string | null> {
    if (input.kind === "sandbox") {
      return null;
    }
    if (input.kind === "media") {
      return this.publishMedia(input);
    }
    return this.publishDocument(input);
  }

  private async publishMedia(input: ConversationalPublishInput): Promise<string> {
    const job = await this.prisma.assistantMediaJob.findUnique({
      where: { id: input.canonicalJobId },
      select: {
        id: true,
        assistantId: true,
        workspaceId: true,
        chatId: true,
        surface: true,
        artifactsJson: true,
        completionAssistantMessageId: true,
        status: true
      }
    });
    if (job === null || job.assistantId !== input.assistantId || job.chatId !== input.chatId) {
      throw new Error(`ConversationalPublish media job missing for ${input.canonicalJobId}`);
    }
    const artifacts = Array.isArray(job.artifactsJson)
      ? (job.artifactsJson as unknown as RuntimeOutputArtifact[])
      : [];

    // Crash-idempotent: pinned id (even with zero attachments) is reused — never
    // createMessage again after a create+pin that crashed during attach.
    let messageId = job.completionAssistantMessageId;
    let existingAttachmentCount = 0;
    if (messageId !== null) {
      if (await this.isPinnedAttachFailureSettled(messageId, input.assistantId)) {
        await this.stampHandleMessageIds(input.handleId, messageId);
        return messageId;
      }
      const existingAttachments = await this.attachmentRepository.listByMessageId(messageId);
      existingAttachmentCount = existingAttachments.length;
      // ADR-162 audit: any attachment is not "complete". Only skip deliver when
      // every expected artifact is already attached (or there are none).
      if (artifacts.length === 0 || existingAttachmentCount >= artifacts.length) {
        await this.stampHandleMessageIds(input.handleId, messageId);
        return messageId;
      }
    } else {
      messageId = (
        await this.assistantChatRepository.createMessage({
          chatId: input.chatId,
          assistantId: input.assistantId,
          author: "assistant",
          content: "",
          metadata: {
            wakeKind: "job_catchup",
            conversationalPublish: true
          }
        })
      ).id;
      // Pin before deliver so a crash mid-attach retries the same row.
      await this.prisma.assistantMediaJob.updateMany({
        where: { id: input.canonicalJobId },
        data: { completionAssistantMessageId: messageId }
      });
      await this.stampHandleMessageIds(input.handleId, messageId);
    }

    // ADR-162 — empty artifacts (typical terminal failure): leave bubble with
    // no attachments so narration / fail-present can proceed. Never invent captions.
    if (artifacts.length === 0) {
      await this.stampHandleMessageIds(input.handleId, messageId);
      return messageId;
    }

    const remainingArtifacts =
      existingAttachmentCount > 0
        ? await this.selectRemainingMediaArtifacts({
            messageId,
            artifacts
          })
        : artifacts;
    if (remainingArtifacts.length === 0) {
      await this.stampHandleMessageIds(input.handleId, messageId);
      return messageId;
    }

    const channelTarget =
      input.channel === "telegram"
        ? await this.resolveTelegramChannelTarget(input.assistantId, input.chatId)
        : undefined;
    try {
      const delivered = await this.mediaDeliveryService.deliver({
        artifacts: runtimeOutputArtifactsToMediaArtifacts(remainingArtifacts),
        channel: input.channel,
        assistantId: input.assistantId,
        chatId: input.chatId,
        messageId,
        workspaceId: input.workspaceId,
        settleQuota: false,
        ...(channelTarget === undefined ? {} : { channelTarget })
      });
      if (delivered.attachments.length === 0) {
        return this.settlePinnedAttachFailure({
          handleId: input.handleId,
          assistantId: input.assistantId,
          messageId,
          canonicalJobId: input.canonicalJobId,
          reason: "zero_attachments"
        });
      }
    } catch (error) {
      return this.settlePinnedAttachFailure({
        handleId: input.handleId,
        assistantId: input.assistantId,
        messageId,
        canonicalJobId: input.canonicalJobId,
        reason: error instanceof Error ? error.message : String(error)
      });
    }

    await this.stampHandleMessageIds(input.handleId, messageId);
    return messageId;
  }

  private async publishDocument(input: ConversationalPublishInput): Promise<string> {
    const job = await this.prisma.assistantDocumentRenderJob.findUnique({
      where: { id: input.canonicalJobId },
      select: {
        id: true,
        docId: true,
        versionId: true,
        assistantId: true,
        workspaceId: true,
        chatId: true,
        surface: true,
        providerStatusJson: true,
        status: true
      }
    });
    if (job === null || job.assistantId !== input.assistantId || job.chatId !== input.chatId) {
      throw new Error(`ConversationalPublish document job missing for ${input.canonicalJobId}`);
    }
    const parsed = this.parseDocumentPayload(job.providerStatusJson);
    // Empty / missing artifacts are a normal terminal-failure present — do not
    // throw (that stuck FIFO on releaseClaimToReady). Still publish a bubble.
    const workingBase = parsed ?? {
      artifacts: [] as RuntimeOutputArtifact[],
      completionAssistantMessageId: null as string | null
    };

    let messageId =
      typeof workingBase.completionAssistantMessageId === "string"
        ? workingBase.completionAssistantMessageId
        : null;
    let workingPayload = workingBase;
    let existingAttachmentCount = 0;
    if (messageId !== null) {
      if (await this.isPinnedAttachFailureSettled(messageId, input.assistantId)) {
        await this.stampHandleMessageIds(input.handleId, messageId);
        return messageId;
      }
      const existingAttachments = await this.attachmentRepository.listByMessageId(messageId);
      existingAttachmentCount = existingAttachments.length;
      // ADR-162 audit: partial attach must retry remaining artifacts — do not
      // treat "any attachment" as a complete publish.
      if (
        workingPayload.artifacts.length === 0 ||
        existingAttachmentCount >= workingPayload.artifacts.length
      ) {
        await this.stampHandleMessageIds(input.handleId, messageId);
        return messageId;
      }
    } else {
      messageId = (
        await this.assistantChatRepository.createMessage({
          chatId: input.chatId,
          assistantId: input.assistantId,
          author: "assistant",
          content: "",
          metadata: {
            wakeKind: "job_catchup",
            conversationalPublish: true
          }
        })
      ).id;
      // Pin before deliver so a crash mid-attach retries the same row.
      workingPayload = {
        ...workingBase,
        completionAssistantMessageId: messageId,
        externalDeliveryCommitted: false
      };
      await this.prisma.assistantDocumentRenderJob.updateMany({
        where: { id: input.canonicalJobId },
        data: {
          providerStatusJson: workingPayload as never
        }
      });
      await this.stampHandleMessageIds(input.handleId, messageId);
    }

    if (workingPayload.artifacts.length === 0) {
      await this.stampHandleMessageIds(input.handleId, messageId);
      return messageId;
    }

    const remainingArtifacts =
      existingAttachmentCount > 0
        ? await this.selectRemainingMediaArtifacts({
            messageId,
            artifacts: workingPayload.artifacts,
            documentIdentity: { docId: job.docId, versionId: job.versionId }
          })
        : workingPayload.artifacts;
    if (remainingArtifacts.length === 0) {
      await this.stampHandleMessageIds(input.handleId, messageId);
      return messageId;
    }

    const channelTarget =
      input.channel === "telegram"
        ? await this.resolveTelegramChannelTarget(input.assistantId, input.chatId)
        : undefined;
    let delivered;
    try {
      delivered = await this.mediaDeliveryService.deliver({
        artifacts: runtimeOutputArtifactsToMediaArtifacts(remainingArtifacts),
        channel: input.channel,
        assistantId: input.assistantId,
        chatId: input.chatId,
        messageId,
        workspaceId: input.workspaceId,
        settleQuota: false,
        deliveryIdentity: {
          kind: "document",
          docId: job.docId,
          versionId: job.versionId
        },
        ...(channelTarget === undefined ? {} : { channelTarget })
      });
    } catch (error) {
      return this.settlePinnedAttachFailure({
        handleId: input.handleId,
        assistantId: input.assistantId,
        messageId,
        canonicalJobId: input.canonicalJobId,
        reason: error instanceof Error ? error.message : String(error)
      });
    }
    const normalized = delivered.attachments
      .filter(
        (attachment) =>
          typeof attachment.path === "string" &&
          attachment.path.trim().length > 0 &&
          attachment.unavailable !== true
      )
      .map((attachment) => ({
        attachmentId: attachment.id,
        storagePath: attachment.path as string,
        mimeType: attachment.mimeType
      }));
    if (normalized.length === 0) {
      return this.settlePinnedAttachFailure({
        handleId: input.handleId,
        assistantId: input.assistantId,
        messageId,
        canonicalJobId: input.canonicalJobId,
        reason: "zero_attachments"
      });
    }

    await this.stampDocumentAttachments({
      job: {
        id: job.id,
        docId: job.docId,
        versionId: job.versionId
      },
      payload: workingPayload,
      completionAssistantMessageId: messageId,
      attachments: normalized
    });

    const nextPayload = {
      ...workingPayload,
      completionAssistantMessageId: messageId,
      externalDeliveryCommitted: true
    };
    await this.prisma.assistantDocumentRenderJob.updateMany({
      where: { id: input.canonicalJobId },
      data: {
        providerStatusJson: nextPayload as never
      }
    });
    await this.stampHandleMessageIds(input.handleId, messageId);
    return messageId;
  }

  private async stampHandleMessageIds(handleId: string, messageId: string): Promise<void> {
    await this.prisma.assistantAsyncJobHandle.updateMany({
      where: { id: handleId },
      data: {
        continuationAssistantMessageId: messageId
      }
    });
  }

  /**
   * ADR-166 — after create+pin, attach throw/zero must not leave a blank unbound
   * orphan. Project one honest failure on the pinned identity and return it so
   * the attempt can bind; retries reuse the same id without re-deliver.
   */
  private async settlePinnedAttachFailure(input: {
    handleId: string;
    assistantId: string;
    messageId: string;
    canonicalJobId: string;
    reason: string;
  }): Promise<string> {
    const failureText = "The file was ready, but attaching it to this chat message failed.";
    try {
      await this.assistantChatRepository.updateMessageContent(
        input.messageId,
        input.assistantId,
        failureText
      );
      await this.assistantChatRepository.mergeMessageMetadata(input.messageId, input.assistantId, {
        conversationalPublishAttachmentFailed: true,
        conversationalPublishAttachmentError: input.reason.slice(0, 500)
      });
    } catch (error) {
      this.logger.warn(
        `conversational_publish_attach_failure_project_failed jobId=${input.canonicalJobId} messageId=${input.messageId}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
    await this.stampHandleMessageIds(input.handleId, input.messageId);
    this.logger.warn(
      `conversational_publish_attach_failed jobId=${input.canonicalJobId} messageId=${input.messageId} reason=${input.reason}`
    );
    return input.messageId;
  }

  private async isPinnedAttachFailureSettled(
    messageId: string,
    assistantId: string
  ): Promise<boolean> {
    const finder = this.assistantChatRepository.findMessageByIdForAssistant;
    if (typeof finder !== "function") {
      return false;
    }
    const existing = await finder.call(this.assistantChatRepository, messageId, assistantId);
    if (existing === null) return false;
    const metadata =
      existing.metadata !== null &&
      typeof existing.metadata === "object" &&
      !Array.isArray(existing.metadata)
        ? (existing.metadata as Record<string, unknown>)
        : null;
    return metadata?.conversationalPublishAttachmentFailed === true;
  }

  /**
   * Resume partial attach by ADR-167 delivery identity (artifact id / workspace
   * path aliases), not renamed storagePath alone. Fail closed without a path.
   */
  private async selectRemainingMediaArtifacts(input: {
    messageId: string;
    artifacts: RuntimeOutputArtifact[];
    documentIdentity?: { docId: string; versionId: string };
  }): Promise<RuntimeOutputArtifact[]> {
    const existingAttachments = await this.attachmentRepository.listByMessageId(input.messageId);
    if (existingAttachments.length === 0) {
      return input.artifacts;
    }
    if (input.documentIdentity !== undefined) {
      const already = existingAttachments.some((attachment) =>
        attachmentMatchesDeliveryIdentity(attachment, {
          kind: "document",
          docId: input.documentIdentity!.docId,
          versionId: input.documentIdentity!.versionId
        })
      );
      return already ? [] : input.artifacts;
    }
    const artifactsHavePaths = input.artifacts.every(
      (artifact) =>
        typeof artifact.storagePath === "string" && artifact.storagePath.trim().length > 0
    );
    if (!artifactsHavePaths) {
      throw new Error(
        "ConversationalPublish cannot resume partial attach without storagePath identity on artifacts."
      );
    }
    return input.artifacts.filter((artifact) => {
      const path = artifact.storagePath.trim();
      return !existingAttachments.some((attachment) =>
        attachmentMatchesDeliveryIdentity(attachment, {
          kind: "media",
          artifactId: artifact.artifactId ?? null,
          workspaceArtifactPath: path
        })
      );
    });
  }

  private async resolveTelegramChannelTarget(assistantId: string, chatId: string) {
    const config =
      await this.resolveTelegramChannelRuntimeConfigService.resolveByAssistantId(assistantId);
    if (config === null || config.outbound !== true) {
      throw new Error("Telegram outbound delivery is not available for this assistant.");
    }
    const chat = await this.assistantChatRepository.findChatById(chatId);
    if (chat === null || chat.surface !== "telegram") {
      throw new Error("Telegram conversational publish chat is missing or not Telegram.");
    }
    return {
      channel: "telegram" as const,
      chatId: parseTelegramChatIdFromSurfaceThreadKey(chat.surfaceThreadKey),
      metadata: {
        botToken: config.botToken
      }
    };
  }

  private parseDocumentPayload(value: unknown): {
    artifacts: RuntimeOutputArtifact[];
    completionAssistantMessageId?: string | null;
    descriptorMode?: "create_presentation" | "revise_document" | "export_or_redeliver";
    outputFormat?: "pdf" | "pptx";
    externalDeliveryCommitted?: boolean;
    [key: string]: unknown;
  } | null {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      return null;
    }
    const row = value as Record<string, unknown>;
    if (!Array.isArray(row.artifacts)) {
      return null;
    }
    return {
      ...row,
      artifacts: row.artifacts as RuntimeOutputArtifact[],
      completionAssistantMessageId:
        typeof row.completionAssistantMessageId === "string"
          ? row.completionAssistantMessageId
          : null
    };
  }

  private async stampDocumentAttachments(input: {
    job: { id: string; docId: string; versionId: string };
    payload: {
      artifacts: RuntimeOutputArtifact[];
      descriptorMode?: "create_presentation" | "revise_document" | "export_or_redeliver";
      outputFormat?: "pdf" | "pptx";
    };
    completionAssistantMessageId: string;
    attachments: Array<{ attachmentId: string; storagePath: string; mimeType: string }>;
  }): Promise<void> {
    const version = await this.prisma.assistantDocumentVersion.findUnique({
      where: { id: input.job.versionId },
      select: {
        versionNumber: true,
        sourceJson: true,
        status: true
      }
    });
    const workspaceFacts = this.readWorkspaceFacts(version?.sourceJson);
    const descriptorMode =
      input.payload.descriptorMode === "revise_document" ||
      input.payload.descriptorMode === "export_or_redeliver"
        ? input.payload.descriptorMode
        : "create_presentation";
    const outputFormat = input.payload.outputFormat === "pptx" ? "pptx" : "pdf";
    const versionStatus =
      version?.status === "ready" || version?.status === "superseded" ? version.status : "ready";
    const isCurrentOutput = versionStatus === "ready";

    for (const attachment of input.attachments) {
      await this.prisma.assistantChatMessageAttachment.updateMany({
        where: {
          id: attachment.attachmentId,
          messageId: input.completionAssistantMessageId
        },
        data: {
          metadata: {
            source: "tool_output",
            kind: "document",
            documentLink: buildAssistantDocumentLinkMetadata({
              docId: input.job.docId,
              versionId: input.job.versionId,
              versionNumber: version?.versionNumber ?? null,
              descriptorMode,
              documentType: "presentation",
              outputFormat,
              documentStatus: "ready",
              versionStatus,
              renderJobId: input.job.id,
              isCurrentOutput,
              workspaceFacts: {
                ...workspaceFacts,
                outputPath: attachment.storagePath
              }
            })
          } as unknown as Prisma.InputJsonValue
        }
      });
    }
    this.logger.log(
      `conversational_publish_document jobId=${input.job.id} messageId=${input.completionAssistantMessageId} attachments=${String(input.attachments.length)}`
    );
  }

  private readWorkspaceFacts(value: unknown) {
    const row =
      value !== null && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : {};
    const metadata =
      row.metadata !== null && typeof row.metadata === "object" && !Array.isArray(row.metadata)
        ? (row.metadata as Record<string, unknown>)
        : null;
    return normalizeDocumentWorkspaceFacts(metadata?.documentWorkspace);
  }
}
