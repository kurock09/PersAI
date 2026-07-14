import { Injectable } from "@nestjs/common";
import type { AssistantRole as PrismaAssistantRole } from "@prisma/client";
import type { AssistantRole } from "../../domain/assistant-role.entity";
import type { AssistantRoleRepository } from "../../domain/assistant-role.repository";
import { WorkspaceManagementPrismaService } from "./workspace-management-prisma.service";

@Injectable()
export class PrismaAssistantRoleRepository implements AssistantRoleRepository {
  constructor(private readonly prisma: WorkspaceManagementPrismaService) {}

  async findById(id: string): Promise<AssistantRole | null> {
    const row = await this.prisma.assistantRole.findUnique({ where: { id } });
    return row === null ? null : this.mapToDomain(row);
  }

  async findByKey(key: string): Promise<AssistantRole | null> {
    const row = await this.prisma.assistantRole.findUnique({ where: { key } });
    return row === null ? null : this.mapToDomain(row);
  }

  async findActiveCatalog(): Promise<AssistantRole[]> {
    const rows = await this.prisma.assistantRole.findMany({
      where: { status: "active" },
      orderBy: [{ displayOrder: "asc" }, { createdAt: "asc" }, { key: "asc" }]
    });
    return rows.map((row) => this.mapToDomain(row));
  }

  private mapToDomain(row: PrismaAssistantRole): AssistantRole {
    return {
      id: row.id,
      key: row.key,
      name: normalizeLocalizedText(row.name),
      description: normalizeLocalizedText(row.description),
      mission: normalizeLocalizedText(row.mission),
      category: row.category,
      iconEmoji: row.iconEmoji,
      color: row.color,
      status: row.status,
      displayOrder: row.displayOrder,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt
    };
  }
}

function normalizeLocalizedText(value: unknown): Record<string, string> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  const normalized: Record<string, string> = {};
  for (const [locale, text] of Object.entries(value as Record<string, unknown>)) {
    if (typeof text === "string" && text.trim().length > 0) {
      normalized[locale.toLowerCase()] = text;
    }
  }
  return normalized;
}
