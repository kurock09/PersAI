import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { AssistantKnowledgeSource as PrismaAssistantKnowledgeSource } from "@prisma/client";
import { createKnowledgeStorageQuotaExceededError } from "./assistant-inbound-error";
import { chunkKnowledgeText, type KnowledgeChunkDraft } from "./assistant-knowledge-chunking";
import type {
  AssistantKnowledgeQuotaState,
  AssistantKnowledgeSourceState
} from "./assistant-knowledge-source.types";
import { PersaiKnowledgeObjectStorageService } from "./persai-knowledge-object-storage.service";
import { TrackWorkspaceQuotaUsageService } from "./track-workspace-quota-usage.service";
import { MediaPreprocessorService } from "./media/media-preprocessor.service";
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

class KnowledgeIndexingError extends Error {
  constructor(
    public readonly code: string,
    message: string
  ) {
    super(message);
  }
}

@Injectable()
export class ManageAssistantKnowledgeSourcesService {
  constructor(
    @Inject(ASSISTANT_REPOSITORY)
    private readonly assistantRepository: AssistantRepository,
    private readonly prisma: WorkspaceManagementPrismaService,
    private readonly mediaPreprocessorService: MediaPreprocessorService,
    private readonly knowledgeObjectStorage: PersaiKnowledgeObjectStorageService,
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

    let source: PrismaAssistantKnowledgeSource;
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
          status: "processing"
        }
      });
    } catch (error) {
      await this.knowledgeObjectStorage.deleteObject(stored.objectKey);
      await this.trackWorkspaceQuotaUsageService.releaseKnowledgeStorage({
        assistant,
        sizeBytes: applied.appliedDelta,
        source: "assistant_knowledge_source_upload_rollback"
      });
      throw error;
    }

    return this.indexExistingSource({
      sourceId: source.id,
      assistantId: assistant.id,
      buffer: params.file.buffer,
      mimeType: source.mimeType,
      originalFilename: source.originalFilename,
      nextVersion: 1
    });
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

  async delete(userId: string, sourceId: string): Promise<void> {
    const assistant = await this.resolveAssistant(userId);
    const source = await this.prisma.assistantKnowledgeSource.findFirst({
      where: { id: sourceId, assistantId: assistant.id }
    });
    if (source === null) {
      throw new NotFoundException("Knowledge source not found.");
    }

    await this.prisma.assistantKnowledgeSource.delete({
      where: { id: source.id }
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

    await this.prisma.assistantKnowledgeSource.update({
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
      assistantId: assistant.id,
      buffer: downloaded.buffer,
      mimeType: source.mimeType,
      originalFilename: source.originalFilename,
      nextVersion: source.currentVersion + 1
    });
  }

  private async resolveAssistant(userId: string) {
    const assistant = await this.assistantRepository.findByUserId(userId);
    if (assistant === null) {
      throw new NotFoundException("Assistant does not exist for this user.");
    }
    return assistant;
  }

  private async indexExistingSource(params: {
    sourceId: string;
    assistantId: string;
    buffer: Buffer;
    mimeType: string;
    originalFilename: string;
    nextVersion: number;
  }): Promise<AssistantKnowledgeSourceState> {
    try {
      const chunks = await this.extractChunks(
        params.buffer,
        params.mimeType,
        params.originalFilename
      );
      await this.persistIndexedChunks(params.sourceId, params.nextVersion, chunks);
      const row = await this.prisma.assistantKnowledgeSource.findUniqueOrThrow({
        where: { id: params.sourceId }
      });
      return this.toState(row);
    } catch (error) {
      return this.markFailedAndReturn(params.sourceId, error);
    }
  }

  private async extractChunks(
    buffer: Buffer,
    mimeType: string,
    originalFilename: string
  ): Promise<KnowledgeChunkDraft[]> {
    const preprocessed = await this.mediaPreprocessorService.process(
      buffer,
      mimeType,
      originalFilename
    );
    const extractedText = preprocessed.textExtract?.trim() ?? null;
    if (extractedText === null || extractedText.length === 0) {
      throw new KnowledgeIndexingError(
        "text_extract_unavailable",
        "No searchable text could be extracted from the uploaded file."
      );
    }

    const chunks = chunkKnowledgeText(extractedText);
    if (chunks.length === 0) {
      throw new KnowledgeIndexingError(
        "empty_text_extract",
        "The uploaded file did not produce any indexable text chunks."
      );
    }

    return chunks;
  }

  private async persistIndexedChunks(
    sourceId: string,
    sourceVersion: number,
    chunks: KnowledgeChunkDraft[]
  ): Promise<void> {
    const source = await this.prisma.assistantKnowledgeSource.findUniqueOrThrow({
      where: { id: sourceId },
      select: { assistantId: true, workspaceId: true }
    });

    await this.prisma.$transaction(async (tx) => {
      await tx.assistantKnowledgeSourceChunk.deleteMany({
        where: { knowledgeSourceId: sourceId }
      });
      await tx.assistantKnowledgeSourceChunk.createMany({
        data: chunks.map((chunk) => ({
          knowledgeSourceId: sourceId,
          assistantId: source.assistantId,
          workspaceId: source.workspaceId,
          sourceVersion,
          chunkIndex: chunk.chunkIndex,
          locator: chunk.locator,
          content: chunk.content
        }))
      });
      await tx.assistantKnowledgeSource.update({
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
  ): Promise<AssistantKnowledgeSourceState> {
    const normalized =
      error instanceof KnowledgeIndexingError
        ? error
        : new KnowledgeIndexingError("indexing_failed", this.toSafeErrorMessage(error));
    const row = await this.prisma.assistantKnowledgeSource.update({
      where: { id: sourceId },
      data: {
        status: "failed",
        lastErrorCode: normalized.code,
        lastErrorMessage: normalized.message
      }
    });
    return this.toState(row);
  }

  private toState(row: PrismaAssistantKnowledgeSource): AssistantKnowledgeSourceState {
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

  private toSafeErrorMessage(error: unknown): string {
    if (error instanceof Error && error.message.trim().length > 0) {
      return error.message.trim().slice(0, 500);
    }
    return "Knowledge indexing failed.";
  }
}
