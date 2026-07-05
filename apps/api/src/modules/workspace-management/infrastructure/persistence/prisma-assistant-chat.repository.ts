import { Injectable } from "@nestjs/common";
import {
  SESSION_SUBTREE_GC_GRACE_MS,
  type ProviderGatewayToolExchange
} from "@persai/runtime-contract";
import {
  Prisma,
  type AssistantChat as PrismaAssistantChat,
  type AssistantChatMessage as PrismaAssistantChatMessage
} from "@prisma/client";
import type { AssistantChatMessage } from "../../domain/assistant-chat-message.entity";
import type {
  AssistantChat,
  AssistantChatMode,
  AssistantChatSkillDecisionState,
  AssistantChatSkillRetrievalState,
  AssistantChatSurface
} from "../../domain/assistant-chat.entity";
import { chatModeToDeepModeEnabled } from "../../domain/assistant-chat.entity";
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

function resolveStoredChatMode(input: CreateAssistantChatInput | UpdateAssistantChatInput): {
  chatMode?: AssistantChatMode;
  deepModeEnabled?: boolean;
} {
  if (input.chatMode !== undefined) {
    return {
      chatMode: input.chatMode,
      deepModeEnabled: chatModeToDeepModeEnabled(input.chatMode)
    };
  }
  if (input.deepModeEnabled !== undefined) {
    return {
      chatMode: input.deepModeEnabled ? "smart" : "normal",
      deepModeEnabled: input.deepModeEnabled
    };
  }
  return {};
}

@Injectable()
export class PrismaAssistantChatRepository implements AssistantChatRepository {
  constructor(private readonly prisma: WorkspaceManagementPrismaService) {}

