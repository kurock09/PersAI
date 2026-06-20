import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type {
  KnowledgeExtractionQuality,
  KnowledgeProcessingProviderTrace,
  KnowledgeSourceProvenance,
  KnowledgeSourceType,
  NormalizedKnowledgeChunk
} from "./knowledge-processing.types";
import { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";

export const KNOWLEDGE_VECTOR_INDEX = Symbol("KNOWLEDGE_VECTOR_INDEX");

export type KnowledgeVectorIndexMetadata = {
  sourceType: KnowledgeSourceType;
  sourceId: string;
  sourceVersion: number;
  provenance?: KnowledgeSourceProvenance | null;
  chunkMetadata?: Record<string, unknown> | null;
  provider?: KnowledgeProcessingProviderTrace | null;
  quality?: KnowledgeExtractionQuality | null;
};

export type KnowledgeVectorIndexChunk = NormalizedKnowledgeChunk & {
  embeddingModelKey: string;
  embeddingVector: number[];
};

export type KnowledgeVectorIndexReplaceInput = {
  sourceType: KnowledgeSourceType;
  sourceId: string;
  sourceVersion: number;
  chunks: KnowledgeVectorIndexChunk[];
};

export type KnowledgeVectorSearchInput = {
  workspaceId: string | null;
  embeddingModelKey: string;
  queryVector: number[];
  limit: number;
  sourceTypes?: KnowledgeSourceType[];
  assistantId?: string | null;
  skillIds?: string[];
};

export type KnowledgeVectorSearchHit = {
  id: string;
  workspaceId: string | null;
  assistantId: string | null;
  skillId: string | null;
  sourceType: KnowledgeSourceType;
  sourceId: string;
  chunkId: string | null;
  sourceVersion: number;
  chunkIndex: number;
  embeddingModelKey: string;
  score: number;
  metadata: KnowledgeVectorIndexMetadata | null;
};

export interface KnowledgeVectorIndex {
  replaceSourceChunks(input: KnowledgeVectorIndexReplaceInput): Promise<void>;
  deleteSource(input: { sourceType: KnowledgeSourceType; sourceId: string }): Promise<void>;
  searchNearest(input: KnowledgeVectorSearchInput): Promise<KnowledgeVectorSearchHit[]>;
}

type PostgresKnowledgeVectorSearchRow = {
  id: string;
  workspace_id: string | null;
  assistant_id: string | null;
  skill_id: string | null;
  source_type: KnowledgeSourceType;
  source_id: string;
  chunk_id: string | null;
  source_version: number;
  chunk_index: number;
  embedding_model_key: string;
  score: number;
  metadata: Prisma.JsonValue | null;
};

@Injectable()
export class PostgresPgvectorKnowledgeIndex implements KnowledgeVectorIndex {
  constructor(private readonly prisma: WorkspaceManagementPrismaService) {}

  async replaceSourceChunks(input: KnowledgeVectorIndexReplaceInput): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw(Prisma.sql`
        DELETE FROM "knowledge_vector_chunks"
        WHERE "source_type" = ${input.sourceType}::"KnowledgeVectorSourceType"
          AND "source_id" = ${input.sourceId}::uuid
      `);

      for (const chunk of input.chunks) {
        const metadata = buildKnowledgeVectorIndexMetadata(chunk);
        await tx.$executeRaw(Prisma.sql`
          INSERT INTO "knowledge_vector_chunks" (
            "workspace_id",
            "assistant_id",
            "skill_id",
            "source_type",
            "source_id",
            "chunk_id",
            "source_version",
            "chunk_index",
            "embedding_model_key",
            "embedding_vector",
            "metadata",
            "updated_at"
          )
          VALUES (
            ${chunk.workspaceId ?? null}::uuid,
            ${chunk.assistantId ?? null}::uuid,
            ${chunk.skillId ?? null}::uuid,
            ${chunk.sourceType}::"KnowledgeVectorSourceType",
            ${chunk.sourceId}::uuid,
            ${chunk.chunkId ?? null}::uuid,
            ${chunk.sourceVersion},
            ${chunk.chunkIndex},
            ${chunk.embeddingModelKey},
            ${serializePgvector(chunk.embeddingVector)}::vector,
            ${JSON.stringify(metadata)}::jsonb,
            now()
          )
          ON CONFLICT (
            "source_type",
            "source_id",
            "source_version",
            "chunk_index",
            "embedding_model_key"
          )
          DO UPDATE SET
            "workspace_id" = EXCLUDED."workspace_id",
            "assistant_id" = EXCLUDED."assistant_id",
            "skill_id" = EXCLUDED."skill_id",
            "chunk_id" = EXCLUDED."chunk_id",
            "embedding_vector" = EXCLUDED."embedding_vector",
            "metadata" = EXCLUDED."metadata",
            "updated_at" = now()
        `);
      }
    });
  }

  async deleteSource(input: { sourceType: KnowledgeSourceType; sourceId: string }): Promise<void> {
    await this.prisma.$executeRaw(Prisma.sql`
      DELETE FROM "knowledge_vector_chunks"
      WHERE "source_type" = ${input.sourceType}::"KnowledgeVectorSourceType"
        AND "source_id" = ${input.sourceId}::uuid
    `);
  }

  async searchNearest(input: KnowledgeVectorSearchInput): Promise<KnowledgeVectorSearchHit[]> {
    const conditions: Prisma.Sql[] = [
      Prisma.sql`"embedding_model_key" = ${input.embeddingModelKey}`
    ];

    if (input.workspaceId !== null) {
      conditions.push(Prisma.sql`"workspace_id" = ${input.workspaceId}::uuid`);
    }
    if (input.sourceTypes && input.sourceTypes.length > 0) {
      conditions.push(
        Prisma.sql`"source_type" IN (${Prisma.join(
          input.sourceTypes.map(
            (sourceType) => Prisma.sql`${sourceType}::"KnowledgeVectorSourceType"`
          )
        )})`
      );
    }
    if (input.assistantId !== undefined) {
      conditions.push(Prisma.sql`"assistant_id" = ${input.assistantId}::uuid`);
    }
    if (input.skillIds && input.skillIds.length > 0) {
      conditions.push(
        Prisma.sql`"skill_id" IN (${Prisma.join(
          input.skillIds.map((skillId) => Prisma.sql`${skillId}::uuid`)
        )})`
      );
    }

    const rows = await this.prisma.$queryRaw<PostgresKnowledgeVectorSearchRow[]>(Prisma.sql`
      SELECT
        "id",
        "workspace_id",
        "assistant_id",
        "skill_id",
        "source_type",
        "source_id",
        "chunk_id",
        "source_version",
        "chunk_index",
        "embedding_model_key",
        1 - ("embedding_vector" <=> ${serializePgvector(input.queryVector)}::vector) AS "score",
        "metadata"
      FROM "knowledge_vector_chunks"
      WHERE ${Prisma.join(conditions, " AND ")}
      ORDER BY "embedding_vector"::halfvec(3072) <=> ${serializePgvector(input.queryVector)}::halfvec(3072)
      LIMIT ${Math.max(1, input.limit)}
    `);

    return rows.map((row) => ({
      id: row.id,
      workspaceId: row.workspace_id,
      assistantId: row.assistant_id,
      skillId: row.skill_id,
      sourceType: row.source_type,
      sourceId: row.source_id,
      chunkId: row.chunk_id,
      sourceVersion: row.source_version,
      chunkIndex: row.chunk_index,
      embeddingModelKey: row.embedding_model_key,
      score: Number(row.score),
      metadata: parseKnowledgeVectorIndexMetadata(row.metadata)
    }));
  }
}

export function buildKnowledgeVectorIndexMetadata(
  chunk: NormalizedKnowledgeChunk
): KnowledgeVectorIndexMetadata {
  return {
    sourceType: chunk.sourceType,
    sourceId: chunk.sourceId,
    sourceVersion: chunk.sourceVersion,
    provenance: chunk.provenance ?? null,
    chunkMetadata: chunk.metadata ?? null,
    provider: chunk.provider ?? null,
    quality: chunk.quality ?? null
  };
}

export function serializePgvector(vector: number[]): string {
  if (vector.length === 0) {
    throw new Error("pgvector embedding must contain at least one dimension.");
  }
  for (const value of vector) {
    if (!Number.isFinite(value)) {
      throw new Error("pgvector embedding contains a non-finite number.");
    }
  }
  return `[${vector.join(",")}]`;
}

function parseKnowledgeVectorIndexMetadata(
  value: Prisma.JsonValue | null
): KnowledgeVectorIndexMetadata | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as KnowledgeVectorIndexMetadata;
}
