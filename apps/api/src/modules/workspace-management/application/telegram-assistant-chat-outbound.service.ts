import { Inject, Injectable, Logger } from "@nestjs/common";
import {
  ASSISTANT_CHAT_REPOSITORY,
  type AssistantChatRepository
} from "../domain/assistant-chat.repository";
import { ResolveTelegramChannelRuntimeConfigService } from "./resolve-telegram-channel-runtime-config.service";
import { TelegramBotClientService } from "./telegram-bot.client.service";

export function parseTelegramChatIdFromSurfaceThreadKey(value: string): string {
  const trimmed = value.trim();
  const match = trimmed.match(/^telegram:(.+):session:[^:]+$/);
  return match?.[1]?.trim() || trimmed;
}

export type TelegramAssistantTextNoticeInput = {
  assistantId: string;
  chatId: string;
  workspaceId: string;
  assistantMessageId: string;
  text: string;
  mediaAlreadyDelivered?: boolean;
};

@Injectable()
export class TelegramAssistantChatOutboundService {
  private readonly logger = new Logger(TelegramAssistantChatOutboundService.name);

  constructor(
    @Inject(ASSISTANT_CHAT_REPOSITORY)
    private readonly assistantChatRepository: AssistantChatRepository,
    private readonly resolveTelegramChannelRuntimeConfigService: ResolveTelegramChannelRuntimeConfigService,
    private readonly telegramBotClientService: TelegramBotClientService
  ) {}

  async deliverPersistedAssistantMessageBestEffort(
    input: TelegramAssistantTextNoticeInput
  ): Promise<void> {
    try {
      const chat = await this.assistantChatRepository.findChatById(input.chatId);
      if (chat === null || chat.surface !== "telegram") {
        return;
      }

      const config = await this.resolveTelegramChannelRuntimeConfigService.resolveByAssistantId(
        input.assistantId
      );
      if (config === null || config.outbound !== true) {
        return;
      }

      await this.telegramBotClientService.sendAssistantTurnReply({
        botToken: config.botToken,
        chatId: parseTelegramChatIdFromSurfaceThreadKey(chat.surfaceThreadKey),
        assistantId: input.assistantId,
        parseMode: config.parseMode,
        turnResult: {
          assistantMessage: input.text,
          respondedAt: new Date().toISOString(),
          media: [],
          assistantMessageId: input.assistantMessageId,
          chatId: input.chatId,
          workspaceId: input.workspaceId
        },
        mediaAlreadyDelivered: input.mediaAlreadyDelivered ?? false
      });
    } catch (error) {
      this.logger.warn(
        `Telegram assistant text notice failed assistantId=${input.assistantId} chatId=${input.chatId} messageId=${input.assistantMessageId}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }
}
