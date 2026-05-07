import { createHash } from "node:crypto";
import { Injectable } from "@nestjs/common";
import type {
  PersaiSandboxFileOrigin,
  RuntimeFileRef,
  RuntimeFilesToolItem
} from "@persai/runtime-contract";
import { RuntimeStatePrismaService } from "../runtime-state/infrastructure/persistence/runtime-state-prisma.service";
import { PersaiMediaObjectStorageService } from "./persai-media-object-storage.service";

export type RuntimeAssistantFileRecord = {
  fileRef: string;
  assistantId: string;
  workspaceId: string;
  sandboxJobId: string | null;
  origin: PersaiSandboxFileOrigin;
  sourceToolCode: string | null;
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

export type RuntimeAssistantDirectoryListing = {
  files: RuntimeAssistantFileRecord[];
  directories: string[];
  totalFiles: number;
  truncated: boolean;
};

type AttachmentBackedOrigin = Extract<
  PersaiSandboxFileOrigin,
  "uploaded_attachment" | "runtime_output"
>;
type RegistryRow = {
  id: string;
  assistantId: string;
  workspaceId: string;
  sandboxJobId: string | null;
  origin: PersaiSandboxFileOrigin;
  sourceToolCode: string | null;
  objectKey: string;
  relativePath: string;
  displayName: string | null;
  mimeType: string;
  sizeBytes: bigint;
  logicalSizeBytes: bigint | null;
  sha256: string | null;
  metadata: unknown;
  createdAt: Date;
};

@Injectable()
export class RuntimeAssistantFileRegistryService {
  constructor(
    private readonly prisma: RuntimeStatePrismaService,
    private readonly mediaObjectStorage: PersaiMediaObjectStorageService
  ) {}

  async findByFileRef(input: {
    assistantId: string;
    workspaceId: string;
    fileRef: string;
  }): Promise<RuntimeAssistantFileRecord | null> {
    let canonical: RegistryRow | null;
    try {
      canonical = await this.prisma.assistantFile.findFirst({
        where: {
          id: input.fileRef,
          assistantId: input.assistantId,
          workspaceId: input.workspaceId
        }
      });
    } catch (error) {
      if (this.isInvalidAssistantFileIdError(error)) {
        return null;
      }
      throw error;
    }
    return canonical === null ? null : this.mapRow(canonical);
  }

  async findLatestByPath(input: {
    assistantId: string;
    workspaceId: string;
    relativePath: string;
  }): Promise<RuntimeAssistantFileRecord | null> {
    const canonical = await this.prisma.assistantFile.findFirst({
      where: {
        assistantId: input.assistantId,
        workspaceId: input.workspaceId,
        relativePath: input.relativePath
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }]
    });
    return canonical === null ? null : this.mapRow(canonical);
  }

  async listByFileRefs(input: {
    assistantId: string;
    workspaceId: string;
    fileRefs: string[];
  }): Promise<RuntimeAssistantFileRecord[]> {
    if (input.fileRefs.length === 0) {
      return [];
    }
    const requestedRefs = [...new Set(input.fileRefs)];
    let canonicalRows: RegistryRow[];
    try {
      canonicalRows = await this.prisma.assistantFile.findMany({
        where: {
          id: { in: requestedRefs },
          assistantId: input.assistantId,
          workspaceId: input.workspaceId
        }
      });
    } catch (error) {
      if (this.isInvalidAssistantFileIdError(error)) {
        throw new Error(
          "One or more fileRefs are invalid. Use the canonical fileRef returned by files results, not a path or relativePath."
        );
      }
      throw error;
    }
    const canonicalById = new Map(canonicalRows.map((row) => [row.id, this.mapRow(row)] as const));
    return requestedRefs.flatMap((fileRef) => {
      const record = canonicalById.get(fileRef);
      return record === undefined ? [] : [record];
    });
  }

  async listDirectory(input: {
    assistantId: string;
    workspaceId: string;
    directoryPath: string | null;
    recursive: boolean;
    limit: number;
  }): Promise<RuntimeAssistantDirectoryListing> {
    const normalizedDirectoryPath = this.normalizeDirectoryPath(input.directoryPath);
    const canonicalRows = await this.prisma.assistantFile.findMany({
      where: {
        assistantId: input.assistantId,
        workspaceId: input.workspaceId
      },
      orderBy: [{ relativePath: "asc" }, { createdAt: "desc" }, { id: "desc" }]
    });

    const files: RuntimeAssistantFileRecord[] = [];
    const directories = new Set<string>();
    const seenRelativePaths = new Set<string>();
    let totalFiles = 0;

    for (const row of canonicalRows) {
      if (seenRelativePaths.has(row.relativePath)) {
        continue;
      }
      seenRelativePaths.add(row.relativePath);
      const placement = this.resolveDirectoryPlacement(row.relativePath, normalizedDirectoryPath);
      if (placement === null) {
        continue;
      }
      if (placement.immediateChildDirectory !== null) {
        directories.add(placement.immediateChildDirectory);
      }
      if (!input.recursive && !placement.isDirectFile) {
        continue;
      }
      totalFiles += 1;
      if (files.length < input.limit) {
        files.push(this.mapRow(row));
      }
    }

    return {
      files,
      directories: [...directories].sort((left, right) => left.localeCompare(right)),
      totalFiles,
      truncated: totalFiles > files.length
    };
  }

  async search(input: {
    assistantId: string;
    workspaceId: string;
    query: string;
    limit: number;
  }): Promise<RuntimeAssistantFileRecord[]> {
    const normalizedQuery = input.query.trim();
    const where = this.buildSearchWhere(input.assistantId, input.workspaceId, normalizedQuery);
    const canonicalRows = await this.prisma.assistantFile.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: input.limit
    });
    return canonicalRows.map((row) => this.mapRow(row));
  }

  async ensureAttachmentBackedFile(input: {
    assistantId: string;
    workspaceId: string;
    origin: AttachmentBackedOrigin;
    referenceId: string;
    objectKey: string;
    filename: string | null;
    mimeType: string;
    sizeBytes: number;
  }): Promise<RuntimeAssistantFileRecord> {
    const relativePath = this.buildAttachmentRelativePath(
      input.origin,
      input.referenceId,
      input.filename,
      input.mimeType
    );
    const sha256 = await this.computeObjectSha256(input.objectKey);
    const metadata = {
      attachmentId: input.referenceId
    };
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
        sizeBytes: BigInt(input.sizeBytes),
        logicalSizeBytes: BigInt(input.sizeBytes),
        ...(sha256 === null ? {} : { sha256 }),
        metadata
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
        sizeBytes: BigInt(input.sizeBytes),
        logicalSizeBytes: BigInt(input.sizeBytes),
        sha256,
        metadata
      }
    });
    return this.mapRow(row);
  }

  private async computeObjectSha256(objectKey: string): Promise<string | null> {
    const buffer = await this.mediaObjectStorage.downloadObject(objectKey);
    return buffer === null ? null : createHash("sha256").update(buffer).digest("hex");
  }

  toRuntimeFileRef(record: RuntimeAssistantFileRecord): RuntimeFileRef {
    return {
      fileRef: record.fileRef,
      origin: record.origin,
      sourceToolCode: record.sourceToolCode,
      objectKey: record.objectKey,
      relativePath: record.relativePath,
      displayName: record.displayName,
      mimeType: record.mimeType,
      sizeBytes: record.sizeBytes,
      logicalSizeBytes: record.logicalSizeBytes
    };
  }

  toRuntimeFilesToolItem(record: RuntimeAssistantFileRecord): RuntimeFilesToolItem {
    return {
      fileRef: record.fileRef,
      origin: record.origin,
      sourceToolCode: record.sourceToolCode,
      relativePath: record.relativePath,
      displayName: record.displayName,
      mimeType: record.mimeType,
      sizeBytes: record.sizeBytes,
      logicalSizeBytes: record.logicalSizeBytes
    };
  }

  private buildSearchWhere(assistantId: string, workspaceId: string, query: string) {
    return {
      assistantId,
      workspaceId,
      OR: [
        {
          displayName: {
            contains: query,
            mode: "insensitive" as const
          }
        },
        {
          relativePath: {
            contains: query,
            mode: "insensitive" as const
          }
        }
      ]
    };
  }

  private normalizeDirectoryPath(value: string | null): string {
    if (value === null) {
      return "";
    }
    const normalized = value
      .trim()
      .replace(/\\/g, "/")
      .replace(/^\/+|\/+$/g, "");
    return normalized === "." ? "" : normalized;
  }

  private resolveDirectoryPlacement(
    relativePath: string,
    directoryPath: string
  ): { isDirectFile: boolean; immediateChildDirectory: string | null } | null {
    if (directoryPath.length === 0) {
      const segments = relativePath.split("/").filter((segment) => segment.length > 0);
      if (segments.length === 0) {
        return null;
      }
      return {
        isDirectFile: segments.length === 1,
        immediateChildDirectory: segments.length > 1 ? segments[0]! : null
      };
    }

    const prefix = `${directoryPath}/`;
    if (!relativePath.startsWith(prefix)) {
      return null;
    }
    const remainder = relativePath.slice(prefix.length);
    if (remainder.length === 0) {
      return null;
    }
    const segments = remainder.split("/").filter((segment) => segment.length > 0);
    if (segments.length === 0) {
      return null;
    }
    return {
      isDirectFile: segments.length === 1,
      immediateChildDirectory: segments.length > 1 ? segments[0]! : null
    };
  }

  private isInvalidAssistantFileIdError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    return (
      message.includes("Error creating UUID") ||
      message.includes("invalid character") ||
      message.includes("Inconsistent column data")
    );
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

  private mapRow(row: RegistryRow): RuntimeAssistantFileRecord {
    return {
      fileRef: row.id,
      assistantId: row.assistantId,
      workspaceId: row.workspaceId,
      sandboxJobId: row.sandboxJobId,
      origin: row.origin,
      sourceToolCode: row.sourceToolCode,
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
