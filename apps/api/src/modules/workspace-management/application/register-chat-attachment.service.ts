import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { AttachmentType } from "@prisma/client";
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
import {
  buildDefaultInspectionPath,
  inferProjectPathFromOutputPath,
  resolveVisibleWorkspaceOutputFormatFromPath
} from "./document-workspace-deliverable-gating";
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
  constructor(
    private readonly prisma: WorkspaceManagementPrismaService,
    @Inject(ASSISTANT_CHAT_MESSAGE_ATTACHMENT_REPOSITORY)
    private readonly attachmentRepository: AssistantChatMessageAttachmentRepository,
    private readonly workspaceFileMetadataService: WorkspaceFileMetadataService,
    private readonly assistantDocumentJobService: AssistantDocumentJobService
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

    const registeredDocumentLink =
      input.kind === "files.attach"
        ? await this.resolveFilesAttachDocumentLink({
            assistantId: input.assistantId,
            workspaceId: input.workspaceId,
            storagePath
          })
        : null;
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
      metadata: {
        ...(input.metadata ?? {}),
        ...(registeredDocumentLink === null ? {} : { documentLink: registeredDocumentLink }),
        kind: input.kind
      },
      clientTurnId: input.clientTurnId ?? null,
      clientAttachmentId: input.clientAttachmentId ?? null
    });

    await this.workspaceFileMetadataService.upsert({
      workspaceId: input.workspaceId,
      path: storagePath,
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
      ...(input.shortDescription !== undefined && input.shortDescription !== null
        ? { shortDescription: input.shortDescription }
        : {})
    });

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

  private async resolveFilesAttachDocumentLink(input: {
    assistantId: string;
    workspaceId: string;
    storagePath: string;
  }) {
    const currentDocumentLink =
      await this.assistantDocumentJobService.findCurrentDocumentLinkByOutputPath({
        assistantId: input.assistantId,
        workspaceId: input.workspaceId,
        outputPath: input.storagePath
      });
    if (currentDocumentLink.status === "blocked") {
      throw new BadRequestException(currentDocumentLink.message);
    }
    if (currentDocumentLink.status === "ready") {
      return currentDocumentLink.link;
    }

    const outputFormat = resolveVisibleWorkspaceOutputFormatFromPath(input.storagePath);
    if (outputFormat !== "pdf" && outputFormat !== "xlsx" && outputFormat !== "docx") {
      return null;
    }
    const workspaceProjectPath = await this.resolveProjectPathForUnregisteredDocumentOutput({
      workspaceId: input.workspaceId,
      storagePath: input.storagePath
    });
    if (workspaceProjectPath === null) {
      return null;
    }

    const defaultInspectionPath = buildDefaultInspectionPath(input.storagePath);
    const defaultInspectionExists =
      defaultInspectionPath === null
        ? false
        : (await this.workspaceFileMetadataService.get({
            workspaceId: input.workspaceId,
            path: defaultInspectionPath
          })) !== null;
    const inspectHint =
      defaultInspectionExists || defaultInspectionPath === null
        ? "Run document.register_version on this output before files.attach so final delivery keeps project/source/version provenance."
        : `Missing inspect sidecar ${defaultInspectionPath}. Run document.inspect, then document.register_version, then files.attach.`;
    throw new BadRequestException(
      `Document output ${input.storagePath} belongs to project ${workspaceProjectPath} but no current registered version points to it. ${inspectHint}`
    );
  }
}
