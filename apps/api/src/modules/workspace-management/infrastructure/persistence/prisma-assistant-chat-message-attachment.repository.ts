import { Injectable } from "@nestjs/common";
import { Prisma, type AssistantChatMessageAttachment as PrismaAttachment } from "@prisma/client";
import type {
  AssistantChatMessageAttachment,
  AttachmentProcessingStatus,
  AttachmentType
} from "../../domain/assistant-chat-message-attachment.entity";
import type {
  AssistantChatMessageAttachmentRepository,
  CreateAttachmentInput
} from "../../domain/assistant-chat-message-attachment.repository";
import { WorkspaceManagementPrismaService } from "./workspace-management-prisma.service";

@Injectable()
export class PrismaAssistantChatMessageAttachmentRepository implements AssistantChatMessageAttachmentRepository {
  constructor(private readonly prisma: WorkspaceManagementPrismaService) {}

  async create(input: CreateAttachmentInput): Promise<AssistantChatMessageAttachment> {
    const record = await this.prisma.assistantChatMessageAttachment.create({
      data: {
        messageId: input.messageId,
        chatId: input.chatId,
        assistantId: input.assistantId,
        workspaceId: input.workspaceId,
        attachmentType: input.attachmentType,
        storagePath: input.storagePath,
        originalFilename: input.originalFilename,
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes,
        durationMs: input.durationMs,
        width: input.width,
        height: input.height,
        processingStatus: input.processingStatus,
        transcription: input.transcription,
        metadata: input.metadata ? (input.metadata as Prisma.InputJsonValue) : Prisma.DbNull,
        clientTurnId: input.clientTurnId ?? null,
        clientAttachmentId: input.clientAttachmentId ?? null
      }
    });
    return this.mapToDomain(record);
  }

  async findById(id: string): Promise<AssistantChatMessageAttachment | null> {
    const record = await this.prisma.assistantChatMessageAttachment.findUnique({
      where: { id }
    });
    return record ? this.mapToDomain(record) : null;
  }

  async findStagedByClientAttachment(input: {
    assistantId: string;
    chatId: string;
    clientAttachmentId: string;
  }): Promise<AssistantChatMessageAttachment | null> {
    const record = await this.prisma.assistantChatMessageAttachment.findUnique({
      where: {
        assistantId_chatId_clientAttachmentId: {
          assistantId: input.assistantId,
          chatId: input.chatId,
          clientAttachmentId: input.clientAttachmentId
        }
      }
    });
    return record ? this.mapToDomain(record) : null;
  }

  async listByMessageId(messageId: string): Promise<AssistantChatMessageAttachment[]> {
    const records = await this.prisma.assistantChatMessageAttachment.findMany({
      where: { messageId },
      orderBy: { createdAt: "asc" }
    });
    return records.map((r) => this.mapToDomain(r));
  }

  async listByMessageIds(messageIds: string[]): Promise<AssistantChatMessageAttachment[]> {
    if (messageIds.length === 0) {
      return [];
    }
    const records = await this.prisma.assistantChatMessageAttachment.findMany({
      where: { messageId: { in: messageIds } },
      orderBy: { createdAt: "asc" }
    });
    return records.map((r) => this.mapToDomain(r));
  }

  async listByChatId(chatId: string): Promise<AssistantChatMessageAttachment[]> {
    const records = await this.prisma.assistantChatMessageAttachment.findMany({
      where: { chatId },
      orderBy: { createdAt: "asc" }
    });
    return records.map((r) => this.mapToDomain(r));
  }

  async sumSizeBytesByAssistantId(assistantId: string): Promise<bigint> {
    const result = await this.prisma.assistantChatMessageAttachment.aggregate({
      where: { assistantId },
      _sum: { sizeBytes: true }
    });
    return result._sum.sizeBytes ?? BigInt(0);
  }

  async deleteByAssistantId(assistantId: string): Promise<number> {
    const result = await this.prisma.assistantChatMessageAttachment.deleteMany({
      where: { assistantId }
    });
    return result.count;
  }

  async deleteByChatId(chatId: string): Promise<number> {
    const result = await this.prisma.assistantChatMessageAttachment.deleteMany({
      where: { chatId }
    });
    return result.count;
  }

  async sumSizeBytesByWorkspaceId(workspaceId: string): Promise<bigint> {
    const result = await this.prisma.assistantChatMessageAttachment.aggregate({
      where: { workspaceId },
      _sum: { sizeBytes: true }
    });
    return result._sum.sizeBytes ?? BigInt(0);
  }

  private mapToDomain(record: PrismaAttachment): AssistantChatMessageAttachment {
    return {
      id: record.id,
      messageId: record.messageId,
      chatId: record.chatId,
      assistantId: record.assistantId,
      workspaceId: record.workspaceId,
      attachmentType: record.attachmentType as AttachmentType,
      storagePath: record.storagePath,
      originalFilename: record.originalFilename,
      mimeType: record.mimeType,
      sizeBytes: record.sizeBytes,
      durationMs: record.durationMs,
      width: record.width,
      height: record.height,
      processingStatus: record.processingStatus as AttachmentProcessingStatus,
      transcription: record.transcription,
      metadata: record.metadata as Record<string, unknown> | null,
      clientTurnId: record.clientTurnId,
      clientAttachmentId: record.clientAttachmentId,
      createdAt: record.createdAt
    };
  }
}
