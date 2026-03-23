import { Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";

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
  constructor(private readonly prisma: WorkspaceManagementPrismaService) {}

  async execute(input: AppendAssistantAuditEventInput): Promise<void> {
    await this.prisma.assistantAuditEvent.create({
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
  }
}
