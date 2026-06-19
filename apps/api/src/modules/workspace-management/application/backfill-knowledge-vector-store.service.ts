import { Inject, Injectable, Logger } from "@nestjs/common";
import {
  KNOWLEDGE_VECTOR_INDEX,
  type KnowledgeVectorIndex,
  type KnowledgeVectorIndexChunk
} from "./knowledge-vector-index";
import type { KnowledgeSourceType } from "./knowledge-processing.types";
import { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";

/**
 * ADR-120 Slice 3 — parity backfill for the unified `KnowledgeVectorChunk`
 * store.
 *
 * The indexing worker dual-persists every successfully indexed source into both
 * the legacy per-source `*_chunks` tables AND `KnowledgeVectorChunk`. That
 * dual-persist landed with ADR-079 (the same commit that introduced the vector
 * store). Legacy `assistant_knowledge_source_chunks` writes, however, predate
 * ADR-079, so an assistant source indexed before the dual-persist existed can
 * have legacy chunks with NO vector rows. Now that the document/product read
 * path selects vector candidates exclusively from `KnowledgeVectorChunk`, those
 * pre-dual-persist sources would silently lose ANN coverage.
 *
 * This one-shot backfill re-mirrors each ready persistent document/product
 * source's current-version chunks into `KnowledgeVectorChunk`, reusing the
 * embeddings already stored on the legacy chunk rows. It is idempotent:
 * `replaceSourceChunks` deletes and re-inserts a source's vector rows on each
 * call, so re-running converges to the same state without duplicating rows.
 *
 * Skills (`skill_document`, `skill_knowledge_card`) and product text entries
 * were introduced together with — or after — the vector store, so they have
 * always dual-persisted and are not part of this gap; this backfill covers the
 * document/product sources the read path now depends on.
 */
@Injectable()
export class BackfillKnowledgeVectorStoreService {
  private readonly logger = new Logger(BackfillKnowledgeVectorStoreService.name);

  constructor(
    private readonly prisma: WorkspaceManagementPrismaService,
    @Inject(KNOWLEDGE_VECTOR_INDEX)
    private readonly knowledgeVectorIndex: KnowledgeVectorIndex
  ) {}

  async execute(): Promise<BackfillKnowledgeVectorStoreSummary> {
    const summary: BackfillKnowledgeVectorStoreSummary = {
      mirroredSources: 0,
      mirroredChunks: 0,
      clearedSources: 0,
      skippedSourcesWithoutEmbeddings: 0
    };
    await this.backfillAssistantSources(summary);
    await this.backfillGlobalSources(summary);
    await this.backfillProductTextEntries(summary);
    this.logger.log(
      `ADR-120 vector-store backfill complete: mirrored ${String(summary.mirroredSources)} sources / ${String(summary.mirroredChunks)} chunks, cleared ${String(summary.clearedSources)} empty sources, skipped ${String(summary.skippedSourcesWithoutEmbeddings)} sources without embeddings.`
    );
    return summary;
  }

  private async backfillAssistantSources(
    summary: BackfillKnowledgeVectorStoreSummary
  ): Promise<void> {
    const sources = (await this.prisma.assistantKnowledgeSource.findMany({
      where: { status: "ready" },
      select: { id: true, assistantId: true, workspaceId: true, currentVersion: true }
    })) as Array<{
      id: string;
      assistantId: string;
      workspaceId: string;
      currentVersion: number;
    }>;
    for (const source of sources) {
      const rows = (await this.prisma.assistantKnowledgeSourceChunk.findMany({
        where: { knowledgeSourceId: source.id, sourceVersion: source.currentVersion },
        select: {
          chunkIndex: true,
          locator: true,
          content: true,
          embeddingModelKey: true,
          embeddingVector: true
        },
        orderBy: { chunkIndex: "asc" }
      })) as LegacyChunkRow[];
      await this.mirrorSource({
        summary,
        sourceType: "assistant_knowledge_source",
        sourceId: source.id,
        sourceVersion: source.currentVersion,
        workspaceId: source.workspaceId,
        assistantId: source.assistantId,
        skillId: null,
        rows
      });
    }
  }

  private async backfillGlobalSources(summary: BackfillKnowledgeVectorStoreSummary): Promise<void> {
    const sources = (await this.prisma.globalKnowledgeSource.findMany({
      where: { status: "ready" },
      select: { id: true, currentVersion: true }
    })) as Array<{ id: string; currentVersion: number }>;
    for (const source of sources) {
      const rows = (await this.prisma.globalKnowledgeSourceChunk.findMany({
        where: { globalKnowledgeSourceId: source.id, sourceVersion: source.currentVersion },
        select: {
          chunkIndex: true,
          locator: true,
          content: true,
          embeddingModelKey: true,
          embeddingVector: true
        },
        orderBy: { chunkIndex: "asc" }
      })) as LegacyChunkRow[];
      await this.mirrorSource({
        summary,
        sourceType: "global_knowledge_source",
        sourceId: source.id,
        sourceVersion: source.currentVersion,
        workspaceId: null,
        assistantId: null,
        skillId: null,
        rows
      });
    }
  }

  private async backfillProductTextEntries(
    summary: BackfillKnowledgeVectorStoreSummary
  ): Promise<void> {
    const sources = (await this.prisma.productKnowledgeTextEntry.findMany({
      where: { status: "ready" },
      select: { id: true, currentVersion: true }
    })) as Array<{ id: string; currentVersion: number }>;
    for (const source of sources) {
      const rows = (await this.prisma.productKnowledgeTextEntryChunk.findMany({
        where: { textEntryId: source.id, sourceVersion: source.currentVersion },
        select: {
          chunkIndex: true,
          locator: true,
          content: true,
          embeddingModelKey: true,
          embeddingVector: true
        },
        orderBy: { chunkIndex: "asc" }
      })) as LegacyChunkRow[];
      await this.mirrorSource({
        summary,
        sourceType: "product_knowledge_text_entry",
        sourceId: source.id,
        sourceVersion: source.currentVersion,
        workspaceId: null,
        assistantId: null,
        skillId: null,
        rows
      });
    }
  }

  private async mirrorSource(input: {
    summary: BackfillKnowledgeVectorStoreSummary;
    sourceType: KnowledgeSourceType;
    sourceId: string;
    sourceVersion: number;
    workspaceId: string | null;
    assistantId: string | null;
    skillId: string | null;
    rows: LegacyChunkRow[];
  }): Promise<void> {
    const chunks: KnowledgeVectorIndexChunk[] = [];
    for (const row of input.rows) {
      const embeddingVector = toEmbeddingVector(row.embeddingVector);
      if (row.embeddingModelKey === null || embeddingVector === null) {
        continue;
      }
      chunks.push({
        sourceType: input.sourceType,
        sourceId: input.sourceId,
        sourceVersion: input.sourceVersion,
        workspaceId: input.workspaceId,
        assistantId: input.assistantId,
        skillId: input.skillId,
        chunkId: null,
        chunkIndex: row.chunkIndex,
        locator: row.locator,
        content: row.content,
        metadata: null,
        provenance: null,
        provider: null,
        quality: null,
        embeddingModelKey: row.embeddingModelKey,
        embeddingVector
      });
    }
    if (chunks.length === 0) {
      // No embedded chunks to mirror. Clear any stale vector rows so the store
      // matches the legacy truth, then move on.
      await this.knowledgeVectorIndex.deleteSource({
        sourceType: input.sourceType,
        sourceId: input.sourceId
      });
      input.summary.clearedSources += 1;
      if (input.rows.length > 0) {
        input.summary.skippedSourcesWithoutEmbeddings += 1;
      }
      return;
    }
    await this.knowledgeVectorIndex.replaceSourceChunks({
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      sourceVersion: input.sourceVersion,
      chunks
    });
    input.summary.mirroredSources += 1;
    input.summary.mirroredChunks += chunks.length;
  }
}

export type BackfillKnowledgeVectorStoreSummary = {
  mirroredSources: number;
  mirroredChunks: number;
  clearedSources: number;
  skippedSourcesWithoutEmbeddings: number;
};

type LegacyChunkRow = {
  chunkIndex: number;
  locator: string | null;
  content: string;
  embeddingModelKey: string | null;
  embeddingVector: unknown;
};

function toEmbeddingVector(value: unknown): number[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  const numbers = value.filter((entry): entry is number => typeof entry === "number");
  return numbers.length > 0 ? numbers : null;
}
