import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException
} from "@nestjs/common";
import { Prisma, type GlobalKnowledgeSource as PrismaGlobalKnowledgeSource } from "@prisma/client";
import type {
  GlobalKnowledgeSourceScope,
  GlobalKnowledgeSourceState
} from "./assistant-knowledge-source.types";
import {
  parseProductKnowledgeTextEntryInput,
  toProductKnowledgeTextEntryState,
  type ProductKnowledgeTextEntryInput,
  type ProductKnowledgeTextEntryState
} from "./authored-knowledge.types";
import {
  toKnowledgeIndexingJobState,
  type KnowledgeIndexingJobState
} from "./skill-management.types";
import { AdminAuthorizationService } from "./admin-authorization.service";
import { validatePersaiMediaFile } from "./media/media-security-policy";
import { KnowledgeIndexingJobWorkerService } from "./knowledge-indexing-job-worker.service";
import { PersaiKnowledgeObjectStorageService } from "./persai-knowledge-object-storage.service";
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
    private readonly knowledgeIndexingJobWorkerService: KnowledgeIndexingJobWorkerService
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

  parseTextEntryInput(body: unknown): ProductKnowledgeTextEntryInput {
    try {
      return parseProductKnowledgeTextEntryInput(body);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Invalid Product KB text entry request.";
      throw new BadRequestException(message);
    }
  }

  parseScope(value: unknown): GlobalKnowledgeSourceScope {
    if (value === "product") {
      return value;
    }
    throw new BadRequestException(
      "scope must be 'product'. Skills are managed through /admin/skills."
    );
  }

  async list(
    userId: string,
    scope: GlobalKnowledgeSourceScope
  ): Promise<GlobalKnowledgeSourceState[]> {
    await this.adminAuthorizationService.assertCanReadAdminSurface(userId);
    const rows = await this.prisma.globalKnowledgeSource.findMany({
      where: {
        scope
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }]
    });
    return rows.map((row) => this.toState(row));
  }

  async listTextEntries(userId: string): Promise<ProductKnowledgeTextEntryState[]> {
    await this.adminAuthorizationService.assertCanReadAdminSurface(userId);
    const rows = await this.prisma.productKnowledgeTextEntry.findMany({
      where: {
        lifecycleStatus: { not: "archived" }
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }]
    });
    return rows.map(toProductKnowledgeTextEntryState);
  }

  async createTextEntry(
    userId: string,
    input: ProductKnowledgeTextEntryInput
  ): Promise<{
    entry: ProductKnowledgeTextEntryState;
    indexingJob: KnowledgeIndexingJobState | null;
  }> {
    const access = await this.adminAuthorizationService.assertCanWriteGlobalKnowledge(userId);
    const lifecycleStatus = input.lifecycleStatus ?? "draft";
    const result = await this.prisma.$transaction(async (tx) => {
      const entry = await tx.productKnowledgeTextEntry.create({
        data: {
          createdByUserId: access.userId,
          updatedByUserId: access.userId,
          title: input.title,
          body: input.body,
          category: input.category,
          locale: input.locale,
          tags: input.tags as Prisma.InputJsonValue,
          lifecycleStatus,
          status: lifecycleStatus === "active" ? "processing" : "ready",
          provenanceKind: input.provenanceKind,
          provenanceMetadata:
            input.provenanceMetadata === null
              ? Prisma.JsonNull
              : (input.provenanceMetadata as Prisma.InputJsonValue),
          currentVersion: 1,
          archivedAt: lifecycleStatus === "archived" ? new Date() : null
        }
      });
      const indexingJob =
        lifecycleStatus === "active"
          ? await tx.knowledgeIndexingJob.create({
              data: {
                workspaceId: null,
                requestedByUserId: access.userId,
                sourceType: "product_knowledge_text_entry",
                sourceId: entry.id,
                sourceVersion: 1,
                status: "pending",
                processorMode: "local",
                pendingDedupeKey: `product_knowledge_text_entry:${entry.id}:1`
              }
            })
          : null;
      return { entry, indexingJob };
    });
    return {
      entry: toProductKnowledgeTextEntryState(result.entry),
      indexingJob:
        result.indexingJob === null ? null : toKnowledgeIndexingJobState(result.indexingJob)
    };
  }

  async updateTextEntry(
    userId: string,
    entryId: string,
    input: ProductKnowledgeTextEntryInput
  ): Promise<{
    entry: ProductKnowledgeTextEntryState;
    indexingJob: KnowledgeIndexingJobState | null;
  }> {
    const access = await this.adminAuthorizationService.assertCanWriteGlobalKnowledge(userId);
    const existing = await this.prisma.productKnowledgeTextEntry.findFirst({
      where: { id: entryId }
    });
    if (existing === null) {
      throw new NotFoundException("Product KB text entry not found.");
    }
    const lifecycleStatus = input.lifecycleStatus ?? existing.lifecycleStatus;
    const shouldIndex = lifecycleStatus === "active";
    const nextVersion = shouldIndex ? existing.currentVersion + 1 : existing.currentVersion;
    const result = await this.prisma.$transaction(async (tx) => {
      if (!shouldIndex) {
        await this.clearProductTextEntryRuntimeIndex(tx, existing.id);
      }
      const entry = await tx.productKnowledgeTextEntry.update({
        where: { id: existing.id },
        data: {
          title: input.title,
          body: input.body,
          category: input.category,
          locale: input.locale,
          tags: input.tags as Prisma.InputJsonValue,
          lifecycleStatus,
          provenanceKind: input.provenanceKind,
          provenanceMetadata:
            input.provenanceMetadata === null
              ? Prisma.JsonNull
              : (input.provenanceMetadata as Prisma.InputJsonValue),
          status: shouldIndex ? "processing" : "ready",
          currentVersion: nextVersion,
          updatedByUserId: access.userId,
          lastReindexRequestedAt: shouldIndex ? new Date() : existing.lastReindexRequestedAt,
          lastErrorCode: null,
          lastErrorMessage: null,
          archivedAt:
            lifecycleStatus === "archived"
              ? (existing.archivedAt ?? new Date())
              : lifecycleStatus === "draft" || lifecycleStatus === "active"
                ? null
                : existing.archivedAt
        }
      });
      const indexingJob = shouldIndex
        ? await tx.knowledgeIndexingJob.create({
            data: {
              workspaceId: null,
              requestedByUserId: access.userId,
              sourceType: "product_knowledge_text_entry",
              sourceId: existing.id,
              sourceVersion: nextVersion,
              status: "pending",
              processorMode: "local",
              pendingDedupeKey: `product_knowledge_text_entry:${existing.id}:${String(nextVersion)}`
            }
          })
        : null;
      return { entry, indexingJob };
    });
    return {
      entry: toProductKnowledgeTextEntryState(result.entry),
      indexingJob:
        result.indexingJob === null ? null : toKnowledgeIndexingJobState(result.indexingJob)
    };
  }

  async archiveTextEntry(userId: string, entryId: string): Promise<void> {
    const access = await this.adminAuthorizationService.assertCanWriteGlobalKnowledge(userId);
    const existing = await this.prisma.productKnowledgeTextEntry.findFirst({
      where: { id: entryId }
    });
    if (existing === null) {
      throw new NotFoundException("Product KB text entry not found.");
    }
    await this.prisma.$transaction(async (tx) => {
      await this.clearProductTextEntryRuntimeIndex(tx, existing.id);
      await tx.productKnowledgeTextEntry.update({
        where: { id: existing.id },
        data: {
          lifecycleStatus: "archived",
          status: "ready",
          archivedAt: existing.archivedAt ?? new Date(),
          updatedByUserId: access.userId
        }
      });
    });
  }

  async reindexTextEntry(
    userId: string,
    entryId: string
  ): Promise<{ entry: ProductKnowledgeTextEntryState; indexingJob: KnowledgeIndexingJobState }> {
    const access = await this.adminAuthorizationService.assertCanWriteGlobalKnowledge(userId);
    const existing = await this.prisma.productKnowledgeTextEntry.findFirst({
      where: { id: entryId }
    });
    if (existing === null) {
      throw new NotFoundException("Product KB text entry not found.");
    }
    if (existing.lifecycleStatus !== "active") {
      throw new ConflictException("Only active Product KB text entries can be reindexed.");
    }
    const nextVersion = existing.currentVersion + 1;
    const result = await this.prisma.$transaction(async (tx) => {
      const entry = await tx.productKnowledgeTextEntry.update({
        where: { id: existing.id },
        data: {
          status: "processing",
          currentVersion: nextVersion,
          lastReindexRequestedAt: new Date(),
          lastErrorCode: null,
          lastErrorMessage: null
        }
      });
      const indexingJob = await tx.knowledgeIndexingJob.create({
        data: {
          workspaceId: null,
          requestedByUserId: access.userId,
          sourceType: "product_knowledge_text_entry",
          sourceId: existing.id,
          sourceVersion: nextVersion,
          status: "pending",
          processorMode: "local",
          pendingDedupeKey: `product_knowledge_text_entry:${existing.id}:${String(nextVersion)}`
        }
      });
      return { entry, indexingJob };
    });
    return {
      entry: toProductKnowledgeTextEntryState(result.entry),
      indexingJob: toKnowledgeIndexingJobState(result.indexingJob)
    };
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
          createdByUserId: access.userId,
          scope: params.scope,
          displayName: params.displayName,
          originalFilename: validated.originalFilename ?? params.file.originalname,
          mimeType: validated.effectiveMimeType,
          sizeBytes: BigInt(stored.sizeBytes),
          storagePath: stored.objectKey,
          status: "processing",
          currentVersion: 1
        }
      });
      await this.knowledgeIndexingJobWorkerService.enqueueSourceJob({
        workspaceId: null,
        requestedByUserId: access.userId,
        sourceType: "global_knowledge_source",
        sourceId: source.id,
        sourceVersion: 1,
        processorMode: "auto"
      });
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

    return this.toState(source);
  }

  async delete(userId: string, sourceId: string): Promise<void> {
    await this.adminAuthorizationService.assertCanWriteGlobalKnowledge(userId);
    const source = await this.prisma.globalKnowledgeSource.findFirst({
      where: {
        id: sourceId
      }
    });
    if (source === null) {
      throw new NotFoundException("Knowledge source not found.");
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.knowledgeVectorChunk.deleteMany({
        where: { sourceType: "global_knowledge_source", sourceId: source.id }
      });
      await tx.knowledgeIndexingJob.deleteMany({
        where: { sourceType: "global_knowledge_source", sourceId: source.id }
      });
      await tx.globalKnowledgeSource.delete({
        where: { id: source.id }
      });
    });
    await this.knowledgeObjectStorage.deleteObject(source.storagePath);
  }

  async reindex(userId: string, sourceId: string): Promise<GlobalKnowledgeSourceState> {
    const access = await this.adminAuthorizationService.assertCanWriteGlobalKnowledge(userId);
    const source = await this.prisma.globalKnowledgeSource.findFirst({
      where: {
        id: sourceId
      }
    });
    if (source === null) {
      throw new NotFoundException("Knowledge source not found.");
    }
    const nextVersion = source.currentVersion + 1;
    const updated = await this.prisma.globalKnowledgeSource.update({
      where: { id: source.id },
      data: {
        status: "processing",
        currentVersion: nextVersion,
        lastReindexRequestedAt: new Date(),
        lastErrorCode: null,
        lastErrorMessage: null
      }
    });
    await this.knowledgeIndexingJobWorkerService.enqueueSourceJob({
      workspaceId: null,
      requestedByUserId: access.userId,
      sourceType: "global_knowledge_source",
      sourceId: source.id,
      sourceVersion: nextVersion,
      processorMode: "auto"
    });
    return this.toState(updated);
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

  private async clearProductTextEntryRuntimeIndex(
    tx: {
      productKnowledgeTextEntryChunk: {
        deleteMany: (args: { where: { textEntryId: string } }) => Promise<unknown>;
      };
      knowledgeVectorChunk: {
        deleteMany: (args: {
          where: { sourceType: "product_knowledge_text_entry"; sourceId: string };
        }) => Promise<unknown>;
      };
      knowledgeIndexingJob: {
        deleteMany: (args: {
          where: {
            sourceType: "product_knowledge_text_entry";
            sourceId: string;
            status?: "pending";
          };
        }) => Promise<unknown>;
      };
    },
    entryId: string
  ): Promise<void> {
    await tx.productKnowledgeTextEntryChunk.deleteMany({
      where: { textEntryId: entryId }
    });
    await tx.knowledgeVectorChunk.deleteMany({
      where: { sourceType: "product_knowledge_text_entry", sourceId: entryId }
    });
    await tx.knowledgeIndexingJob.deleteMany({
      where: { sourceType: "product_knowledge_text_entry", sourceId: entryId, status: "pending" }
    });
  }
}
