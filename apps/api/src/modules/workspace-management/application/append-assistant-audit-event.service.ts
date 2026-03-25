import { Injectable, Logger } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";
import { DeliverAdminSystemNotificationService } from "./deliver-admin-system-notification.service";

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
    private readonly deliverAdminSystemNotificationService: DeliverAdminSystemNotificationService
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
    void this.deliverAdminSystemNotificationService
      .executeFromAuditEvent({
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
          error instanceof Error ? error.message : "Unknown admin notification delivery failure.";
        this.logger.warn(`Admin notification delivery failed after audit append: ${message}`);
      });
  }
}
