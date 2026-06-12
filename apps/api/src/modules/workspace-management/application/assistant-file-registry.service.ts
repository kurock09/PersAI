import { createHash } from "node:crypto";
import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { Prisma, type SandboxFileOrigin } from "@prisma/client";
import { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";
import { PersaiMediaObjectStorageService } from "./media/persai-media-object-storage.service";
import {
  ASSISTANT_FILE_MEDIA_DERIVATIVES_SCHEMA,
  readAssistantFileMediaDerivatives,
  withAssistantFileMediaDerivatives,
  type AssistantFileMediaDerivativeDescriptor,
  type AssistantFileMediaDerivativesMetadata,
  type AssistantFileMediaDerivativesStatus,
  type AttachmentSemanticSummarySource
} from "./media/media.types";
import type {
  KnowledgeExtractionQuality,
  KnowledgeProcessingProviderTrace
} from "./knowledge-processing.types";

type AttachmentBackedOrigin = Extract<SandboxFileOrigin, "uploaded_attachment" | "runtime_output">;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CLEANUP_TTL_BY_REASON: Record<Exclude<AssistantFileCleanupReason, null>, number> = {
  voice_upload_cache: 24 * 60 * 60 * 1000
};
const INTERNAL_RUNTIME_FILE_EXTRACTION_CACHE_KEY = "internalRuntimeFileExtractionCache";
const INTERNAL_RUNTIME_FILE_EXTRACTION_CACHE_SCHEMA =
  "persai.internalRuntimeFileExtractionCache.v1";
const INTERNAL_RUNTIME_FILE_EXTRACTION_TEXT_MAX_CHARS = 12_000;
const INTERNAL_RUNTIME_FILE_EXTRACTION_MARKDOWN_MAX_CHARS = 12_000;
const ASSISTANT_FILE_SYSTEM_VARIANT_SCHEMA = "persai.mediaDerivativeFile.v1";

export type AssistantFileBucket =
  | "user_files"
  | "assistant_created"
  | "documents"
  | "media_uploads"
  | "cache_history";

export type AssistantFileCleanupReason = "voice_upload_cache" | null;

export type AssistantFileDocumentLink = {
  docId: string;
  versionId: string;
  versionNumber: number;
  descriptorMode: string;
  documentType: string;
  documentStatus: string;
  versionStatus: string;
  isCurrentOutput: boolean;
};

export type AssistantFileInternalRuntimeExtractionCache = {
  schema: typeof INTERNAL_RUNTIME_FILE_EXTRACTION_CACHE_SCHEMA;
  cachedAt: string;
  text: string;
  markdown: string | null;
  note: string | null;
  provider: KnowledgeProcessingProviderTrace;
  quality: KnowledgeExtractionQuality;
};

export type AssistantFileRegistryRecord = {
  fileRef: string;
  assistantId: string;
  workspaceId: string;
  origin: SandboxFileOrigin;
  objectKey: string;
  relativePath: string;
  displayName: string | null;
  mimeType: string;
  sizeBytes: number;
  logicalSizeBytes: number | null;
  sha256: string | null;
  metadata: Record<string, unknown> | null;
  fileBucket: AssistantFileBucket;
  cleanupEligible: boolean;
  cleanupReason: AssistantFileCleanupReason;
  cleanupEligibleAt: Date | null;
  documentLink: AssistantFileDocumentLink | null;
  createdAt: Date;
};

export type AssistantFileCleanupSummary = {
  eligibleCount: number;
  eligibleBytes: number;
};

export type AssistantFileCleanupResult = AssistantFileCleanupSummary & {
  deletedCount: number;
  deletedBytes: number;
  skippedPinnedCount: number;
};

type AssistantFileSystemVariantMetadata = {
  schema: typeof ASSISTANT_FILE_SYSTEM_VARIANT_SCHEMA;
  role: "media_derivative";
  parentFileRef: string;
  derivativeKind: "thumbnail" | "poster";
};

export function readAssistantFileInternalRuntimeExtractionCache(
  metadata: Record<string, unknown> | null
): AssistantFileInternalRuntimeExtractionCache | null {
  const raw =
    metadata?.[INTERNAL_RUNTIME_FILE_EXTRACTION_CACHE_KEY] !== undefined
      ? metadata[INTERNAL_RUNTIME_FILE_EXTRACTION_CACHE_KEY]
      : null;
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }
  const row = raw as Record<string, unknown>;
  if (
    row.schema !== INTERNAL_RUNTIME_FILE_EXTRACTION_CACHE_SCHEMA ||
    typeof row.cachedAt !== "string" ||
    typeof row.text !== "string" ||
    (row.markdown !== null && typeof row.markdown !== "string") ||
    (row.note !== null && typeof row.note !== "string") ||
    !isKnowledgeProcessingProviderTrace(row.provider) ||
    !isKnowledgeExtractionQuality(row.quality)
  ) {
    return null;
  }
  return {
    schema: INTERNAL_RUNTIME_FILE_EXTRACTION_CACHE_SCHEMA,
    cachedAt: row.cachedAt,
    text: row.text,
    markdown: row.markdown as string | null,
    note: row.note as string | null,
    provider: row.provider,
    quality: row.quality
  };
}

