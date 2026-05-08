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

/**
 * Delivers a notification to the user's active web chat thread.
 * Requires intent.chatId (the target chat's database UUID).
 * ADR-088 §Core principles #4 – dumb adapter, no policy/dedupe logic.
 */
@Injectable()
export class WebThreadChannelAdapter implements NotificationChannelAdapter {
  private readonly logger = new Logger(WebThreadChannelAdapter.name);

  readonly channelType = NotificationChannelType.web_thread;

  constructor(
    @Inject(ASSISTANT_CHAT_REPOSITORY)
    private readonly assistantChatRepository: AssistantChatRepository
  ) {}

  async deliver(
    intent: NotificationIntentRecord,
    renderedPayload: RenderedPayload,
    _channelConfig: ChannelRegistryRow
  ): Promise<DeliveryResult> {
    if (!intent.chatId || !intent.assistantId) {
      this.logger.warn({
        event: "web_thread_adapter.missing_context",
        intentId: intent.id,
        workspaceId: intent.workspaceId,
        hasChatId: Boolean(intent.chatId),
        hasAssistantId: Boolean(intent.assistantId)
      });
      return { status: "failed", error: { reason: "web_thread_context_missing" } };
    }

    const message = await this.assistantChatRepository.createMessage({
      chatId: intent.chatId,
      assistantId: intent.assistantId,
      author: "assistant",
      content: renderedPayload.body
    });

    this.logger.log({
      event: "web_thread_adapter.delivered",
      intentId: intent.id,
      chatId: intent.chatId,
      messageId: message.id
    });

    return {
      status: "delivered",
      providerRef: `web_thread:${intent.chatId}:${message.id}`
    };
  }
}
