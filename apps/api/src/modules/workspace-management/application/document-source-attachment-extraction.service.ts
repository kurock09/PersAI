import { Injectable, Logger } from "@nestjs/common";
import type { RuntimeAttachmentRef, RuntimeDocumentSourceFile } from "@persai/runtime-contract";
import { DocumentExtractionService } from "./document-extraction.service";
import { PersaiMediaObjectStorageService } from "./media/persai-media-object-storage.service";
import type { KnowledgeDocumentProcessingInput } from "./knowledge-processing.types";

const SOURCE_ATTACHMENT_TEXT_MIMES = new Set<string>([
  "application/json",
  "application/x-ndjson",
  "application/xml",
  "application/x-yaml",
  "application/yaml",
  "text/csv",
  "text/html",
  "text/markdown",
  "text/plain",
  "text/tab-separated-values",
  "text/xml",
  "text/x-markdown"
]);

const SOURCE_ATTACHMENT_DOCUMENT_MIMES = new Set<string>([
  "application/pdf",
  "application/x-pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
]);

@Injectable()
export class DocumentSourceAttachmentExtractionService {
  private readonly logger = new Logger(DocumentSourceAttachmentExtractionService.name);

  constructor(
    private readonly mediaObjectStorage: PersaiMediaObjectStorageService,
    private readonly documentExtractionService: DocumentExtractionService
  ) {}

  async extractSourceFiles(input: {
    jobId: string;
    assistantId: string;
    workspaceId: string;
    attachments: RuntimeAttachmentRef[];
  }): Promise<RuntimeDocumentSourceFile[]> {
    const results: RuntimeDocumentSourceFile[] = [];
    for (const attachment of input.attachments) {
      const mime = normalizeMime(attachment.mimeType);
      if (!isSupportedSourceMime(mime)) {
        results.push({
          attachmentId: attachment.attachmentId,
          filename: attachment.filename,
          mimeType: attachment.mimeType,
          sizeBytes: attachment.sizeBytes,
          text: null,
          markdown: null,
          note: "Attachment is not a supported text/document source for automatic extraction in document generation.",
          provider: null,
          quality: null
        });
        continue;
      }

      try {
        const downloaded = await this.mediaObjectStorage.downloadObject(attachment.objectKey);
        if (downloaded === null) {
          results.push({
            attachmentId: attachment.attachmentId,
            filename: attachment.filename,
            mimeType: attachment.mimeType,
            sizeBytes: attachment.sizeBytes,
            text: null,
            markdown: null,
            note: "Attachment object not found in storage; document generation could not extract its content.",
            provider: null,
            quality: null
          });
          continue;
        }

        const extraction = await this.documentExtractionService.extract(
          this.toExtractionInput({
            jobId: input.jobId,
            assistantId: input.assistantId,
            workspaceId: input.workspaceId,
            attachment,
            buffer: downloaded.buffer,
            mime
          })
        );
        const text = extraction.normalizedText.trim();
        results.push({
          attachmentId: attachment.attachmentId,
          filename: attachment.filename,
          mimeType: attachment.mimeType,
          sizeBytes: attachment.sizeBytes,
          text: text.length > 0 ? text : null,
          markdown: extraction.markdown ?? null,
          note:
            text.length > 0
              ? null
              : "Document extraction completed but produced no usable source text.",
          provider: extraction.provider,
          quality: extraction.quality
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.warn(
          `Document source attachment extraction failed for job ${input.jobId}, attachment ${attachment.attachmentId}: ${message}`
        );
        results.push({
          attachmentId: attachment.attachmentId,
          filename: attachment.filename,
          mimeType: attachment.mimeType,
          sizeBytes: attachment.sizeBytes,
          text: null,
          markdown: null,
          note: `Document extraction failed: ${message}.`,
          provider: null,
          quality: null
        });
      }
    }
    return results;
  }

  private toExtractionInput(input: {
    jobId: string;
    assistantId: string;
    workspaceId: string;
    attachment: RuntimeAttachmentRef;
    buffer: Buffer;
    mime: string;
  }): KnowledgeDocumentProcessingInput {
    return {
      source: {
        sourceType: "assistant_knowledge_source",
        sourceId: `document-job:${input.jobId}:attachment:${input.attachment.attachmentId}`,
        sourceVersion: 1,
        workspaceId: input.workspaceId,
        assistantId: input.assistantId,
        skillId: null,
        provenance: {
          originKind: "uploaded_file",
          originalFilename: input.attachment.filename,
          mimeType: input.attachment.mimeType,
          storagePath: input.attachment.objectKey,
          metadata: {
            transientDocumentGenerationSource: true,
            attachmentId: input.attachment.attachmentId,
            fileRef: input.attachment.fileRef ?? null,
            aliases: input.attachment.aliases ?? null
          }
        },
        metadata: {
          transientDocumentGenerationSource: true
        }
      },
      content: {
        kind: "bytes",
        buffer: input.buffer,
        mimeType: input.mime,
        originalFilename: input.attachment.filename ?? input.attachment.attachmentId,
        sizeBytes: input.buffer.length
      }
    };
  }
}

function normalizeMime(mimeType: string | null | undefined): string {
  return (mimeType ?? "").toLowerCase().split(";")[0]?.trim() ?? "";
}

function isSupportedSourceMime(mime: string): boolean {
  return (
    mime.startsWith("text/") ||
    SOURCE_ATTACHMENT_TEXT_MIMES.has(mime) ||
    SOURCE_ATTACHMENT_DOCUMENT_MIMES.has(mime)
  );
}
