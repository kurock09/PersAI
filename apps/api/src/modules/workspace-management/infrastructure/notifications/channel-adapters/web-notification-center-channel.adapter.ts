import { Inject, Injectable, Logger } from "@nestjs/common";
import type {
  ChannelRegistryRow,
  DeliveryResult,
  NotificationIntentRecord,
  RenderedPayload
} from "../../../application/notifications/notification-platform.types";
import { NotificationChannelType } from "../../../application/notifications/notification-platform.types";
import type { NotificationChannelAdapter } from "./channel-adapter.interface";
import {
  ASSISTANT_CHAT_REPOSITORY,
  type AssistantChatRepository
} from "../../../domain/assistant-chat.repository";
import { WorkspaceManagementPrismaService } from "../../persistence/workspace-management-prisma.service";

const NOTIFICATION_WEB_CHAT_THREAD_KEY = "system:notifications";
const NOTIFICATION_WEB_CHAT_TITLE = "Notifications";

/**
 * Delivers a notification to the in-app system thread system:notifications.
 * Finds or creates the thread for the assistant, then writes the message.
 * ADR-088 §Core principles #4 – dumb adapter, no policy/dedupe logic.
 */
@Injectable()
export class WebNotificationCenterChannelAdapter implements NotificationChannelAdapter {
  private readonly logger = new Logger(WebNotificationCenterChannelAdapter.name);

  readonly channelType = NotificationChannelType.web_notification_center;

  constructor(
    @Inject(ASSISTANT_CHAT_REPOSITORY)
    private readonly assistantChatRepository: AssistantChatRepository,
    private readonly prisma: WorkspaceManagementPrismaService
  ) {}

  async deliver(
    intent: NotificationIntentRecord,
    renderedPayload: RenderedPayload,
    _channelConfig: ChannelRegistryRow
  ): Promise<DeliveryResult> {
    if (!intent.assistantId) {
      this.logger.warn({
        event: "web_notification_center_adapter.no_assistant_id",
        intentId: intent.id,
        workspaceId: intent.workspaceId
      });
      return { status: "failed", error: { reason: "assistant_id_missing" } };
    }

    const userId = await this.resolveUserId(intent);
    if (!userId) {
      this.logger.warn({
        event: "web_notification_center_adapter.no_user_id",
        intentId: intent.id,
        assistantId: intent.assistantId
      });
      return { status: "failed", error: { reason: "user_id_not_resolved" } };
    }

    const chat = await this.assistantChatRepository.findOrCreateChatBySurfaceThread({
      assistantId: intent.assistantId,
      userId,
      workspaceId: intent.workspaceId,
      surface: "web",
      surfaceThreadKey: NOTIFICATION_WEB_CHAT_THREAD_KEY,
      title: NOTIFICATION_WEB_CHAT_TITLE
    });

    const message = await this.assistantChatRepository.createMessage({
      chatId: chat.id,
      assistantId: intent.assistantId,
      author: "assistant",
      content: renderedPayload.body
    });

    this.logger.log({
      event: "web_notification_center_adapter.delivered",
      intentId: intent.id,
      chatId: chat.id,
      messageId: message.id
    });

    return {
      status: "delivered",
      providerRef: `web_nc:${chat.id}:${message.id}`
    };
  }

  private async resolveUserId(intent: NotificationIntentRecord): Promise<string | null> {
    if (intent.userId) {
      return intent.userId;
    }
    if (!intent.assistantId) {
      return null;
    }
    const assistant = await this.prisma.assistant.findUnique({
      where: { id: intent.assistantId },
      select: { userId: true }
    });
    return assistant?.userId ?? null;
  }
}
