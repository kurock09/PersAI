import {
  BadRequestException,
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException
} from "@nestjs/common";
import type { AttachmentType, Prisma } from "@prisma/client";
import {
  PERSAI_RUNTIME_CHANNELS,
  type PersaiRuntimeChannel,
  type RuntimeBillingFacts
} from "@persai/runtime-contract";
import {
  ASSISTANT_CHAT_MESSAGE_ATTACHMENT_REPOSITORY,
  type AssistantChatMessageAttachmentRepository
} from "../domain/assistant-chat-message-attachment.repository";
import type { AssistantChatSurface } from "../domain/assistant-chat.entity";
import { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";
import { AssistantDocumentJobService } from "./assistant-document-job.service";
import { DocumentWorkspaceInspectionService } from "./document-workspace-inspection.service";
import {
  inferProjectPathFromOutputPath,
  resolveVisibleWorkspaceOutputFormatFromPath
} from "./document-workspace-deliverable-gating";
import { DocumentWorkspaceVersionRegistrationService } from "./document-workspace-version-registration.service";
import { WorkspaceFileMetadataService } from "./workspace-file-metadata.service";

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
};

export type RegisterChatAttachmentOutcome = {
  attachmentId: string;
  storagePath: string;
};

type FilesAttachDocumentLinkContext = {
  assistantId: string;
  workspaceId: string;
  chatId: string;
  storagePath: string;
  chatSurface: "web" | "telegram";
  externalThreadKey: string;
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
    @Inject(ASSISTANT_CHAT_MESSAGE_ATTACHMENT_REPOSITORY)
    private readonly attachmentRepository: AssistantChatMessageAttachmentRepository,
    private readonly workspaceFileMetadataService: WorkspaceFileMetadataService,
    private readonly assistantDocumentJobService: AssistantDocumentJobService,
    private readonly documentWorkspaceInspectionService?: DocumentWorkspaceInspectionService,
    private readonly documentWorkspaceVersionRegistrationService?: DocumentWorkspaceVersionRegistrationService
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
    this.assertStoragePathAllowed(storagePath);
    const filesAttachDocumentLinkContext =
      input.kind === "files.attach"
        ? await this.prepareFilesAttachDocumentLinkContext({
            assistantId: input.assistantId,
            workspaceId: input.workspaceId,
            chatId: input.chatId,
            storagePath
          })
        : null;
    const attachmentMetadata = {
      ...(input.metadata ?? {}),
      kind: input.kind
    };
    const attachment = await this.attachmentRepository.create({
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
      processingStatus: "ready",
      transcription: input.transcription ?? null,
      billingFacts: input.billingFacts ?? null,
      metadata: attachmentMetadata,
      clientTurnId: input.clientTurnId ?? null,
      clientAttachmentId: input.clientAttachmentId ?? null
    });

    await this.workspaceFileMetadataService.upsert({
      workspaceId: input.workspaceId,
      path: storagePath,
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
      originChatId: input.chatId,
      originAssistantId: input.assistantId,
      ...(input.shortDescription !== undefined && input.shortDescription !== null
        ? { shortDescription: input.shortDescription }
        : {})
    });

    if (filesAttachDocumentLinkContext !== null) {
      await this.attachDocumentLinkBestEffort({
        attachmentId: attachment.id,
        baseMetadata: attachmentMetadata,
        context: filesAttachDocumentLinkContext
      });
    }

    return {
      attachmentId: attachment.id,
      storagePath
    };
  }

  private assertStoragePathAllowed(storagePath: string): void {
    if (!storagePath.startsWith("/workspace/")) {
      throw new BadRequestException("storagePath must be under /workspace/.");
    }
    if (storagePath.includes("..")) {
      throw new BadRequestException("storagePath must not contain '..'.");
    }
  }

  private resolveSurface(channel: PersaiRuntimeChannel): AssistantChatSurface {
    if (channel === "web" || channel === "telegram") {
      return channel;
    }
    throw new BadRequestException(`Unsupported channel: ${channel}`);
  }

  private async resolveRuntimeMessageId(
    input: RegisterChatAttachmentFromRuntimeInput,
    _chatId: string
  ): Promise<string> {
    if (input.messageId !== null && input.messageId !== undefined) {
      return input.messageId;
    }
    throw new NotFoundException("chat_message_not_found");
  }

  private requiredString(value: unknown, field: string): string {
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new BadRequestException(`Field "${field}" must be a non-empty string.`);
    }
    return value.trim();
  }

  private async resolveProjectPathForUnregisteredDocumentOutput(input: {
    workspaceId: string;
    storagePath: string;
  }): Promise<string | null> {
    const candidates = new Set<string>();
    const inferredProjectPath = inferProjectPathFromOutputPath(input.storagePath);
    if (inferredProjectPath !== null) {
      candidates.add(inferredProjectPath);
    }
    const lastSlash = input.storagePath.lastIndexOf("/");
    if (lastSlash > "/workspace".length) {
      candidates.add(input.storagePath.slice(0, lastSlash));
    }
    for (const candidate of candidates) {
      const projectManifestMetadata = await this.workspaceFileMetadataService.get({
        workspaceId: input.workspaceId,
        path: `${candidate}/project.json`
      });
      if (projectManifestMetadata !== null) {
        return candidate;
      }
    }
    return null;
  }

  private async prepareFilesAttachDocumentLinkContext(input: {
    assistantId: string;
    workspaceId: string;
    chatId: string;
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

    const chat = await this.prisma.assistantChat.findFirst({
      where: {
        id: input.chatId,
        assistantId: input.assistantId,
        workspaceId: input.workspaceId
      },
      select: {
        surface: true,
        surfaceThreadKey: true
      }
    });
    if (chat === null) {
      throw new NotFoundException("chat_not_found");
    }
    if (chat.surface !== "web" && chat.surface !== "telegram") {
      throw new BadRequestException(
        `Document auto-registration for files.attach does not support chat surface ${chat.surface}.`
      );
    }

    return {
      assistantId: input.assistantId,
      workspaceId: input.workspaceId,
      chatId: input.chatId,
      storagePath: input.storagePath,
      chatSurface: chat.surface,
      externalThreadKey: chat.surfaceThreadKey
    };
  }

  private async resolveCurrentVisibleWorkspaceDocumentIdByOutputPath(input: {
    assistantId: string;
    workspaceId: string;
    outputPath: string;
  }): Promise<string | null> {
    const document = await this.prisma.assistantDocument.findFirst({
      where: {
        assistantId: input.assistantId,
        workspaceId: input.workspaceId,
        currentVersion: {
          is: {
            sourceJson: {
              path: ["metadata", "documentWorkspace", "outputPath"],
              equals: input.outputPath
            }
          }
        }
      },
      select: { id: true }
    });
    return document?.id ?? null;
  }

  private async resolveFilesAttachDocumentLink(input: FilesAttachDocumentLinkContext) {
    const currentDocumentLink =
      await this.assistantDocumentJobService.findCurrentDocumentLinkByOutputPath({
        assistantId: input.assistantId,
        workspaceId: input.workspaceId,
        outputPath: input.storagePath
      });
    const workspaceProjectPath = await this.resolveProjectPathForUnregisteredDocumentOutput({
      workspaceId: input.workspaceId,
      storagePath: input.storagePath
    });
    const existingDocId =
      currentDocumentLink.status === "ready"
        ? currentDocumentLink.link.docId
        : await this.resolveCurrentVisibleWorkspaceDocumentIdByOutputPath({
            assistantId: input.assistantId,
            workspaceId: input.workspaceId,
            outputPath: input.storagePath
          });
    return this.autoRegisterProjectOwnedDocumentOutputForAttach({
      assistantId: input.assistantId,
      workspaceId: input.workspaceId,
      storagePath: input.storagePath,
      chatSurface: input.chatSurface,
      externalThreadKey: input.externalThreadKey,
      workspaceProjectPath,
      existingDocId
    });
  }

  private async attachDocumentLinkBestEffort(input: {
    attachmentId: string;
    baseMetadata: Record<string, unknown>;
    context: FilesAttachDocumentLinkContext;
  }): Promise<void> {
    try {
      const documentLink = await this.resolveFilesAttachDocumentLink(input.context);
      if (documentLink === null) {
        return;
      }
      await this.prisma.assistantChatMessageAttachment.update({
        where: {
          id: input.attachmentId
        },
        data: {
          metadata: {
            ...input.baseMetadata,
            documentLink
          } as unknown as Prisma.InputJsonValue
        }
      });
    } catch (error) {
      // ADR-132 repair slice: document identity/inspection/link metadata is
      // best-effort enrichment after attachment creation and must never block
      // successful current-turn delivery of an existing file.
      this.logger.warn(
        `Document attachment ${input.context.storagePath} delivered without metadata enrichment: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  private async autoRegisterProjectOwnedDocumentOutputForAttach(input: {
    assistantId: string;
    workspaceId: string;
    storagePath: string;
    chatSurface: "web" | "telegram";
    externalThreadKey: string;
    workspaceProjectPath: string | null;
    existingDocId: string | null;
  }) {
    if (
      this.documentWorkspaceInspectionService === undefined ||
      this.documentWorkspaceVersionRegistrationService === undefined
    ) {
      throw new InternalServerErrorException(
        "Document auto-registration for files.attach is unavailable because the inspection or version-registration service is not wired."
      );
    }

    const inspect = await this.documentWorkspaceInspectionService.execute({
      assistantId: input.assistantId,
      workspaceId: input.workspaceId,
      path: input.storagePath,
      depth: "standard",
      outputPath: null
    });
    if (!inspect.accepted) {
      throw new BadRequestException(
        `Document output ${input.storagePath} could not be inspected for attach (${inspect.code}): ${inspect.message}`
      );
    }

    const registration = await this.documentWorkspaceVersionRegistrationService.execute({
      assistantId: input.assistantId,
      workspaceId: input.workspaceId,
      channel: input.chatSurface,
      externalThreadKey: input.externalThreadKey,
      sourceUserMessageText: `Auto-register visible workspace output during files.attach: ${input.storagePath}`,
      sourceUserMessageCreatedAt: new Date().toISOString(),
      descriptorMode: input.existingDocId === null ? null : "revise_document",
      docId: input.existingDocId,
      requestedName: null,
      workspaceProjectPath: input.workspaceProjectPath,
      outputPath: input.storagePath,
      sourceManifestPath: null,
      inspectionPath: inspect.inspectPath
    });
    if (!registration.accepted) {
      throw new BadRequestException(
        `Document output ${input.storagePath} could not be auto-registered for attach (${registration.code}): ${registration.message}`
      );
    }

    const refreshedDocumentLink =
      await this.assistantDocumentJobService.findCurrentDocumentLinkByOutputPath({
        assistantId: input.assistantId,
        workspaceId: input.workspaceId,
        outputPath: input.storagePath
      });
    if (refreshedDocumentLink.status === "ready") {
      return refreshedDocumentLink.link;
    }
    throw new BadRequestException(
      `Document output ${input.storagePath} was auto-registered during files.attach, but link resolution did not find the current registered output afterwards.`
    );
  }
}
