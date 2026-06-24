import { Injectable } from "@nestjs/common";
import type { WorkspaceFileMetadata as PrismaRow } from "@prisma/client";
import type {
  UpsertWorkspaceFileMetadataInput,
  WorkspaceFileMetadataRepository,
  WorkspaceFileMetadataRow
} from "../../domain/workspace-file-metadata.repository";
import { WorkspaceManagementPrismaService } from "./workspace-management-prisma.service";

@Injectable()
export class PrismaWorkspaceFileMetadataRepository implements WorkspaceFileMetadataRepository {
  constructor(private readonly prisma: WorkspaceManagementPrismaService) {}

  async upsert(input: UpsertWorkspaceFileMetadataInput): Promise<void> {
    await this.prisma.workspaceFileMetadata.upsert({
      where: {
        workspaceId_path: {
          workspaceId: input.workspaceId,
          path: input.path
        }
      },
      create: {
        workspaceId: input.workspaceId,
        path: input.path,
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes,
        contentHash: input.contentHash ?? null,
        shortDescription: input.shortDescription ?? null
      },
      update: {
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes,
        ...(input.contentHash !== undefined ? { contentHash: input.contentHash } : {}),
        ...(input.shortDescription !== undefined
          ? { shortDescription: input.shortDescription }
          : {})
      }
    });
  }

  async get(input: {
    workspaceId: string;
    path: string;
  }): Promise<WorkspaceFileMetadataRow | null> {
    const row = await this.prisma.workspaceFileMetadata.findUnique({
      where: {
        workspaceId_path: {
          workspaceId: input.workspaceId,
          path: input.path
        }
      }
    });
    return row ? this.mapToDomain(row) : null;
  }

  async list(input: {
    workspaceId: string;
    pathPrefix?: string;
    limit?: number;
  }): Promise<WorkspaceFileMetadataRow[]> {
    const rows = await this.prisma.workspaceFileMetadata.findMany({
      where: {
        workspaceId: input.workspaceId,
        ...(input.pathPrefix !== undefined && input.pathPrefix.length > 0
          ? { path: { startsWith: input.pathPrefix } }
          : {})
      },
      orderBy: { createdAt: "desc" },
      take: input.limit ?? 100
    });
    return rows.map((row) => this.mapToDomain(row));
  }

  async delete(input: { workspaceId: string; path: string }): Promise<void> {
    await this.prisma.workspaceFileMetadata.deleteMany({
      where: {
        workspaceId: input.workspaceId,
        path: input.path
      }
    });
  }

  private mapToDomain(row: PrismaRow): WorkspaceFileMetadataRow {
    return {
      workspaceId: row.workspaceId,
      path: row.path,
      mimeType: row.mimeType,
      sizeBytes: row.sizeBytes,
      contentHash: row.contentHash,
      shortDescription: row.shortDescription,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt
    };
  }
}
