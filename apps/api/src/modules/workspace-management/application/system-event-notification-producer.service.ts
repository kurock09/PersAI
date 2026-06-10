import { Injectable, Logger } from "@nestjs/common";
import {
  NotificationClass,
  NotificationPriority,
  NotificationRenderStrategy,
  NotificationSource
} from "@prisma/client";
import { NotificationIntentService } from "./notifications/notification-intent.service";

type AuditEventNotificationClass = "operational" | "administrative";

const CLASS_BY_EVENT_CODE: Record<string, AuditEventNotificationClass | undefined> = {
  "assistant.runtime.apply_failed": "operational",
  "assistant.runtime.apply_degraded": "operational",
  "assistant.runtime.apply_succeeded": "operational",
  "assistant.media.reserve_openai_transport_used": "operational",
  "admin.plan_created": "administrative",
  "admin.plan_updated": "administrative"
};

export type SystemEventFromAuditInput = {
  auditEventId: string;
  workspaceId: string | null;
  assistantId: string | null;
  actorUserId: string | null;
  eventCode: string;
  summary: string;
  details: Record<string, unknown>;
  createdAt: string;
};

/**
 * Produces `system_event` notification intents from assistant audit events.
 * Replaces the deleted `DeliverAdminSystemNotificationService` (ADR-088 Slice 4).
 * Direct webhook delivery is gone; `NotificationDeliveryWorkerService` handles
 * actual delivery through `AdminWebhookChannelAdapter`.
 */
@Injectable()
export class SystemEventNotificationProducerService {
  private readonly logger = new Logger(SystemEventNotificationProducerService.name);

  constructor(private readonly notificationIntentService: NotificationIntentService) {}

  async emitFromAuditEvent(input: SystemEventFromAuditInput): Promise<void> {
    if (input.workspaceId === null) {
      return;
    }
    const notificationClass = CLASS_BY_EVENT_CODE[input.eventCode];
    if (notificationClass === undefined) {
      return;
    }

    try {
      await this.notificationIntentService.createIntent({
        workspaceId: input.workspaceId,
        assistantId: input.assistantId ?? null,
        userId: input.actorUserId ?? null,
        source: NotificationSource.system_event,
        class:
          notificationClass === "operational"
            ? NotificationClass.operational
            : NotificationClass.administrative,
        priority: NotificationPriority.immediate,
        renderStrategy: NotificationRenderStrategy.static_fallback,
        allowedChannels: ["admin_webhook"],
        respectQuietHours: false,
        traceId: input.auditEventId,
        factPayload: {
          message: input.summary,
          eventCode: input.eventCode,
          details: input.details,
          actorUserId: input.actorUserId,
          assistantId: input.assistantId,
          occurredAt: input.createdAt
        }
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      this.logger.warn({
        event: "system_event_producer.intent_create_failed",
        workspaceId: input.workspaceId,
        eventCode: input.eventCode,
        error: message
      });
    }
  }
}
