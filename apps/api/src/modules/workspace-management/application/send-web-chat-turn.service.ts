import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException
} from "@nestjs/common";
import { loadApiConfig } from "@persai/config";
import {
  ASSISTANT_CHAT_REPOSITORY,
  type AssistantChatRepository
} from "../domain/assistant-chat.repository";
import {
  ASSISTANT_PUBLISHED_VERSION_REPOSITORY,
  type AssistantPublishedVersionRepository
} from "../domain/assistant-published-version.repository";
import { ASSISTANT_REPOSITORY, type AssistantRepository } from "../domain/assistant.repository";
import {
  ASSISTANT_RUNTIME_ADAPTER,
  type AssistantRuntimeAdapter
} from "./assistant-runtime-adapter.types";
import { WEB_CHAT_GLOBAL_MEMORY_WRITE_CONTEXT } from "../domain/memory-source-policy";
import { RecordWebChatMemoryTurnService } from "./record-web-chat-memory-turn.service";
import { TrackWorkspaceQuotaUsageService } from "./track-workspace-quota-usage.service";
import type { AssistantWebChatTurnState } from "./web-chat.types";

export interface SendWebChatTurnRequest {
  surfaceThreadKey: string;
  message: string;
  title?: string | null;
}

function normalizeOptionalTitle(value: unknown): string | null | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (value === null) {
    return null;
  }

  if (typeof value !== "string" || value.trim().length === 0) {
    throw new BadRequestException("title must be a non-empty string, null, or omitted.");
  }

  return value.trim();
}

@Injectable()
export class SendWebChatTurnService {
  constructor(
    @Inject(ASSISTANT_REPOSITORY)
    private readonly assistantRepository: AssistantRepository,
    @Inject(ASSISTANT_PUBLISHED_VERSION_REPOSITORY)
    private readonly assistantPublishedVersionRepository: AssistantPublishedVersionRepository,
    @Inject(ASSISTANT_CHAT_REPOSITORY)
    private readonly assistantChatRepository: AssistantChatRepository,
    @Inject(ASSISTANT_RUNTIME_ADAPTER)
    private readonly assistantRuntimeAdapter: AssistantRuntimeAdapter,
    private readonly recordWebChatMemoryTurnService: RecordWebChatMemoryTurnService,
    private readonly trackWorkspaceQuotaUsageService: TrackWorkspaceQuotaUsageService
  ) {}

  parseInput(payload: unknown): SendWebChatTurnRequest {
    if (typeof payload !== "object" || payload === null) {
      throw new BadRequestException("Web chat payload must be an object.");
    }

    const body = payload as Record<string, unknown>;
    const surfaceThreadKey = body.surfaceThreadKey;
    const message = body.message;
    const title = normalizeOptionalTitle(body.title);

    if (typeof surfaceThreadKey !== "string" || surfaceThreadKey.trim().length === 0) {
      throw new BadRequestException("surfaceThreadKey must be a non-empty string.");
    }
    if (typeof message !== "string" || message.trim().length === 0) {
      throw new BadRequestException("message must be a non-empty string.");
    }

    return {
      surfaceThreadKey: surfaceThreadKey.trim(),
      message: message.trim(),
      ...(title !== undefined ? { title } : {})
    };
  }

