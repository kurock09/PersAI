import { Injectable } from "@nestjs/common";
import type {
  AssistantTaskRegistryItem as PrismaItem,
  AssistantTaskRegistryControlStatus as PrismaStatus
} from "@prisma/client";
import type { AssistantTaskRegistryItem } from "../../domain/assistant-task-registry-item.entity";
import type { AssistantTaskRegistryRepository } from "../../domain/assistant-task-registry.repository";
import { WorkspaceManagementPrismaService } from "./workspace-management-prisma.service";

@Injectable()
export class PrismaAssistantTaskRegistryRepository implements AssistantTaskRegistryRepository {
  constructor(private readonly prisma: WorkspaceManagementPrismaService) {}

  async listByAssistantId(assistantId: string, limit: number): Promise<AssistantTaskRegistryItem[]> {
    const rows = await this.prisma.assistantTaskRegistryItem.findMany({
      where: { assistantId },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      take: limit
    });

    return rows.map((row) => this.mapToDomain(row));
  }

  async findByIdAndAssistantId(
    id: string,
    assistantId: string
  ): Promise<AssistantTaskRegistryItem | null> {
    const row = await this.prisma.assistantTaskRegistryItem.findFirst({
      where: { id, assistantId }
    });

    return row ? this.mapToDomain(row) : null;
  }

  async updateControlStatus(
    id: string,
    assistantId: string,
    patch: {
      controlStatus: AssistantTaskRegistryItem["controlStatus"];
      disabledAt: Date | null;
      cancelledAt: Date | null;
    }
  ): Promise<boolean> {
    const result = await this.prisma.assistantTaskRegistryItem.updateMany({
      where: { id, assistantId },
      data: {
        controlStatus: patch.controlStatus as PrismaStatus,
        disabledAt: patch.disabledAt,
        cancelledAt: patch.cancelledAt
      }
    });

    return result.count > 0;
  }

  private mapToDomain(row: PrismaItem): AssistantTaskRegistryItem {
    return {
      id: row.id,
      assistantId: row.assistantId,
      userId: row.userId,
      workspaceId: row.workspaceId,
      title: row.title,
      sourceSurface: row.sourceSurface as AssistantTaskRegistryItem["sourceSurface"],
      sourceLabel: row.sourceLabel,
      controlStatus: row.controlStatus as AssistantTaskRegistryItem["controlStatus"],
      nextRunAt: row.nextRunAt,
      disabledAt: row.disabledAt,
      cancelledAt: row.cancelledAt,
      externalRef: row.externalRef,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt
    };
  }
}
