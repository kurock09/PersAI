import { Injectable } from "@nestjs/common";
import type { AssistantMemoryRegistryItem as PrismaItem } from "@prisma/client";
import type { AssistantMemoryRegistryItem } from "../../domain/assistant-memory-registry-item.entity";
import type {
  AssistantMemoryRegistryRepository,
  CreateAssistantMemoryRegistryItemInput
} from "../../domain/assistant-memory-registry.repository";
import { WorkspaceManagementPrismaService } from "./workspace-management-prisma.service";

@Injectable()
export class PrismaAssistantMemoryRegistryRepository implements AssistantMemoryRegistryRepository {
  constructor(private readonly prisma: WorkspaceManagementPrismaService) {}

  async create(
    input: CreateAssistantMemoryRegistryItemInput
  ): Promise<AssistantMemoryRegistryItem> {
    const row = await this.prisma.assistantMemoryRegistryItem.create({
      data: {
        assistantId: input.assistantId,
        userId: input.userId,
        workspaceId: input.workspaceId,
        chatId: input.chatId,
        relatedUserMessageId: input.relatedUserMessageId,
        relatedAssistantMessageId: input.relatedAssistantMessageId,
        summary: input.summary,
        sourceType: input.sourceType,
        sourceLabel: input.sourceLabel,
        memoryClass: input.memoryClass,
        kind: input.kind
      }
    });

    return this.mapToDomain(row);
  }

  async listActiveByAssistantId(
    assistantId: string,
    limit: number,
    filter?: { sourceType?: AssistantMemoryRegistryItem["sourceType"] }
  ): Promise<AssistantMemoryRegistryItem[]> {
    const rows = await this.prisma.assistantMemoryRegistryItem.findMany({
      where: {
        assistantId,
        forgottenAt: null,
        ...(filter?.sourceType === undefined ? {} : { sourceType: filter.sourceType })
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit
    });

    return rows.map((row) => this.mapToDomain(row));
  }

  async searchActiveByAssistantId(
    assistantId: string,
    query: string,
    limit: number,
    filter?: { sourceType?: AssistantMemoryRegistryItem["sourceType"] }
  ): Promise<AssistantMemoryRegistryItem[]> {
    const rows = await this.prisma.assistantMemoryRegistryItem.findMany({
      where: {
        assistantId,
        forgottenAt: null,
        ...(filter?.sourceType === undefined ? {} : { sourceType: filter.sourceType }),
        summary: {
          contains: query,
          mode: "insensitive"
        }
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit
    });

    return rows.map((row) => this.mapToDomain(row));
  }

  async findActiveByIdAndAssistantId(
    id: string,
    assistantId: string
  ): Promise<AssistantMemoryRegistryItem | null> {
    const row = await this.prisma.assistantMemoryRegistryItem.findFirst({
      where: { id, assistantId, forgottenAt: null }
    });

    return row ? this.mapToDomain(row) : null;
  }

  async updateSummaryById(
    id: string,
    assistantId: string,
    summary: string
  ): Promise<AssistantMemoryRegistryItem | null> {
    const existing = await this.prisma.assistantMemoryRegistryItem.findFirst({
      where: { id, assistantId, forgottenAt: null },
      select: { id: true }
    });
    if (existing === null) {
      return null;
    }

    const row = await this.prisma.assistantMemoryRegistryItem.update({
      where: { id },
      data: { summary }
    });
    return this.mapToDomain(row);
  }

  async markForgottenById(id: string, assistantId: string): Promise<boolean> {
    const result = await this.prisma.assistantMemoryRegistryItem.updateMany({
      where: { id, assistantId, forgottenAt: null },
      data: { forgottenAt: new Date() }
    });

    return result.count > 0;
  }

  async markForgottenForMessages(
    assistantId: string,
    filters: { assistantMessageId: string; userMessageId: string | null }
  ): Promise<number> {
    const or: Array<Record<string, string>> = [
      { relatedAssistantMessageId: filters.assistantMessageId }
    ];
    if (filters.userMessageId !== null) {
      or.push({ relatedUserMessageId: filters.userMessageId });
    }

    const result = await this.prisma.assistantMemoryRegistryItem.updateMany({
      where: {
        assistantId,
        forgottenAt: null,
        OR: or
      },
      data: { forgottenAt: new Date() }
    });

    return result.count;
  }

  async listActiveCoreByAssistantId(
    assistantId: string,
    limit: number
  ): Promise<AssistantMemoryRegistryItem[]> {
    const rows = await this.prisma.assistantMemoryRegistryItem.findMany({
      where: {
        assistantId,
        forgottenAt: null,
        memoryClass: "core"
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit
    });

    return rows.map((row) => this.mapToDomain(row));
  }

  async countActiveCoreByAssistantId(assistantId: string): Promise<number> {
    return this.prisma.assistantMemoryRegistryItem.count({
      where: {
        assistantId,
        forgottenAt: null,
        memoryClass: "core"
      }
    });
  }

  async demoteOldestCoreByAssistantId(assistantId: string, count: number): Promise<number> {
    if (count <= 0) {
      return 0;
    }
    const candidates = await this.prisma.assistantMemoryRegistryItem.findMany({
      where: {
        assistantId,
        forgottenAt: null,
        memoryClass: "core"
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: count,
      select: { id: true }
    });
    if (candidates.length === 0) {
      return 0;
    }
    const result = await this.prisma.assistantMemoryRegistryItem.updateMany({
      where: {
        id: { in: candidates.map((row) => row.id) },
        memoryClass: "core",
        forgottenAt: null
      },
      data: { memoryClass: "contextual" }
    });
    return result.count;
  }

  async findActiveByNormalizedSummaryAndAssistantId(
    assistantId: string,
    normalizedSummary: string
  ): Promise<AssistantMemoryRegistryItem | null> {
    if (normalizedSummary.length === 0) {
      return null;
    }
    const row = await this.prisma.assistantMemoryRegistryItem.findFirst({
      where: {
        assistantId,
        forgottenAt: null,
        summary: { equals: normalizedSummary, mode: "insensitive" }
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }]
    });
    return row ? this.mapToDomain(row) : null;
  }

  async bumpLastUsedAt(assistantId: string, ids: readonly string[]): Promise<number> {
    if (ids.length === 0) {
      return 0;
    }
    const result = await this.prisma.assistantMemoryRegistryItem.updateMany({
      where: {
        assistantId,
        forgottenAt: null,
        id: { in: [...ids] }
      },
      data: { lastUsedAt: new Date() }
    });
    return result.count;
  }

  private mapToDomain(row: PrismaItem): AssistantMemoryRegistryItem {
    return {
      id: row.id,
      assistantId: row.assistantId,
      userId: row.userId,
      workspaceId: row.workspaceId,
      chatId: row.chatId,
      relatedUserMessageId: row.relatedUserMessageId,
      relatedAssistantMessageId: row.relatedAssistantMessageId,
      summary: row.summary,
      sourceType: row.sourceType,
      sourceLabel: row.sourceLabel,
      memoryClass: row.memoryClass,
      kind: row.kind,
      lastUsedAt: row.lastUsedAt,
      forgottenAt: row.forgottenAt,
      createdAt: row.createdAt
    };
  }
}