  async execute(userId: string, request: SendWebChatTurnRequest): Promise<AssistantWebChatTurnState> {
    const assistant = await this.assistantRepository.findByUserId(userId);
    if (assistant === null) {
      throw new NotFoundException("Assistant does not exist for this user.");
    }

    const latestPublishedVersion =
      await this.assistantPublishedVersionRepository.findLatestByAssistantId(assistant.id);
    if (latestPublishedVersion === null) {
      throw new ConflictException(
        "Assistant transport is unavailable until at least one version is published."
      );
    }

    if (
      assistant.applyStatus !== "succeeded" ||
      assistant.applyAppliedVersionId !== latestPublishedVersion.id
    ) {
      throw new ConflictException(
        "Assistant transport requires the latest published version to be successfully applied."
      );
    }

    const existingChat = await this.assistantChatRepository.findChatBySurfaceThread(
      assistant.id,
      "web",
      request.surfaceThreadKey
    );
    if (existingChat === null) {
      const activeChatsCount = await this.assistantChatRepository.countActiveChatsByAssistantIdAndSurface(
        assistant.id,
        "web"
      );
      const activeChatsCap = loadApiConfig(process.env).WEB_ACTIVE_CHATS_CAP;
      if (activeChatsCount >= activeChatsCap) {
        throw new ConflictException(
          `Active web chats cap reached (${activeChatsCap}). Archive an existing chat or continue in an existing thread.`
        );
      }
    }
    const chat =
      existingChat ??
      (await this.assistantChatRepository.createChat({
        assistantId: assistant.id,
        userId: assistant.userId,
        workspaceId: assistant.workspaceId,
        surface: "web",
        surfaceThreadKey: request.surfaceThreadKey,
        title: request.title ?? null
      }));

    const userMessage = await this.assistantChatRepository.createMessage({
      chatId: chat.id,
      assistantId: assistant.id,
      author: "user",
      content: request.message
    });

    const runtimeResponse = await this.assistantRuntimeAdapter.sendWebChatTurn({
      assistantId: assistant.id,
      publishedVersionId: latestPublishedVersion.id,
      chatId: chat.id,
      surfaceThreadKey: chat.surfaceThreadKey,
      userMessageId: userMessage.id,
      userMessage: userMessage.content
    });

    const assistantMessage = await this.assistantChatRepository.createMessage({
      chatId: chat.id,
      assistantId: assistant.id,
      author: "assistant",
      content: runtimeResponse.assistantMessage
    });

    await this.recordWebChatMemoryTurnService.execute({
      assistantId: assistant.id,
      userId: assistant.userId,
      workspaceId: assistant.workspaceId,
      chatId: chat.id,
      userMessageId: userMessage.id,
      assistantMessageId: assistantMessage.id,
      userContent: userMessage.content,
      assistantContent: runtimeResponse.assistantMessage,
      memoryWriteContext: WEB_CHAT_GLOBAL_MEMORY_WRITE_CONTEXT
    });
    await this.trackWorkspaceQuotaUsageService.recordWebChatTurnUsage({
      assistant,
      userContent: userMessage.content,
      assistantContent: assistantMessage.content,
      source: "web_chat_turn_sync"
    });
    const activeWebChatsCurrent = await this.assistantChatRepository.countActiveChatsByAssistantIdAndSurface(
      assistant.id,
      "web"
    );
    await this.trackWorkspaceQuotaUsageService.refreshActiveWebChatsUsage({
      assistant,
      activeWebChatsCurrent,
      source: "web_chat_turn_prepare"
    });

    const refreshedChat = await this.assistantChatRepository.findChatById(chat.id);
    if (refreshedChat === null) {
      throw new NotFoundException("Chat does not exist for this assistant.");
    }

    return {
      chat: {
        id: refreshedChat.id,
        assistantId: refreshedChat.assistantId,
        surface: refreshedChat.surface,
        surfaceThreadKey: refreshedChat.surfaceThreadKey,
        title: refreshedChat.title,
        archivedAt: refreshedChat.archivedAt?.toISOString() ?? null,
        lastMessageAt: refreshedChat.lastMessageAt?.toISOString() ?? null,
        createdAt: refreshedChat.createdAt.toISOString(),
        updatedAt: refreshedChat.updatedAt.toISOString()
      },
      userMessage: {
        id: userMessage.id,
        chatId: userMessage.chatId,
        assistantId: userMessage.assistantId,
        author: userMessage.author,
        content: userMessage.content,
        createdAt: userMessage.createdAt.toISOString()
      },
      assistantMessage: {
        id: assistantMessage.id,
        chatId: assistantMessage.chatId,
        assistantId: assistantMessage.assistantId,
        author: assistantMessage.author,
        content: assistantMessage.content,
        createdAt: assistantMessage.createdAt.toISOString()
      },
      runtime: {
        respondedAt: runtimeResponse.respondedAt
      }
    };
  }
}

