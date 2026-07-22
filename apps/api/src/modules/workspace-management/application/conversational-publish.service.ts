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
 * ADR-162 Phase 1 — sole chat-row create + artifact attach for ordinary
 * deferred media/document jobs. Runs under catch-up eligibility
 * (after idle-pause / USER_TURN gate), before the narration runtime turn.
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
      throw new Error(
        `ConversationalPublish failed to attach media artifacts for ${input.canonicalJobId}`
      );
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
            artifacts: workingPayload.artifacts
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
      throw new Error(
        `ConversationalPublish failed to attach document artifacts for ${input.canonicalJobId}`
      );
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
   * Resume partial attach by durable storagePath identity only.
   * No count-tail heuristics — without paths, fail closed so retry is explicit.
   */
  private async selectRemainingMediaArtifacts(input: {
    messageId: string;
    artifacts: RuntimeOutputArtifact[];
  }): Promise<RuntimeOutputArtifact[]> {
    const existingAttachments = await this.attachmentRepository.listByMessageId(input.messageId);
    if (existingAttachments.length === 0) {
      return input.artifacts;
    }
    const attachedPaths = new Set(
      existingAttachments
        .map((attachment) =>
          typeof attachment.storagePath === "string" ? attachment.storagePath.trim() : ""
        )
        .filter((path) => path.length > 0)
    );
    const artifactsHavePaths = input.artifacts.every(
      (artifact) =>
        typeof artifact.storagePath === "string" && artifact.storagePath.trim().length > 0
    );
    if (!artifactsHavePaths || attachedPaths.size === 0) {
      throw new Error(
        "ConversationalPublish cannot resume partial attach without storagePath identity on artifacts and attachments."
      );
    }
    return input.artifacts.filter((artifact) => !attachedPaths.has(artifact.storagePath.trim()));
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
