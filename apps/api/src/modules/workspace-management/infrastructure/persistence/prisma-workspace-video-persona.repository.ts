import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type {
  WorkspaceVideoPersonaCreateInput,
  WorkspaceVideoPersonaRecord,
  WorkspaceVideoPersonaRepository
} from "../../domain/workspace-video-persona.repository";
import { WorkspaceManagementPrismaService } from "./workspace-management-prisma.service";

/**
 * ADR-109 Slice 5 — Prisma implementation of the workspace video persona
 * domain port.
 *
 * All mutating paths accept an optional (or required) `Prisma.TransactionClient`
 * so callers can compose persona operations atomically with ledger events and
 * wallet debits in a single `prisma.$transaction` block.
 */
@Injectable()
export class PrismaWorkspaceVideoPersonaRepository implements WorkspaceVideoPersonaRepository {
  constructor(private readonly prisma: WorkspaceManagementPrismaService) {}

  async countActiveForWorkspace(
    workspaceId: string,
    tx?: Prisma.TransactionClient
  ): Promise<number> {
    const client = tx ?? this.prisma;
    return client.workspaceVideoPersona.count({
      where: { workspaceId, archived: false }
    });
  }

  async findActiveByLowerName(
    workspaceId: string,
    displayNameLower: string,
    tx?: Prisma.TransactionClient
  ): Promise<WorkspaceVideoPersonaRecord | null> {
    const client = tx ?? this.prisma;
    const row = await client.workspaceVideoPersona.findFirst({
      where: { workspaceId, displayNameLower, archived: false }
    });
    return row === null ? null : this.mapToDomain(row);
  }

  async findById(
    workspaceId: string,
    personaId: string,
    tx?: Prisma.TransactionClient
  ): Promise<WorkspaceVideoPersonaRecord | null> {
    const client = tx ?? this.prisma;
    const row = await client.workspaceVideoPersona.findFirst({
      where: { id: personaId, workspaceId }
    });
    return row === null ? null : this.mapToDomain(row);
  }

  async listActive(workspaceId: string): Promise<WorkspaceVideoPersonaRecord[]> {
    const rows = await this.prisma.workspaceVideoPersona.findMany({
      where: { workspaceId, archived: false },
      orderBy: { createdAt: "asc" }
    });
    return rows.map((row) => this.mapToDomain(row));
  }

  async create(
    input: WorkspaceVideoPersonaCreateInput,
    tx: Prisma.TransactionClient
  ): Promise<WorkspaceVideoPersonaRecord> {
    const row = await tx.workspaceVideoPersona.create({
      data: {
        id: input.id,
        workspaceId: input.workspaceId,
        displayName: input.displayName,
        displayNameLower: input.displayNameLower,
        portraitImageUrl: input.portraitImageUrl,
        portraitImageStorageKey: input.portraitImageStorageKey,
        heygenVoiceId: input.heygenVoiceId,
        heygenVoiceLabel: input.heygenVoiceLabel,
        heygenAvatarId: input.heygenAvatarId,
        archived: false
      }
    });
    return this.mapToDomain(row);
  }

  async archive(
    workspaceId: string,
    personaId: string,
    tx?: Prisma.TransactionClient
  ): Promise<WorkspaceVideoPersonaRecord | null> {
    const client = tx ?? this.prisma;
    const existing = await client.workspaceVideoPersona.findFirst({
      where: { id: personaId, workspaceId }
    });
    if (existing === null) {
      return null;
    }
    const updated = await client.workspaceVideoPersona.update({
      where: { id: personaId },
      data: { archived: true, archivedAt: new Date() }
    });
    return this.mapToDomain(updated);
  }

  private mapToDomain(row: {
    id: string;
    workspaceId: string;
    displayName: string;
    displayNameLower: string;
    portraitImageUrl: string;
    portraitImageStorageKey: string;
    heygenVoiceId: string;
    heygenVoiceLabel: string;
    heygenAvatarId: string;
    archived: boolean;
    archivedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }): WorkspaceVideoPersonaRecord {
    return {
      id: row.id,
      workspaceId: row.workspaceId,
      displayName: row.displayName,
      displayNameLower: row.displayNameLower,
      portraitImageUrl: row.portraitImageUrl,
      portraitImageStorageKey: row.portraitImageStorageKey,
      heygenVoiceId: row.heygenVoiceId,
      heygenVoiceLabel: row.heygenVoiceLabel,
      heygenAvatarId: row.heygenAvatarId,
      archived: row.archived,
      archivedAt: row.archivedAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt
    };
  }
}
