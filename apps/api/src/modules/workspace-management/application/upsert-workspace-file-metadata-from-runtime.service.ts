import { BadRequestException, Injectable } from "@nestjs/common";
import { WorkspaceFileMetadataService } from "./workspace-file-metadata.service";

export type UpsertWorkspaceFileMetadataFromRuntimeInput = {
  workspaceId: string;
  path: string;
  mimeType: string;
  sizeBytes: number;
  shortDescription: string | null;
  originChatId: string | null;
  originAssistantId: string | null;
};

// ADR-128 Slice 4 — runtime-driven manifest writes after a successful sandbox
// `files.write` on any `/workspace/...` path. The flat workspace has no role
// carve-out, so every successful write feeds the manifest. The api owns the
// upsert so the sandbox does not need DB access.
@Injectable()
export class UpsertWorkspaceFileMetadataFromRuntimeService {
  constructor(private readonly workspaceFileMetadataService: WorkspaceFileMetadataService) {}

  parseInput(body: unknown): UpsertWorkspaceFileMetadataFromRuntimeInput {
    if (body === null || typeof body !== "object" || Array.isArray(body)) {
      throw new BadRequestException("Request body must be an object.");
    }
    const row = body as Record<string, unknown>;
    const path = this.requiredString(row.path, "path");
    if (!this.isPersistedWorkspacePath(path)) {
      throw new BadRequestException(
        'path must start with "/workspace/" — only files inside the workspace mount are tracked in the manifest.'
      );
    }
    if (path.includes("..")) {
      throw new BadRequestException('path must not contain "..".');
    }
    const mimeType = this.requiredString(row.mimeType, "mimeType");
    const sizeBytes = row.sizeBytes;
    if (typeof sizeBytes !== "number" || !Number.isFinite(sizeBytes) || sizeBytes < 0) {
      throw new BadRequestException('Field "sizeBytes" must be a non-negative number.');
    }
    const shortDescriptionRaw = row.shortDescription;
    const shortDescription =
      typeof shortDescriptionRaw === "string" && shortDescriptionRaw.length > 0
        ? shortDescriptionRaw
        : null;
    const originChatId = this.optionalUuid(row.originChatId, "originChatId");
    const originAssistantId = this.optionalUuid(row.originAssistantId, "originAssistantId");
    return {
      workspaceId: this.requiredString(row.workspaceId, "workspaceId"),
      path,
      mimeType,
      sizeBytes: Math.floor(sizeBytes),
      shortDescription,
      originChatId,
      originAssistantId
    };
  }

  async execute(input: UpsertWorkspaceFileMetadataFromRuntimeInput): Promise<void> {
    await this.workspaceFileMetadataService.upsert({
      workspaceId: input.workspaceId,
      path: input.path,
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
      ...(input.shortDescription !== null ? { shortDescription: input.shortDescription } : {}),
      ...(input.originChatId !== null ? { originChatId: input.originChatId } : {}),
      ...(input.originAssistantId !== null ? { originAssistantId: input.originAssistantId } : {})
    });
  }

  private optionalUuid(value: unknown, field: string): string | null {
    if (value === undefined || value === null) {
      return null;
    }
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new BadRequestException(`Field "${field}" must be a UUID string when provided.`);
    }
    return value.trim();
  }

  private requiredString(value: unknown, field: string): string {
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new BadRequestException(`Field "${field}" must be a non-empty string.`);
    }
    return value.trim();
  }

  private isPersistedWorkspacePath(path: string): boolean {
    return path.startsWith("/workspace/");
  }
}
