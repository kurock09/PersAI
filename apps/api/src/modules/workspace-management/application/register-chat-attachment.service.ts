import { BadRequestException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import type { AttachmentType } from "@prisma/client";
import {
  PERSAI_RUNTIME_CHANNELS,
  type PersaiRuntimeChannel,
  type RuntimeBillingFacts
} from "@persai/runtime-contract";
import type { AssistantChatMessageAttachment } from "../domain/assistant-chat-message-attachment.entity";
import type { AssistantChatSurface } from "../domain/assistant-chat.entity";
import { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";
import { AssistantDocumentJobService } from "./assistant-document-job.service";
import { resolveVisibleWorkspaceOutputFormatFromPath } from "./document-workspace-deliverable-gating";
import { WorkspaceFileMetadataService } from "./workspace-file-metadata.service";
import {
  WorkspaceFileMicroDescriptionJobService,
  type WorkspaceFileMicroDescriptionSourceKind
} from "./workspace-file-micro-description-job.service";
import { normalizeActiveWorkspaceFilePath } from "./workspace-visible-paths";
import {
  DeliverChatAttachmentOnceService,
  type ChatAttachmentDeliveryIdentity
} from "./deliver-chat-attachment-once.service";
import { WebChatLiveTurnPresentService } from "./web-chat-live-turn-present.service";

export type RegisterChatAttachmentKind =
  | "user_upload"
  | "image_generate"
  | "image_edit"
  | "document"
  | "files.attach"
  | "tts"
  | "video_generate";

export type RegisterChatAttachmentInput = {
  assistantId: string;
  workspaceId: string;
  chatId: string;
  messageId: string;
  storagePath: string;
  attachmentType: AttachmentType;
  mimeType: string;
  sizeBytes: number;
  originalFilename: string;
  kind: RegisterChatAttachmentKind;
  clientTurnId?: string | null;
  clientAttachmentId?: string | null;
  shortDescription?: string | null;
  metadata?: Record<string, unknown> | null;
  durationMs?: number | null;
  width?: number | null;
  height?: number | null;
  transcription?: string | null;
  billingFacts?: RuntimeBillingFacts | null;
  thumbnailStoragePath?: string | null;
  posterStoragePath?: string | null;
  deliveryIdentity?: ChatAttachmentDeliveryIdentity;
};

export type RegisterChatAttachmentOutcome = {
  attachmentId: string;
  storagePath: string;
  alreadyDelivered: boolean;
  attachment: Pick<AssistantChatMessageAttachment, "id" | "storagePath" | "metadata">;
  delivery: { kind: "new" | "existing"; canonicalKey: string };
};

type FilesAttachDocumentLinkContext = {
  assistantId: string;
  workspaceId: string;
  storagePath: string;
};

export type RegisterChatAttachmentFromRuntimeInput = {
  assistantId: string;
  workspaceId: string;
  channel: PersaiRuntimeChannel;
  externalThreadKey: string;
  messageId?: string | null;
  storagePath: string;
  attachmentType: AttachmentType;
  mimeType: string;
  sizeBytes: number;
  originalFilename: string;
  kind: RegisterChatAttachmentKind;
  clientTurnId?: string | null;
  clientAttachmentId?: string | null;
};

@Injectable()
export class RegisterChatAttachmentService {
  private readonly logger = new Logger(RegisterChatAttachmentService.name);

  constructor(
    private readonly prisma: WorkspaceManagementPrismaService,
    private readonly workspaceFileMetadataService: WorkspaceFileMetadataService,
    private readonly assistantDocumentJobService: AssistantDocumentJobService,
    private readonly workspaceFileMicroDescriptionJobService: WorkspaceFileMicroDescriptionJobService,
    private readonly deliverChatAttachmentOnceService: DeliverChatAttachmentOnceService,
    private readonly webChatLiveTurnPresentService: WebChatLiveTurnPresentService
  ) {}

  parseRuntimeInput(value: unknown): RegisterChatAttachmentFromRuntimeInput {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      throw new BadRequestException("Request body must be an object.");
    }
    const row = value as Record<string, unknown>;
    const sizeBytes = row.sizeBytes;
    if (typeof sizeBytes !== "number" || !Number.isFinite(sizeBytes) || sizeBytes < 0) {
      throw new BadRequestException('Field "sizeBytes" must be a non-negative number.');
    }
    const channel = row.channel;
    if (
      typeof channel !== "string" ||
      !(PERSAI_RUNTIME_CHANNELS as readonly string[]).includes(channel)
    ) {
      throw new BadRequestException("channel must be one of web, telegram, or max_ru.");
    }
    const attachmentType = row.attachmentType;
    if (typeof attachmentType !== "string" || attachmentType.trim().length === 0) {
      throw new BadRequestException('Field "attachmentType" must be a non-empty string.');
    }
    const kind = row.kind;
    if (typeof kind !== "string" || kind.trim().length === 0) {
      throw new BadRequestException('Field "kind" must be a non-empty string.');
    }
    return {
      assistantId: this.requiredString(row.assistantId, "assistantId"),
      workspaceId: this.requiredString(row.workspaceId, "workspaceId"),
      channel: channel as PersaiRuntimeChannel,
      externalThreadKey: this.requiredString(row.externalThreadKey, "externalThreadKey"),
      messageId:
        typeof row.messageId === "string" && row.messageId.trim().length > 0
          ? row.messageId.trim()
          : null,
      storagePath: this.requiredString(row.storagePath, "storagePath"),
      attachmentType: attachmentType as AttachmentType,
      mimeType: this.requiredString(row.mimeType, "mimeType"),
      sizeBytes,
      originalFilename: this.requiredString(row.originalFilename, "originalFilename"),
      kind: kind as RegisterChatAttachmentKind,
      clientTurnId:
        typeof row.clientTurnId === "string" && row.clientTurnId.trim().length > 0
          ? row.clientTurnId.trim()
          : null,
      clientAttachmentId:
        typeof row.clientAttachmentId === "string" && row.clientAttachmentId.trim().length > 0
          ? row.clientAttachmentId.trim()
          : null
    };
  }

  async executeFromRuntime(
    input: RegisterChatAttachmentFromRuntimeInput
  ): Promise<RegisterChatAttachmentOutcome> {
    const surface = this.resolveSurface(input.channel);
    const chat = await this.prisma.assistantChat.findFirst({
      where: {
        assistantId: input.assistantId,
        workspaceId: input.workspaceId,
        surface,
        surfaceThreadKey: input.externalThreadKey
      },
      select: { id: true }
    });
    if (chat === null) {
      throw new NotFoundException("chat_not_found");
    }

    const messageId = await this.resolveRuntimeMessageId(input, chat.id);
    const message = await this.prisma.assistantChatMessage.findFirst({
      where: {
        id: messageId,
        chatId: chat.id,
        assistantId: input.assistantId
      },
      select: { id: true }
    });
    if (message === null) {
      throw new NotFoundException("chat_message_not_found");
    }

    return this.execute({
      assistantId: input.assistantId,
      workspaceId: input.workspaceId,
      chatId: chat.id,
      messageId,
      storagePath: input.storagePath,
      attachmentType: input.attachmentType,
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
      originalFilename: input.originalFilename,
      kind: input.kind,
      ...(input.clientTurnId !== undefined && input.clientTurnId !== null
        ? { clientTurnId: input.clientTurnId }
        : {}),
      ...(input.clientAttachmentId !== undefined && input.clientAttachmentId !== null
        ? { clientAttachmentId: input.clientAttachmentId }
        : {})
    });
  }

  async execute(input: RegisterChatAttachmentInput): Promise<RegisterChatAttachmentOutcome> {
    const storagePath = input.storagePath.trim();
    if (storagePath.length === 0) {
      throw new BadRequestException("storagePath is required.");
    }
    const isWorkspaceStoragePath = this.assertStoragePathAllowed(storagePath);
    const filesAttachDocumentLinkContext =
      input.kind === "files.attach"
        ? await this.prepareFilesAttachDocumentLinkContext({
            assistantId: input.assistantId,
            workspaceId: input.workspaceId,
            storagePath
          })
        : null;
    const documentLink =
      filesAttachDocumentLinkContext === null
        ? null
        : await this.resolveFilesAttachDocumentLink(filesAttachDocumentLinkContext);
    const attachmentMetadata = {
      ...(input.metadata ?? {}),
      kind: input.kind,
      ...(documentLink === null ? {} : { documentLink })
    };
    const priorMetadata = isWorkspaceStoragePath
      ? await this.workspaceFileMetadataService.get({
          workspaceId: input.workspaceId,
          path: storagePath
        })
      : null;
    const shouldInvalidateSummary = this.shouldInvalidateManifestShortDescription(
      input,
      priorMetadata
    );
    const deliveryIdentity =
      input.deliveryIdentity ??
      (documentLink === null
        ? { kind: "media" as const, workspaceArtifactPath: storagePath }
        : {
            kind: "document" as const,
            docId: documentLink.docId,
            versionId: documentLink.versionId,
            versionNumber: documentLink.versionNumber
          });
    const delivered = await this.deliverChatAttachmentOnceService.execute({
      messageId: input.messageId,
      chatId: input.chatId,
      assistantId: input.assistantId,
      workspaceId: input.workspaceId,
      attachmentType: input.attachmentType,
      storagePath,
      thumbnailStoragePath: input.thumbnailStoragePath ?? null,
      posterStoragePath: input.posterStoragePath ?? null,
      originalFilename: input.originalFilename,
      mimeType: input.mimeType,
      sizeBytes: BigInt(input.sizeBytes),
      durationMs: input.durationMs ?? null,
      width: input.width ?? null,
      height: input.height ?? null,
      transcription: input.transcription ?? null,
      billingFacts: input.billingFacts ?? null,
      metadata: attachmentMetadata,
      clientTurnId: input.clientTurnId ?? null,
      clientAttachmentId: input.clientAttachmentId ?? null,
      deliveryIdentity
    });

    if (!delivered.alreadyDelivered && isWorkspaceStoragePath) {
      await this.workspaceFileMetadataService.upsert({
        workspaceId: input.workspaceId,
        path: storagePath,
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes,
        originChatId: input.chatId,
        originAssistantId: input.assistantId,
        ...(input.shortDescription !== undefined && input.shortDescription !== null
          ? { shortDescription: input.shortDescription }
          : shouldInvalidateSummary
            ? { shortDescription: null }
            : {})
      });
      void this.enqueueMicroDescriptionBestEffort({
        workspaceId: input.workspaceId,
        path: storagePath,
        assistantId: input.assistantId,
        chatId: input.chatId,
        kind: input.kind,
        metadata: attachmentMetadata,
        forceRefresh: shouldInvalidateSummary
      });
    }

    return {
      attachmentId: delivered.attachment.id,
      storagePath: delivered.attachment.storagePath ?? storagePath,
      alreadyDelivered: delivered.alreadyDelivered,
      attachment: delivered.attachment,
      delivery: delivered.delivery
    };
  }

  private async enqueueMicroDescriptionBestEffort(input: {
    workspaceId: string;
    path: string;
    assistantId: string;
    chatId: string;
    kind: RegisterChatAttachmentKind;
    metadata: Record<string, unknown>;
    forceRefresh?: boolean;
  }): Promise<void> {
    try {
      const chat = await this.prisma.assistantChat.findUnique({
        where: { id: input.chatId },
        select: { chatMode: true }
      });
      const sourceKind = this.resolveMicroDescriptionSourceKind(input.kind, input.metadata);
      await this.workspaceFileMicroDescriptionJobService.enqueueIfNeeded({
        workspaceId: input.workspaceId,
        path: input.path,
        assistantId: input.assistantId,
        sourceKind,
        sourceChatId: input.chatId,
        chatMode: chat?.chatMode ?? null,
        ...(input.forceRefresh === true ? { forceRefresh: true } : {})
      });
    } catch (error) {
      this.logger.warn(
        `workspace_file_micro_description_enqueue_failed path=${input.path} reason=${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  private resolveMicroDescriptionSourceKind(
    kind: RegisterChatAttachmentKind,
    metadata: Record<string, unknown>
  ): WorkspaceFileMicroDescriptionSourceKind {
    if (kind !== "user_upload") {
      return "generated";
    }
    const source = metadata.source;
    if (typeof source === "string" && source.includes("telegram")) {
      return "inbound";
    }
    return "user_upload";
  }

  private shouldInvalidateManifestShortDescription(
    input: RegisterChatAttachmentInput,
    priorMetadata: Awaited<ReturnType<WorkspaceFileMetadataService["get"]>>
  ): boolean {
    if (input.shortDescription !== undefined && input.shortDescription !== null) {
      return false;
    }
    if (priorMetadata === null) {
      return false;
    }
    return (
      priorMetadata.sizeBytes !== BigInt(input.sizeBytes) ||
      priorMetadata.mimeType !== input.mimeType
    );
  }

  private assertStoragePathAllowed(storagePath: string): boolean {
    if (normalizeActiveWorkspaceFilePath(storagePath) === null) {
      if (storagePath.startsWith("external-download/")) {
        return false;
      }
      throw new BadRequestException(
        'storagePath must be an active hierarchical "/workspace/..." file path.'
      );
    }
    return true;
  }

  private resolveSurface(channel: PersaiRuntimeChannel): AssistantChatSurface {
    if (channel === "web" || channel === "telegram") {
      return channel;
    }
    throw new BadRequestException(`Unsupported channel: ${channel}`);
  }

  private async resolveRuntimeMessageId(
    input: RegisterChatAttachmentFromRuntimeInput,
    chatId: string
  ): Promise<string> {
    if (typeof input.messageId === "string" && input.messageId.trim().length > 0) {
      return input.messageId.trim();
    }
    // ADR-167 — bind to the open ordinary USER_TURN assistant bubble (D1).
    // Never fall back to the user message id.
    const attempt = await this.webChatLiveTurnPresentService.findOpenOrdinaryUserTurnAttemptForChat(
      {
        assistantId: input.assistantId,
        chatId
      }
    );
    if (attempt === null) {
      throw new NotFoundException("open_assistant_message_not_found");
    }
    try {
      return await this.webChatLiveTurnPresentService.ensureOpenTurnAssistantMessage({
        attempt
      });
    } catch (error) {
      throw new NotFoundException(
        error instanceof Error && error.message.trim().length > 0
          ? error.message
          : "open_assistant_message_not_found"
      );
    }
  }

  private requiredString(value: unknown, field: string): string {
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new BadRequestException(`Field "${field}" must be a non-empty string.`);
    }
    return value.trim();
  }

  private async prepareFilesAttachDocumentLinkContext(input: {
    assistantId: string;
    workspaceId: string;
    storagePath: string;
  }): Promise<FilesAttachDocumentLinkContext | null> {
    const outputFormat = resolveVisibleWorkspaceOutputFormatFromPath(input.storagePath);
    if (outputFormat !== "pdf" && outputFormat !== "xlsx" && outputFormat !== "docx") {
      return null;
    }

    const outputMetadata = await this.workspaceFileMetadataService.get({
      workspaceId: input.workspaceId,
      path: input.storagePath
    });
    if (outputMetadata === null) {
      throw new BadRequestException(
        `Document output ${input.storagePath} could not be attached because the workspace file does not exist.`
      );
    }

    return {
      assistantId: input.assistantId,
      workspaceId: input.workspaceId,
      storagePath: input.storagePath
    };
  }

  private async resolveFilesAttachDocumentLink(input: FilesAttachDocumentLinkContext) {
    const currentDocumentLink =
      await this.assistantDocumentJobService.findCurrentDocumentLinkByOutputPath({
        assistantId: input.assistantId,
        workspaceId: input.workspaceId,
        outputPath: input.storagePath
      });
    return currentDocumentLink.status === "ready" ? currentDocumentLink.link : null;
  }
}
