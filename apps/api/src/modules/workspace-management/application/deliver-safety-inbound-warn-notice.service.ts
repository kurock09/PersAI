import { Injectable, Logger } from "@nestjs/common";
import { resolveSafetyInboundWarnMessengerCopy } from "./system-copy/system-copy-catalog";
import { PersistSafetyInboundThreadNoticeService } from "./persist-safety-inbound-thread-notice.service";
import { ResolveTelegramChannelRuntimeConfigService } from "./resolve-telegram-channel-runtime-config.service";
import { ResolveUserLocaleService } from "./resolve-user-locale.service";
import { parseTelegramChatIdFromSurfaceThreadKey } from "./telegram-assistant-chat-outbound.service";
import { TelegramBotClientService } from "./telegram-bot.client.service";

@Injectable()
export class DeliverSafetyInboundWarnNoticeService {
  private readonly logger = new Logger(DeliverSafetyInboundWarnNoticeService.name);

  constructor(
    private readonly persistSafetyInboundThreadNoticeService: PersistSafetyInboundThreadNoticeService,
    private readonly resolveTelegramChannelRuntimeConfigService: ResolveTelegramChannelRuntimeConfigService,
    private readonly resolveUserLocaleService: ResolveUserLocaleService,
    private readonly telegramBotClientService: TelegramBotClientService
  ) {}

  async deliverWarnNoticeIfPossible(input: {
    userId: string;
    workspaceId: string;
    assistantId: string;
    chatId: string | null;
    surface: string;
    surfaceThreadKey: string | null;
    reasonCode: string;
    moderationCaseId: string;
  }): Promise<void> {
    if (input.surface === "telegram") {
      await this.deliverTelegramWarnBestEffort(input);
      return;
    }

    await this.persistSafetyInboundThreadNoticeService.persistWarnNoticeIfPossible({
      chatId: input.chatId,
      assistantId: input.assistantId,
      reasonCode: input.reasonCode,
      moderationCaseId: input.moderationCaseId
    });
  }

  private async deliverTelegramWarnBestEffort(input: {
    userId: string;
    workspaceId: string;
    assistantId: string;
    surfaceThreadKey: string | null;
    reasonCode: string;
  }): Promise<void> {
    const surfaceThreadKey = input.surfaceThreadKey?.trim() ?? "";
    if (surfaceThreadKey.length === 0) {
      return;
    }

    try {
      const config = await this.resolveTelegramChannelRuntimeConfigService.resolveByAssistantId(
        input.assistantId
      );
      if (config === null || config.outbound !== true) {
        return;
      }

      const locale = await this.resolveUserLocaleService.forUserInWorkspace(
        input.userId,
        input.workspaceId
      );
      const text = resolveSafetyInboundWarnMessengerCopy(
        input.reasonCode,
        locale,
        "We noticed a risky request during an automatic safety review."
      );
      const telegramChatId = parseTelegramChatIdFromSurfaceThreadKey(surfaceThreadKey);
      await this.telegramBotClientService.sendPlainText(config.botToken, telegramChatId, text);
    } catch (error) {
      this.logger.warn(
        `Telegram safety inbound warn notice failed assistantId=${input.assistantId} surfaceThreadKey=${input.surfaceThreadKey}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }
}
