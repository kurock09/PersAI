import { Injectable } from "@nestjs/common";
import { Prisma, type WorkspaceVideoClonedVoiceStatus } from "@prisma/client";
import type {
  WorkspaceVideoPersonaCreateInput,
  WorkspaceVideoPersonaUpdateInput,
  WorkspaceVideoPersonaRecord,
  WorkspaceVideoPersonaRepository
} from "../../domain/workspace-video-persona.repository";
import { WorkspaceManagementPrismaService } from "./workspace-management-prisma.service";

// The `id` column is a Postgres `uuid`. A lookup by a non-UUID value (e.g. when
// the model passes a display name like "alexey" instead of the real personaId)
// makes Prisma throw a raw "Error creating UUID" instead of returning no row.
// We guard such inputs so the lookup resolves to "not found" honestly rather
// than surfacing a database crash to the runtime.
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value.trim());
}

function normalizeVideoFormat(value: string): "16:9" | "9:16" | "1:1" {
  if (value === "16:9" || value === "9:16" || value === "1:1") {
    return value;
  }
  return "1:1";
}

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

  private readonly clonedVoiceInclude = {
    clonedVoice: {
      select: {
        id: true,
        displayName: true,
        heygenVoiceCloneId: true,
        status: true,
        archived: true
      }
    }
  } satisfies Prisma.WorkspaceVideoPersonaInclude;

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
      where: { workspaceId, displayNameLower, archived: false },
      include: this.clonedVoiceInclude
    });
    return row === null ? null : this.mapToDomain(row);
  }

  async findById(
    workspaceId: string,
    personaId: string,
    tx?: Prisma.TransactionClient
  ): Promise<WorkspaceVideoPersonaRecord | null> {
    if (!isUuid(personaId)) {
      return null;
    }
    const client = tx ?? this.prisma;
    const row = await client.workspaceVideoPersona.findFirst({
      where: { id: personaId, workspaceId },
      include: this.clonedVoiceInclude
    });
    return row === null ? null : this.mapToDomain(row);
  }

  async listActive(workspaceId: string): Promise<WorkspaceVideoPersonaRecord[]> {
    const rows = await this.prisma.workspaceVideoPersona.findMany({
      where: { workspaceId, archived: false },
      orderBy: { createdAt: "asc" },
      include: this.clonedVoiceInclude
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
        videoFormat: input.videoFormat,
        heygenVoiceId: input.heygenVoiceId,
        heygenVoiceLabel: input.heygenVoiceLabel,
        clonedVoiceId: input.clonedVoiceId ?? null,
        heygenAvatarId: input.heygenAvatarId,
        archived: false
      },
      include: this.clonedVoiceInclude
    });
    return this.mapToDomain(row);
  }

  async update(
    input: WorkspaceVideoPersonaUpdateInput,
    tx?: Prisma.TransactionClient
  ): Promise<WorkspaceVideoPersonaRecord | null> {
    if (!isUuid(input.personaId)) {
      return null;
    }
    const client = tx ?? this.prisma;
    const existing = await client.workspaceVideoPersona.findFirst({
      where: { id: input.personaId, workspaceId: input.workspaceId, archived: false }
    });
    if (existing === null) {
      return null;
    }
    const updated = await client.workspaceVideoPersona.update({
      where: { id: input.personaId },
      data: {
        displayName: input.displayName,
        displayNameLower: input.displayNameLower,
        ...(input.videoFormat === undefined ? {} : { videoFormat: input.videoFormat }),
        ...(input.heygenVoiceId === undefined ? {} : { heygenVoiceId: input.heygenVoiceId }),
        ...(input.heygenVoiceLabel === undefined
          ? {}
          : { heygenVoiceLabel: input.heygenVoiceLabel }),
        ...(input.clonedVoiceId === undefined ? {} : { clonedVoiceId: input.clonedVoiceId })
      },
      include: this.clonedVoiceInclude
    });
    return this.mapToDomain(updated);
  }

  async archive(
    workspaceId: string,
    personaId: string,
    tx?: Prisma.TransactionClient
  ): Promise<WorkspaceVideoPersonaRecord | null> {
    if (!isUuid(personaId)) {
      return null;
    }
    const client = tx ?? this.prisma;
    const existing = await client.workspaceVideoPersona.findFirst({
      where: { id: personaId, workspaceId }
    });
    if (existing === null) {
      return null;
    }
    const updated = await client.workspaceVideoPersona.update({
      where: { id: personaId },
      data: { archived: true, archivedAt: new Date() },
      include: this.clonedVoiceInclude
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
    videoFormat: string;
    heygenVoiceId: string;
    heygenVoiceLabel: string;
    clonedVoiceId: string | null;
    heygenAvatarId: string;
    archived: boolean;
    archivedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
    clonedVoice?: {
      id: string;
      displayName: string;
      heygenVoiceCloneId: string | null;
      status: WorkspaceVideoClonedVoiceStatus;
      archived: boolean;
    } | null;
  }): WorkspaceVideoPersonaRecord {
    return {
      id: row.id,
      workspaceId: row.workspaceId,
      displayName: row.displayName,
      displayNameLower: row.displayNameLower,
      portraitImageUrl: row.portraitImageUrl,
      portraitImageStorageKey: row.portraitImageStorageKey,
      videoFormat: normalizeVideoFormat(row.videoFormat),
      heygenVoiceId: row.heygenVoiceId,
      heygenVoiceLabel: row.heygenVoiceLabel,
      clonedVoiceId: row.clonedVoiceId,
      linkedClonedVoiceDisplayName: row.clonedVoice?.displayName ?? null,
      linkedClonedVoiceProviderId: row.clonedVoice?.heygenVoiceCloneId ?? null,
      linkedClonedVoiceStatus: row.clonedVoice?.status ?? null,
      linkedClonedVoiceArchived: row.clonedVoice?.archived ?? null,
      heygenAvatarId: row.heygenAvatarId,
      archived: row.archived,
      archivedAt: row.archivedAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt
    };
  }
}
