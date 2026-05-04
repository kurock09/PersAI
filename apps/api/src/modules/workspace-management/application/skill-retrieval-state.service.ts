import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";

export type SkillRetrievalDecisionMode =
  | "reuse_cached_refs"
  | "refresh_search_only"
  | "refresh_with_helper";

export type SkillRetrievalState = {
  activeSkillId: string;
  lastUserMessageId: string;
  lastUserQueryFingerprint: string;
  lastTopReferenceIds: string[];
  lastTopReferenceScores: number[];
  lastRetrievedAtMessageIndex: number;
  lastMode: SkillRetrievalDecisionMode;
  lastHelperApplied: boolean;
  lastHelperChangedOrder: boolean;
  reuseStreak: number;
  lastCandidateSetHash: string | null;
};

export type SkillRetrievalChatContext = {
  chatId: string;
  currentUserMessageId: string;
  currentUserMessageIndex: number;
  state: SkillRetrievalState | null;
};

@Injectable()
export class SkillRetrievalStateService {
  constructor(private readonly prisma: WorkspaceManagementPrismaService) {}

  async resolveChatContext(input: {
    assistantId: string;
    conversation:
      | {
          channel: string;
          surfaceThreadKey: string;
        }
      | null
      | undefined;
  }): Promise<SkillRetrievalChatContext | null> {
    const surface =
      input.conversation?.channel === "web" || input.conversation?.channel === "telegram"
        ? input.conversation.channel
        : null;
    const surfaceThreadKey = input.conversation?.surfaceThreadKey?.trim() ?? null;
    if (surface === null || surfaceThreadKey === null || surfaceThreadKey.length === 0) {
      return null;
    }
    const chat = await this.prisma.assistantChat.findUnique({
      where: {
        assistantId_surface_surfaceThreadKey: {
          assistantId: input.assistantId,
          surface,
          surfaceThreadKey
        }
      },
      select: {
        id: true,
        skillRetrievalState: true
      }
    });
    if (chat === null) {
      return null;
    }
    const [currentUserMessage, currentUserMessageIndex] = await Promise.all([
      this.prisma.assistantChatMessage.findFirst({
        where: {
          chatId: chat.id,
          assistantId: input.assistantId,
          author: "user"
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        select: { id: true }
      }),
      this.prisma.assistantChatMessage.count({
        where: {
          chatId: chat.id,
          assistantId: input.assistantId,
          author: "user"
        }
      })
    ]);
    if (currentUserMessage === null || currentUserMessageIndex <= 0) {
      return null;
    }
    return {
      chatId: chat.id,
      currentUserMessageId: currentUserMessage.id,
      currentUserMessageIndex,
      state: this.parseState(chat.skillRetrievalState)
    };
  }

  async persistState(chatId: string, state: SkillRetrievalState | null): Promise<void> {
    await this.prisma.assistantChat.update({
      where: { id: chatId },
      data: {
        skillRetrievalState:
          state === null ? Prisma.DbNull : (state as unknown as Prisma.InputJsonValue)
      }
    });
  }

  async clearForChat(chatId: string): Promise<void> {
    await this.persistState(chatId, null);
  }

  async clearForAssistant(assistantId: string): Promise<void> {
    await this.prisma.assistantChat.updateMany({
      where: { assistantId },
      data: {
        skillRetrievalState: Prisma.DbNull
      }
    });
  }

  async clearForChatWhenSkillMismatches(input: {
    chatId: string;
    activeSkillId: string | null;
  }): Promise<void> {
    const chat = await this.prisma.assistantChat.findUnique({
      where: { id: input.chatId },
      select: { skillRetrievalState: true }
    });
    const state = this.parseState(chat?.skillRetrievalState);
    if (state === null) {
      return;
    }
    if (input.activeSkillId === null || state.activeSkillId !== input.activeSkillId) {
      await this.clearForChat(input.chatId);
    }
  }

  parseState(value: unknown): SkillRetrievalState | null {
    if (
      value === null ||
      value === undefined ||
      typeof value !== "object" ||
      Array.isArray(value)
    ) {
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
    const lastTopReferenceIds = Array.isArray(row.lastTopReferenceIds)
      ? row.lastTopReferenceIds.filter((entry): entry is string => typeof entry === "string")
      : [];
    const lastTopReferenceScores = Array.isArray(row.lastTopReferenceScores)
      ? row.lastTopReferenceScores.filter(
          (entry): entry is number => typeof entry === "number" && Number.isFinite(entry)
        )
      : [];
    return {
      activeSkillId,
      lastUserMessageId,
      lastUserQueryFingerprint,
      lastTopReferenceIds,
      lastTopReferenceScores,
      lastRetrievedAtMessageIndex,
      lastMode,
      lastHelperApplied: row.lastHelperApplied === true,
      lastHelperChangedOrder: row.lastHelperChangedOrder === true,
      reuseStreak,
      lastCandidateSetHash:
        typeof row.lastCandidateSetHash === "string" ? row.lastCandidateSetHash : null
    };
  }

  buildQueryFingerprint(query: string): string {
    return query.replace(/\s+/g, " ").trim().toLowerCase().slice(0, 512);
  }
}
