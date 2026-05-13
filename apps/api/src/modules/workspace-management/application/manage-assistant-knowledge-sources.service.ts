import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { AssistantKnowledgeSource as PrismaAssistantKnowledgeSource } from "@prisma/client";
import { createKnowledgeStorageQuotaExceededError } from "./assistant-inbound-error";
import type {
  AssistantKnowledgeSourceInspectState,
  AssistantKnowledgeQuotaState,
  AssistantKnowledgeSourceState
} from "./assistant-knowledge-source.types";
import { KnowledgeIndexingJobWorkerService } from "./knowledge-indexing-job-worker.service";
import { PersaiKnowledgeObjectStorageService } from "./persai-knowledge-object-storage.service";
import { TrackWorkspaceQuotaUsageService } from "./track-workspace-quota-usage.service";
import { validatePersaiMediaFile } from "./media/media-security-policy";
import { ASSISTANT_REPOSITORY, type AssistantRepository } from "../domain/assistant.repository";
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
export class ManageAssistantKnowledgeSourcesService {
  constructor(
    @Inject(ASSISTANT_REPOSITORY)
    private readonly assistantRepository: AssistantRepository,
    private readonly prisma: WorkspaceManagementPrismaService,
    private readonly knowledgeObjectStorage: PersaiKnowledgeObjectStorageService,
    private readonly trackWorkspaceQuotaUsageService: TrackWorkspaceQuotaUsageService,
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

  async upload(params: {
    userId: string;
    displayName: string | null;
    file: { buffer: Buffer; mimetype: string; originalname: string };
  }): Promise<AssistantKnowledgeSourceState> {
    const assistant = await this.resolveAssistant(params.userId);
    const validated = await validatePersaiMediaFile({
      buffer: params.file.buffer,
      mimeType: params.file.mimetype,
      originalFilename: params.file.originalname,
      surface: "knowledge_upload"
    });

    if (!this.isKnowledgeDocumentMime(validated.effectiveMimeType)) {
      throw new BadRequestException("Only document-like files can be added as knowledge sources.");
    }

    const quotaCheck =
      await this.trackWorkspaceQuotaUsageService.checkKnowledgeStorageQuota(assistant);
    if (!quotaCheck.allowed) {
      throw createKnowledgeStorageQuotaExceededError(quotaCheck.usedBytes, quotaCheck.limitBytes);
    }

    const objectKey = this.knowledgeObjectStorage.buildKnowledgeSourceObjectKey({
      assistantId: assistant.id,
      extension: validated.normalizedExtension,
      originalFilename: validated.originalFilename
    });
    const stored = await this.knowledgeObjectStorage.saveObject({
      objectKey,
      buffer: params.file.buffer,
      mimeType: validated.effectiveMimeType
    });

    const applied = await this.trackWorkspaceQuotaUsageService.recordKnowledgeStorageUpload({
      assistant,
      sizeBytes: BigInt(stored.sizeBytes),
      source: "assistant_knowledge_source_upload",
      metadata: {
        mimeType: validated.effectiveMimeType
      }
    });
    if (applied.capped) {
      await this.knowledgeObjectStorage.deleteObject(stored.objectKey);
      const released = await this.trackWorkspaceQuotaUsageService.releaseKnowledgeStorage({
        assistant,
        sizeBytes: applied.appliedDelta,
        source: "assistant_knowledge_source_upload_rollback"
      });
      throw createKnowledgeStorageQuotaExceededError(
        released.state.knowledgeStorageBytesUsed,
        released.state.knowledgeStorageBytesLimit
      );
    }

    let source: PrismaAssistantKnowledgeSource | null = null;
    try {
      source = await this.prisma.assistantKnowledgeSource.create({
        data: {
          assistantId: assistant.id,
          userId: assistant.userId,
          workspaceId: assistant.workspaceId,
          namespace: "assistant_user_workspace",
          sourceKind: "uploaded_file",
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
        workspaceId: assistant.workspaceId,
        assistantId: assistant.id,
        requestedByUserId: assistant.userId,
        sourceType: "assistant_knowledge_source",
        sourceId: source.id,
        sourceVersion: 1,
        processorMode: "auto"
      });
    } catch (error) {
      if (source !== null) {
        await this.prisma.assistantKnowledgeSource
          .delete({ where: { id: source.id } })
          .catch(() => undefined);
      }
      await this.knowledgeObjectStorage.deleteObject(stored.objectKey);
      await this.trackWorkspaceQuotaUsageService.releaseKnowledgeStorage({
        assistant,
        sizeBytes: applied.appliedDelta,
        source: "assistant_knowledge_source_upload_rollback"
      });
      throw error;
    }

    return this.toState(source);
  }

  async list(userId: string): Promise<{
    quota: AssistantKnowledgeQuotaState;
    sources: AssistantKnowledgeSourceState[];
  }> {
    const assistant = await this.resolveAssistant(userId);
    const quota = await this.trackWorkspaceQuotaUsageService.checkKnowledgeStorageQuota(assistant);
    const rows = await this.prisma.assistantKnowledgeSource.findMany({
      where: { assistantId: assistant.id },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }]
    });

    return {
      quota: {
        usedBytes: Number(quota.usedBytes),
        limitBytes: quota.limitBytes === null ? null : Number(quota.limitBytes)
      },
      sources: rows.map((row) => this.toState(row))
    };
  }

  async get(userId: string, sourceId: string): Promise<AssistantKnowledgeSourceState> {
    const assistant = await this.resolveAssistant(userId);
    const row = await this.prisma.assistantKnowledgeSource.findFirst({
      where: { id: sourceId, assistantId: assistant.id }
    });
    if (row === null) {
      throw new NotFoundException("Knowledge source not found.");
    }
    return this.toState(row);
  }

