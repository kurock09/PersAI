import { Injectable } from "@nestjs/common";
import type {
  PersaiSandboxFileOrigin,
  RuntimeFileRef,
  RuntimeFilesToolItem
} from "@persai/runtime-contract";
import { RuntimeStatePrismaService } from "../runtime-state/infrastructure/persistence/runtime-state-prisma.service";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
  constructor(private readonly prisma: RuntimeStatePrismaService) {}

  async findByFileRef(input: {
    assistantId: string;
    workspaceId: string;
    fileRef: string;
  }): Promise<RuntimeAssistantFileRecord | null> {
    const canonical = await this.prisma.assistantFile.findFirst({
      where: {
        id: input.fileRef,
        assistantId: input.assistantId,
        workspaceId: input.workspaceId
      }
    });
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
    const canonicalRows = await this.prisma.assistantFile.findMany({
      where: {
        id: { in: requestedRefs },
        assistantId: input.assistantId,
        workspaceId: input.workspaceId
      }
    });
    const canonicalById = new Map(canonicalRows.map((row) => [row.id, this.mapRow(row)] as const));
    return requestedRefs.flatMap((fileRef) => {
      const record = canonicalById.get(fileRef);
      return record === undefined ? [] : [record];
    });
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
        sha256: null,
        metadata
      }
    });
    return this.mapRow(row);
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
        ...(UUID_PATTERN.test(query) ? [{ id: query }] : []),
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
        },
        {
          objectKey: {
            contains: query,
            mode: "insensitive" as const
          }
        }
      ]
    };
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
