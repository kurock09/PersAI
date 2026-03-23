import { Injectable } from "@nestjs/common";
import type { AssistantGovernance as PrismaAssistantGovernance, Prisma } from "@prisma/client";
import { createDefaultMemoryControlEnvelope } from "../../domain/assistant-memory-control.defaults";
import { createDefaultTasksControlEnvelope } from "../../domain/assistant-tasks-control.defaults";
import type { AssistantGovernanceRepository } from "../../domain/assistant-governance.repository";
import type { AssistantGovernance } from "../../domain/assistant-governance.entity";
import { WorkspaceManagementPrismaService } from "./workspace-management-prisma.service";

@Injectable()
export class PrismaAssistantGovernanceRepository implements AssistantGovernanceRepository {
  constructor(private readonly prisma: WorkspaceManagementPrismaService) {}

  async findByAssistantId(assistantId: string): Promise<AssistantGovernance | null> {
    const governance = await this.prisma.assistantGovernance.findUnique({
      where: { assistantId }
    });

    return governance ? this.mapToDomain(governance) : null;
  }

  async createBaseline(assistantId: string): Promise<AssistantGovernance> {
    const governance = await this.prisma.assistantGovernance.create({
      data: {
        assistantId,
        memoryControl: createDefaultMemoryControlEnvelope() as Prisma.InputJsonValue,
        tasksControl: createDefaultTasksControlEnvelope() as Prisma.InputJsonValue
      }
    });

    return this.mapToDomain(governance);
  }

  async appendMemoryControlForgetMarker(
    assistantId: string,
    marker: Record<string, unknown>
  ): Promise<void> {
    let row = await this.prisma.assistantGovernance.findUnique({
      where: { assistantId }
    });
    if (row === null) {
      await this.createBaseline(assistantId);
      row = await this.prisma.assistantGovernance.findUnique({
        where: { assistantId }
      });
    }
    if (row === null) {
      return;
    }

    const raw = row.memoryControl;
    const base =
      raw !== null && typeof raw === "object" && !Array.isArray(raw)
        ? { ...(raw as Record<string, unknown>) }
        : createDefaultMemoryControlEnvelope();
    const markers = Array.isArray(base.forgetRequestMarkers)
      ? [...(base.forgetRequestMarkers as unknown[])]
      : [];
    markers.push(marker);
    base.forgetRequestMarkers = markers;

    await this.prisma.assistantGovernance.update({
      where: { assistantId },
      data: { memoryControl: base as Prisma.InputJsonValue }
    });
  }

  private mapToDomain(governance: PrismaAssistantGovernance): AssistantGovernance {
    return {
      id: governance.id,
      assistantId: governance.assistantId,
      capabilityEnvelope: governance.capabilityEnvelope,
      secretRefs: governance.secretRefs,
      policyEnvelope: governance.policyEnvelope,
      memoryControl: governance.memoryControl,
      tasksControl: governance.tasksControl,
      quotaPlanCode: governance.quotaPlanCode,
      quotaHook: governance.quotaHook,
      auditHook: governance.auditHook,
      createdAt: governance.createdAt,
      updatedAt: governance.updatedAt
    };
  }
}
