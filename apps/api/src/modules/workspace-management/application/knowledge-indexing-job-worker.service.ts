import { randomUUID } from "node:crypto";
import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import {
  KnowledgeIndexingError,
  KnowledgeIndexingService,
  type IndexedKnowledgeChunkDraft
} from "./knowledge-indexing.service";
import { KnowledgeModelPolicyService } from "./knowledge-model-policy.service";
import { PersaiKnowledgeObjectStorageService } from "./persai-knowledge-object-storage.service";
import {
  KNOWLEDGE_VECTOR_INDEX,
  type KnowledgeVectorIndex,
  type KnowledgeVectorIndexChunk
} from "./knowledge-vector-index";
import type {
  KnowledgeDocumentProcessorMode,
  KnowledgeDocumentContent,
  KnowledgeExtractionQuality,
  KnowledgeProcessingProviderTrace,
  KnowledgeSourceType,
  NormalizedKnowledgeSource
} from "./knowledge-processing.types";
import { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";

const INDEXING_JOB_POLL_INTERVAL_MS = 10_000;
const INDEXING_JOB_BATCH_SIZE = 4;
const INDEXING_JOB_CLAIM_TTL_MS = 30 * 60 * 1000;
const INDEXING_JOB_RETRY_BASE_DELAY_MS = 30_000;
const INDEXING_JOB_RETRY_MAX_DELAY_MS = 30 * 60 * 1000;
const LAST_ERROR_MAX_CHARS = 1_000;

type ClaimedKnowledgeIndexingJob = {
  id: string;
  workspaceId: string | null;
  assistantId: string | null;
  skillId: string | null;
  requestedByUserId: string | null;
  sourceType: KnowledgeSourceType;
  sourceId: string;
  sourceVersion: number;
  processorMode: KnowledgeDocumentProcessorMode;
  attemptCount: number;
  maxAttempts: number;
  claimToken: string;
  claimEpoch: number;
};

type SourceLoadResult = {
  normalizedSource: NormalizedKnowledgeSource;
  content:
    | {
        kind: "bytes";
        buffer: Buffer;
        mimeType: string;
        originalFilename: string;
        sizeBytes: number;
      }
    | KnowledgeDocumentContent;
  embeddingModelKey: string | null;
};

type SourcePersistInput = {
  job: ClaimedKnowledgeIndexingJob;
  chunks: IndexedKnowledgeChunkDraft[];
  provider: KnowledgeProcessingProviderTrace | null;
  quality: KnowledgeExtractionQuality | null;
};

class KnowledgeIndexingJobExecutionError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly retryable: boolean,
    public readonly provider: KnowledgeProcessingProviderTrace | null = null,
    public readonly quality: KnowledgeExtractionQuality | null = null
  ) {
    super(message);
  }
}

