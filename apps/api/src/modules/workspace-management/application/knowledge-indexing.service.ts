import { Injectable } from "@nestjs/common";
import { chunkKnowledgeText, type KnowledgeChunkDraft } from "./assistant-knowledge-chunking";
import { MediaPreprocessorService } from "./media/media-preprocessor.service";
import { KnowledgeEmbeddingService } from "./knowledge-embedding.service";

export class KnowledgeIndexingError extends Error {
  constructor(
    public readonly code: string,
    message: string
  ) {
    super(message);
  }
}

export type IndexedKnowledgeChunkDraft = KnowledgeChunkDraft & {
  embeddingModelKey: string | null;
  embeddingVector: number[] | null;
  embeddingGeneratedAt: Date | null;
};

@Injectable()
export class KnowledgeIndexingService {
  constructor(
    private readonly mediaPreprocessorService: MediaPreprocessorService,
    private readonly knowledgeEmbeddingService: KnowledgeEmbeddingService
  ) {}

  async buildIndexedChunks(params: {
    buffer: Buffer;
    mimeType: string;
    originalFilename: string;
    embeddingModelKey?: string | null;
  }): Promise<IndexedKnowledgeChunkDraft[]> {
    const chunks = await this.extractChunks(
      params.buffer,
      params.mimeType,
      params.originalFilename
    );
    const embeddingModelKey = params.embeddingModelKey?.trim() || null;
    const embeddings = await this.knowledgeEmbeddingService.generateEmbeddings({
      modelKey: embeddingModelKey,
      texts: chunks.map((chunk) => chunk.content)
    });
    const generatedAt = embeddingModelKey === null ? null : new Date();

    return chunks.map((chunk, index) => ({
      ...chunk,
      embeddingModelKey: embeddings[index] === null ? null : embeddingModelKey,
      embeddingVector: embeddings[index] ?? null,
      embeddingGeneratedAt: embeddings[index] === null ? null : generatedAt
    }));
  }

  private async extractChunks(
    buffer: Buffer,
    mimeType: string,
    originalFilename: string
  ): Promise<KnowledgeChunkDraft[]> {
    const preprocessed = await this.mediaPreprocessorService.process(
      buffer,
      mimeType,
      originalFilename,
      { enableDocumentVisualFallback: true }
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
}
