import { Injectable, Logger } from "@nestjs/common";
import { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";
import { ResolveTelegramChannelRuntimeConfigService } from "./resolve-telegram-channel-runtime-config.service";
import {
  TelegramBotApiError,
  TelegramBotClientService,
  TelegramBotUnauthorizedError
} from "./telegram-bot.client.service";
import { ResolveActiveAssistantService } from "./resolve-active-assistant.service";

@Injectable()
export class RefreshTelegramGroupsService {
  private readonly logger = new Logger(RefreshTelegramGroupsService.name);

  constructor(
    private readonly prisma: WorkspaceManagementPrismaService,
    private readonly resolveTelegramChannelRuntimeConfigService: ResolveTelegramChannelRuntimeConfigService,
    private readonly telegramBotClientService: TelegramBotClientService,
    private readonly resolveActiveAssistantService: ResolveActiveAssistantService
  ) {}

  async execute(userId: string): Promise<void> {
    const assistant = await this.resolveActiveAssistantService.execute({ userId });

    const runtimeConfig =
      await this.resolveTelegramChannelRuntimeConfigService.resolveByAssistantId(
        assistant.assistantId
      );
    if (runtimeConfig === null) {
      return;
    }

    const activeGroups = await this.prisma.assistantTelegramGroup.findMany({
      where: {
        assistantId: assistant.assistantId,
        status: "active"
      },
      select: {
        id: true,
        telegramChatId: true
      }
    });

    const now = new Date();
    for (const group of activeGroups) {
      try {
        const membership = await this.telegramBotClientService.getChatMember(
          runtimeConfig.botToken,
          group.telegramChatId,
          runtimeConfig.botUserId ?? "me"
        );
        const status = membership.status;
        const stillActive =
          status === "member" || status === "administrator" || status === "creator";
        if (stillActive) {
          continue;
        }
      } catch (error) {
        if (error instanceof TelegramBotUnauthorizedError) {
          this.logger.warn(
            `Telegram group refresh aborted for assistant ${assistant.assistantId}: bot token unauthorized.`
          );
          return;
        }
        if (
          error instanceof TelegramBotApiError &&
          (error.errorCode === 400 ||
            error.errorCode === 403 ||
            error.status === 400 ||
            error.status === 403)
        ) {
          this.logger.debug(
            `Telegram group ${group.telegramChatId} is no longer active for assistant ${assistant.assistantId}: ${error.description}`
          );
        } else if (error instanceof Error) {
          this.logger.warn(
            `Telegram group refresh failed for ${group.telegramChatId}: ${error.message}`
          );
          continue;
        } else {
          continue;
        }
      }

      await this.prisma.assistantTelegramGroup.update({
        where: { id: group.id },
        data: {
          status: "left",
          leftAt: now
        }
      });
    }
  }
}