@Injectable()
export class KnowledgeIndexingJobWorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(KnowledgeIndexingJobWorkerService.name);
  private stopped = false;
  private running = false;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly prisma: WorkspaceManagementPrismaService,
    private readonly knowledgeObjectStorage: PersaiKnowledgeObjectStorageService,
    private readonly knowledgeIndexingService: KnowledgeIndexingService,
    private readonly knowledgeModelPolicyService: KnowledgeModelPolicyService,
    @Inject(KNOWLEDGE_VECTOR_INDEX)
    private readonly knowledgeVectorIndex: KnowledgeVectorIndex
  ) {}

  onModuleInit(): void {
    this.scheduleNext(INDEXING_JOB_POLL_INTERVAL_MS);
  }

  onModuleDestroy(): void {
    this.stopped = true;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  async enqueueSourceJob(input: {
    workspaceId?: string | null;
    sourceType: KnowledgeSourceType;
    sourceId: string;
    sourceVersion: number;
    assistantId?: string | null;
    skillId?: string | null;
    requestedByUserId?: string | null;
    processorMode?: KnowledgeDocumentProcessorMode;
    priority?: number;
  }) {
    return this.prisma.knowledgeIndexingJob.create({
      data: {
        workspaceId: input.workspaceId ?? null,
        assistantId: input.assistantId ?? null,
        skillId: input.skillId ?? null,
        requestedByUserId: input.requestedByUserId ?? null,
        sourceType: input.sourceType,
        sourceId: input.sourceId,
        sourceVersion: input.sourceVersion,
        status: "pending",
        processorMode: input.processorMode ?? "auto",
        priority: input.priority ?? 100,
        pendingDedupeKey: `${input.sourceType}:${input.sourceId}:${String(input.sourceVersion)}`
      }
    });
  }

  async processDueIndexingJobsBatch(limit = INDEXING_JOB_BATCH_SIZE): Promise<number> {
    const claimed = await this.claimDueJobs(limit);
    for (const job of claimed) {
      await this.processClaimedJob(job);
    }
    return claimed.length;
  }

  private scheduleNext(delayMs: number): void {
    if (this.stopped) {
      return;
    }
    this.timer = setTimeout(() => {
      void this.tick();
    }, delayMs);
    this.timer.unref?.();
  }

  private async tick(): Promise<void> {
    if (this.running || this.stopped) {
      this.scheduleNext(INDEXING_JOB_POLL_INTERVAL_MS);
      return;
    }
    this.running = true;
    try {
      await this.processDueIndexingJobsBatch();
    } catch (error) {
      this.logger.error(`Knowledge indexing job worker tick failed: ${toSafeErrorMessage(error)}`);
    } finally {
      this.running = false;
      this.scheduleNext(INDEXING_JOB_POLL_INTERVAL_MS);
    }
  }

  private async claimDueJobs(limit: number): Promise<ClaimedKnowledgeIndexingJob[]> {
    const now = new Date();
    const claimExpiresAt = new Date(now.getTime() + INDEXING_JOB_CLAIM_TTL_MS);
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<
        Array<{
          id: string;
          workspaceId: string | null;
          assistantId: string | null;
          skillId: string | null;
          requestedByUserId: string | null;
          sourceType: KnowledgeSourceType;
          sourceId: string;
          sourceVersion: number;
          processorMode: KnowledgeDocumentProcessorMode;
          attemptCount: number;
          maxAttempts: number;
          claimEpoch: number | null;
        }>
      >(Prisma.sql`
        SELECT
          "id",
          "workspace_id" AS "workspaceId",
          "assistant_id" AS "assistantId",
          "skill_id" AS "skillId",
          "requested_by_user_id" AS "requestedByUserId",
          "source_type"::text AS "sourceType",
          "source_id" AS "sourceId",
          "source_version" AS "sourceVersion",
          "processor_mode"::text AS "processorMode",
          "attempt_count" AS "attemptCount",
          "max_attempts" AS "maxAttempts",
          "scheduler_claim_epoch" AS "claimEpoch"
        FROM "knowledge_indexing_jobs"
        WHERE (
            "status" = 'pending'
            AND ("retry_after_at" IS NULL OR "retry_after_at" <= NOW())
          )
          OR (
            "status" = 'in_progress'
            AND "scheduler_claim_expires_at" IS NOT NULL
            AND "scheduler_claim_expires_at" <= NOW()
          )
        ORDER BY "priority" ASC, "created_at" ASC
        FOR UPDATE SKIP LOCKED
        LIMIT ${Math.max(1, Math.floor(limit))}
      `);

      const claimed: ClaimedKnowledgeIndexingJob[] = [];
      for (const row of rows) {
        const claimToken = randomUUID();
        const claimEpoch = (row.claimEpoch ?? 0) + 1;
        const attemptCount = row.attemptCount + 1;
        await tx.knowledgeIndexingJob.update({
          where: { id: row.id },
          data: {
            status: "in_progress",
            schedulerClaimToken: claimToken,
            schedulerClaimEpoch: claimEpoch,
            schedulerClaimedAt: now,
            schedulerClaimExpiresAt: claimExpiresAt,
            attemptCount,
            startedAt: now,
            completedAt: null,
            lastErrorCode: null,
            lastErrorMessage: null
          }
        });
        claimed.push({
          id: row.id,
          workspaceId: row.workspaceId,
          assistantId: row.assistantId,
          skillId: row.skillId,
          requestedByUserId: row.requestedByUserId,
          sourceType: row.sourceType,
          sourceId: row.sourceId,
          sourceVersion: row.sourceVersion,
          processorMode: row.processorMode,
          attemptCount,
          maxAttempts: row.maxAttempts,
          claimToken,
          claimEpoch
        });
      }
      return claimed;
    });
  }

  private async processClaimedJob(job: ClaimedKnowledgeIndexingJob): Promise<void> {
    try {
      const source = await this.loadSource(job);
      const chunks = await this.knowledgeIndexingService.buildIndexedChunksForSource({
        source: source.normalizedSource,
        content: source.content,
        processorMode: job.processorMode,
        embeddingModelKey: source.embeddingModelKey
      });
      const provider = chunks[0]?.provider ?? null;
      const quality = chunks[0]?.quality ?? null;
      if (quality?.status === "needs_review") {
        await this.markSourceNeedsReview(job, provider, quality);
        return;
      }
      await this.persistSuccessfulSourceChunks({ job, chunks, provider, quality });
      await this.completeJob(job, {
        status: "completed",
        provider,
        quality,
        chunkCount: chunks.length,
        embeddingChunkCount: chunks.filter((chunk) => chunk.embeddingVector !== null).length
      });
    } catch (error) {
      await this.handleJobFailure(job, error);
    }
  }

  private async loadSource(job: ClaimedKnowledgeIndexingJob): Promise<SourceLoadResult> {
    if (job.sourceType === "assistant_knowledge_source") {
      const source = await this.prisma.assistantKnowledgeSource.findUnique({
        where: { id: job.sourceId }
      });
      if (source === null) {
        throw new KnowledgeIndexingJobExecutionError(
          "source_not_found",
          "The assistant knowledge source no longer exists.",
          false
        );
      }
      if (source.currentVersion !== job.sourceVersion) {
        throw new KnowledgeIndexingJobExecutionError(
          "source_version_superseded",
          "The indexing job was superseded by a newer source version.",
          false
        );
      }
      const downloaded = await this.downloadSourceObject(source.storagePath);
      const embeddingModelKey =
        await this.knowledgeModelPolicyService.resolveAssistantEmbeddingModelKey(
          source.assistantId
        );
      return {
        normalizedSource: {
          sourceType: job.sourceType,
          sourceId: source.id,
          sourceVersion: job.sourceVersion,
          workspaceId: null,
          assistantId: source.assistantId,
          skillId: null,
          provenance: {
            originKind: "uploaded_file",
            originalFilename: source.originalFilename,
            mimeType: source.mimeType,
            storagePath: source.storagePath,
            createdByUserId: source.userId
          },
          metadata: null
        },
        content: {
          kind: "bytes",
          buffer: downloaded.buffer,
          mimeType: source.mimeType,
          originalFilename: source.originalFilename,
          sizeBytes: Number(source.sizeBytes)
        },
        embeddingModelKey
      };
    }

    if (job.sourceType === "global_knowledge_source") {
      const source = await this.prisma.globalKnowledgeSource.findUnique({
        where: { id: job.sourceId }
      });
      if (source === null) {
        throw new KnowledgeIndexingJobExecutionError(
          "source_not_found",
          "The global knowledge source no longer exists.",
          false
        );
      }
      if (source.currentVersion !== job.sourceVersion) {
        throw new KnowledgeIndexingJobExecutionError(
          "source_version_superseded",
          "The indexing job was superseded by a newer source version.",
          false
        );
      }
      const downloaded = await this.downloadSourceObject(source.storagePath);
      const embeddingModelKey =
        await this.knowledgeModelPolicyService.resolveAdminKnowledgeEmbeddingModelKey();
      return {
        normalizedSource: {
          sourceType: job.sourceType,
          sourceId: source.id,
          sourceVersion: job.sourceVersion,
          workspaceId: null,
          assistantId: null,
          skillId: null,
          provenance: {
            originKind: "admin_product_document",
            originalFilename: source.originalFilename,
            mimeType: source.mimeType,
            storagePath: source.storagePath,
            createdByUserId: source.createdByUserId,
            metadata: {
              scope: source.scope
            }
          },
          metadata: {
            scope: source.scope
          }
        },
        content: {
          kind: "bytes",
          buffer: downloaded.buffer,
          mimeType: source.mimeType,
          originalFilename: source.originalFilename,
          sizeBytes: Number(source.sizeBytes)
        },
        embeddingModelKey
      };
    }

    if (job.sourceType === "product_knowledge_text_entry") {
      const source = await this.prisma.productKnowledgeTextEntry.findUnique({
        where: { id: job.sourceId }
      });
      if (source === null) {
        throw new KnowledgeIndexingJobExecutionError(
          "source_not_found",
          "The Product KB text entry no longer exists.",
          false
        );
      }
      if (source.currentVersion !== job.sourceVersion) {
        throw new KnowledgeIndexingJobExecutionError(
          "source_version_superseded",
          "The indexing job was superseded by a newer source version.",
          false
        );
      }
      if (source.lifecycleStatus !== "active") {
        throw new KnowledgeIndexingJobExecutionError(
          "source_not_active",
          "Only active Product KB text entries are indexed.",
          false
        );
      }
      const embeddingModelKey =
        await this.knowledgeModelPolicyService.resolveAdminKnowledgeEmbeddingModelKey();
      return {
        normalizedSource: {
          sourceType: job.sourceType,
          sourceId: source.id,
          sourceVersion: job.sourceVersion,
          workspaceId: null,
          assistantId: null,
          skillId: null,
          provenance: {
            originKind: "manual_entry",
            title: source.title,
            createdByUserId: source.createdByUserId,
            metadata: {
              category: source.category,
              locale: source.locale,
              tags: source.tags,
              provenanceKind: source.provenanceKind,
              provenanceMetadata: source.provenanceMetadata
            }
          },
          metadata: {
            title: source.title,
            category: source.category,
            locale: source.locale,
            tags: source.tags,
            lifecycleStatus: source.lifecycleStatus,
            provenanceKind: source.provenanceKind
          }
        },
        content: {
          kind: "text",
          text: source.body,
          mimeType: "text/markdown",
          title: source.title,
          sizeBytes: Buffer.byteLength(source.body, "utf8")
        },
        embeddingModelKey
      };
    }

    if (job.sourceType === "skill_knowledge_card") {
      const source = await this.prisma.skillKnowledgeCard.findUnique({
        where: { id: job.sourceId }
      });
      if (source === null) {
        throw new KnowledgeIndexingJobExecutionError(
          "source_not_found",
          "The Skill knowledge card no longer exists.",
          false
        );
      }
      if (source.currentVersion !== job.sourceVersion) {
        throw new KnowledgeIndexingJobExecutionError(
          "source_version_superseded",
          "The indexing job was superseded by a newer source version.",
          false
        );
      }
      if (source.lifecycleStatus !== "active") {
        throw new KnowledgeIndexingJobExecutionError(
          "source_not_active",
          "Only active Skill knowledge cards are indexed.",
          false
        );
      }
      const embeddingModelKey =
        await this.knowledgeModelPolicyService.resolveAdminKnowledgeEmbeddingModelKey();
      return {
        normalizedSource: {
          sourceType: job.sourceType,
          sourceId: source.id,
          sourceVersion: job.sourceVersion,
          workspaceId: null,
          assistantId: null,
          skillId: source.skillId,
          provenance: {
            originKind: "manual_entry",
            title: source.title,
            createdByUserId: source.createdByUserId,
            metadata: {
              locale: source.locale,
              tags: source.tags,
              provenanceKind: source.provenanceKind,
              provenanceMetadata: source.provenanceMetadata
            }
          },
          metadata: {
            title: source.title,
            locale: source.locale,
            tags: source.tags,
            lifecycleStatus: source.lifecycleStatus,
            provenanceKind: source.provenanceKind
          }
        },
        content: {
          kind: "text",
          text: source.body,
          mimeType: "text/markdown",
          title: source.title,
          sizeBytes: Buffer.byteLength(source.body, "utf8")
        },
        embeddingModelKey
      };
    }

    const source = await this.prisma.skillDocument.findUnique({
      where: { id: job.sourceId }
    });
    if (source === null) {
      throw new KnowledgeIndexingJobExecutionError(
        "source_not_found",
        "The Skill document no longer exists.",
        false
      );
    }
    if (source.currentVersion !== job.sourceVersion) {
      throw new KnowledgeIndexingJobExecutionError(
        "source_version_superseded",
        "The indexing job was superseded by a newer source version.",
        false
      );
    }
    const downloaded = await this.downloadSourceObject(source.storagePath);
    const embeddingModelKey =
      await this.knowledgeModelPolicyService.resolveAdminKnowledgeEmbeddingModelKey();
    return {
      normalizedSource: {
        sourceType: job.sourceType,
        sourceId: source.id,
        sourceVersion: job.sourceVersion,
        workspaceId: null,
        assistantId: null,
        skillId: source.skillId,
        provenance: {
          originKind: "skill_document",
          title: source.displayName,
          originalFilename: source.originalFilename,
          mimeType: source.mimeType,
          storagePath: source.storagePath,
          createdByUserId: source.createdByUserId
        },
        metadata: {
          displayName: source.displayName,
          description: source.description
        }
      },
      content: {
        kind: "bytes",
        buffer: downloaded.buffer,
        mimeType: source.mimeType,
        originalFilename: source.originalFilename,
        sizeBytes: Number(source.sizeBytes)
      },
      embeddingModelKey
    };
  }

  private async downloadSourceObject(storagePath: string) {
    const downloaded = await this.knowledgeObjectStorage.downloadObject(storagePath);
    if (downloaded === null) {
      throw new KnowledgeIndexingJobExecutionError(
        "stored_file_missing",
        "The stored knowledge source file could not be found.",
        false
      );
    }
    return downloaded;
  }

  private async persistSuccessfulSourceChunks(input: SourcePersistInput): Promise<void> {
    await this.persistLegacyChunkRows(input);
    const vectorChunks = this.toVectorChunks(input.job, input.chunks);
    if (vectorChunks.length > 0) {
      await this.knowledgeVectorIndex.replaceSourceChunks({
        sourceType: input.job.sourceType,
        sourceId: input.job.sourceId,
        sourceVersion: input.job.sourceVersion,
        chunks: vectorChunks
      });
      return;
    }
    await this.knowledgeVectorIndex.deleteSource({
      sourceType: input.job.sourceType,
      sourceId: input.job.sourceId
    });
  }

  private async persistLegacyChunkRows(input: SourcePersistInput): Promise<void> {
    const now = new Date();
    const qualityJson = toNullableJson(input.quality);
    if (input.job.sourceType === "assistant_knowledge_source") {
      const source = await this.prisma.assistantKnowledgeSource.findUniqueOrThrow({
        where: { id: input.job.sourceId },
        select: { assistantId: true, workspaceId: true }
      });
      await this.prisma.$transaction(async (tx) => {
        await tx.assistantKnowledgeSourceChunk.deleteMany({
          where: { knowledgeSourceId: input.job.sourceId }
        });
        await tx.assistantKnowledgeSourceChunk.createMany({
          data: input.chunks.map((chunk) => ({
            knowledgeSourceId: input.job.sourceId,
            assistantId: source.assistantId,
            workspaceId: source.workspaceId,
            sourceVersion: input.job.sourceVersion,
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
        await tx.assistantKnowledgeSource.update({
          where: { id: input.job.sourceId },
          data: {
            status: "ready",
            currentVersion: input.job.sourceVersion,
            chunkCount: input.chunks.length,
            processorProviderKey: input.provider?.providerKey ?? null,
            processorMode: input.provider?.processorMode ?? input.job.processorMode,
            processingQuality: qualityJson,
            lastIndexedAt: now,
            lastErrorCode: null,
            lastErrorMessage: null
          }
        });
      });
      return;
    }

    if (input.job.sourceType === "global_knowledge_source") {
      const source = await this.prisma.globalKnowledgeSource.findUniqueOrThrow({
        where: { id: input.job.sourceId },
        select: { scope: true }
      });
      await this.prisma.$transaction(async (tx) => {
        await tx.globalKnowledgeSourceChunk.deleteMany({
          where: { globalKnowledgeSourceId: input.job.sourceId }
        });
        await tx.globalKnowledgeSourceChunk.createMany({
          data: input.chunks.map((chunk) => ({
            globalKnowledgeSourceId: input.job.sourceId,
            scope: source.scope,
            sourceVersion: input.job.sourceVersion,
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
          where: { id: input.job.sourceId },
          data: {
            status: "ready",
            currentVersion: input.job.sourceVersion,
            chunkCount: input.chunks.length,
            processorProviderKey: input.provider?.providerKey ?? null,
            processorMode: input.provider?.processorMode ?? input.job.processorMode,
            processingQuality: qualityJson,
            lastIndexedAt: now,
            lastErrorCode: null,
            lastErrorMessage: null
          }
        });
      });
      return;
    }

    if (input.job.sourceType === "product_knowledge_text_entry") {
      await this.prisma.productKnowledgeTextEntry.findUniqueOrThrow({
        where: { id: input.job.sourceId },
        select: { id: true }
      });
      await this.prisma.$transaction(async (tx) => {
        await tx.productKnowledgeTextEntryChunk.deleteMany({
          where: { textEntryId: input.job.sourceId }
        });
        await tx.productKnowledgeTextEntryChunk.createMany({
          data: input.chunks.map((chunk) => ({
            textEntryId: input.job.sourceId,
            sourceVersion: input.job.sourceVersion,
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
        await tx.productKnowledgeTextEntry.update({
          where: { id: input.job.sourceId },
          data: {
            status: "ready",
            currentVersion: input.job.sourceVersion,
            chunkCount: input.chunks.length,
            processorProviderKey: input.provider?.providerKey ?? null,
            processorMode: input.provider?.processorMode ?? input.job.processorMode,
            processingQuality: qualityJson,
            lastIndexedAt: now,
            lastErrorCode: null,
            lastErrorMessage: null
          }
        });
      });
      return;
    }

    if (input.job.sourceType === "skill_knowledge_card") {
      const source = await this.prisma.skillKnowledgeCard.findUniqueOrThrow({
        where: { id: input.job.sourceId },
        select: { skillId: true }
      });
      await this.prisma.$transaction(async (tx) => {
        await tx.skillKnowledgeCardChunk.deleteMany({
          where: { skillKnowledgeCardId: input.job.sourceId }
        });
        await tx.skillKnowledgeCardChunk.createMany({
          data: input.chunks.map((chunk) => ({
            skillKnowledgeCardId: input.job.sourceId,
            skillId: source.skillId,
            sourceVersion: input.job.sourceVersion,
            chunkIndex: chunk.chunkIndex,
            locator: chunk.locator,
            content: chunk.content,
            embeddingModelKey: chunk.embeddingModelKey,
            embeddingGeneratedAt: chunk.embeddingGeneratedAt
          }))
        });
        await tx.skillKnowledgeCard.update({
          where: { id: input.job.sourceId },
          data: {
            status: "ready",
            currentVersion: input.job.sourceVersion,
            chunkCount: input.chunks.length,
            processorProviderKey: input.provider?.providerKey ?? null,
            processorMode: input.provider?.processorMode ?? input.job.processorMode,
            processingQuality: qualityJson,
            lastIndexedAt: now,
            lastErrorCode: null,
            lastErrorMessage: null
          }
        });
      });
      return;
    }

    const source = await this.prisma.skillDocument.findUniqueOrThrow({
      where: { id: input.job.sourceId },
      select: { skillId: true }
    });
    await this.prisma.$transaction(async (tx) => {
      await tx.skillDocumentChunk.deleteMany({
        where: { skillDocumentId: input.job.sourceId }
      });
      await tx.skillDocumentChunk.createMany({
        data: input.chunks.map((chunk) => ({
          skillDocumentId: input.job.sourceId,
          skillId: source.skillId,
          sourceVersion: input.job.sourceVersion,
          chunkIndex: chunk.chunkIndex,
          locator: chunk.locator,
          content: chunk.content,
          embeddingModelKey: chunk.embeddingModelKey,
          embeddingGeneratedAt: chunk.embeddingGeneratedAt
        }))
      });
      await tx.skillDocument.update({
        where: { id: input.job.sourceId },
        data: {
          status: "ready",
          currentVersion: input.job.sourceVersion,
          chunkCount: input.chunks.length,
          processorProviderKey: input.provider?.providerKey ?? null,
          processorMode: input.provider?.processorMode ?? input.job.processorMode,
          processingQuality: qualityJson,
          lastIndexedAt: now,
          lastErrorCode: null,
          lastErrorMessage: null
        }
      });
    });
  }

  private toVectorChunks(
    job: ClaimedKnowledgeIndexingJob,
    chunks: IndexedKnowledgeChunkDraft[]
  ): KnowledgeVectorIndexChunk[] {
    return chunks.flatMap((chunk): KnowledgeVectorIndexChunk[] => {
      if (chunk.embeddingModelKey === null || chunk.embeddingVector === null) {
        return [];
      }
      return [
        {
          sourceType: job.sourceType,
          sourceId: job.sourceId,
          sourceVersion: job.sourceVersion,
          workspaceId: job.workspaceId,
          assistantId: job.assistantId,
          skillId: job.skillId,
          chunkIndex: chunk.chunkIndex,
          locator: chunk.locator,
          content: chunk.content,
          metadata: chunk.metadata,
          provenance: null,
          provider: chunk.provider,
          quality: chunk.quality,
          embeddingModelKey: chunk.embeddingModelKey,
          embeddingVector: chunk.embeddingVector
        }
      ];
    });
  }

  private async markSourceNeedsReview(
    job: ClaimedKnowledgeIndexingJob,
    provider: KnowledgeProcessingProviderTrace | null,
    quality: KnowledgeExtractionQuality
  ): Promise<void> {
    await this.clearSourceChunks(job);
    const message = "The knowledge source extraction quality needs admin review before indexing.";
    await this.updateSourceTerminalState(job, {
      status: "needs_review",
      provider,
      quality,
      errorCode: "extraction_needs_review",
      errorMessage: message
    });
    await this.completeJob(job, {
      status: "needs_review",
      provider,
      quality,
      chunkCount: 0,
      embeddingChunkCount: 0,
      errorCode: "extraction_needs_review",
      errorMessage: message
    });
  }

  private async clearSourceChunks(job: ClaimedKnowledgeIndexingJob): Promise<void> {
    await this.knowledgeVectorIndex.deleteSource({
      sourceType: job.sourceType,
      sourceId: job.sourceId
    });
    if (job.sourceType === "assistant_knowledge_source") {
      await this.prisma.assistantKnowledgeSourceChunk.deleteMany({
        where: { knowledgeSourceId: job.sourceId }
      });
      return;
    }
    if (job.sourceType === "global_knowledge_source") {
      await this.prisma.globalKnowledgeSourceChunk.deleteMany({
        where: { globalKnowledgeSourceId: job.sourceId }
      });
      return;
    }
    if (job.sourceType === "product_knowledge_text_entry") {
      await this.prisma.productKnowledgeTextEntryChunk.deleteMany({
        where: { textEntryId: job.sourceId }
      });
      return;
    }
    if (job.sourceType === "skill_knowledge_card") {
      await this.prisma.skillKnowledgeCardChunk.deleteMany({
        where: { skillKnowledgeCardId: job.sourceId }
      });
      return;
    }
    await this.prisma.skillDocumentChunk.deleteMany({
      where: { skillDocumentId: job.sourceId }
    });
  }

  private async updateSourceTerminalState(
    job: ClaimedKnowledgeIndexingJob,
    input: {
      status: "failed" | "needs_review";
      provider: KnowledgeProcessingProviderTrace | null;
      quality: KnowledgeExtractionQuality | null;
      errorCode: string;
      errorMessage: string;
    }
  ): Promise<void> {
    const data = {
      status: input.status,
      chunkCount: 0,
      processorProviderKey: input.provider?.providerKey ?? null,
      processorMode: input.provider?.processorMode ?? job.processorMode,
      processingQuality: toNullableJson(input.quality),
      lastErrorCode: input.errorCode.slice(0, 128),
      lastErrorMessage: truncateLastError(input.errorMessage)
    };
    if (job.sourceType === "assistant_knowledge_source") {
      await this.prisma.assistantKnowledgeSource.update({
        where: { id: job.sourceId },
        data
      });
      return;
    }
    if (job.sourceType === "global_knowledge_source") {
      await this.prisma.globalKnowledgeSource.update({
        where: { id: job.sourceId },
        data
      });
      return;
    }
    if (job.sourceType === "product_knowledge_text_entry") {
      await this.prisma.productKnowledgeTextEntry.update({
        where: { id: job.sourceId },
        data
      });
      return;
    }
    if (job.sourceType === "skill_knowledge_card") {
      await this.prisma.skillKnowledgeCard.update({
        where: { id: job.sourceId },
        data
      });
      return;
    }
    await this.prisma.skillDocument.update({
      where: { id: job.sourceId },
      data
    });
  }

  private async completeJob(
    job: ClaimedKnowledgeIndexingJob,
    input: {
      status: "completed" | "needs_review";
      provider: KnowledgeProcessingProviderTrace | null;
      quality: KnowledgeExtractionQuality | null;
      chunkCount: number;
      embeddingChunkCount: number;
      errorCode?: string;
      errorMessage?: string;
    }
  ): Promise<void> {
    await this.prisma.knowledgeIndexingJob.updateMany({
      where: {
        id: job.id,
        schedulerClaimToken: job.claimToken,
        schedulerClaimEpoch: job.claimEpoch
      },
      data: {
        status: input.status,
        selectedProviderKey: input.provider?.providerKey ?? null,
        extractionQuality: toNullableJson(input.quality),
        resultPayload: {
          chunkCount: input.chunkCount,
          embeddingChunkCount: input.embeddingChunkCount,
          provider: input.provider
        } as Prisma.InputJsonValue,
        lastErrorCode: input.errorCode?.slice(0, 128) ?? null,
        lastErrorMessage:
          input.errorMessage === undefined ? null : truncateLastError(input.errorMessage),
        completedAt: new Date(),
        retryAfterAt: null,
        schedulerClaimToken: null,
        schedulerClaimEpoch: null,
        schedulerClaimedAt: null,
        schedulerClaimExpiresAt: null
      }
    });
  }

  private async handleJobFailure(job: ClaimedKnowledgeIndexingJob, error: unknown): Promise<void> {
    const normalized = normalizeJobError(error);
    if (normalized.code === "source_version_superseded") {
      await this.cancelSupersededJob(job, normalized);
      return;
    }
    const exhausted = !normalized.retryable || job.attemptCount >= job.maxAttempts;
    if (exhausted) {
      await this.clearSourceChunks(job).catch(() => undefined);
      await this.updateSourceTerminalState(job, {
        status: "failed",
        provider: normalized.provider,
        quality: normalized.quality,
        errorCode: normalized.code,
        errorMessage: normalized.message
      }).catch(() => undefined);
      await this.prisma.knowledgeIndexingJob.updateMany({
        where: {
          id: job.id,
          schedulerClaimToken: job.claimToken,
          schedulerClaimEpoch: job.claimEpoch
        },
        data: {
          status: "failed",
          selectedProviderKey: normalized.provider?.providerKey ?? null,
          extractionQuality: toNullableJson(normalized.quality),
          resultPayload: {
            provider: normalized.provider
          } as Prisma.InputJsonValue,
          lastErrorCode: normalized.code.slice(0, 128),
          lastErrorMessage: truncateLastError(normalized.message),
          retryAfterAt: null,
          completedAt: new Date(),
          schedulerClaimToken: null,
          schedulerClaimEpoch: null,
          schedulerClaimedAt: null,
          schedulerClaimExpiresAt: null
        }
      });
      this.logger.error(
        `Knowledge indexing job ${job.id} failed after ${job.attemptCount} attempt(s): ${normalized.message}`
      );
      return;
    }

    const retryAfterAt = new Date(Date.now() + computeRetryBackoffMs(job.attemptCount));
    await this.prisma.knowledgeIndexingJob.updateMany({
      where: {
        id: job.id,
        schedulerClaimToken: job.claimToken,
        schedulerClaimEpoch: job.claimEpoch
      },
      data: {
        status: "pending",
        retryAfterAt,
        lastErrorCode: normalized.code.slice(0, 128),
        lastErrorMessage: truncateLastError(normalized.message),
        schedulerClaimToken: null,
        schedulerClaimEpoch: null,
        schedulerClaimedAt: null,
        schedulerClaimExpiresAt: null
      }
    });
    this.logger.warn(
      `Knowledge indexing job ${job.id} deferred for retry (attempt ${job.attemptCount}, code=${normalized.code}): ${normalized.message}`
    );
  }

  private async cancelSupersededJob(
    job: ClaimedKnowledgeIndexingJob,
    error: KnowledgeIndexingJobExecutionError
  ): Promise<void> {
    await this.prisma.knowledgeIndexingJob.updateMany({
      where: {
        id: job.id,
        schedulerClaimToken: job.claimToken,
        schedulerClaimEpoch: job.claimEpoch
      },
      data: {
        status: "cancelled",
        resultPayload: {
          reason: error.code,
          message: error.message
        } as Prisma.InputJsonValue,
        lastErrorCode: error.code,
        lastErrorMessage: error.message,
        completedAt: new Date(),
        retryAfterAt: null,
        schedulerClaimToken: null,
        schedulerClaimEpoch: null,
        schedulerClaimedAt: null,
        schedulerClaimExpiresAt: null
      }
    });
  }
}

function normalizeJobError(error: unknown): KnowledgeIndexingJobExecutionError {
  if (error instanceof KnowledgeIndexingJobExecutionError) {
    return error;
  }
  if (error instanceof KnowledgeIndexingError) {
    return new KnowledgeIndexingJobExecutionError(
      error.code,
      error.message,
      false,
      error.provider,
      error.quality
    );
  }
  return new KnowledgeIndexingJobExecutionError("indexing_failed", toSafeErrorMessage(error), true);
}

function computeRetryBackoffMs(attempt: number): number {
  const safeAttempt = Math.max(1, Math.floor(attempt));
  return Math.min(
    INDEXING_JOB_RETRY_MAX_DELAY_MS,
    INDEXING_JOB_RETRY_BASE_DELAY_MS * 2 ** (safeAttempt - 1)
  );
}

function toNullableJson(value: unknown): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  if (value === null || value === undefined) {
    return Prisma.JsonNull;
  }
  return value as Prisma.InputJsonValue;
}

function truncateLastError(message: string): string {
  return message.length <= LAST_ERROR_MAX_CHARS
    ? message
    : `${message.slice(0, LAST_ERROR_MAX_CHARS - 1)}...`;
}

function toSafeErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message.trim().slice(0, LAST_ERROR_MAX_CHARS);
  }
  return "Knowledge indexing failed.";
}