  async inspect(userId: string, sourceId: string): Promise<AssistantKnowledgeSourceInspectState> {
    const assistant = await this.resolveAssistant(userId);
    const row = await this.prisma.assistantKnowledgeSource.findFirst({
      where: { id: sourceId, assistantId: assistant.id }
    });
    if (row === null) {
      throw new NotFoundException("Knowledge source not found.");
    }
    const chunks = await this.prisma.assistantKnowledgeSourceChunk.findMany({
      where: {
        knowledgeSourceId: row.id,
        sourceVersion: row.currentVersion
      },
      select: {
        chunkIndex: true,
        content: true
      },
      orderBy: [{ chunkIndex: "asc" }],
      take: 20
    });
    const processingQuality =
      row.processingQuality !== null &&
      typeof row.processingQuality === "object" &&
      !Array.isArray(row.processingQuality)
        ? (row.processingQuality as Record<string, unknown>)
        : null;
    const textChars =
      typeof processingQuality?.textChars === "number" ? processingQuality.textChars : 0;
    const firstChunkPreview =
      chunks[0]?.content.trim().slice(0, 200) && chunks[0]?.content.trim().length > 0
        ? chunks[0]!.content.trim().slice(0, 200)
        : null;
    return {
      sourceId: row.id,
      originalFilename: row.originalFilename,
      sizeBytes: Number(row.sizeBytes),
      chunkCount: row.chunkCount,
      textChars,
      firstChunkPreview,
      processorProviderKey: row.processorProviderKey,
      processorMode: row.processorMode,
      processingQuality,
      chunks: chunks.map((chunk) => ({
        chunkIndex: chunk.chunkIndex,
        contentPreview: chunk.content.trim().slice(0, 200),
        looksLikeTocHeadingOnly: this.looksLikeTocHeadingOnly(chunk.content)
      }))
    };
  }

  async delete(userId: string, sourceId: string): Promise<void> {
    const assistant = await this.resolveAssistant(userId);
    const source = await this.prisma.assistantKnowledgeSource.findFirst({
      where: { id: sourceId, assistantId: assistant.id }
    });
    if (source === null) {
      throw new NotFoundException("Knowledge source not found.");
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.knowledgeVectorChunk.deleteMany({
        where: { sourceType: "assistant_knowledge_source", sourceId: source.id }
      });
      await tx.knowledgeIndexingJob.deleteMany({
        where: { sourceType: "assistant_knowledge_source", sourceId: source.id }
      });
      await tx.assistantKnowledgeSource.delete({
        where: { id: source.id }
      });
    });
    await this.knowledgeObjectStorage.deleteObject(source.storagePath);
    await this.trackWorkspaceQuotaUsageService.releaseKnowledgeStorage({
      assistant,
      sizeBytes: source.sizeBytes,
      source: "assistant_knowledge_source_delete",
      metadata: {
        sourceId: source.id
      }
    });
  }

  async reindex(userId: string, sourceId: string): Promise<AssistantKnowledgeSourceState> {
    const assistant = await this.resolveAssistant(userId);
    const source = await this.prisma.assistantKnowledgeSource.findFirst({
      where: { id: sourceId, assistantId: assistant.id }
    });
    if (source === null) {
      throw new NotFoundException("Knowledge source not found.");
    }

    const nextVersion = source.currentVersion + 1;
    const updated = await this.prisma.assistantKnowledgeSource.update({
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
      workspaceId: source.workspaceId,
      assistantId: assistant.id,
      requestedByUserId: assistant.userId,
      sourceType: "assistant_knowledge_source",
      sourceId: source.id,
      sourceVersion: nextVersion,
      processorMode: "auto"
    });
    return this.toState(updated);
  }

  private async resolveAssistant(userId: string) {
    const assistant = await this.assistantRepository.findByUserId(userId);
    if (assistant === null) {
      throw new NotFoundException("Assistant does not exist for this user.");
    }
    return assistant;
  }

  private toState(row: PrismaAssistantKnowledgeSource): AssistantKnowledgeSourceState {
    const processingQuality =
      row.processingQuality !== null &&
      typeof row.processingQuality === "object" &&
      !Array.isArray(row.processingQuality)
        ? (row.processingQuality as Record<string, unknown>)
        : null;
    return {
      id: row.id,
      namespace: row.namespace,
      sourceKind: row.sourceKind,
      displayName: row.displayName,
      originalFilename: row.originalFilename,
      mimeType: row.mimeType,
      sizeBytes: Number(row.sizeBytes),
      status: row.status,
      currentVersion: row.currentVersion,
      chunkCount: row.chunkCount,
      processorProviderKey: row.processorProviderKey,
      processorMode: row.processorMode,
      processingQuality,
      lastIndexedAt: row.lastIndexedAt?.toISOString() ?? null,
      lastReindexRequestedAt: row.lastReindexRequestedAt?.toISOString() ?? null,
      lastErrorCode: row.lastErrorCode,
      lastErrorMessage: row.lastErrorMessage,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString()
    };
  }

  private looksLikeTocHeadingOnly(content: string): boolean {
    const normalized = content.replace(/\s+/g, " ").trim();
    if (normalized.length === 0 || normalized.length >= 250) {
      return false;
    }
    return (
      /(^|\s)\d+(?:\.\d+)+(?:\.|\s)/u.test(normalized) ||
      /\b\.{3,}\s*\d+\s*$/u.test(normalized) ||
      /^\d+(?:\.\d+)+\s+/u.test(normalized)
    );
  }

  private isKnowledgeDocumentMime(mimeType: string): boolean {
    return mimeType.startsWith("text/") || KNOWLEDGE_DOCUMENT_MIMES.has(mimeType);
  }
}
