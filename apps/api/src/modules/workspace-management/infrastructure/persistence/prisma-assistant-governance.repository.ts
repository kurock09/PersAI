import { Injectable } from "@nestjs/common";
import type { AssistantGovernance as PrismaAssistantGovernance, Prisma } from "@prisma/client";
import type { AssistantGovernanceRepository } from "../../domain/assistant-governance.repository";
import type { AssistantGovernance } from "../../domain/assistant-governance.entity";
import { createDefaultMemoryControlEnvelope } from "../../domain/assistant-memory-control.defaults";
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
        memoryControl: createDefaultMemoryControlEnvelope() as Prisma.InputJsonValue
      }
    });

    return this.mapToDomain(governance);
  }

  private mapToDomain(governance: PrismaAssistantGovernance): AssistantGovernance {
    return {
      id: governance.id,
      assistantId: governance.assistantId,
      capabilityEnvelope: governance.capabilityEnvelope,
      secretRefs: governance.secretRefs,
      policyEnvelope: governance.policyEnvelope,
      memoryControl: governance.memoryControl,
      quotaPlanCode: governance.quotaPlanCode,
      quotaHook: governance.quotaHook,
      auditHook: governance.auditHook,
      createdAt: governance.createdAt,
      updatedAt: governance.updatedAt
    };
  }
}
