import { Injectable } from "@nestjs/common";
import { chunkKnowledgeText, type KnowledgeChunkDraft } from "./assistant-knowledge-chunking";
import { KnowledgeDocumentProcessorService } from "./knowledge-document-processor.service";
import { KnowledgeEmbeddingService } from "./knowledge-embedding.service";
import type {
  KnowledgeDocumentContent,
  KnowledgeDocumentProcessorMode,
  KnowledgeExtractionQuality,
  KnowledgeProcessingProviderTrace,
  NormalizedKnowledgeSource
} from "./knowledge-processing.types";

export class KnowledgeIndexingError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly provider: KnowledgeProcessingProviderTrace | null = null,
    public readonly quality: KnowledgeExtractionQuality | null = null
  ) {
    super(message);
  }
}

export type IndexedKnowledgeChunkDraft = KnowledgeChunkDraft & {
  embeddingModelKey: string | null;
  embeddingVector: number[] | null;
  embeddingGeneratedAt: Date | null;
  metadata: Record<string, unknown> | null;
  provider: KnowledgeProcessingProviderTrace | null;
  quality: KnowledgeExtractionQuality | null;
};

export type KnowledgeIndexingEmbeddingUsage = {
  providerKey: "openai";
  modelKey: string;
  inputTokens: number;
  totalTokens: number;
};

export type KnowledgeIndexingBuildResult = {
  chunks: IndexedKnowledgeChunkDraft[];
  embeddingUsage: KnowledgeIndexingEmbeddingUsage | null;
};

@Injectable()
export class KnowledgeIndexingService {
  constructor(
    private readonly knowledgeDocumentProcessorService: KnowledgeDocumentProcessorService,
    private readonly knowledgeEmbeddingService: KnowledgeEmbeddingService
  ) {}

  async buildIndexedChunks(params: {
    buffer: Buffer;
    mimeType: string;
    originalFilename: string;
    embeddingModelKey?: string | null;
  }): Promise<IndexedKnowledgeChunkDraft[]> {
    const built = await this.buildIndexedChunksForSourceInternal({
      source: buildUploadCompatibilitySource(params),
      content: {
        kind: "bytes",
        buffer: params.buffer,
        mimeType: params.mimeType,
        originalFilename: params.originalFilename,
        sizeBytes: params.buffer.length
      },
      processorMode: "local",
      ...(params.embeddingModelKey === undefined
        ? {}
        : { embeddingModelKey: params.embeddingModelKey })
    });
    return built.chunks;
  }

  async buildIndexedChunksForSource(params: {
    source: NormalizedKnowledgeSource;
    content: KnowledgeDocumentContent;
    processorMode?: KnowledgeDocumentProcessorMode;
    embeddingModelKey?: string | null;
  }): Promise<KnowledgeIndexingBuildResult> {
    return this.buildIndexedChunksForSourceInternal(params);
  }

  private async buildIndexedChunksForSourceInternal(params: {
    source: NormalizedKnowledgeSource;
    content: KnowledgeDocumentContent;
    processorMode?: KnowledgeDocumentProcessorMode;
    embeddingModelKey?: string | null;
  }): Promise<KnowledgeIndexingBuildResult> {
    const processingInput = {
      source: params.source,
      content: params.content
    };
    const processed = await this.knowledgeDocumentProcessorService.process(
      params.processorMode === undefined
        ? processingInput
        : {
            ...processingInput,
            requestedMode: params.processorMode
          }
    );
    const extractedText = processed.normalizedText.trim();
    if (extractedText.length === 0) {
      throw new KnowledgeIndexingError(
        "text_extract_unavailable",
        "No searchable text could be extracted from the knowledge source.",
        processed.provider,
        processed.quality
      );
    }

    const chunks = chunkKnowledgeText(extractedText);
    if (chunks.length === 0) {
      throw new KnowledgeIndexingError(
        "empty_text_extract",
        "The knowledge source did not produce any indexable text chunks.",
        processed.provider,
        processed.quality
      );
    }
    const embeddingModelKey = params.embeddingModelKey?.trim() || null;
    const embeddingResult = await this.knowledgeEmbeddingService.generateEmbeddings({
      modelKey: embeddingModelKey,
      texts: chunks.map((chunk) => chunk.content)
    });
    const generatedAt = embeddingModelKey === null ? null : new Date();

    return {
      chunks: chunks.map((chunk, index) => ({
        ...chunk,
        embeddingModelKey: embeddingResult.embeddings[index] === null ? null : embeddingModelKey,
        embeddingVector: embeddingResult.embeddings[index] ?? null,
        embeddingGeneratedAt: embeddingResult.embeddings[index] === null ? null : generatedAt,
        metadata: processed.metadata ?? null,
        provider: processed.provider,
        quality: processed.quality
      })),
      embeddingUsage: embeddingResult.usage
    };
  }
}

function buildUploadCompatibilitySource(params: {
  mimeType: string;
  originalFilename: string;
}): NormalizedKnowledgeSource {
  return {
    sourceType: "assistant_knowledge_source",
    sourceId: "upload-compatibility-source",
    sourceVersion: 1,
    workspaceId: "upload-compatibility-workspace",
    assistantId: null,
    skillId: null,
    provenance: {
      originKind: "uploaded_file",
      originalFilename: params.originalFilename,
      mimeType: params.mimeType
    },
    metadata: null
  };
}