  async createChat(input: CreateAssistantChatInput): Promise<AssistantChat> {
    const modeState = resolveStoredChatMode(input);
    const chat = await this.prisma.assistantChat.create({
      data: {
        assistantId: input.assistantId,
        userId: input.userId,
        workspaceId: input.workspaceId,
        surface: input.surface,
        surfaceThreadKey: input.surfaceThreadKey,
        title: input.title,
        chatMode: modeState.chatMode ?? "normal",
        deepModeEnabled: modeState.deepModeEnabled ?? false
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

            if (
              input.activeWebChatsLimit !== null &&
              input.activeWebChatsLimit > 0 &&
              activeCount >= input.activeWebChatsLimit
            ) {
              return {
                outcome: "cap_reached",
                activeCount,
                limit: input.activeWebChatsLimit
              };
            }

            const modeState = resolveStoredChatMode(input);
            const created = await tx.assistantChat.create({
              data: {
                assistantId: input.assistantId,
                userId: input.userId,
                workspaceId: input.workspaceId,
                surface: "web",
                surfaceThreadKey: input.surfaceThreadKey,
                title: input.title,
                chatMode: modeState.chatMode ?? "normal",
                deepModeEnabled: modeState.deepModeEnabled ?? false
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

  async resetElevatedWebChatModesForAssistant(assistantId: string): Promise<number> {
    const result = await this.prisma.assistantChat.updateMany({
      where: {
        assistantId,
        surface: "web",
        archivedAt: null,
        chatMode: { in: ["smart", "project"] }
      },
      data: {
        chatMode: "normal",
        deepModeEnabled: false
      }
    });
    return result.count;
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

    const modeState = resolveStoredChatMode(input);
    const chat = await this.prisma.assistantChat.update({
      where: { id: chatId },
      data: {
        ...(input.title === undefined ? {} : { title: input.title }),
        ...(modeState.chatMode === undefined ? {} : { chatMode: modeState.chatMode }),
        ...(modeState.deepModeEnabled === undefined
          ? {}
          : { deepModeEnabled: modeState.deepModeEnabled }),
        ...(input.skillDecisionState === undefined
          ? {}
          : {
              skillDecisionState:
                input.skillDecisionState === null
                  ? Prisma.DbNull
                  : (input.skillDecisionState as unknown as Prisma.InputJsonValue)
            }),
        ...(input.skillRetrievalState === undefined
          ? {}
          : {
              skillRetrievalState:
                input.skillRetrievalState === null
                  ? Prisma.DbNull
                  : (input.skillRetrievalState as unknown as Prisma.InputJsonValue)
            })
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

  async hardDeleteChat(
    chatId: string,
    assistantId: string,
    options?: { workspaceId?: string }
  ): Promise<boolean> {
    const existingChat = await this.prisma.assistantChat.findUnique({
      where: { id: chatId },
      select: {
        id: true,
        assistantId: true,
        workspaceId: true,
        surface: true,
        surfaceThreadKey: true
      }
    });
    if (existingChat === null || existingChat.assistantId !== assistantId) {
      return false;
    }
    const workspaceId = options?.workspaceId ?? existingChat.workspaceId;

    await this.prisma.$transaction(async (tx) => {
      const runtimeSessions =
        existingChat.surface === "web"
          ? await tx.runtimeSession.findMany({
              where: {
                assistantId,
                channel: "web",
                externalThreadKey: existingChat.surfaceThreadKey
              },
              select: { id: true }
            })
          : [];
      const runtimeSessionIds = runtimeSessions.map((session) => session.id);
      // Schedule session-subtree GC before the chat row disappears so bytes
      // and manifest survive the hard-delete transaction for the 3-day grace.
      await tx.sandboxWorkspaceGcLease.create({
        data: {
          kind: "session_subtree",
          targetId: chatId,
          scheduledAt: new Date(Date.now() + SESSION_SUBTREE_GC_GRACE_MS),
          metadata: {
            workspaceId,
            assistantId,
            ...(runtimeSessionIds[0] !== undefined ? { sessionId: runtimeSessionIds[0] } : {})
          }
        }
      });

      if (existingChat.surface === "web") {
        await tx.runtimeTurnReceipt.deleteMany({
          where: {
            assistantId,
            channel: "web",
            externalThreadKey: existingChat.surfaceThreadKey
          }
        });

        if (runtimeSessionIds.length > 0) {
          await tx.runtimeSessionCompaction.deleteMany({
            where: {
              runtimeSessionId: { in: runtimeSessionIds },
              assistantId
            }
          });
          await tx.runtimeSession.deleteMany({
            where: {
              id: { in: runtimeSessionIds },
              assistantId,
              channel: "web",
              externalThreadKey: existingChat.surfaceThreadKey
            }
          });
        }
      }

      await tx.assistantChatMessage.deleteMany({
        where: {
          chatId,
          assistantId
        }
      });
      await tx.assistantChat.delete({
        where: {
          id_assistantId: {
            id: chatId,
            assistantId
          }
        }
      });
    });

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
          ...(input.metadata !== undefined
            ? { metadata: input.metadata as Prisma.InputJsonValue }
            : {}),
          ...(input.toolExchanges !== undefined && input.toolExchanges.length > 0
            ? { toolExchanges: input.toolExchanges as unknown as Prisma.InputJsonValue }
            : {}),
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

  async updateMessageContent(
    messageId: string,
    assistantId: string,
    content: string
  ): Promise<AssistantChatMessage | null> {
    const existingMessage = await this.prisma.assistantChatMessage.findFirst({
      where: { id: messageId, assistantId },
      select: { id: true }
    });
    if (existingMessage === null) {
      return null;
    }
    const updated = await this.prisma.assistantChatMessage.update({
      where: { id: existingMessage.id },
      data: { content }
    });
    return this.mapMessageToDomain(updated);
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

  async findLatestAssistantMessageToolContext(
    chatId: string,
    assistantId: string
  ): Promise<{
    metadata: Record<string, unknown> | null;
    toolExchanges: ProviderGatewayToolExchange[] | null;
  } | null> {
    const message = await this.prisma.assistantChatMessage.findFirst({
      where: {
        chatId,
        assistantId,
        author: "assistant",
        toolExchanges: { not: Prisma.DbNull }
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      select: {
        metadata: true,
        toolExchanges: true
      }
    });
    if (message === null) {
      return null;
    }
    return this.mapMessageToolContext(message);
  }

  async findMessageToolContextById(
    messageId: string,
    assistantId: string
  ): Promise<{
    metadata: Record<string, unknown> | null;
    toolExchanges: ProviderGatewayToolExchange[] | null;
  } | null> {
    const message = await this.prisma.assistantChatMessage.findFirst({
      where: { id: messageId, assistantId },
      select: {
        metadata: true,
        toolExchanges: true
      }
    });
    if (message === null) {
      return null;
    }
    return this.mapMessageToolContext(message);
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

  async findLastCrossSessionCarryOverAt(chatId: string): Promise<Date | null> {
    const row = await this.prisma.assistantChat.findUnique({
      where: { id: chatId },
      select: { lastCrossSessionCarryOverAt: true }
    });
    return row?.lastCrossSessionCarryOverAt ?? null;
  }

  async setLastCrossSessionCarryOverAt(chatId: string, firedAt: Date): Promise<boolean> {
    // Idempotent advance: only bump the bookkeeping cell if the new value is
    // strictly greater than the stored one. Conditional update via a WHERE
    // clause guarded by `lastCrossSessionCarryOverAt: { lt: firedAt } | null`
    // ensures concurrent fire-and-forget marks cannot regress the cooldown.
    const updated = await this.prisma.assistantChat.updateMany({
      where: {
        id: chatId,
        OR: [
          { lastCrossSessionCarryOverAt: null },
          { lastCrossSessionCarryOverAt: { lt: firedAt } }
        ]
      },
      data: { lastCrossSessionCarryOverAt: firedAt }
    });
    return updated.count > 0;
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
      chatMode: chat.chatMode,
      deepModeEnabled: chat.deepModeEnabled,
      skillDecisionState: this.parseSkillDecisionState(chat.skillDecisionState),
      skillRetrievalState: this.parseSkillRetrievalState(chat.skillRetrievalState),
      archivedAt: chat.archivedAt,
      lastMessageAt: chat.lastMessageAt,
      createdAt: chat.createdAt,
      updatedAt: chat.updatedAt
    };
  }

  private parseSkillDecisionState(value: unknown): AssistantChatSkillDecisionState | null {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return null;
    }
    const row = value as Record<string, unknown>;
    const status = row.status === "active" || row.status === "inactive" ? row.status : null;
    if (status === null) {
      return null;
    }
    const activeSkillId = typeof row.activeSkillId === "string" ? row.activeSkillId : null;
    const activeSkillName = typeof row.activeSkillName === "string" ? row.activeSkillName : null;
    const activeScenarioKey =
      typeof row.activeScenarioKey === "string" ? row.activeScenarioKey : null;
    const activeScenarioDisplayName =
      typeof row.activeScenarioDisplayName === "string" ? row.activeScenarioDisplayName : null;
    const topicSummary = typeof row.topicSummary === "string" ? row.topicSummary : null;
    return {
      status,
      activeSkillId: status === "active" ? activeSkillId : null,
      activeSkillName: status === "active" ? activeSkillName : null,
      activeScenarioKey: status === "active" ? activeScenarioKey : null,
      activeScenarioDisplayName: status === "active" ? activeScenarioDisplayName : null,
      topicSummary
    };
  }

  private mapMessageToolContext(message: {
    metadata: Prisma.JsonValue | null;
    toolExchanges: Prisma.JsonValue | null;
  }): {
    metadata: Record<string, unknown> | null;
    toolExchanges: ProviderGatewayToolExchange[] | null;
  } {
    const metadata =
      message.metadata !== null &&
      typeof message.metadata === "object" &&
      !Array.isArray(message.metadata)
        ? (message.metadata as Record<string, unknown>)
        : null;
    const toolExchanges = Array.isArray(message.toolExchanges)
      ? (message.toolExchanges as unknown as ProviderGatewayToolExchange[])
      : null;
    return { metadata, toolExchanges };
  }

  private mapMessageToDomain(message: PrismaAssistantChatMessage): AssistantChatMessage {
    return {
      id: message.id,
      chatId: message.chatId,
      assistantId: message.assistantId,
      author: message.author,
      content: message.content,
      metadata:
        message.metadata !== null &&
        typeof message.metadata === "object" &&
        !Array.isArray(message.metadata)
          ? (message.metadata as Record<string, unknown>)
          : null,
      createdAt: message.createdAt
    };
  }

  private parseSkillRetrievalState(value: unknown): AssistantChatSkillRetrievalState | null {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return null;
    }
    const row = value as Record<string, unknown>;
    const activeSkillId = typeof row.activeSkillId === "string" ? row.activeSkillId : null;
    const lastUserMessageId =
      typeof row.lastUserMessageId === "string" ? row.lastUserMessageId : null;
    const lastUserQueryFingerprint =
      typeof row.lastUserQueryFingerprint === "string" ? row.lastUserQueryFingerprint : null;
    const lastRetrievedAtMessageIndex =
      typeof row.lastRetrievedAtMessageIndex === "number" &&
      Number.isInteger(row.lastRetrievedAtMessageIndex)
        ? row.lastRetrievedAtMessageIndex
        : null;
    const lastMode =
      row.lastMode === "reuse_cached_refs" ||
      row.lastMode === "refresh_search_only" ||
      row.lastMode === "refresh_with_helper"
        ? row.lastMode
        : null;
    const reuseStreak =
      typeof row.reuseStreak === "number" && Number.isInteger(row.reuseStreak)
        ? row.reuseStreak
        : null;
    if (
      activeSkillId === null ||
      lastUserMessageId === null ||
      lastUserQueryFingerprint === null ||
      lastRetrievedAtMessageIndex === null ||
      lastMode === null ||
      reuseStreak === null
    ) {
      return null;
    }
    return {
      activeSkillId,
      lastUserMessageId,
      lastUserQueryFingerprint,
      lastTopReferenceIds: Array.isArray(row.lastTopReferenceIds)
        ? row.lastTopReferenceIds.filter((entry): entry is string => typeof entry === "string")
        : [],
      lastTopReferenceScores: Array.isArray(row.lastTopReferenceScores)
        ? row.lastTopReferenceScores.filter(
            (entry): entry is number => typeof entry === "number" && Number.isFinite(entry)
          )
        : [],
      lastRetrievedAtMessageIndex,
      lastMode,
      lastHelperApplied: row.lastHelperApplied === true,
      lastHelperChangedOrder: row.lastHelperChangedOrder === true,
      reuseStreak,
      lastCandidateSetHash:
        typeof row.lastCandidateSetHash === "string" ? row.lastCandidateSetHash : null
    };
  }
}
