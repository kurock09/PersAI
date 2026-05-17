import { BadRequestException, Injectable } from "@nestjs/common";
import { AssistantFileRegistryService } from "./assistant-file-registry.service";
import { DocumentExtractionService } from "./document-extraction.service";
import type {
  KnowledgeDocumentProcessingInput,
  KnowledgeExtractionQuality,
  KnowledgeProcessingProviderTrace
} from "./knowledge-processing.types";

const INTERNAL_FILE_EXTRACTION_TEXT_MIMES = new Set<string>([
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

const INTERNAL_FILE_EXTRACTION_DOCUMENT_MIMES = new Set<string>([
  "application/pdf",
  "application/x-pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
]);

export type ExtractInternalRuntimeAssistantFileInput = {
  assistantId: string;
  workspaceId: string;
  fileRef: string;
};

export type ExtractInternalRuntimeAssistantFileOutcome =
  | {
      ok: true;
      extracted: true;
      file: {
        fileRef: string;
        displayName: string | null;
        relativePath: string;
        mimeType: string;
        sizeBytes: number;
      };
      text: string;
      markdown: string | null;
      note: string | null;
      provider: KnowledgeProcessingProviderTrace;
      quality: KnowledgeExtractionQuality;
    }
  | {
      ok: true;
      extracted: false;
      file: {
        fileRef: string;
        displayName: string | null;
        relativePath: string;
        mimeType: string;
        sizeBytes: number;
      } | null;
      text: null;
      markdown: null;
      note: string;
      provider: null;
      quality: null;
    };

@Injectable()
export class ExtractInternalRuntimeAssistantFileService {
  constructor(
    private readonly assistantFileRegistryService: AssistantFileRegistryService,
    private readonly documentExtractionService: DocumentExtractionService
  ) {}

  parseInput(value: unknown): ExtractInternalRuntimeAssistantFileInput {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      throw new BadRequestException("Request body must be an object.");
    }
    const row = value as Record<string, unknown>;
    return {
      assistantId: this.requiredString(row.assistantId, "assistantId"),
      workspaceId: this.requiredString(row.workspaceId, "workspaceId"),
      fileRef: this.requiredString(row.fileRef, "fileRef")
    };
  }

  async execute(
    input: ExtractInternalRuntimeAssistantFileInput
  ): Promise<ExtractInternalRuntimeAssistantFileOutcome> {
    const file = await this.assistantFileRegistryService.findAssistantFile(input);
    if (file === null) {
      return {
        ok: true,
        extracted: false,
        file: null,
        text: null,
        markdown: null,
        note: "File not found.",
        provider: null,
        quality: null
      };
    }

    const mime = normalizeMime(file.mimeType);
    const fileSummary = {
      fileRef: file.fileRef,
      displayName: file.displayName,
      relativePath: file.relativePath,
      mimeType: file.mimeType,
      sizeBytes: file.sizeBytes
    };
    if (!isSupportedExtractionMime(mime)) {
      return {
        ok: true,
        extracted: false,
        file: fileSummary,
        text: null,
        markdown: null,
        note: `File mime type "${file.mimeType}" is not supported for text extraction through files.read.`,
        provider: null,
        quality: null
      };
    }

    const downloaded = await this.assistantFileRegistryService.downloadAssistantFile(input);
    const extraction = await this.documentExtractionService.extract(
      this.toExtractionInput({
        input,
        file: downloaded.file,
        buffer: downloaded.buffer,
        mime
      })
    );
    const text = extraction.normalizedText.trim();
    return {
      ok: true,
      extracted: true,
      file: fileSummary,
      text,
      markdown: extraction.markdown ?? null,
      note: text.length > 0 ? null : "Document extraction completed but produced no usable text.",
      provider: extraction.provider,
      quality: extraction.quality
    };
  }

  private toExtractionInput(input: {
    input: ExtractInternalRuntimeAssistantFileInput;
    file: {
      fileRef: string;
      displayName: string | null;
      relativePath: string;
      mimeType: string;
      objectKey: string;
    };
    buffer: Buffer;
    mime: string;
  }): KnowledgeDocumentProcessingInput {
    return {
      source: {
        sourceType: "assistant_knowledge_source",
        sourceId: `runtime-file:${input.file.fileRef}`,
        sourceVersion: 1,
        workspaceId: input.input.workspaceId,
        assistantId: input.input.assistantId,
        skillId: null,
        provenance: {
          originKind: "uploaded_file",
          originalFilename: input.file.displayName,
          mimeType: input.file.mimeType,
          storagePath: input.file.objectKey,
          metadata: {
            runtimeFilesRead: true,
            fileRef: input.file.fileRef,
            relativePath: input.file.relativePath
          }
        },
        metadata: {
          runtimeFilesRead: true
        }
      },
      content: {
        kind: "bytes",
        buffer: input.buffer,
        mimeType: input.mime,
        originalFilename:
          input.file.displayName ?? input.file.relativePath.split("/").pop() ?? input.file.fileRef,
        sizeBytes: input.buffer.length
      }
    };
  }

  private requiredString(value: unknown, field: string): string {
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new BadRequestException(`${field} must be a non-empty string.`);
    }
    return value.trim();
  }
}

function normalizeMime(mimeType: string | null | undefined): string {
  return (mimeType ?? "").toLowerCase().split(";")[0]?.trim() ?? "";
}

function isSupportedExtractionMime(mime: string): boolean {
  return (
    mime.startsWith("text/") ||
    INTERNAL_FILE_EXTRACTION_TEXT_MIMES.has(mime) ||
    INTERNAL_FILE_EXTRACTION_DOCUMENT_MIMES.has(mime)
  );
}
