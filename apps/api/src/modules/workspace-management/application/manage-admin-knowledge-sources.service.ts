import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { GlobalKnowledgeSource as PrismaGlobalKnowledgeSource } from "@prisma/client";
import type {
  GlobalKnowledgeSourceScope,
  GlobalKnowledgeSourceState
} from "./assistant-knowledge-source.types";
import { AdminAuthorizationService } from "./admin-authorization.service";
import { validatePersaiMediaFile } from "./media/media-security-policy";
import { KnowledgeIndexingError, KnowledgeIndexingService } from "./knowledge-indexing.service";
import { PersaiKnowledgeObjectStorageService } from "./persai-knowledge-object-storage.service";
import { TrackWorkspaceQuotaUsageService } from "./track-workspace-quota-usage.service";
import { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";

const KNOWLEDGE_DOCUMENT_MIMES = new Set([
  "application/json",
  "application/pdf",
  "application/msword",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
]);

@Injectable()
export class ManageAdminKnowledgeSourcesService {
  constructor(
    private readonly adminAuthorizationService: AdminAuthorizationService,
    private readonly prisma: WorkspaceManagementPrismaService,
    private readonly knowledgeObjectStorage: PersaiKnowledgeObjectStorageService,
    private readonly knowledgeIndexingService: KnowledgeIndexingService,
    private readonly trackWorkspaceQuotaUsageService: TrackWorkspaceQuotaUsageService
  ) {}

  parseUploadInput(body: unknown): { displayName: string | null } {
    if (body === null || body === undefined || typeof body !== "object" || Array.isArray(body)) {
      return { displayName: null };
    }
    const displayName = (body as { displayName?: unknown }).displayName;
    if (displayName === undefined || displayName === null || displayName === "") {
      return { displayName: null };
    }
    if (typeof displayName !== "string") {
      throw new BadRequestException("displayName must be a string when provided.");
    }
    const trimmed = displayName.trim();
    return { displayName: trimmed.length > 0 ? trimmed.slice(0, 255) : null };
  }

  parseScope(value: unknown): GlobalKnowledgeSourceScope {
    if (value === "product" || value === "skill") {
      return value;
    }
    throw new BadRequestException("scope must be either 'product' or 'skill'.");
  }

  async list(
    userId: string,
    scope: GlobalKnowledgeSourceScope
  ): Promise<GlobalKnowledgeSourceState[]> {
    const access = await this.adminAuthorizationService.assertCanReadAdminSurface(userId);
    const rows = await this.prisma.globalKnowledgeSource.findMany({
      where: {
        workspaceId: access.workspaceId,
        scope
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }]
    });
    return rows.map((row) => this.toState(row));
  }

  async upload(params: {
    userId: string;
    scope: GlobalKnowledgeSourceScope;
    displayName: string | null;
    file: { buffer: Buffer; mimetype: string; originalname: string };
  }): Promise<GlobalKnowledgeSourceState> {
    const access = await this.adminAuthorizationService.assertCanWriteGlobalKnowledge(
      params.userId
    );
    const validated = await validatePersaiMediaFile({
      buffer: params.file.buffer,
      mimeType: params.file.mimetype,
      originalFilename: params.file.originalname,
      surface: "knowledge_upload"
    });
    if (!this.isKnowledgeDocumentMime(validated.effectiveMimeType)) {
      throw new BadRequestException("Only document-like files can be added as knowledge sources.");
    }
    const quota = await this.trackWorkspaceQuotaUsageService.checkWorkspaceKnowledgeStorageQuota({
      workspaceId: access.workspaceId,
      userId: access.userId
    });
    if (!quota.allowed) {
      throw new ConflictException("Workspace knowledge storage quota is already exhausted.");
    }

    const objectKey = this.knowledgeObjectStorage.buildGlobalKnowledgeSourceObjectKey({
      scope: params.scope,
      extension: validated.normalizedExtension,
      originalFilename: validated.originalFilename
    });
    const stored = await this.knowledgeObjectStorage.saveObject({
      objectKey,
      buffer: params.file.buffer,
      mimeType: validated.effectiveMimeType
    });

    let source: PrismaGlobalKnowledgeSource | null = null;
    try {
      source = await this.prisma.globalKnowledgeSource.create({
        data: {
          workspaceId: access.workspaceId,
          createdByUserId: access.userId,
          scope: params.scope,
          displayName: params.displayName,
          originalFilename: validated.originalFilename ?? params.file.originalname,
          mimeType: validated.effectiveMimeType,
          sizeBytes: BigInt(stored.sizeBytes),
          storagePath: stored.objectKey,
          status: "processing"
        }
      });
      const applied =
        await this.trackWorkspaceQuotaUsageService.recordWorkspaceKnowledgeStorageUpload({
          workspaceId: access.workspaceId,
          userId: access.userId,
          sizeBytes: BigInt(stored.sizeBytes),
          source: "admin_global_knowledge_upload",
          metadata: {
            scope: params.scope,
            sourceId: source.id
          }
        });
      if (applied.capped) {
        throw new ConflictException("Workspace knowledge storage quota is exhausted.");
      }
    } catch (error) {
      if (source !== null) {
        await this.prisma.globalKnowledgeSource
          .delete({
            where: { id: source.id }
          })
          .catch(() => undefined);
      }
      await this.knowledgeObjectStorage.deleteObject(stored.objectKey).catch(() => undefined);
      throw error;
    }

    return this.indexExistingSource({
      sourceId: source.id,
      buffer: params.file.buffer,
      mimeType: source.mimeType,
      originalFilename: source.originalFilename,
      nextVersion: 1
    });
  }

  async delete(userId: string, sourceId: string): Promise<void> {
    const access = await this.adminAuthorizationService.assertCanWriteGlobalKnowledge(userId);
    const source = await this.prisma.globalKnowledgeSource.findFirst({
      where: {
        id: sourceId,
        workspaceId: access.workspaceId
      }
    });
    if (source === null) {
      throw new NotFoundException("Knowledge source not found.");
    }
    await this.prisma.globalKnowledgeSource.delete({
      where: { id: source.id }
    });
    await this.knowledgeObjectStorage.deleteObject(source.storagePath);
    await this.trackWorkspaceQuotaUsageService.releaseWorkspaceKnowledgeStorage({
      workspaceId: access.workspaceId,
      userId: access.userId,
      sizeBytes: source.sizeBytes,
      source: "admin_global_knowledge_delete",
      metadata: {
        scope: source.scope,
        sourceId: source.id
      }
    });
  }

  async reindex(userId: string, sourceId: string): Promise<GlobalKnowledgeSourceState> {
    const access = await this.adminAuthorizationService.assertCanWriteGlobalKnowledge(userId);
    const source = await this.prisma.globalKnowledgeSource.findFirst({
      where: {
        id: sourceId,
        workspaceId: access.workspaceId
      }
    });
    if (source === null) {
      throw new NotFoundException("Knowledge source not found.");
    }
    await this.prisma.globalKnowledgeSource.update({
      where: { id: source.id },
      data: {
        status: "processing",
        lastReindexRequestedAt: new Date(),
        lastErrorCode: null,
        lastErrorMessage: null
      }
    });

    const downloaded = await this.knowledgeObjectStorage.downloadObject(source.storagePath);
    if (downloaded === null) {
      return this.markFailedAndReturn(
        source.id,
        new KnowledgeIndexingError(
          "stored_file_missing",
          "The stored knowledge file could not be found for reindex."
        )
      );
    }

    return this.indexExistingSource({
      sourceId: source.id,
      buffer: downloaded.buffer,
      mimeType: source.mimeType,
      originalFilename: source.originalFilename,
      nextVersion: source.currentVersion + 1
    });
  }

  private async indexExistingSource(params: {
    sourceId: string;
    buffer: Buffer;
    mimeType: string;
    originalFilename: string;
    nextVersion: number;
  }): Promise<GlobalKnowledgeSourceState> {
    try {
      const chunks = await this.knowledgeIndexingService.buildIndexedChunks({
        buffer: params.buffer,
        mimeType: params.mimeType,
        originalFilename: params.originalFilename
      });
      await this.persistIndexedChunks(params.sourceId, params.nextVersion, chunks);
      const row = await this.prisma.globalKnowledgeSource.findUniqueOrThrow({
        where: { id: params.sourceId }
      });
      return this.toState(row);
    } catch (error) {
      return this.markFailedAndReturn(params.sourceId, error);
    }
  }

  private async persistIndexedChunks(
    sourceId: string,
    sourceVersion: number,
    chunks: Awaited<ReturnType<KnowledgeIndexingService["buildIndexedChunks"]>>
  ): Promise<void> {
    const source = await this.prisma.globalKnowledgeSource.findUniqueOrThrow({
      where: { id: sourceId },
      select: { workspaceId: true, scope: true }
    });
    await this.prisma.$transaction(async (tx) => {
      await tx.globalKnowledgeSourceChunk.deleteMany({
        where: { globalKnowledgeSourceId: sourceId }
      });
      await tx.globalKnowledgeSourceChunk.createMany({
        data: chunks.map((chunk) => ({
          globalKnowledgeSourceId: sourceId,
          workspaceId: source.workspaceId,
          scope: source.scope,
          sourceVersion,
          chunkIndex: chunk.chunkIndex,
          locator: chunk.locator,
          content: chunk.content,
          embeddingModelKey: chunk.embeddingModelKey,
          embeddingVector:
            chunk.embeddingVector === null
              ? Prisma.JsonNull
              : (chunk.embeddingVector as Prisma.InputJsonValue),
          embeddingGeneratedAt: chunk.embeddingGeneratedAt
        }))
      });
      await tx.globalKnowledgeSource.update({
        where: { id: sourceId },
        data: {
          status: "ready",
          currentVersion: sourceVersion,
          chunkCount: chunks.length,
          lastIndexedAt: new Date(),
          lastErrorCode: null,
          lastErrorMessage: null
        }
      });
    });
  }

  private async markFailedAndReturn(
    sourceId: string,
    error: unknown
  ): Promise<GlobalKnowledgeSourceState> {
    const normalized =
      error instanceof KnowledgeIndexingError
        ? error
        : new KnowledgeIndexingError(
            "indexing_failed",
            error instanceof Error && error.message.trim().length > 0
              ? error.message.trim().slice(0, 500)
              : "Knowledge indexing failed."
          );
    const row = await this.prisma.globalKnowledgeSource.update({
      where: { id: sourceId },
      data: {
        status: "failed",
        lastErrorCode: normalized.code,
        lastErrorMessage: normalized.message
      }
    });
    return this.toState(row);
  }

  private toState(row: PrismaGlobalKnowledgeSource): GlobalKnowledgeSourceState {
    return {
      id: row.id,
      scope: row.scope,
      displayName: row.displayName,
      originalFilename: row.originalFilename,
      mimeType: row.mimeType,
      sizeBytes: Number(row.sizeBytes),
      status: row.status,
      currentVersion: row.currentVersion,
      chunkCount: row.chunkCount,
      lastIndexedAt: row.lastIndexedAt?.toISOString() ?? null,
      lastReindexRequestedAt: row.lastReindexRequestedAt?.toISOString() ?? null,
      lastErrorCode: row.lastErrorCode,
      lastErrorMessage: row.lastErrorMessage,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString()
    };
  }

  private isKnowledgeDocumentMime(mimeType: string): boolean {
    return mimeType.startsWith("text/") || KNOWLEDGE_DOCUMENT_MIMES.has(mimeType);
  }
}