@Injectable()
export class AssistantFileRegistryService {
  private readonly logger = new Logger(AssistantFileRegistryService.name);

  constructor(
    private readonly prisma: WorkspaceManagementPrismaService,
    private readonly mediaObjectStorage: PersaiMediaObjectStorageService
  ) {}

  async listAssistantFiles(input: {
    assistantId: string;
    workspaceId: string;
    query?: string | null;
    limit: number;
  }): Promise<AssistantFileRegistryRecord[]> {
    const query = input.query?.trim() ?? "";
    const rows = await this.prisma.assistantFile.findMany({
      where: {
        assistantId: input.assistantId,
        workspaceId: input.workspaceId,
        ...(query.length === 0
          ? {}
          : {
              OR: [
                ...(UUID_PATTERN.test(query) ? [{ id: query }] : []),
                { displayName: { contains: query, mode: "insensitive" } },
                { relativePath: { contains: query, mode: "insensitive" } }
              ]
            })
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: input.limit
    });
    const files = await this.attachDocumentLinks(
      rows.filter((row) => !this.isHiddenSystemVariant(row.metadata)).map((row) => this.mapRow(row))
    );
    return files.filter((file) => file.documentLink?.documentStatus !== "archived");
  }

  async summarizeCleanup(input: {
    assistantId: string;
    workspaceId: string;
  }): Promise<AssistantFileCleanupSummary> {
    const files = await this.listAssistantFiles({
      assistantId: input.assistantId,
      workspaceId: input.workspaceId,
      limit: 1000
    });
    return this.summarizeCleanupFromFiles(files);
  }

  async findAssistantFile(input: {
    assistantId: string;
    workspaceId: string;
    fileRef: string;
  }): Promise<AssistantFileRegistryRecord | null> {
    const row = await this.prisma.assistantFile.findFirst({
      where: {
        id: input.fileRef,
        assistantId: input.assistantId,
        workspaceId: input.workspaceId
      }
    });
    if (row === null) {
      return null;
    }
    if (this.isHiddenSystemVariant(row.metadata)) {
      return null;
    }
    const [mapped] = await this.attachDocumentLinks([this.mapRow(row)]);
    return mapped ?? null;
  }

  async downloadAssistantFile(input: {
    assistantId: string;
    workspaceId: string;
    fileRef: string;
  }): Promise<{ file: AssistantFileRegistryRecord; buffer: Buffer; contentType: string }> {
    const file = await this.findDownloadableAssistantFile(input);
    if (file === null) {
      throw new NotFoundException("File not found.");
    }
    const downloaded = await this.mediaObjectStorage.downloadObject(file.objectKey);
    if (downloaded === null) {
      throw new NotFoundException("File object not found on storage.");
    }
    return {
      file,
      buffer: downloaded.buffer,
      contentType: downloaded.contentType
    };
  }

  private async findDownloadableAssistantFile(input: {
    assistantId: string;
    workspaceId: string;
    fileRef: string;
  }): Promise<AssistantFileRegistryRecord | null> {
    const row = await this.prisma.assistantFile.findFirst({
      where: {
        id: input.fileRef,
        assistantId: input.assistantId,
        workspaceId: input.workspaceId
      }
    });
    return row === null ? null : this.mapRow(row);
  }

  async updateAssistantFileMetadata(input: {
    assistantId: string;
    workspaceId: string;
    fileRef: string;
    displayName: string | null;
  }): Promise<AssistantFileRegistryRecord> {
    const existing = await this.findAssistantFile(input);
    if (existing === null) {
      throw new NotFoundException("File not found.");
    }
    const row = await this.prisma.assistantFile.update({
      where: { id: input.fileRef },
      data: {
        displayName: input.displayName
      }
    });
    return this.mapRow(row);
  }

  async deleteAssistantFile(input: {
    assistantId: string;
    workspaceId: string;
    fileRef: string;
  }): Promise<void> {
    const existing = await this.findAssistantFile(input);
    if (existing === null) {
      throw new NotFoundException("File not found.");
    }
    const derivativeFiles = await this.listMediaDerivativeFiles({
      assistantId: input.assistantId,
      workspaceId: input.workspaceId,
      parentFileRef: input.fileRef
    });
    const deletedAt = new Date().toISOString();
    const linkedAttachments = await this.prisma.assistantChatMessageAttachment.findMany({
      where: {
        assistantFileId: input.fileRef,
        assistantId: input.assistantId,
        workspaceId: input.workspaceId
      },
      select: {
        id: true,
        metadata: true
      }
    });
    const linkedDocumentDelivery = await this.prisma.assistantDocumentDeliveredFile.findFirst({
      where: {
        assistantFileId: input.fileRef,
        workspaceId: input.workspaceId,
        document: {
          assistantId: input.assistantId,
          workspaceId: input.workspaceId
        }
      },
      select: {
        docId: true,
        versionId: true,
        isCurrentOutput: true
      }
    });
    if (linkedDocumentDelivery !== null) {
      await this.archiveDeliveredDocumentFromFilesSurface({
        assistantId: input.assistantId,
        workspaceId: input.workspaceId,
        docId: linkedDocumentDelivery.docId,
        deletedAt
      });
      return;
    }
    await this.prisma.$transaction([
      ...linkedAttachments.map((attachment) =>
        this.prisma.assistantChatMessageAttachment.update({
          where: { id: attachment.id },
          data: {
            metadata: {
              ...this.asMetadataObject(attachment.metadata),
              fileDeleted: true,
              deletedFileRef: input.fileRef,
              deletedAt
            } satisfies Prisma.InputJsonObject
          }
        })
      ),
      ...(derivativeFiles.length > 0
        ? [
            this.prisma.assistantFile.deleteMany({
              where: { id: { in: derivativeFiles.map((file) => file.fileRef) } }
            })
          ]
        : []),
      this.prisma.assistantFile.delete({
        where: { id: input.fileRef }
      })
    ]);
    await Promise.all(
      [existing.objectKey, ...derivativeFiles.map((file) => file.objectKey)].map((objectKey) =>
        this.mediaObjectStorage.deleteObject(objectKey).catch(() => {})
      )
    );
  }

  private async archiveDeliveredDocumentFromFilesSurface(input: {
    assistantId: string;
    workspaceId: string;
    docId: string;
    deletedAt: string;
  }): Promise<void> {
    const deliveredFiles = await this.prisma.assistantDocumentDeliveredFile.findMany({
      where: {
        docId: input.docId,
        workspaceId: input.workspaceId,
        document: {
          assistantId: input.assistantId,
          workspaceId: input.workspaceId
        }
      },
      select: {
        assistantFileId: true
      }
    });
    const deliveredFileRefs = [...new Set(deliveredFiles.map((file) => file.assistantFileId))];
    const linkedAttachments =
      deliveredFileRefs.length === 0
        ? []
        : await this.prisma.assistantChatMessageAttachment.findMany({
            where: {
              assistantFileId: { in: deliveredFileRefs },
              assistantId: input.assistantId,
              workspaceId: input.workspaceId
            },
            select: {
              id: true,
              assistantFileId: true,
              metadata: true
            }
          });

    await this.prisma.$transaction([
      this.prisma.assistantDocument.updateMany({
        where: {
          id: input.docId,
          assistantId: input.assistantId,
          workspaceId: input.workspaceId
        },
        data: {
          status: "archived"
        }
      }),
      ...linkedAttachments.map((attachment) =>
        this.prisma.assistantChatMessageAttachment.update({
          where: { id: attachment.id },
          data: {
            metadata: {
              ...this.asMetadataObject(attachment.metadata),
              fileDeleted: true,
              deletedFileRef: attachment.assistantFileId,
              deletedDocumentId: input.docId,
              deletedAt: input.deletedAt
            } satisfies Prisma.InputJsonObject
          }
        })
      )
    ]);
  }

  async cleanupAssistantFileCache(
    input: { assistantId: string; workspaceId: string },
    now: Date = new Date()
  ): Promise<AssistantFileCleanupResult> {
    const files = await this.listAssistantFiles({
      assistantId: input.assistantId,
      workspaceId: input.workspaceId,
      limit: 1000
    });
    const eligible = this.summarizeCleanupFromFiles(files, now);
    let deletedCount = 0;
    let deletedBytes = 0;
    let skippedPinnedCount = 0;

    for (const file of files.filter(
      (candidate) =>
        candidate.cleanupEligible &&
        candidate.cleanupEligibleAt !== null &&
        candidate.cleanupEligibleAt <= now
    )) {
      const pinCount = await this.prisma.assistantChatMessageAttachment.count({
        where: { assistantFileId: file.fileRef }
      });
      if (pinCount > 0) {
        skippedPinnedCount += 1;
        this.logger.debug(
          `[cleanup] skipping pinned file ${file.fileRef}: referenced by ${pinCount} message attachment(s)`
        );
        continue;
      }
      await this.deleteAssistantFile({
        assistantId: input.assistantId,
        workspaceId: input.workspaceId,
        fileRef: file.fileRef
      });
      deletedCount += 1;
      deletedBytes += file.sizeBytes;
    }

    return {
      ...eligible,
      deletedCount,
      deletedBytes,
      skippedPinnedCount
    };
  }

  async linkAttachmentToExistingFile(input: {
    assistantId: string;
    workspaceId: string;
    sourceAttachmentId: string;
    fileRef: string;
  }): Promise<void> {
    const existing = await this.findAssistantFile({
      assistantId: input.assistantId,
      workspaceId: input.workspaceId,
      fileRef: input.fileRef
    });
    if (existing === null) {
      throw new NotFoundException("File not found.");
    }
    await this.prisma.assistantChatMessageAttachment.updateMany({
      where: {
        id: input.sourceAttachmentId,
        assistantId: input.assistantId,
        workspaceId: input.workspaceId
      },
      data: { assistantFileId: input.fileRef }
    });
    await this.ensureMediaDerivativeTracking({
      assistantId: input.assistantId,
      workspaceId: input.workspaceId,
      fileRef: input.fileRef
    });
  }

  async ensureMediaDerivativeTracking(input: {
    assistantId: string;
    workspaceId: string;
    fileRef: string;
  }): Promise<void> {
    const existing = await this.prisma.assistantFile.findFirst({
      where: {
        id: input.fileRef,
        assistantId: input.assistantId,
        workspaceId: input.workspaceId
      },
      select: {
        id: true,
        mimeType: true,
        metadata: true
      }
    });
    if (existing === null || this.isHiddenSystemVariant(existing.metadata)) {
      return;
    }
    const nextMetadata = this.withPendingMediaDerivativesIfNeeded({
      metadata: this.asMetadataRecord(existing.metadata),
      mimeType: existing.mimeType
    });
    const currentJson = JSON.stringify(this.asMetadataRecord(existing.metadata) ?? {});
    const nextJson = JSON.stringify(nextMetadata);
    if (currentJson === nextJson) {
      return;
    }
    await this.prisma.assistantFile.update({
      where: { id: existing.id },
      data: {
        metadata: nextMetadata as Prisma.InputJsonValue
      }
    });
  }

  async listPendingMediaDerivativeParents(limit: number): Promise<AssistantFileRegistryRecord[]> {
    const rows = await this.prisma.assistantFile.findMany({
      where: {
        metadata: {
          path: ["mediaDerivatives", "status"],
          equals: "pending"
        }
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: limit
    });
    return rows
      .filter((row) => !this.isHiddenSystemVariant(row.metadata))
      .map((row) => this.mapRow(row));
  }

  async markMediaDerivativesStatus(input: {
    assistantId: string;
    workspaceId: string;
    fileRef: string;
    status: AssistantFileMediaDerivativesStatus;
    thumbnail?: AssistantFileMediaDerivativeDescriptor | null | undefined;
    poster?: AssistantFileMediaDerivativeDescriptor | null | undefined;
    lastError?: string | null | undefined;
  }): Promise<AssistantFileRegistryRecord> {
    const existing = await this.findAssistantFile(input);
    if (existing === null) {
      throw new NotFoundException("File not found.");
    }
    const current = readAssistantFileMediaDerivatives(existing.metadata);
    const next: AssistantFileMediaDerivativesMetadata = {
      schemaVersion: ASSISTANT_FILE_MEDIA_DERIVATIVES_SCHEMA,
      status: input.status,
      thumbnail: input.thumbnail !== undefined ? input.thumbnail : (current?.thumbnail ?? null),
      poster: input.poster !== undefined ? input.poster : (current?.poster ?? null),
      lastError: input.lastError ?? null,
      updatedAt: new Date().toISOString()
    };
    const metadata = withAssistantFileMediaDerivatives({
      metadata: existing.metadata,
      derivatives: next
    });
    const row = await this.prisma.assistantFile.update({
      where: { id: input.fileRef },
      data: {
        metadata: (metadata ?? Prisma.DbNull) as Prisma.InputJsonValue
      }
    });
    const derivativeRefs = readAssistantFileMediaDerivatives(
      metadata as Record<string, unknown> | null
    );
    await this.prisma.assistantChatMessageAttachment.updateMany({
      where: {
        assistantFileId: input.fileRef,
        assistantId: input.assistantId,
        workspaceId: input.workspaceId
      },
      data: {
        metadata: {
          ...(derivativeRefs?.thumbnail?.fileRef !== undefined
            ? { thumbnailFileRef: derivativeRefs.thumbnail.fileRef }
            : {}),
          ...(derivativeRefs?.poster?.fileRef !== undefined
            ? { posterFileRef: derivativeRefs.poster.fileRef }
            : {}),
          ...(derivativeRefs?.status !== undefined
            ? { derivativesStatus: derivativeRefs.status }
            : {}),
          ...(input.lastError !== undefined && input.lastError !== null
            ? { derivativesLastError: input.lastError }
            : {})
        } as Prisma.InputJsonValue
      }
    });
    return this.mapRow(row);
  }

  async upsertMediaDerivativeFile(input: {
    assistantId: string;
    workspaceId: string;
    parentFileRef: string;
    parentOrigin: SandboxFileOrigin;
    derivativeKind: "thumbnail" | "poster";
    objectKey: string;
    filename: string | null;
    mimeType: string;
    sizeBytes: bigint;
    width: number | null;
    height: number | null;
  }): Promise<AssistantFileMediaDerivativeDescriptor> {
    const relativePath = this.buildDerivativeRelativePath({
      parentFileRef: input.parentFileRef,
      derivativeKind: input.derivativeKind,
      filename: input.filename,
      mimeType: input.mimeType
    });
    const metadata: AssistantFileSystemVariantMetadata = {
      schema: ASSISTANT_FILE_SYSTEM_VARIANT_SCHEMA,
      role: "media_derivative",
      parentFileRef: input.parentFileRef,
      derivativeKind: input.derivativeKind
    };
    const row = await this.prisma.assistantFile.upsert({
      where: {
        assistantId_workspaceId_origin_objectKey: {
          assistantId: input.assistantId,
          workspaceId: input.workspaceId,
          origin: input.parentOrigin,
          objectKey: input.objectKey
        }
      },
      update: {
        relativePath,
        displayName: input.filename,
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes,
        logicalSizeBytes: BigInt(0),
        metadata: metadata as unknown as Prisma.InputJsonValue
      },
      create: {
        assistantId: input.assistantId,
        workspaceId: input.workspaceId,
        sandboxJobId: null,
        origin: input.parentOrigin,
        sourceToolCode: null,
        objectKey: input.objectKey,
        relativePath,
        displayName: input.filename,
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes,
        logicalSizeBytes: BigInt(0),
        sha256: null,
        metadata: metadata as unknown as Prisma.InputJsonValue
      }
    });
    return {
      fileRef: row.id,
      objectKey: input.objectKey,
      mimeType: input.mimeType,
      width: input.width,
      height: input.height,
      sizeBytes: Number(input.sizeBytes)
    };
  }

  async ensureAttachmentFile(input: {
    assistantId: string;
    workspaceId: string;
    origin: AttachmentBackedOrigin;
    sourceAttachmentId: string;
    sourceMessageId: string;
    sourceChatId: string;
    objectKey: string;
    filename: string | null;
    mimeType: string;
    sizeBytes: bigint;
    contentBuffer?: Buffer;
    source: string;
    semanticSummary?: string | null;
    semanticSummarySource?: AttachmentSemanticSummarySource | null;
  }): Promise<AssistantFileRegistryRecord> {
    const relativePath = this.buildAttachmentRelativePath(
      input.origin,
      input.sourceAttachmentId,
      input.filename,
      input.mimeType
    );
    const metadata = {
      source: input.source,
      sourceAttachmentId: input.sourceAttachmentId,
      sourceMessageId: input.sourceMessageId,
      sourceChatId: input.sourceChatId,
      ...(input.semanticSummary === null || input.semanticSummary === undefined
        ? {}
        : {
            semanticSummary: input.semanticSummary,
            semanticSummarySource: input.semanticSummarySource ?? null
          })
    };
    const metadataWithDerivativeTracking = this.withPendingMediaDerivativesIfNeeded({
      metadata,
      mimeType: input.mimeType
    });
    const sha256 =
      input.contentBuffer === undefined
        ? null
        : createHash("sha256").update(input.contentBuffer).digest("hex");
    const row = await this.prisma.assistantFile.upsert({
      where: {
        assistantId_workspaceId_origin_objectKey: {
          assistantId: input.assistantId,
          workspaceId: input.workspaceId,
          origin: input.origin,
          objectKey: input.objectKey
        }
      },
      update: {
        relativePath,
        displayName: input.filename,
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes,
        logicalSizeBytes: input.sizeBytes,
        ...(sha256 === null ? {} : { sha256 }),
        metadata: metadataWithDerivativeTracking as Prisma.InputJsonValue
      },
      create: {
        assistantId: input.assistantId,
        workspaceId: input.workspaceId,
        sandboxJobId: null,
        origin: input.origin,
        sourceToolCode: null,
        objectKey: input.objectKey,
        relativePath,
        displayName: input.filename,
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes,
        logicalSizeBytes: input.sizeBytes,
        sha256,
        metadata: metadataWithDerivativeTracking as Prisma.InputJsonValue
      }
    });

    await this.prisma.assistantChatMessageAttachment.updateMany({
      where: {
        id: input.sourceAttachmentId,
        assistantId: input.assistantId,
        workspaceId: input.workspaceId
      },
      data: { assistantFileId: row.id }
    });

    return this.mapRow(row);
  }

  async updateInternalRuntimeExtractionCache(input: {
    assistantId: string;
    workspaceId: string;
    fileRef: string;
    cache: {
      text: string;
      markdown: string | null;
      note: string | null;
      provider: KnowledgeProcessingProviderTrace;
      quality: KnowledgeExtractionQuality;
      cachedAt?: string;
    };
  }): Promise<AssistantFileRegistryRecord> {
    const existing = await this.findAssistantFile({
      assistantId: input.assistantId,
      workspaceId: input.workspaceId,
      fileRef: input.fileRef
    });
    if (existing === null) {
      throw new NotFoundException("File not found.");
    }
    const metadata: Prisma.InputJsonObject = {
      ...this.asMetadataObject(existing.metadata),
      [INTERNAL_RUNTIME_FILE_EXTRACTION_CACHE_KEY]: {
        schema: INTERNAL_RUNTIME_FILE_EXTRACTION_CACHE_SCHEMA,
        cachedAt: input.cache.cachedAt ?? new Date().toISOString(),
        text: this.truncateExtractionCacheValue(
          input.cache.text,
          INTERNAL_RUNTIME_FILE_EXTRACTION_TEXT_MAX_CHARS
        ),
        markdown:
          input.cache.markdown === null
            ? null
            : this.truncateExtractionCacheValue(
                input.cache.markdown,
                INTERNAL_RUNTIME_FILE_EXTRACTION_MARKDOWN_MAX_CHARS
              ),
        note: input.cache.note,
        provider: this.serializeJsonObject(input.cache.provider),
        quality: this.serializeJsonObject(input.cache.quality)
      }
    };
    const row = await this.prisma.assistantFile.update({
      where: { id: input.fileRef },
      data: {
        metadata
      }
    });
    return this.mapRow(row);
  }

  private buildAttachmentRelativePath(
    origin: AttachmentBackedOrigin,
    referenceId: string,
    filename: string | null,
    mimeType: string
  ): string {
    const basename = this.sanitizeAttachmentFilename(
      filename ?? this.deriveFilenameFromMime(referenceId, mimeType)
    );
    const prefix = origin === "uploaded_attachment" ? "uploads" : "artifacts";
    return `${prefix}/${referenceId}/${basename}`;
  }

  private asMetadataObject(metadata: unknown): Prisma.InputJsonObject {
    return metadata !== null && typeof metadata === "object" && !Array.isArray(metadata)
      ? (metadata as Prisma.InputJsonObject)
      : {};
  }

  private asMetadataRecord(metadata: unknown): Record<string, unknown> | null {
    return metadata !== null && typeof metadata === "object" && !Array.isArray(metadata)
      ? (metadata as Record<string, unknown>)
      : null;
  }

  private serializeJsonObject(value: Record<string, unknown>): Prisma.InputJsonObject {
    return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonObject;
  }

  private sanitizeAttachmentFilename(filename: string): string {
    const trimmed = filename.trim();
    const collapsed = trimmed.replace(/[\\/]+/g, "-");
    return collapsed.length > 0 ? collapsed : "file";
  }

  private deriveFilenameFromMime(referenceId: string, mimeType: string): string {
    if (mimeType === "application/pdf") {
      return `${referenceId}.pdf`;
    }
    if (mimeType.startsWith("image/")) {
      const subtype = mimeType.slice("image/".length).replace(/[^a-z0-9]+/gi, "");
      return `${referenceId}.${subtype || "img"}`;
    }
    if (mimeType.startsWith("audio/")) {
      const subtype = mimeType.slice("audio/".length).replace(/[^a-z0-9]+/gi, "");
      return `${referenceId}.${subtype || "audio"}`;
    }
    if (mimeType.startsWith("video/")) {
      const subtype = mimeType.slice("video/".length).replace(/[^a-z0-9]+/gi, "");
      return `${referenceId}.${subtype || "video"}`;
    }
    return `${referenceId}.bin`;
  }

  private buildDerivativeRelativePath(input: {
    parentFileRef: string;
    derivativeKind: "thumbnail" | "poster";
    filename: string | null;
    mimeType: string;
  }): string {
    const basename = this.sanitizeAttachmentFilename(
      input.filename ?? this.deriveFilenameFromMime(input.derivativeKind, input.mimeType)
    );
    return `system/derivatives/${input.parentFileRef}/${input.derivativeKind}/${basename}`;
  }

  private summarizeCleanupFromFiles(
    files: AssistantFileRegistryRecord[],
    now: Date = new Date()
  ): AssistantFileCleanupSummary {
    return files.reduce(
      (summary, file) =>
        file.cleanupEligible && file.cleanupEligibleAt !== null && file.cleanupEligibleAt <= now
          ? {
              eligibleCount: summary.eligibleCount + 1,
              eligibleBytes: summary.eligibleBytes + file.sizeBytes
            }
          : summary,
      { eligibleCount: 0, eligibleBytes: 0 }
    );
  }

  private classifyFile(input: {
    origin: SandboxFileOrigin;
    mimeType: string;
    displayName: string | null;
    relativePath: string;
    metadata: Record<string, unknown> | null;
  }): {
    fileBucket: AssistantFileBucket;
    cleanupEligible: boolean;
    cleanupReason: AssistantFileCleanupReason;
  } {
    if (this.isVoiceUploadCache(input)) {
      return {
        fileBucket: "cache_history",
        cleanupEligible: true,
        cleanupReason: "voice_upload_cache"
      };
    }
    if (input.origin === "runtime_output" || input.origin === "sandbox_output") {
      if (this.isDocumentMime(input.mimeType)) {
        return {
          fileBucket: "documents",
          cleanupEligible: false,
          cleanupReason: null
        };
      }
      return {
        fileBucket: "assistant_created",
        cleanupEligible: false,
        cleanupReason: null
      };
    }
    if (this.isMediaMime(input.mimeType)) {
      return {
        fileBucket: "media_uploads",
        cleanupEligible: false,
        cleanupReason: null
      };
    }
    return {
      fileBucket: "user_files",
      cleanupEligible: false,
      cleanupReason: null
    };
  }

  private isMediaMime(mimeType: string): boolean {
    return mimeType.startsWith("image/") || mimeType.startsWith("video/");
  }

  private isDocumentMime(mimeType: string): boolean {
    return (
      mimeType === "application/pdf" ||
      mimeType === "application/vnd.openxmlformats-officedocument.presentationml.presentation"
    );
  }

  private isVoiceUploadCache(input: {
    origin: SandboxFileOrigin;
    mimeType: string;
    displayName: string | null;
    relativePath: string;
    metadata: Record<string, unknown> | null;
  }): boolean {
    if (input.origin !== "uploaded_attachment" || !input.mimeType.startsWith("audio/")) {
      return false;
    }
    const source = input.metadata?.source;
    if (source !== "chat_upload" && source !== "web_staged_upload") {
      return false;
    }
    const normalizedMime = input.mimeType.toLowerCase();
    if (
      normalizedMime === "audio/webm" ||
      normalizedMime === "audio/ogg" ||
      normalizedMime === "audio/opus"
    ) {
      return true;
    }
    const name = (input.displayName ?? input.relativePath).toLowerCase();
    return /(^|[/\\-])voice[-_]/.test(name) || name.includes("voice-note");
  }

  private mapRow(row: {
    id: string;
    assistantId: string;
    workspaceId: string;
    origin: SandboxFileOrigin;
    objectKey: string;
    relativePath: string;
    displayName: string | null;
    mimeType: string;
    sizeBytes: bigint;
    logicalSizeBytes: bigint | null;
    sha256: string | null;
    metadata: Prisma.JsonValue | null;
    createdAt: Date;
  }): AssistantFileRegistryRecord {
    const metadata =
      row.metadata !== null && typeof row.metadata === "object" && !Array.isArray(row.metadata)
        ? (row.metadata as Record<string, unknown>)
        : null;
    const classification = this.classifyFile({
      origin: row.origin,
      mimeType: row.mimeType,
      displayName: row.displayName,
      relativePath: row.relativePath,
      metadata
    });
    const cleanupEligibleAt =
      classification.cleanupReason !== null
        ? new Date(row.createdAt.getTime() + CLEANUP_TTL_BY_REASON[classification.cleanupReason])
        : null;
    return {
      fileRef: row.id,
      assistantId: row.assistantId,
      workspaceId: row.workspaceId,
      origin: row.origin,
      objectKey: row.objectKey,
      relativePath: row.relativePath,
      displayName: row.displayName,
      mimeType: row.mimeType,
      sizeBytes: Number(row.sizeBytes),
      logicalSizeBytes: row.logicalSizeBytes === null ? null : Number(row.logicalSizeBytes),
      sha256: row.sha256,
      metadata,
      ...classification,
      cleanupEligibleAt,
      documentLink: null,
      createdAt: row.createdAt
    };
  }

  private readSystemVariantMetadata(metadata: unknown): AssistantFileSystemVariantMetadata | null {
    const row = this.asMetadataRecord(metadata);
    if (
      row?.schema !== ASSISTANT_FILE_SYSTEM_VARIANT_SCHEMA ||
      row.role !== "media_derivative" ||
      typeof row.parentFileRef !== "string" ||
      (row.derivativeKind !== "thumbnail" && row.derivativeKind !== "poster")
    ) {
      return null;
    }
    return {
      schema: ASSISTANT_FILE_SYSTEM_VARIANT_SCHEMA,
      role: "media_derivative",
      parentFileRef: row.parentFileRef,
      derivativeKind: row.derivativeKind
    };
  }

  private isHiddenSystemVariant(metadata: unknown): boolean {
    return this.readSystemVariantMetadata(metadata) !== null;
  }

  private withPendingMediaDerivativesIfNeeded(input: {
    metadata: Record<string, unknown> | null | undefined;
    mimeType: string;
  }): Record<string, unknown> {
    const current = readAssistantFileMediaDerivatives(input.metadata);
    if (!input.mimeType.startsWith("image/") && !input.mimeType.startsWith("video/")) {
      return { ...(input.metadata ?? {}) };
    }
    if (current?.status === "ready") {
      return { ...(input.metadata ?? {}) };
    }
    const next: AssistantFileMediaDerivativesMetadata = {
      schemaVersion: ASSISTANT_FILE_MEDIA_DERIVATIVES_SCHEMA,
      status: "pending",
      thumbnail: current?.thumbnail ?? null,
      poster: current?.poster ?? null,
      lastError: current?.lastError ?? null,
      updatedAt: new Date().toISOString()
    };
    return (
      withAssistantFileMediaDerivatives({
        metadata: input.metadata,
        derivatives: next
      }) ?? {}
    );
  }

  private async listMediaDerivativeFiles(input: {
    assistantId: string;
    workspaceId: string;
    parentFileRef: string;
  }): Promise<AssistantFileRegistryRecord[]> {
    const rows = await this.prisma.assistantFile.findMany({
      where: {
        assistantId: input.assistantId,
        workspaceId: input.workspaceId
      }
    });
    return rows
      .filter(
        (row) => this.readSystemVariantMetadata(row.metadata)?.parentFileRef === input.parentFileRef
      )
      .map((row) => this.mapRow(row));
  }

  private truncateExtractionCacheValue(value: string, maxChars: number): string {
    const normalized = value.replace(/\s+/g, " ").trim();
    if (normalized.length <= maxChars) {
      return normalized;
    }
    return `${normalized.slice(0, maxChars - 3).trim()}...`;
  }

  private async attachDocumentLinks(
    files: AssistantFileRegistryRecord[]
  ): Promise<AssistantFileRegistryRecord[]> {
    const fileRefs = files.map((file) => file.fileRef);
    if (fileRefs.length === 0) {
      return files;
    }
    const links = await this.prisma.assistantDocumentDeliveredFile.findMany({
      where: {
        assistantFileId: { in: fileRefs }
      },
      orderBy: [{ deliveredAt: "desc" }, { id: "desc" }],
      select: {
        assistantFileId: true,
        docId: true,
        versionId: true,
        isCurrentOutput: true,
        document: {
          select: {
            documentType: true,
            status: true
          }
        },
        version: {
          select: {
            versionNumber: true,
            descriptorMode: true,
            status: true
          }
        }
      }
    });
    const byFileRef = new Map<string, AssistantFileDocumentLink>();
    for (const link of links) {
      if (byFileRef.has(link.assistantFileId)) {
        continue;
      }
      byFileRef.set(link.assistantFileId, {
        docId: link.docId,
        versionId: link.versionId,
        versionNumber: link.version.versionNumber,
        descriptorMode: link.version.descriptorMode,
        documentType: link.document.documentType,
        documentStatus: link.document.status,
        versionStatus: link.version.status,
        isCurrentOutput: link.isCurrentOutput
      });
    }
    return files.map((file) => ({
      ...file,
      documentLink: byFileRef.get(file.fileRef) ?? null
    }));
  }
}

function isKnowledgeProcessingProviderTrace(
  value: unknown
): value is KnowledgeProcessingProviderTrace {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const row = value as Record<string, unknown>;
  return (
    typeof row.providerKey === "string" &&
    typeof row.processorMode === "string" &&
    Array.isArray(row.attemptedProviderKeys)
  );
}

function isKnowledgeExtractionQuality(value: unknown): value is KnowledgeExtractionQuality {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const row = value as Record<string, unknown>;
  return (
    typeof row.status === "string" &&
    (typeof row.score === "number" || row.score === null) &&
    Array.isArray(row.reasonCodes) &&
    typeof row.textChars === "number"
  );
}
