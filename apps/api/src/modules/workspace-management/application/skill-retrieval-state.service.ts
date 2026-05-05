import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import {
  ASSISTANT_CHAT_REPOSITORY,
  type AssistantChatRepository
} from "../domain/assistant-chat.repository";
import type {
  AssistantChatSkillRetrievalDecisionMode as SkillRetrievalDecisionMode,
  AssistantChatSkillRetrievalState as SkillRetrievalState
} from "../domain/assistant-chat.entity";
import { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";
import { Inject } from "@nestjs/common";

export type { SkillRetrievalDecisionMode, SkillRetrievalState };

export type SkillRetrievalChatContext = {
  chatId: string;
  currentUserMessageId: string;
  currentUserMessageIndex: number;
  state: SkillRetrievalState | null;
};

@Injectable()
export class SkillRetrievalStateService {
  constructor(
    private readonly prisma: WorkspaceManagementPrismaService,
    @Inject(ASSISTANT_CHAT_REPOSITORY)
    private readonly assistantChatRepository: AssistantChatRepository
  ) {}

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
    const chat = await this.assistantChatRepository.findChatBySurfaceThread(
      input.assistantId,
      surface,
      surfaceThreadKey
    );
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
      state: chat.skillRetrievalState
    };
  }

  async persistState(chatId: string, state: SkillRetrievalState | null): Promise<void> {
    await this.assistantChatRepository.updateChat(chatId, {
      skillRetrievalState: state
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
    const chat = await this.assistantChatRepository.findChatById(input.chatId);
    const state = chat?.skillRetrievalState ?? null;
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
