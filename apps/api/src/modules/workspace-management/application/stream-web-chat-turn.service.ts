import { ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
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
import { EnforceAssistantCapabilityAndQuotaService } from "./enforce-assistant-capability-and-quota.service";
import { RecordWebChatMemoryTurnService } from "./record-web-chat-memory-turn.service";
import { TrackWorkspaceQuotaUsageService } from "./track-workspace-quota-usage.service";
import type { Assistant } from "../domain/assistant.entity";
import { EnforceAbuseRateLimitService } from "./enforce-abuse-rate-limit.service";
import type {
  AssistantWebChatMessageState,
  AssistantWebChatState,
  AssistantWebChatTurnState
} from "./web-chat.types";

export interface StreamWebChatTurnPrepared {
  chat: AssistantWebChatState;
  userMessage: AssistantWebChatMessageState;
  assistant: Assistant;
  assistantId: string;
  publishedVersionId: string;
  userId: string;
  workspaceId: string;
}

export interface StreamWebChatTurnRequest {
  surfaceThreadKey: string;
  message: string;
  title?: string | null;
}

export interface StreamWebChatTurnOutcomeCompleted {
  status: "completed";
  transport: AssistantWebChatTurnState;
}

export interface StreamWebChatTurnOutcomeInterrupted {
  status: "interrupted";
  transport: AssistantWebChatTurnState | null;
}

export interface StreamWebChatTurnOutcomeFailed {
  status: "failed";
  transport: AssistantWebChatTurnState | null;
  message: string;
}

export type StreamWebChatTurnOutcome =
  | StreamWebChatTurnOutcomeCompleted
  | StreamWebChatTurnOutcomeInterrupted
  | StreamWebChatTurnOutcomeFailed;

@Injectable()
export class StreamWebChatTurnService {
  constructor(
    @Inject(ASSISTANT_REPOSITORY)
    private readonly assistantRepository: AssistantRepository,
    @Inject(ASSISTANT_PUBLISHED_VERSION_REPOSITORY)
    private readonly assistantPublishedVersionRepository: AssistantPublishedVersionRepository,
    @Inject(ASSISTANT_CHAT_REPOSITORY)
    private readonly assistantChatRepository: AssistantChatRepository,
    @Inject(ASSISTANT_RUNTIME_ADAPTER)
    private readonly assistantRuntimeAdapter: AssistantRuntimeAdapter,
    private readonly enforceAssistantCapabilityAndQuotaService: EnforceAssistantCapabilityAndQuotaService,
    private readonly enforceAbuseRateLimitService: EnforceAbuseRateLimitService,
    private readonly recordWebChatMemoryTurnService: RecordWebChatMemoryTurnService,
    private readonly trackWorkspaceQuotaUsageService: TrackWorkspaceQuotaUsageService
  ) {}

  async prepare(
    userId: string,
    request: StreamWebChatTurnRequest
  ): Promise<StreamWebChatTurnPrepared> {
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
    const activeChatsCount =
      await this.assistantChatRepository.countActiveChatsByAssistantIdAndSurface(
        assistant.id,
        "web"
      );
    await this.enforceAssistantCapabilityAndQuotaService.enforceWebChatTurn({
      assistant,
      isNewThread: existingChat === null,
      activeWebChatsCount: activeChatsCount
    });
    await this.enforceAbuseRateLimitService.enforceAndRegisterAttempt({
      assistant,
      surface: "web_chat"
    });
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

    const activeWebChatsCurrent =
      await this.assistantChatRepository.countActiveChatsByAssistantIdAndSurface(
        assistant.id,
        "web"
      );
    await this.trackWorkspaceQuotaUsageService.refreshActiveWebChatsUsage({
      assistant,
      activeWebChatsCurrent,
      source: "web_chat_turn_prepare"
    });

    return {
      chat: {
        id: chat.id,
        assistantId: chat.assistantId,
        surface: chat.surface,
        surfaceThreadKey: chat.surfaceThreadKey,
        title: chat.title,
        archivedAt: chat.archivedAt?.toISOString() ?? null,
        lastMessageAt: chat.lastMessageAt?.toISOString() ?? null,
        createdAt: chat.createdAt.toISOString(),
        updatedAt: chat.updatedAt.toISOString()
      },
      userMessage: {
        id: userMessage.id,
        chatId: userMessage.chatId,
        assistantId: userMessage.assistantId,
        author: userMessage.author,
        content: userMessage.content,
        createdAt: userMessage.createdAt.toISOString()
      },
      assistant,
      assistantId: assistant.id,
      publishedVersionId: latestPublishedVersion.id,
      userId: assistant.userId,
      workspaceId: assistant.workspaceId
    };
  }

  async streamToCompletion(
    prepared: StreamWebChatTurnPrepared,
    callbacks: {
      isClientAborted: () => boolean;
      onDelta: (delta: string, accumulated: string) => void;
      onDone: (respondedAt: string) => void;
    }
  ): Promise<StreamWebChatTurnOutcome> {
    let accumulated = "";
    let respondedAt: string | null = null;

    try {
      for await (const chunk of this.assistantRuntimeAdapter.streamWebChatTurn({
        assistantId: prepared.assistantId,
        publishedVersionId: prepared.publishedVersionId,
        chatId: prepared.chat.id,
        surfaceThreadKey: prepared.chat.surfaceThreadKey,
        userMessageId: prepared.userMessage.id,
        userMessage: prepared.userMessage.content
      })) {
        if (callbacks.isClientAborted()) {
          return this.persistInterruptedOutcome(prepared, accumulated, respondedAt);
        }

        if (chunk.type === "delta" && typeof chunk.delta === "string") {
          accumulated += chunk.delta;
          callbacks.onDelta(chunk.delta, accumulated);
        }

        if (chunk.type === "done" && typeof chunk.respondedAt === "string") {
          respondedAt = chunk.respondedAt;
          callbacks.onDone(chunk.respondedAt);
        }
      }

      if (accumulated.trim().length === 0) {
        return {
          status: "failed",
          transport: null,
          message: "Runtime stream finished without assistant output."
        };
      }

      const assistantMessage = await this.assistantChatRepository.createMessage({
        chatId: prepared.chat.id,
        assistantId: prepared.assistantId,
        author: "assistant",
        content: accumulated
      });
      await this.recordWebChatMemoryTurnService.execute({
        assistantId: prepared.assistantId,
        userId: prepared.userId,
        workspaceId: prepared.workspaceId,
        chatId: prepared.chat.id,
        userMessageId: prepared.userMessage.id,
        assistantMessageId: assistantMessage.id,
        userContent: prepared.userMessage.content,
        assistantContent: accumulated,
        memoryWriteContext: WEB_CHAT_GLOBAL_MEMORY_WRITE_CONTEXT
      });
      await this.trackWorkspaceQuotaUsageService.recordWebChatTurnUsage({
        assistant: prepared.assistant,
        userContent: prepared.userMessage.content,
        assistantContent: accumulated,
        source: "web_chat_turn_stream_completed"
      });
      const refreshedChat = await this.assistantChatRepository.findChatById(prepared.chat.id);
      if (refreshedChat === null) {
        throw new NotFoundException("Chat does not exist for this assistant.");
      }

      return {
        status: "completed",
        transport: {
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
          userMessage: prepared.userMessage,
          assistantMessage: {
            id: assistantMessage.id,
            chatId: assistantMessage.chatId,
            assistantId: assistantMessage.assistantId,
            author: assistantMessage.author,
            content: assistantMessage.content,
            createdAt: assistantMessage.createdAt.toISOString()
          },
          runtime: {
            respondedAt: respondedAt ?? new Date().toISOString()
          }
        }
      };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Runtime stream failed unexpectedly.";
      const interruptedOutcome = await this.persistInterruptedOutcome(
        prepared,
        accumulated,
        respondedAt
      );
      return {
        status: "failed",
        transport: interruptedOutcome.transport,
        message
      };
    }
  }

  private async persistInterruptedOutcome(
    prepared: StreamWebChatTurnPrepared,
    partialOutput: string,
    respondedAt: string | null
  ): Promise<StreamWebChatTurnOutcomeInterrupted> {
    if (partialOutput.trim().length === 0) {
      return {
        status: "interrupted",
        transport: null
      };
    }

    const partialAssistantMessage = await this.assistantChatRepository.createMessage({
      chatId: prepared.chat.id,
      assistantId: prepared.assistantId,
      author: "assistant",
      content: partialOutput
    });
    const systemMessage = await this.assistantChatRepository.createMessage({
      chatId: prepared.chat.id,
      assistantId: prepared.assistantId,
      author: "system",
      content:
        "Streaming ended before completion. Assistant partial output above is preserved as-is."
    });
    const refreshedChat = await this.assistantChatRepository.findChatById(prepared.chat.id);
    if (refreshedChat === null) {
      throw new NotFoundException("Chat does not exist for this assistant.");
    }
    await this.trackWorkspaceQuotaUsageService.recordWebChatTurnUsage({
      assistant: prepared.assistant,
      userContent: prepared.userMessage.content,
      assistantContent: partialOutput,
      source: "web_chat_turn_stream_partial"
    });

    return {
      status: "interrupted",
      transport: {
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
        userMessage: prepared.userMessage,
        assistantMessage: {
          id: partialAssistantMessage.id,
          chatId: partialAssistantMessage.chatId,
          assistantId: partialAssistantMessage.assistantId,
          author: partialAssistantMessage.author,
          content: partialAssistantMessage.content,
          createdAt: partialAssistantMessage.createdAt.toISOString()
        },
        runtime: {
          respondedAt: respondedAt ?? systemMessage.createdAt.toISOString()
        }
      }
    };
  }
}
