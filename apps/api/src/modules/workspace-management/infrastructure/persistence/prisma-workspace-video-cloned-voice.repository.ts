import { Injectable } from "@nestjs/common";
import { Prisma, type WorkspaceVideoClonedVoiceStatus } from "@prisma/client";
import type {
  WorkspaceVideoClonedVoiceCreateInput,
  WorkspaceVideoClonedVoiceRecord,
  WorkspaceVideoClonedVoiceUpdateInput,
  WorkspaceVideoClonedVoiceRepository
} from "../../domain/workspace-video-cloned-voice.repository";
import { WorkspaceManagementPrismaService } from "./workspace-management-prisma.service";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value.trim());
}

@Injectable()
export class PrismaWorkspaceVideoClonedVoiceRepository implements WorkspaceVideoClonedVoiceRepository {
  constructor(private readonly prisma: WorkspaceManagementPrismaService) {}

  async countActiveForWorkspace(
    workspaceId: string,
    tx?: Prisma.TransactionClient
  ): Promise<number> {
    const client = tx ?? this.prisma;
    return client.workspaceVideoClonedVoice.count({
      where: { workspaceId, archived: false }
    });
  }

  async findActiveByLowerName(
    workspaceId: string,
    displayNameLower: string,
    tx?: Prisma.TransactionClient
  ): Promise<WorkspaceVideoClonedVoiceRecord | null> {
    const client = tx ?? this.prisma;
    const row = await client.workspaceVideoClonedVoice.findFirst({
      where: { workspaceId, displayNameLower, archived: false }
    });
    return row === null ? null : this.mapToDomain(row);
  }

  async findById(
    workspaceId: string,
    clonedVoiceId: string,
    tx?: Prisma.TransactionClient
  ): Promise<WorkspaceVideoClonedVoiceRecord | null> {
    if (!isUuid(clonedVoiceId)) {
      return null;
    }
    const client = tx ?? this.prisma;
    const row = await client.workspaceVideoClonedVoice.findFirst({
      where: { id: clonedVoiceId, workspaceId }
    });
    return row === null ? null : this.mapToDomain(row);
  }

  async listActive(
    workspaceId: string,
    tx?: Prisma.TransactionClient
  ): Promise<WorkspaceVideoClonedVoiceRecord[]> {
    const client = tx ?? this.prisma;
    const rows = await client.workspaceVideoClonedVoice.findMany({
      where: { workspaceId, archived: false },
      orderBy: { createdAt: "asc" }
    });
    return rows.map((row) => this.mapToDomain(row));
  }

  async create(
    input: WorkspaceVideoClonedVoiceCreateInput,
    tx: Prisma.TransactionClient
  ): Promise<WorkspaceVideoClonedVoiceRecord> {
    const row = await tx.workspaceVideoClonedVoice.create({
      data: {
        id: input.id,
        workspaceId: input.workspaceId,
        displayName: input.displayName,
        displayNameLower: input.displayNameLower,
        heygenVoiceCloneId: input.heygenVoiceCloneId ?? null,
        languageHint: input.languageHint ?? null,
        status: input.status ?? "pending",
        isDefault: input.isDefault ?? false,
        previewAudioUrl: input.previewAudioUrl ?? null,
        sourceMetadata: input.sourceMetadata ?? {}
      }
    });
    return this.mapToDomain(row);
  }

  async update(
    input: WorkspaceVideoClonedVoiceUpdateInput,
    tx: Prisma.TransactionClient
  ): Promise<WorkspaceVideoClonedVoiceRecord | null> {
    if (!isUuid(input.clonedVoiceId)) {
      return null;
    }
    const existing = await tx.workspaceVideoClonedVoice.findFirst({
      where: { id: input.clonedVoiceId, workspaceId: input.workspaceId, archived: false }
    });
    if (existing === null) {
      return null;
    }
    const updated = await tx.workspaceVideoClonedVoice.update({
      where: { id: input.clonedVoiceId },
      data: {
        ...(input.heygenVoiceCloneId === undefined
          ? {}
          : { heygenVoiceCloneId: input.heygenVoiceCloneId }),
        ...(input.languageHint === undefined ? {} : { languageHint: input.languageHint }),
        ...(input.status === undefined ? {} : { status: input.status }),
        ...(input.isDefault === undefined ? {} : { isDefault: input.isDefault }),
        ...(input.previewAudioUrl === undefined ? {} : { previewAudioUrl: input.previewAudioUrl }),
        ...(input.sourceMetadata === undefined ? {} : { sourceMetadata: input.sourceMetadata })
      }
    });
    return this.mapToDomain(updated);
  }

  async setDefault(
    workspaceId: string,
    clonedVoiceId: string,
    tx: Prisma.TransactionClient
  ): Promise<WorkspaceVideoClonedVoiceRecord | null> {
    if (!isUuid(clonedVoiceId)) {
      return null;
    }
    const existing = await tx.workspaceVideoClonedVoice.findFirst({
      where: { id: clonedVoiceId, workspaceId, archived: false }
    });
    if (existing === null) {
      return null;
    }
    await tx.workspaceVideoClonedVoice.updateMany({
      where: { workspaceId, archived: false, isDefault: true },
      data: { isDefault: false }
    });
    const updated = await tx.workspaceVideoClonedVoice.update({
      where: { id: clonedVoiceId },
      data: { isDefault: true }
    });
    return this.mapToDomain(updated);
  }

  async archive(
    workspaceId: string,
    clonedVoiceId: string,
    tx?: Prisma.TransactionClient
  ): Promise<WorkspaceVideoClonedVoiceRecord | null> {
    if (!isUuid(clonedVoiceId)) {
      return null;
    }
    const client = tx ?? this.prisma;
    const existing = await client.workspaceVideoClonedVoice.findFirst({
      where: { id: clonedVoiceId, workspaceId }
    });
    if (existing === null) {
      return null;
    }
    const updated = await client.workspaceVideoClonedVoice.update({
      where: { id: clonedVoiceId },
      data: { archived: true, archivedAt: new Date(), isDefault: false }
    });
    return this.mapToDomain(updated);
  }

  private mapToDomain(row: {
    id: string;
    workspaceId: string;
    displayName: string;
    displayNameLower: string;
    heygenVoiceCloneId: string | null;
    languageHint: string | null;
    status: WorkspaceVideoClonedVoiceStatus;
    isDefault: boolean;
    previewAudioUrl: string | null;
    sourceMetadata: Prisma.JsonValue;
    archived: boolean;
    archivedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }): WorkspaceVideoClonedVoiceRecord {
    return {
      id: row.id,
      workspaceId: row.workspaceId,
      displayName: row.displayName,
      displayNameLower: row.displayNameLower,
      heygenVoiceCloneId: row.heygenVoiceCloneId,
      languageHint: row.languageHint,
      status: row.status,
      isDefault: row.isDefault,
      previewAudioUrl: row.previewAudioUrl,
      sourceMetadata: row.sourceMetadata,
      archived: row.archived,
      archivedAt: row.archivedAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt
    };
  }
}
