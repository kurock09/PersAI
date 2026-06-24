import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { AssistantChatMessageAttachment } from "../domain/assistant-chat-message-attachment.entity";
import {
  ASSISTANT_CHAT_REPOSITORY,
  type AssistantChatRepository
} from "../domain/assistant-chat.repository";
import { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";
import { EXTERNAL_DOWNLOAD_STORAGE_PATH_PREFIX } from "./media/media.types";
import { ResolveActiveAssistantService } from "./resolve-active-assistant.service";

export type WorkspaceFilesGalleryTypeFilter = "image" | "video" | "document";

export type ChatWorkspaceFileTile = {
  storagePath: string;
  thumbnailStoragePath: string | null;
  posterStoragePath: string | null;
  originalFilename: string | null;
  mimeType: string;
  sizeBytes: number;
  attachmentType: string;
  createdAt: string;
  chatId: string;
  messageId: string;
};

const DEFAULT_LIMIT = 48;
const MAX_LIMIT = 100;
const GALLERY_ATTACHMENT_TYPES = new Set(["image", "video", "document", "audio"]);

function isVoiceNoteAttachment(attachment: AssistantChatMessageAttachment): boolean {
  if (attachment.attachmentType === "voice") {
    return true;
  }
  const metadata = attachment.metadata;
  if (metadata === null || typeof metadata !== "object" || Array.isArray(metadata)) {
    return false;
  }
  return metadata.source === "voice_input" || metadata.audioAsVoice === true;
}

function isGalleryEligible(attachment: AssistantChatMessageAttachment): boolean {
  if (attachment.processingStatus !== "ready") {
    return false;
  }
  if (attachment.storagePath === null || attachment.storagePath.trim().length === 0) {
    return false;
  }
  if (attachment.attachmentType === "tool_output") {
    return false;
  }
  if (!GALLERY_ATTACHMENT_TYPES.has(attachment.attachmentType)) {
    return false;
  }
  if (attachment.storagePath.startsWith(EXTERNAL_DOWNLOAD_STORAGE_PATH_PREFIX)) {
    return false;
  }
  if (isVoiceNoteAttachment(attachment)) {
    return false;
  }
  return true;
}

function matchesTypeFilter(
  attachmentType: string,
  type: WorkspaceFilesGalleryTypeFilter | undefined
): boolean {
  if (type === undefined) {
    return true;
  }
  return attachmentType === type;
}

function dedupeByStoragePath(
  attachments: AssistantChatMessageAttachment[]
): AssistantChatMessageAttachment[] {
  const byPath = new Map<string, AssistantChatMessageAttachment>();
  for (const attachment of attachments) {
    const storagePath = attachment.storagePath;
    if (storagePath === null) {
      continue;
    }
    const existing = byPath.get(storagePath);
    if (existing === undefined || attachment.createdAt > existing.createdAt) {
      byPath.set(storagePath, attachment);
    }
  }
  return [...byPath.values()];
}

function toTile(attachment: AssistantChatMessageAttachment): ChatWorkspaceFileTile {
  return {
    storagePath: attachment.storagePath!,
    thumbnailStoragePath: attachment.thumbnailStoragePath,
    posterStoragePath: attachment.posterStoragePath,
    originalFilename: attachment.originalFilename,
    mimeType: attachment.mimeType,
    sizeBytes: Number(attachment.sizeBytes),
    attachmentType: attachment.attachmentType,
    createdAt: attachment.createdAt.toISOString(),
    chatId: attachment.chatId,
    messageId: attachment.messageId
  };
}

/** ADR-126 v3 W5 — workspace-scoped tile gallery rows for Settings → Files. */
@Injectable()
export class ListChatWorkspaceFilesService {
  constructor(
    private readonly resolveActiveAssistantService: ResolveActiveAssistantService,
    @Inject(ASSISTANT_CHAT_REPOSITORY)
    private readonly chatRepository: AssistantChatRepository,
    private readonly prisma: WorkspaceManagementPrismaService
  ) {}

  async execute(input: {
    userId: string;
    chatId: string;
    type?: string | null;
    cursor?: string | null;
    limit?: number | null;
  }): Promise<{ files: ChatWorkspaceFileTile[]; nextCursor: string | null }> {
    const assistant = (await this.resolveActiveAssistantService.execute({ userId: input.userId }))
      .assistant;
    const chat = await this.chatRepository.findChatById(input.chatId);
    if (chat === null || chat.assistantId !== assistant.id || chat.surface !== "web") {
      throw new NotFoundException("Web chat does not exist for this assistant.");
    }

    const typeFilter = this.parseTypeFilter(input.type);
    const limit = this.parseLimit(input.limit);

    const records = await this.prisma.assistantChatMessageAttachment.findMany({
      where: {
        workspaceId: chat.workspaceId,
        assistantId: assistant.id
      },
      orderBy: { createdAt: "desc" }
    });

    const eligible = dedupeByStoragePath(
      records
        .map((record) => this.mapRecord(record))
        .filter(isGalleryEligible)
        .filter((attachment) => matchesTypeFilter(attachment.attachmentType, typeFilter))
    ).sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime());

    let startIndex = 0;
    if (typeof input.cursor === "string" && input.cursor.trim().length > 0) {
      const cursorIndex = eligible.findIndex((row) => row.storagePath === input.cursor!.trim());
      if (cursorIndex >= 0) {
        startIndex = cursorIndex + 1;
      }
    }

    const page = eligible.slice(startIndex, startIndex + limit);
    const nextCursor =
      startIndex + limit < eligible.length && page.length > 0
        ? page[page.length - 1]!.storagePath!
        : null;

    return {
      files: page.map(toTile),
      nextCursor
    };
  }

  private parseTypeFilter(
    value: string | null | undefined
  ): WorkspaceFilesGalleryTypeFilter | undefined {
    if (value === undefined || value === null || value.trim().length === 0 || value === "all") {
      return undefined;
    }
    if (value === "image" || value === "video" || value === "document") {
      return value;
    }
    throw new BadRequestException(
      'Query param "type" must be one of: all, image, video, document.'
    );
  }

  private parseLimit(value: number | null | undefined): number {
    if (value === undefined || value === null) {
      return DEFAULT_LIMIT;
    }
    if (!Number.isFinite(value) || value <= 0) {
      throw new BadRequestException('Query param "limit" must be a positive integer.');
    }
    return Math.min(Math.floor(value), MAX_LIMIT);
  }

  private mapRecord(record: {
    id: string;
    messageId: string;
    chatId: string;
    assistantId: string;
    workspaceId: string;
    attachmentType: AssistantChatMessageAttachment["attachmentType"];
    storagePath: string | null;
    thumbnailStoragePath: string | null;
    posterStoragePath: string | null;
    originalFilename: string | null;
    mimeType: string;
    sizeBytes: bigint;
    durationMs: number | null;
    width: number | null;
    height: number | null;
    processingStatus: AssistantChatMessageAttachment["processingStatus"];
    transcription: string | null;
    billingFactsJson: unknown;
    metadata: unknown;
    clientTurnId: string | null;
    clientAttachmentId: string | null;
    createdAt: Date;
  }): AssistantChatMessageAttachment {
    return {
      id: record.id,
      messageId: record.messageId,
      chatId: record.chatId,
      assistantId: record.assistantId,
      workspaceId: record.workspaceId,
      attachmentType: record.attachmentType,
      storagePath: record.storagePath,
      thumbnailStoragePath: record.thumbnailStoragePath,
      posterStoragePath: record.posterStoragePath,
      originalFilename: record.originalFilename,
      mimeType: record.mimeType,
      sizeBytes: record.sizeBytes,
      durationMs: record.durationMs,
      width: record.width,
      height: record.height,
      processingStatus: record.processingStatus,
      transcription: record.transcription,
      billingFacts: null,
      metadata:
        record.metadata !== null &&
        typeof record.metadata === "object" &&
        !Array.isArray(record.metadata)
          ? (record.metadata as Record<string, unknown>)
          : null,
      clientTurnId: record.clientTurnId,
      clientAttachmentId: record.clientAttachmentId,
      createdAt: record.createdAt
    };
  }
}
