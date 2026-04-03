import { BadRequestException, Inject, Injectable, Logger } from "@nestjs/common";
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
import { InboundMediaService } from "./media/inbound-media.service";
import { MediaDeliveryService } from "./media/media-delivery.service";

export const WELCOME_TURN_SENTINEL = "__welcome_init__";

const WELCOME_INSTRUCTION_RU =
  "Это твой первый разговор с пользователем. Поприветствуй тепло, представься по имени, и расскажи что умеешь: помнишь контекст между сессиями, доступен в Telegram, умеешь ставить задачи и напоминания, генерировать картинки и говорить голосом и многое другое.";

const WELCOME_INSTRUCTION_EN =
  "This is your first conversation with the user. Greet them warmly, introduce yourself by name, and tell them what you can do: you remember context across sessions, you're available in Telegram, you can set tasks and reminders, generate images, speak with voice, and much more.";

export function resolveWelcomeTurnInstruction(locale?: string): string {
  return locale === "ru" ? WELCOME_INSTRUCTION_RU : WELCOME_INSTRUCTION_EN;
}

export interface SendWebChatTurnRequest {
  surfaceThreadKey: string;
  message: string;
  title?: string | null;
  welcomeTurn?: boolean;
  welcomeLocale?: string;
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
  private readonly logger = new Logger(SendWebChatTurnService.name);

  constructor(
    @Inject(ASSISTANT_CHAT_REPOSITORY)
    private readonly assistantChatRepository: AssistantChatRepository,
    @Inject(ASSISTANT_RUNTIME_ADAPTER)
    private readonly assistantRuntimeAdapter: AssistantRuntimeAdapter,
    private readonly prepareAssistantInboundTurnService: PrepareAssistantInboundTurnService,
    private readonly recordWebChatMemoryTurnService: RecordWebChatMemoryTurnService,
    private readonly trackWorkspaceQuotaUsageService: TrackWorkspaceQuotaUsageService,
    private readonly inboundMediaService: InboundMediaService,
    private readonly mediaDeliveryService: MediaDeliveryService
  ) {}

  parseInput(payload: unknown): SendWebChatTurnRequest {
    if (typeof payload !== "object" || payload === null) {
      throw new BadRequestException("Web chat payload must be an object.");
    }

    const body = payload as Record<string, unknown>;
    const surfaceThreadKey = body.surfaceThreadKey;
    const message = body.message;
    const title = normalizeOptionalTitle(body.title);
    const welcomeTurn = body.welcomeTurn === true;

    if (typeof surfaceThreadKey !== "string" || surfaceThreadKey.trim().length === 0) {
      throw new BadRequestException("surfaceThreadKey must be a non-empty string.");
    }
    if (!welcomeTurn && (typeof message !== "string" || message.trim().length === 0)) {
      throw new BadRequestException("message must be a non-empty string.");
    }

    const welcomeLocale =
      welcomeTurn && typeof body.welcomeLocale === "string" ? body.welcomeLocale : undefined;

    return {
      surfaceThreadKey: surfaceThreadKey.trim(),
      message: welcomeTurn ? WELCOME_TURN_SENTINEL : (message as string).trim(),
      ...(title !== undefined ? { title } : {}),
      ...(welcomeTurn ? { welcomeTurn: true } : {}),
      ...(welcomeLocale !== undefined ? { welcomeLocale } : {})
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

    const attachmentContext = await this.inboundMediaService.buildContextForExistingAttachments(
      prepared.chat.id
    );
    const enrichedUserMessage = attachmentContext
      ? `${attachmentContext}\n${prepared.userMessage.content}`
      : prepared.userMessage.content;

    const runtimeResponse = await this.assistantRuntimeAdapter
      .sendWebChatTurn({
        assistantId: prepared.assistantId,
        publishedVersionId: prepared.publishedVersionId,
        chatId: prepared.chat.id,
        surfaceThreadKey: prepared.chat.surfaceThreadKey,
        userMessageId: prepared.userMessage.id,
        userMessage: enrichedUserMessage,
        userTimezone: prepared.workspaceTimezone,
        currentTimeIso: new Date().toISOString()
      })
      .catch((error: unknown) => {
        throw toAssistantInboundHttpException(error);
      });

    const assistantMessage = await this.assistantChatRepository.createMessage({
      chatId: prepared.chat.id,
      assistantId: prepared.assistantId,
      author: "assistant",
      content: runtimeResponse.assistantMessage
    });

    const delivered = await this.mediaDeliveryService.deliver({
      artifacts: runtimeResponse.media.map((m) => ({
        url: m.url,
        type: m.type,
        audioAsVoice: m.audioAsVoice
      })),
      channel: "web",
      assistantId: prepared.assistantId,
      chatId: prepared.chat.id,
      messageId: assistantMessage.id,
      workspaceId: prepared.assistant.workspaceId
    });

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
    await this.consumeBootstrapBestEffort(prepared.assistantId);

    return {
      chat: prepared.chat,
      userMessage: prepared.userMessage,
      assistantMessage: {
        id: assistantMessage.id,
        chatId: assistantMessage.chatId,
        assistantId: assistantMessage.assistantId,
        author: assistantMessage.author,
        content: assistantMessage.content,
        attachments: delivered.attachments,
        createdAt: assistantMessage.createdAt.toISOString()
      },
      runtime: {
        respondedAt: runtimeResponse.respondedAt
      }
    };
  }

  private async consumeBootstrapBestEffort(assistantId: string): Promise<void> {
    try {
      await this.assistantRuntimeAdapter.consumeBootstrapWorkspace(assistantId);
    } catch (error) {
      console.warn("[web-chat] Non-fatal: failed to consume BOOTSTRAP.md:", error);
    }
  }
}
