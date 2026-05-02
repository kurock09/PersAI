import { createHash } from "node:crypto";
import { Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, type SandboxFileOrigin } from "@prisma/client";
import { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";
import { PersaiMediaObjectStorageService } from "./media/persai-media-object-storage.service";

type AttachmentBackedOrigin = Extract<SandboxFileOrigin, "uploaded_attachment" | "runtime_output">;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
  createdAt: Date;
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
    await this.prisma.assistantFile.delete({
      where: { id: input.fileRef }
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
      metadata:
        row.metadata !== null && typeof row.metadata === "object" && !Array.isArray(row.metadata)
          ? (row.metadata as Record<string, unknown>)
          : null,
      createdAt: row.createdAt
    };
  }
}
