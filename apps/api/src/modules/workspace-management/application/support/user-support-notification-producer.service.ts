import { Injectable, Logger } from "@nestjs/common";
import { NotificationRenderStrategy } from "@prisma/client";
import { NotificationIntentService } from "../notifications/notification-intent.service";
import { ResolveUserLocaleService } from "../resolve-user-locale.service";
import type { SupportTicketDetailView } from "./support.types";
import { formatSupportTicketShortId } from "./support.types";
import { supportPushReplyMessage } from "./support-user-messages";

export type SupportReplyNotificationInput = {
  ticket: SupportTicketDetailView;
  replyMessageId: string;
  replyBody: string;
  recipientEmail: string;
};

@Injectable()
export class UserSupportNotificationProducerService {
  private readonly logger = new Logger(UserSupportNotificationProducerService.name);

  constructor(
    private readonly notificationIntentService: NotificationIntentService,
    private readonly resolveUserLocaleService: ResolveUserLocaleService
  ) {}

  async notifyReplySent(input: SupportReplyNotificationInput): Promise<void> {
    const shortId = formatSupportTicketShortId(input.ticket.id);
    const locale = await this.resolveUserLocaleService.forUserInWorkspace(
      input.ticket.userId,
      input.ticket.workspaceId
    );
    const pushText = supportPushReplyMessage(locale, shortId);

    const factPayload = {
      locale,
      ticketId: input.ticket.id,
      ticketShortId: shortId,
      recipientEmail: input.recipientEmail,
      replyBody: input.replyBody,
      userEmail: input.ticket.userEmail
    };

    const dedupeKey = `user_support:reply:${input.ticket.id}:${input.replyMessageId}`;

    try {
      await this.notificationIntentService.createIntent({
        workspaceId: input.ticket.workspaceId,
        assistantId: input.ticket.assistantId,
        userId: input.ticket.userId,
        source: "user_support",
        class: "transactional",
        priority: "immediate",
        renderStrategy: NotificationRenderStrategy.template,
        templateId: "support.reply",
        factPayload,
        allowedChannels: ["email"],
        dedupeKey: `${dedupeKey}:email`,
        respectQuietHours: false,
        traceId: input.ticket.id
      });
    } catch (error) {
      this.logger.warn({
        event: "user_support_notification.email_intent_failed",
        ticketId: input.ticket.id,
        error: error instanceof Error ? error.message : String(error)
      });
    }

    try {
      await this.notificationIntentService.createIntent({
        workspaceId: input.ticket.workspaceId,
        assistantId: input.ticket.assistantId,
        userId: input.ticket.userId,
        source: "user_support",
        class: "conversational",
        priority: "immediate",
        renderStrategy: NotificationRenderStrategy.static_fallback,
        factPayload: {
          locale,
          message: pushText,
          pushText,
          ticketId: input.ticket.id,
          ticketShortId: shortId
        },
        allowedChannels: ["user_preferred"],
        dedupeKey: `${dedupeKey}:push`,
        respectQuietHours: false,
        traceId: input.ticket.id
      });
    } catch (error) {
      this.logger.warn({
        event: "user_support_notification.push_intent_failed",
        ticketId: input.ticket.id,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }
}
