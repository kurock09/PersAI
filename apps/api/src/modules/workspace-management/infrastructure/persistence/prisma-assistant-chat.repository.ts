import { Injectable } from "@nestjs/common";
import type {
  AssistantChat as PrismaAssistantChat,
  AssistantChatMessage as PrismaAssistantChatMessage
} from "@prisma/client";
import type { AssistantChatMessage } from "../../domain/assistant-chat-message.entity";
import type { AssistantChat, AssistantChatSurface } from "../../domain/assistant-chat.entity";
import type {
  AssistantChatRepository,
  CreateAssistantChatInput,
  CreateAssistantChatMessageInput
} from "../../domain/assistant-chat.repository";
import { WorkspaceManagementPrismaService } from "./workspace-management-prisma.service";

@Injectable()
export class PrismaAssistantChatRepository implements AssistantChatRepository {
  constructor(private readonly prisma: WorkspaceManagementPrismaService) {}

  async createChat(input: CreateAssistantChatInput): Promise<AssistantChat> {
    const chat = await this.prisma.assistantChat.create({
      data: {
        assistantId: input.assistantId,
        userId: input.userId,
        workspaceId: input.workspaceId,
        surface: input.surface,
        surfaceThreadKey: input.surfaceThreadKey,
        title: input.title
      }
    });

    return this.mapChatToDomain(chat);
  }

  async findChatById(chatId: string): Promise<AssistantChat | null> {
    const chat = await this.prisma.assistantChat.findUnique({
      where: { id: chatId }
    });

    return chat ? this.mapChatToDomain(chat) : null;
  }

  async findChatBySurfaceThread(
    assistantId: string,
    surface: AssistantChatSurface,
    surfaceThreadKey: string
  ): Promise<AssistantChat | null> {
    const chat = await this.prisma.assistantChat.findUnique({
      where: {
        assistantId_surface_surfaceThreadKey: {
          assistantId,
          surface,
          surfaceThreadKey
        }
      }
    });

    return chat ? this.mapChatToDomain(chat) : null;
  }

  async listChatsByAssistantId(assistantId: string): Promise<AssistantChat[]> {
    const chats = await this.prisma.assistantChat.findMany({
      where: { assistantId },
      orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }]
    });

    return chats.map((chat) => this.mapChatToDomain(chat));
  }

  async createMessage(input: CreateAssistantChatMessageInput): Promise<AssistantChatMessage> {
    const createdAt = new Date();

    const [message] = await this.prisma.$transaction([
      this.prisma.assistantChatMessage.create({
        data: {
          chatId: input.chatId,
          assistantId: input.assistantId,
          author: input.author,
          content: input.content,
          createdAt
        }
      }),
      this.prisma.assistantChat.update({
        where: { id: input.chatId },
        data: { lastMessageAt: createdAt }
      })
    ]);

    return this.mapMessageToDomain(message);
  }

  async listMessagesByChatId(chatId: string): Promise<AssistantChatMessage[]> {
    const messages = await this.prisma.assistantChatMessage.findMany({
      where: { chatId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }]
    });

    return messages.map((message) => this.mapMessageToDomain(message));
  }

  private mapChatToDomain(chat: PrismaAssistantChat): AssistantChat {
    return {
      id: chat.id,
      assistantId: chat.assistantId,
      userId: chat.userId,
      workspaceId: chat.workspaceId,
      surface: chat.surface,
      surfaceThreadKey: chat.surfaceThreadKey,
      title: chat.title,
      archivedAt: chat.archivedAt,
      lastMessageAt: chat.lastMessageAt,
      createdAt: chat.createdAt,
      updatedAt: chat.updatedAt
    };
  }

  private mapMessageToDomain(message: PrismaAssistantChatMessage): AssistantChatMessage {
    return {
      id: message.id,
      chatId: message.chatId,
      assistantId: message.assistantId,
      author: message.author,
      content: message.content,
      createdAt: message.createdAt
    };
  }
}

