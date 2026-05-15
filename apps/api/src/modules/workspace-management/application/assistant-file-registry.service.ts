import { createHash } from "node:crypto";
import { Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, type SandboxFileOrigin } from "@prisma/client";
import { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";
import { PersaiMediaObjectStorageService } from "./media/persai-media-object-storage.service";

type AttachmentBackedOrigin = Extract<SandboxFileOrigin, "uploaded_attachment" | "runtime_output">;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type AssistantFileBucket =
  | "user_files"
  | "assistant_created"
  | "documents"
  | "media_uploads"
  | "cache_history";

export type AssistantFileCleanupReason = "voice_upload_cache" | null;

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
  createdAt: Date;
};

export type AssistantFileCleanupSummary = {
  eligibleCount: number;
  eligibleBytes: number;
};

export type AssistantFileCleanupResult = AssistantFileCleanupSummary & {
  deletedCount: number;
  deletedBytes: number;
};

@Injectable()
export class AssistantFileRegistryService {
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
    return rows.map((row) => this.mapRow(row));
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
    return row === null ? null : this.mapRow(row);
  }

  async downloadAssistantFile(input: {
    assistantId: string;
    workspaceId: string;
    fileRef: string;
  }): Promise<{ file: AssistantFileRegistryRecord; buffer: Buffer; contentType: string }> {
    const file = await this.findAssistantFile(input);
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
    const deletedAt = new Date().toISOString();
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
      this.prisma.assistantFile.delete({
        where: { id: input.fileRef }
      })
    ]);
  }

  async cleanupAssistantFileCache(input: {
    assistantId: string;
    workspaceId: string;
  }): Promise<AssistantFileCleanupResult> {
    const files = await this.listAssistantFiles({
      assistantId: input.assistantId,
      workspaceId: input.workspaceId,
      limit: 1000
    });
    const eligible = this.summarizeCleanupFromFiles(files);
    let deletedCount = 0;
    let deletedBytes = 0;

    for (const file of files.filter((candidate) => candidate.cleanupEligible)) {
      await this.deleteAssistantFile({
        assistantId: input.assistantId,
        workspaceId: input.workspaceId,
        fileRef: file.fileRef
      });
      await this.mediaObjectStorage.deleteObject(file.objectKey).catch(() => {});
      deletedCount += 1;
      deletedBytes += file.sizeBytes;
    }

    return {
      ...eligible,
      deletedCount,
      deletedBytes
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
      sourceChatId: input.sourceChatId
    };
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
        metadata: metadata as Prisma.InputJsonValue
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
        metadata: metadata as Prisma.InputJsonValue
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

  private asMetadataObject(metadata: Prisma.JsonValue | null): Prisma.InputJsonObject {
    return metadata !== null && typeof metadata === "object" && !Array.isArray(metadata)
      ? (metadata as Prisma.InputJsonObject)
      : {};
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

  private summarizeCleanupFromFiles(
    files: AssistantFileRegistryRecord[]
  ): AssistantFileCleanupSummary {
    return files.reduce(
      (summary, file) =>
        file.cleanupEligible
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
      createdAt: row.createdAt
    };
  }
}
