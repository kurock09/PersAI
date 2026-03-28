import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import {
  ASSISTANT_CHAT_REPOSITORY,
  type AssistantChatRepository
} from "../domain/assistant-chat.repository";
import {
  ASSISTANT_RUNTIME_ADAPTER,
  type AssistantRuntimeAdapter
} from "./assistant-runtime-adapter.types";
import { WEB_CHAT_GLOBAL_MEMORY_WRITE_CONTEXT } from "../domain/memory-source-policy";
import { RecordWebChatMemoryTurnService } from "./record-web-chat-memory-turn.service";
import { TrackWorkspaceQuotaUsageService } from "./track-workspace-quota-usage.service";
import type { AssistantWebChatTurnState } from "./web-chat.types";
import { PrepareAssistantInboundTurnService } from "./prepare-assistant-inbound-turn.service";
import { toAssistantInboundHttpException } from "./assistant-inbound-error";

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
    @Inject(ASSISTANT_CHAT_REPOSITORY)
    private readonly assistantChatRepository: AssistantChatRepository,
    @Inject(ASSISTANT_RUNTIME_ADAPTER)
    private readonly assistantRuntimeAdapter: AssistantRuntimeAdapter,
    private readonly prepareAssistantInboundTurnService: PrepareAssistantInboundTurnService,
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

  async execute(
    userId: string,
    request: SendWebChatTurnRequest
  ): Promise<AssistantWebChatTurnState> {
    const prepared = await this.prepareAssistantInboundTurnService.execute({
      userId,
      surface: "web_chat",
      surfaceThreadKey: request.surfaceThreadKey,
      message: request.message,
      ...(request.title !== undefined ? { title: request.title } : {})
    });
    const runtimeResponse = await this.assistantRuntimeAdapter
      .sendWebChatTurn({
        assistantId: prepared.assistantId,
        publishedVersionId: prepared.publishedVersionId,
        chatId: prepared.chat.id,
        surfaceThreadKey: prepared.chat.surfaceThreadKey,
        userMessageId: prepared.userMessage.id,
        userMessage: prepared.userMessage.content,
        userTimezone: prepared.workspaceTimezone,
        currentTimeIso: new Date().toISOString()
      })
      .catch((error: unknown) => {
        throw toAssistantInboundHttpException(error);
      });

    const assistantMessage = await this.recordAssistantMessage(
      prepared.chat.id,
      prepared.assistantId,
      runtimeResponse.assistantMessage
    );

    await this.recordWebChatMemoryTurnService.execute({
      assistantId: prepared.assistantId,
      userId: prepared.userId,
      workspaceId: prepared.workspaceId,
      chatId: prepared.chat.id,
      userMessageId: prepared.userMessage.id,
      assistantMessageId: assistantMessage.id,
      userContent: prepared.userMessage.content,
      assistantContent: runtimeResponse.assistantMessage,
      memoryWriteContext: WEB_CHAT_GLOBAL_MEMORY_WRITE_CONTEXT
    });
    await this.trackWorkspaceQuotaUsageService.recordWebChatTurnUsage({
      assistant: prepared.assistant,
      userContent: prepared.userMessage.content,
      assistantContent: assistantMessage.content,
      source: "web_chat_turn_sync"
    });

    return {
      chat: prepared.chat,
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
        respondedAt: runtimeResponse.respondedAt
      }
    };
  }

  private async recordAssistantMessage(chatId: string, assistantId: string, content: string) {
    return this.assistantChatRepository.createMessage({
      chatId,
      assistantId,
      author: "assistant",
      content
    });
  }
}
