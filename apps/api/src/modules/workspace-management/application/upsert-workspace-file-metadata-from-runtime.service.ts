import { BadRequestException, Injectable } from "@nestjs/common";
import { WorkspaceFileMetadataService } from "./workspace-file-metadata.service";

export type UpsertWorkspaceFileMetadataFromRuntimeInput = {
  workspaceId: string;
  path: string;
  mimeType: string;
  sizeBytes: number;
  shortDescription: string | null;
};

// ADR-128 Slice 2 — runtime-driven manifest writes after a successful sandbox
// `files.write` on a persisted `/workspace/input/...` or `/workspace/outbound/...`
// path. The API owns the upsert so the sandbox does not need DB access.
// Scratch paths elsewhere under `/workspace/...` stay pod-only by design.
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
        'path must start with "/workspace/input/" or "/workspace/outbound/" — only persisted workspace files are tracked in the manifest.'
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
    return {
      workspaceId: this.requiredString(row.workspaceId, "workspaceId"),
      path,
      mimeType,
      sizeBytes: Math.floor(sizeBytes),
      shortDescription
    };
  }

  async execute(input: UpsertWorkspaceFileMetadataFromRuntimeInput): Promise<void> {
    await this.workspaceFileMetadataService.upsert({
      workspaceId: input.workspaceId,
      path: input.path,
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
      ...(input.shortDescription !== null ? { shortDescription: input.shortDescription } : {})
    });
  }

  private requiredString(value: unknown, field: string): string {
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new BadRequestException(`Field "${field}" must be a non-empty string.`);
    }
    return value.trim();
  }

  private isPersistedWorkspacePath(path: string): boolean {
    return path.startsWith("/workspace/input/") || path.startsWith("/workspace/outbound/");
  }
}
