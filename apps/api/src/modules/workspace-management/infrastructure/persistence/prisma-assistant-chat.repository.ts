import { Injectable } from "@nestjs/common";
import {
  Prisma,
  type AssistantChat as PrismaAssistantChat,
  type AssistantChatMessage as PrismaAssistantChatMessage
} from "@prisma/client";
import type { AssistantChatMessage } from "../../domain/assistant-chat-message.entity";
import type { AssistantChat, AssistantChatSurface } from "../../domain/assistant-chat.entity";
import type {
  AssistantChatListMetadata,
  AssistantChatRepository,
  CreateAssistantChatInput,
  CreateAssistantChatMessageInput,
  GetOrCreateWebChatUnderCapInput,
  GetOrCreateWebChatUnderCapResult,
  UpdateAssistantChatInput
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
        title: input.title,
        deepModeEnabled: input.deepModeEnabled ?? false
      }
    });

    return this.mapChatToDomain(chat);
  }

  async findOrCreateChatBySurfaceThread(input: CreateAssistantChatInput): Promise<AssistantChat> {
    try {
      return await this.createChat(input);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError ||
        (typeof error === "object" && error !== null && "code" in error && error.code === "P2002")
      ) {
        const existing = await this.findChatBySurfaceThread(
          input.assistantId,
          input.surface,
          input.surfaceThreadKey
        );
        if (existing !== null) {
          return existing;
        }
      }
      throw error;
    }
  }

  async getOrCreateWebChatBySurfaceThreadUnderCap(
    input: GetOrCreateWebChatUnderCapInput
  ): Promise<GetOrCreateWebChatUnderCapResult> {
    const maxRetries = 3;

    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      try {
        return await this.prisma.$transaction(
          async (tx) => {
            const existing = await tx.assistantChat.findUnique({
              where: {
                assistantId_surface_surfaceThreadKey: {
                  assistantId: input.assistantId,
                  surface: "web",
                  surfaceThreadKey: input.surfaceThreadKey
                }
              }
            });

            if (existing !== null) {
              return {
                outcome: "existing",
                chat: this.mapChatToDomain(existing)
              };
            }

            const activeCount = await tx.assistantChat.count({
              where: {
                assistantId: input.assistantId,
                surface: "web",
                archivedAt: null
              }
            });

            if (activeCount >= input.activeWebChatsLimit) {
              return {
                outcome: "cap_reached",
                activeCount,
                limit: input.activeWebChatsLimit
              };
            }

            const created = await tx.assistantChat.create({
              data: {
                assistantId: input.assistantId,
                userId: input.userId,
                workspaceId: input.workspaceId,
                surface: "web",
                surfaceThreadKey: input.surfaceThreadKey,
                title: input.title,
                deepModeEnabled: input.deepModeEnabled ?? false
              }
            });

            return {
              outcome: "created",
              chat: this.mapChatToDomain(created)
            };
          },
          {
            isolationLevel: Prisma.TransactionIsolationLevel.Serializable
          }
        );
      } catch (error) {
        const prismaCode =
          error instanceof Prisma.PrismaClientKnownRequestError ? error.code : null;
        if (prismaCode === "P2034" && attempt < maxRetries) {
          continue;
        }

        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
          const existing = await this.findChatBySurfaceThread(
            input.assistantId,
            "web",
            input.surfaceThreadKey
          );
          if (existing !== null) {
            return {
              outcome: "existing",
              chat: existing
            };
          }
        }

        throw error;
      }
    }

    throw new Error("Failed to reserve active web chat slot after serialization retries.");
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

  async countActiveChatsByAssistantIdAndSurface(
    assistantId: string,
    surface: AssistantChatSurface
  ): Promise<number> {
    return this.prisma.assistantChat.count({
      where: {
        assistantId,
        surface,
        archivedAt: null
      }
    });
  }

  async listChatsByAssistantId(assistantId: string): Promise<AssistantChat[]> {
    const chats = await this.prisma.assistantChat.findMany({
      where: { assistantId },
      orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }]
    });

    return chats.map((chat) => this.mapChatToDomain(chat));
  }

  async getChatListMetadata(chatId: string): Promise<AssistantChatListMetadata> {
    const [messageCount, latestMessage] = await this.prisma.$transaction([
      this.prisma.assistantChatMessage.count({
        where: { chatId }
      }),
      this.prisma.assistantChatMessage.findFirst({
        where: { chatId },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        select: { content: true }
      })
    ]);

    return {
      messageCount,
      lastMessagePreview: latestMessage?.content ?? null
    };
  }

  async updateChat(chatId: string, input: UpdateAssistantChatInput): Promise<AssistantChat | null> {
    const existingChat = await this.prisma.assistantChat.findUnique({
      where: { id: chatId },
      select: { id: true }
    });

    if (existingChat === null) {
      return null;
    }

    const chat = await this.prisma.assistantChat.update({
      where: { id: chatId },
      data: {
        ...(input.title === undefined ? {} : { title: input.title }),
        ...(input.deepModeEnabled === undefined ? {} : { deepModeEnabled: input.deepModeEnabled })
      }
    });

    return this.mapChatToDomain(chat);
  }

  async archiveChat(chatId: string): Promise<AssistantChat | null> {
    const existingChat = await this.prisma.assistantChat.findUnique({
      where: { id: chatId },
      select: { id: true }
    });

    if (existingChat === null) {
      return null;
    }

    const chat = await this.prisma.assistantChat.update({
      where: { id: chatId },
      data: {
        archivedAt: new Date()
      }
    });

    return this.mapChatToDomain(chat);
  }

  async hardDeleteChat(chatId: string, assistantId: string): Promise<boolean> {
    const existingChat = await this.prisma.assistantChat.findUnique({
      where: { id: chatId },
      select: { id: true, assistantId: true }
    });
    if (existingChat === null || existingChat.assistantId !== assistantId) {
      return false;
    }

    await this.prisma.$transaction([
      this.prisma.assistantChatMessage.deleteMany({
        where: {
          chatId,
          assistantId
        }
      }),
      this.prisma.assistantChat.delete({
        where: {
          id_assistantId: {
            id: chatId,
            assistantId
          }
        }
      })
    ]);

    return true;
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

  async deleteMessage(messageId: string, assistantId: string): Promise<boolean> {
    const existingMessage = await this.prisma.assistantChatMessage.findFirst({
      where: { id: messageId, assistantId },
      select: { chatId: true }
    });
    if (existingMessage === null) {
      return false;
    }

    return this.prisma.$transaction(async (tx) => {
      const deleted = await tx.assistantChatMessage.deleteMany({
        where: { id: messageId, assistantId }
      });
      if (deleted.count === 0) {
        return false;
      }

      const latestMessage = await tx.assistantChatMessage.findFirst({
        where: { chatId: existingMessage.chatId, assistantId },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        select: { createdAt: true }
      });
      await tx.assistantChat.update({
        where: { id: existingMessage.chatId },
        data: { lastMessageAt: latestMessage?.createdAt ?? null }
      });
      return true;
    });
  }

  async listMessagesByChatId(chatId: string): Promise<AssistantChatMessage[]> {
    const messages = await this.prisma.assistantChatMessage.findMany({
      where: { chatId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }]
    });

    return messages.map((message) => this.mapMessageToDomain(message));
  }

  async findMessageByIdForAssistant(
    messageId: string,
    assistantId: string
  ): Promise<AssistantChatMessage | null> {
    const message = await this.prisma.assistantChatMessage.findFirst({
      where: { id: messageId, assistantId }
    });

    return message ? this.mapMessageToDomain(message) : null;
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
      deepModeEnabled: chat.deepModeEnabled,
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
