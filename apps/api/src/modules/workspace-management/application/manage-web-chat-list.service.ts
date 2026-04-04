import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import {
  ASSISTANT_CHAT_MESSAGE_ATTACHMENT_REPOSITORY,
  type AssistantChatMessageAttachmentRepository
} from "../domain/assistant-chat-message-attachment.repository";
import {
  ASSISTANT_CHAT_REPOSITORY,
  type AssistantChatRepository
} from "../domain/assistant-chat.repository";
import { ASSISTANT_REPOSITORY, type AssistantRepository } from "../domain/assistant.repository";
import {
  ASSISTANT_RUNTIME_ADAPTER,
  type AssistantRuntimeAdapter
} from "./assistant-runtime-adapter.types";
import { ResolveAssistantRuntimeTierService } from "./resolve-assistant-runtime-tier.service";
import { TrackWorkspaceQuotaUsageService } from "./track-workspace-quota-usage.service";
import type {
  AssistantWebChatListItemState,
  AssistantWebChatMessageAttachmentState,
  AssistantWebChatMessageState
} from "./web-chat.types";

export interface RenameWebChatRequest {
  title: string | null;
}

export interface DeleteWebChatRequest {
  confirmText: string;
}

function toChatState(chat: {
  id: string;
  assistantId: string;
  surface: "web" | "telegram";
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
    @Inject(ASSISTANT_CHAT_MESSAGE_ATTACHMENT_REPOSITORY)
    private readonly attachmentRepository: AssistantChatMessageAttachmentRepository,
    @Inject(ASSISTANT_RUNTIME_ADAPTER)
    private readonly runtimeAdapter: AssistantRuntimeAdapter,
    private readonly resolveAssistantRuntimeTierService: ResolveAssistantRuntimeTierService,
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
    const messageIds = allMessages.map((m) => m.id);
    const allAttachments = await this.attachmentRepository.listByMessageIds(messageIds);
    const attachmentsByMessageId = new Map<string, AssistantWebChatMessageAttachmentState[]>();
    for (const att of allAttachments) {
      const list = attachmentsByMessageId.get(att.messageId) ?? [];
      list.push({
        id: att.id,
        attachmentType: att.attachmentType,
        originalFilename: att.originalFilename,
        mimeType: att.mimeType,
        sizeBytes: Number(att.sizeBytes),
        processingStatus: att.processingStatus,
        createdAt: att.createdAt.toISOString()
      });
      attachmentsByMessageId.set(att.messageId, list);
    }

    const mapped: AssistantWebChatMessageState[] = allMessages.map((m) => ({
      id: m.id,
      chatId: m.chatId,
      assistantId: m.assistantId,
      author: m.author,
      content: m.content,
      attachments: attachmentsByMessageId.get(m.id) ?? [],
      createdAt: m.createdAt.toISOString()
    }));

    // Reverse pagination: newest first. No cursor = last N; cursor = N older than cursor.
    let endIndex = mapped.length;
    if (pagination.cursor) {
      const cursorIndex = mapped.findIndex((m) => m.id === pagination.cursor);
      if (cursorIndex >= 0) {
        endIndex = cursorIndex;
      }
    }

    const startIndex = Math.max(0, endIndex - pagination.limit);
    const page = mapped.slice(startIndex, endIndex);
    const nextCursor = startIndex > 0 && page.length > 0 ? page[0]!.id : null;

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

    await this.runtimeAdapter.deleteWebChatSession({
      assistantId: assistant.id,
      chatId: chat.id,
      surfaceThreadKey: chat.surfaceThreadKey
    });

    const runtimeTier = await this.resolveAssistantRuntimeTierService.resolveByAssistantId(
      assistant.id
    );
    await this.runtimeAdapter.deleteChatMediaBatch(assistant.id, chat.id, runtimeTier);
    await this.attachmentRepository.deleteByChatId(chat.id);

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
