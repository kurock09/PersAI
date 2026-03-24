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
        sourceLabel: input.sourceLabel
      }
    });

    return this.mapToDomain(row);
  }

  async listActiveByAssistantId(
    assistantId: string,
    limit: number
  ): Promise<AssistantMemoryRegistryItem[]> {
    const rows = await this.prisma.assistantMemoryRegistryItem.findMany({
      where: { assistantId, forgottenAt: null },
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
      forgottenAt: row.forgottenAt,
      createdAt: row.createdAt
    };
  }
}
