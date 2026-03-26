import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import {
  ASSISTANT_CHAT_REPOSITORY,
  type AssistantChatRepository
} from "../domain/assistant-chat.repository";
import { ASSISTANT_REPOSITORY, type AssistantRepository } from "../domain/assistant.repository";
import { TrackWorkspaceQuotaUsageService } from "./track-workspace-quota-usage.service";
import type { AssistantWebChatListItemState, AssistantWebChatMessageState } from "./web-chat.types";

export interface RenameWebChatRequest {
  title: string | null;
}

export interface DeleteWebChatRequest {
  confirmText: string;
}

function toChatState(chat: {
  id: string;
  assistantId: string;
  surface: "web";
  surfaceThreadKey: string;
  title: string | null;
  archivedAt: Date | null;
  lastMessageAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): AssistantWebChatListItemState["chat"] {
  return {
    id: chat.id,
    assistantId: chat.assistantId,
    surface: chat.surface,
    surfaceThreadKey: chat.surfaceThreadKey,
    title: chat.title,
    archivedAt: chat.archivedAt?.toISOString() ?? null,
    lastMessageAt: chat.lastMessageAt?.toISOString() ?? null,
    createdAt: chat.createdAt.toISOString(),
    updatedAt: chat.updatedAt.toISOString()
  };
}

@Injectable()
export class ManageWebChatListService {
  constructor(
    @Inject(ASSISTANT_REPOSITORY)
    private readonly assistantRepository: AssistantRepository,
    @Inject(ASSISTANT_CHAT_REPOSITORY)
    private readonly assistantChatRepository: AssistantChatRepository,
    private readonly trackWorkspaceQuotaUsageService: TrackWorkspaceQuotaUsageService
  ) {}

  parseRenameInput(payload: unknown): RenameWebChatRequest {
    if (typeof payload !== "object" || payload === null) {
      throw new BadRequestException("Rename payload must be an object.");
    }

    const body = payload as Record<string, unknown>;
    const title = body.title;
    if (title === null) {
      return { title: null };
    }
    if (typeof title !== "string") {
      throw new BadRequestException("title must be a string or null.");
    }

    const normalized = title.trim();
    if (normalized.length === 0) {
      throw new BadRequestException("title must be non-empty when provided as string.");
    }

    return {
      title: normalized
    };
  }

  parseDeleteInput(payload: unknown): DeleteWebChatRequest {
    if (typeof payload !== "object" || payload === null) {
      throw new BadRequestException("Delete payload must be an object.");
    }

    const body = payload as Record<string, unknown>;
    const confirmText = body.confirmText;
    if (typeof confirmText !== "string") {
      throw new BadRequestException("confirmText must be a string.");
    }

    return {
      confirmText: confirmText.trim()
    };
  }

  async listChats(userId: string): Promise<AssistantWebChatListItemState[]> {
    const assistant = await this.assistantRepository.findByUserId(userId);
    if (assistant === null) {
      throw new NotFoundException("Assistant does not exist for this user.");
    }

    const chats = await this.assistantChatRepository.listChatsByAssistantId(assistant.id);
    const webChats = chats.filter((chat) => chat.surface === "web");

    const items = await Promise.all(
      webChats.map(async (chat) => {
        const metadata = await this.assistantChatRepository.getChatListMetadata(chat.id);
        return {
          chat: toChatState(chat),
          messageCount: metadata.messageCount,
          lastMessagePreview: metadata.lastMessagePreview
        };
      })
    );

    return items;
  }

  async renameChat(
    userId: string,
    chatId: string,
    request: RenameWebChatRequest
  ): Promise<AssistantWebChatListItemState> {
    const assistant = await this.assistantRepository.findByUserId(userId);
    if (assistant === null) {
      throw new NotFoundException("Assistant does not exist for this user.");
    }

    const chat = await this.assistantChatRepository.findChatById(chatId);
    if (chat === null || chat.assistantId !== assistant.id || chat.surface !== "web") {
      throw new NotFoundException("Web chat does not exist for this assistant.");
    }

    const renamed = await this.assistantChatRepository.renameChat(chatId, request.title);
    if (renamed === null) {
      throw new NotFoundException("Web chat does not exist for this assistant.");
    }

    const metadata = await this.assistantChatRepository.getChatListMetadata(chatId);
    return {
      chat: toChatState(renamed),
      messageCount: metadata.messageCount,
      lastMessagePreview: metadata.lastMessagePreview
    };
  }

  async archiveChat(userId: string, chatId: string): Promise<AssistantWebChatListItemState> {
    const assistant = await this.assistantRepository.findByUserId(userId);
    if (assistant === null) {
      throw new NotFoundException("Assistant does not exist for this user.");
    }

    const chat = await this.assistantChatRepository.findChatById(chatId);
    if (chat === null || chat.assistantId !== assistant.id || chat.surface !== "web") {
      throw new NotFoundException("Web chat does not exist for this assistant.");
    }

    const archived = await this.assistantChatRepository.archiveChat(chatId);
    if (archived === null) {
      throw new NotFoundException("Web chat does not exist for this assistant.");
    }
    const activeWebChatsCurrent =
      await this.assistantChatRepository.countActiveChatsByAssistantIdAndSurface(
        assistant.id,
        "web"
      );
    await this.trackWorkspaceQuotaUsageService.refreshActiveWebChatsUsage({
      assistant,
      activeWebChatsCurrent,
      source: "web_chat_archive"
    });

    const metadata = await this.assistantChatRepository.getChatListMetadata(chatId);
    return {
      chat: toChatState(archived),
      messageCount: metadata.messageCount,
      lastMessagePreview: metadata.lastMessagePreview
    };
  }

  async listChatMessages(
    userId: string,
    chatId: string,
    pagination: { cursor: string | null; limit: number }
  ): Promise<{ messages: AssistantWebChatMessageState[]; nextCursor: string | null }> {
    const assistant = await this.assistantRepository.findByUserId(userId);
    if (assistant === null) {
      throw new NotFoundException("Assistant does not exist for this user.");
    }

    const chat = await this.assistantChatRepository.findChatById(chatId);
    if (chat === null || chat.assistantId !== assistant.id || chat.surface !== "web") {
      throw new NotFoundException("Web chat does not exist for this assistant.");
    }

    const allMessages = await this.assistantChatRepository.listMessagesByChatId(chatId);
    const mapped: AssistantWebChatMessageState[] = allMessages.map((m) => ({
      id: m.id,
      chatId: m.chatId,
      assistantId: m.assistantId,
      author: m.author,
      content: m.content,
      createdAt: m.createdAt.toISOString()
    }));

    let startIndex = 0;
    if (pagination.cursor) {
      const cursorIndex = mapped.findIndex((m) => m.id === pagination.cursor);
      if (cursorIndex >= 0) {
        startIndex = cursorIndex + 1;
      }
    }

    const page = mapped.slice(startIndex, startIndex + pagination.limit);
    const hasMore = startIndex + pagination.limit < mapped.length;
    const nextCursor = hasMore && page.length > 0 ? page[page.length - 1]!.id : null;

    return { messages: page, nextCursor };
  }

  async hardDeleteChat(
    userId: string,
    chatId: string,
    request: DeleteWebChatRequest
  ): Promise<void> {
    if (request.confirmText !== "DELETE") {
      throw new BadRequestException("confirmText must equal DELETE for hard delete.");
    }

    const assistant = await this.assistantRepository.findByUserId(userId);
    if (assistant === null) {
      throw new NotFoundException("Assistant does not exist for this user.");
    }

    const chat = await this.assistantChatRepository.findChatById(chatId);
    if (chat === null || chat.assistantId !== assistant.id || chat.surface !== "web") {
      throw new NotFoundException("Web chat does not exist for this assistant.");
    }

    const deleted = await this.assistantChatRepository.hardDeleteChat(chatId, assistant.id);
    if (!deleted) {
      throw new NotFoundException("Web chat does not exist for this assistant.");
    }
    const activeWebChatsCurrent =
      await this.assistantChatRepository.countActiveChatsByAssistantIdAndSurface(
        assistant.id,
        "web"
      );
    await this.trackWorkspaceQuotaUsageService.refreshActiveWebChatsUsage({
      assistant,
      activeWebChatsCurrent,
      source: "web_chat_hard_delete"
    });
  }
}
