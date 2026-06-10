import { Injectable, Logger } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";
import { AdminSystemNotificationProducerService } from "./admin-system-notification-producer.service";
import { SystemEventNotificationProducerService } from "./system-event-notification-producer.service";

const ADMIN_SYSTEM_EVENT_CODE_BY_AUDIT_EVENT: Partial<
  Record<string, import("./notifications/admin-system-config").AdminSystemEventCode>
> = {
  "assistant.runtime.apply_succeeded": "runtime_apply_succeeded",
  "assistant.runtime.apply_degraded": "runtime_apply_degraded",
  "assistant.runtime.apply_failed": "runtime_apply_failed",
  "assistant.media.reserve_openai_transport_used": "reserve_openai_transport_used",
  "admin.plan_created": "admin_plan_created",
  "admin.plan_updated": "admin_plan_updated"
};

export type AssistantAuditOutcome = "succeeded" | "failed" | "degraded" | "denied";

export interface AppendAssistantAuditEventInput {
  workspaceId: string | null;
  assistantId: string | null;
  actorUserId: string | null;
  eventCategory: string;
  eventCode: string;
  summary: string;
  outcome?: AssistantAuditOutcome;
  details?: Record<string, unknown>;
}

@Injectable()
export class AppendAssistantAuditEventService {
  private readonly logger = new Logger(AppendAssistantAuditEventService.name);

  constructor(
    private readonly prisma: WorkspaceManagementPrismaService,
    private readonly systemEventProducer: SystemEventNotificationProducerService,
    private readonly adminSystemNotificationProducerService: AdminSystemNotificationProducerService
  ) {}

  async execute(input: AppendAssistantAuditEventInput): Promise<void> {
    const created = await this.prisma.assistantAuditEvent.create({
      data: {
        workspaceId: input.workspaceId,
        assistantId: input.assistantId,
        actorUserId: input.actorUserId,
        eventCategory: input.eventCategory,
        eventCode: input.eventCode,
        summary: input.summary,
        outcome: input.outcome ?? "succeeded",
        details: (input.details ?? {}) as Prisma.InputJsonValue
      }
    });
    void this.systemEventProducer
      .emitFromAuditEvent({
        auditEventId: created.id,
        workspaceId: input.workspaceId,
        assistantId: input.assistantId,
        actorUserId: input.actorUserId,
        eventCode: input.eventCode,
        summary: input.summary,
        details: input.details ?? {},
        createdAt: created.createdAt.toISOString()
      })
      .catch((error: unknown) => {
        const message =
          error instanceof Error ? error.message : "Unknown system event notification failure.";
        this.logger.warn(`System event notification failed after audit append: ${message}`);
      });

    const adminSystemEventCode = ADMIN_SYSTEM_EVENT_CODE_BY_AUDIT_EVENT[input.eventCode];
    if (adminSystemEventCode !== undefined) {
      void this.adminSystemNotificationProducerService
        .emitEvent({
          eventCode: adminSystemEventCode,
          summary: input.summary,
          details: input.details ?? {},
          traceId: created.id,
          occurredAt: created.createdAt.toISOString()
        })
        .catch((error: unknown) => {
          const message =
            error instanceof Error ? error.message : "Unknown admin_system notification failure.";
          this.logger.warn(`Admin system notification failed after audit append: ${message}`);
        });
    }
  }
}
