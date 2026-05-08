import { Injectable, Logger } from "@nestjs/common";
import type {
  ChannelRegistryRow,
  DeliveryResult,
  NotificationIntentRecord,
  RenderedPayload
} from "../../../application/notifications/notification-platform.types";
import { NotificationChannelType } from "../../../application/notifications/notification-platform.types";
import type { NotificationChannelAdapter } from "./channel-adapter.interface";
import { PlatformRuntimeProviderSecretStoreService } from "../../../application/platform-runtime-provider-secret-store.service";
import { WorkspaceManagementPrismaService } from "../../persistence/workspace-management-prisma.service";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseTelegramMessageId(value: unknown): string | undefined {
  if (!isRecord(value) || value["ok"] !== true || !isRecord(value["result"])) {
    return undefined;
  }
  const messageId = value["result"]["message_id"];
  return typeof messageId === "number" || typeof messageId === "string"
    ? String(messageId)
    : undefined;
}

/**
 * Delivers a notification to the user's active Telegram thread.
 * ChatId resolution order:
 *   1. intent.surfaceThreadKey (set by active-turn producers knowing the thread)
 *   2. channelConfig.config.chatId (workspace-level default)
 *   3. Assistant's Telegram DM chatId from channel surface binding metadata
 * ADR-088 §Core principles #4 – dumb adapter, no policy/dedupe logic.
 */
@Injectable()
export class TelegramThreadChannelAdapter implements NotificationChannelAdapter {
  private readonly logger = new Logger(TelegramThreadChannelAdapter.name);

  readonly channelType = NotificationChannelType.telegram_thread;

  constructor(
    private readonly platformRuntimeProviderSecretStoreService: PlatformRuntimeProviderSecretStoreService,
    private readonly prisma: WorkspaceManagementPrismaService
  ) {}

  async deliver(
    intent: NotificationIntentRecord,
    renderedPayload: RenderedPayload,
    channelConfig: ChannelRegistryRow
  ): Promise<DeliveryResult> {
    const chatId = await this.resolveChatId(intent, channelConfig);
    if (!chatId) {
      this.logger.warn({
        event: "telegram_thread_adapter.no_chat_id",
        intentId: intent.id,
        workspaceId: intent.workspaceId,
        assistantId: intent.assistantId
      });
      return { status: "failed", error: { reason: "telegram_chat_id_not_resolved" } };
    }

    const botToken = await this.resolveBotToken(intent);
    if (!botToken) {
      this.logger.warn({
        event: "telegram_thread_adapter.no_bot_token",
        intentId: intent.id,
        assistantId: intent.assistantId
      });
      return { status: "failed", error: { reason: "telegram_bot_token_not_configured" } };
    }

    const response = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: renderedPayload.body })
    }).catch(() => null);

    if (response?.ok !== true) {
      const status = response?.status ?? "network_error";
      this.logger.warn({
        event: "telegram_thread_adapter.send_failed",
        intentId: intent.id,
        chatId,
        status
      });
      return { status: "failed", error: { reason: "telegram_send_failed", httpStatus: status } };
    }

    const data = await response.json().catch(() => null);
    const messageId = parseTelegramMessageId(data);

    this.logger.log({
      event: "telegram_thread_adapter.delivered",
      intentId: intent.id,
      chatId,
      messageId
    });

    return {
      status: "delivered",
      providerRef: `telegram:${chatId}:${messageId ?? intent.id}`
    };
  }

  private async resolveChatId(
    intent: NotificationIntentRecord,
    channelConfig: ChannelRegistryRow
  ): Promise<string | null> {
    if (typeof intent.surfaceThreadKey === "string" && intent.surfaceThreadKey.trim().length > 0) {
      return intent.surfaceThreadKey.trim();
    }

    const configChatId = channelConfig.config["chatId"];
    if (typeof configChatId === "string" && configChatId.trim().length > 0) {
      return configChatId.trim();
    }

    if (intent.assistantId) {
      return this.resolveAssistantTelegramDmChatId(intent.assistantId);
    }

    return null;
  }

  private async resolveAssistantTelegramDmChatId(assistantId: string): Promise<string | null> {
    const binding = await this.prisma.assistantChannelSurfaceBinding.findFirst({
      where: { assistantId, providerKey: "telegram", bindingState: "active" },
      select: { metadata: true }
    });
    if (!binding || !isRecord(binding.metadata)) {
      return null;
    }
    const meta = binding.metadata;
    const dmChatId =
      typeof meta["telegramDmChatId"] === "string" ? meta["telegramDmChatId"].trim() : "";
    if (dmChatId) {
      return dmChatId;
    }
    const legacyChatId =
      typeof meta["reminderDeliveryChatId"] === "string"
        ? meta["reminderDeliveryChatId"].trim()
        : "";
    const legacyChatType =
      typeof meta["reminderDeliveryChatType"] === "string"
        ? meta["reminderDeliveryChatType"].trim()
        : "";
    return legacyChatId && legacyChatType === "private" ? legacyChatId : null;
  }

  private async resolveBotToken(intent: NotificationIntentRecord): Promise<string | null> {
    if (!intent.assistantId) {
      return null;
    }
    return this.platformRuntimeProviderSecretStoreService.resolveSecretValueByProviderKey(
      `telegram_bot:${intent.assistantId}`
    );
  }
}
