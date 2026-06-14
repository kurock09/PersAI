import { Injectable, Logger } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";
import { AdminSystemNotificationProducerService } from "./admin-system-notification-producer.service";
import {
  type AdminSystemEventCode,
  resolveAdminSystemUserLabel,
  USER_SCOPED_ADMIN_SYSTEM_EVENT_CODES
} from "./notifications/admin-system-config";
import { SystemEventNotificationProducerService } from "./system-event-notification-producer.service";

const ADMIN_SYSTEM_EVENT_CODE_BY_AUDIT_EVENT: Partial<Record<string, AdminSystemEventCode>> = {
  "assistant.runtime.apply_succeeded": "runtime_apply_succeeded",
  "assistant.runtime.apply_degraded": "runtime_apply_degraded",
  "assistant.runtime.apply_failed": "runtime_apply_failed",
  "assistant.media.reserve_openai_transport_used": "reserve_openai_transport_used",
  "admin.plan_created": "admin_plan_created",
  "admin.plan_updated": "admin_plan_updated",
  "admin.safety_user_restricted": "safety_user_restricted"
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

    const adminSystemEventCode = this.resolveAdminSystemEventCode(input);
    if (adminSystemEventCode !== undefined) {
      const details = await this.enrichAdminSystemEmitDetails(
        adminSystemEventCode,
        input.details ?? {},
        input.actorUserId
      );
      void this.adminSystemNotificationProducerService
        .emitEvent({
          eventCode: adminSystemEventCode,
          summary: input.summary,
          details,
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

  resolveAdminSystemEventCode(
    input: AppendAssistantAuditEventInput
  ): AdminSystemEventCode | undefined {
    const mapped = ADMIN_SYSTEM_EVENT_CODE_BY_AUDIT_EVENT[input.eventCode];
    if (mapped !== undefined) {
      return mapped;
    }
    if (input.eventCode === "safety.moderation_case_decided") {
      const decision = input.details?.["decision"];
      if (decision === "block_user") {
        return "safety_user_restricted";
      }
    }
    return undefined;
  }

  async enrichAdminSystemEmitDetails(
    eventCode: AdminSystemEventCode,
    details: Record<string, unknown>,
    actorUserId: string | null
  ): Promise<Record<string, unknown>> {
    if (!USER_SCOPED_ADMIN_SYSTEM_EVENT_CODES.has(eventCode)) {
      return details;
    }
    if (resolveAdminSystemUserLabel(details) !== null) {
      return details;
    }

    const userIdCandidate =
      typeof details["userId"] === "string" && details["userId"].trim().length > 0
        ? details["userId"].trim()
        : typeof details["sourceUserId"] === "string" && details["sourceUserId"].trim().length > 0
          ? details["sourceUserId"].trim()
          : actorUserId !== null && actorUserId.trim().length > 0
            ? actorUserId.trim()
            : null;
    if (userIdCandidate === null) {
      return details;
    }

    const user = await this.prisma.appUser.findUnique({
      where: { id: userIdCandidate },
      select: { email: true }
    });
    const email = user?.email?.trim() ?? "";
    if (email.length === 0) {
      return details;
    }

    return { ...details, userEmail: email };
  }
}
