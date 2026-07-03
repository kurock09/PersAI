import { BadRequestException, Injectable } from "@nestjs/common";
import type { RuntimeFilesToolItem } from "@persai/runtime-contract";
import { WorkspaceFileMetadataService } from "./workspace-file-metadata.service";
import { normalizeActiveWorkspaceDirectoryPath } from "./workspace-visible-paths";

export type ListWorkspaceFilesFromManifestInput = {
  workspaceId: string;
  pathPrefix: string;
  assistantHandle: string;
  scope: "chat" | "assistant" | "workspace";
  currentChatId: string | null;
  currentAssistantId: string;
};

export type ListWorkspaceFilesFromManifestOutcome = {
  items: RuntimeFilesToolItem[];
};

// ADR-133 Slice 3 — manifest-as-index reader over the active hierarchical
// `/workspace/...` namespace. Directories are synthesised from manifest path
// components (no FS access).
@Injectable()
export class ListWorkspaceFilesFromManifestService {
  // Listings cap. The manifest is the authoritative index and a single
  // workspace can hold many files; we still cap the underlying fetch
  // generously and rely on the derivation step to collapse subtree rows
  // into one entry per immediate child.
  private static readonly MAX_MANIFEST_ROWS_PER_LIST = 1_000;

  constructor(private readonly workspaceFileMetadataService: WorkspaceFileMetadataService) {}

  parseInput(value: unknown): ListWorkspaceFilesFromManifestInput {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      throw new BadRequestException("Request body must be an object.");
    }
    const row = value as Record<string, unknown>;
    return {
      workspaceId: this.requiredString(row.workspaceId, "workspaceId"),
      pathPrefix: this.requiredString(row.pathPrefix, "pathPrefix"),
      assistantHandle: this.requiredString(row.assistantHandle, "assistantHandle"),
      scope: this.readScope(row.scope),
      currentChatId: this.readNullableString(row.currentChatId),
      currentAssistantId: this.requiredString(row.currentAssistantId, "currentAssistantId")
    };
  }

  async execute(
    input: ListWorkspaceFilesFromManifestInput
  ): Promise<ListWorkspaceFilesFromManifestOutcome> {
    this.assertWorkspacePrefix(input.pathPrefix);
    const normalizedPrefix = this.normalizeDirectoryPrefix(input.pathPrefix);
    const searchPrefix = `${normalizedPrefix}/`;

    const rows = await this.workspaceFileMetadataService.list({
      workspaceId: input.workspaceId,
      pathPrefix: searchPrefix,
      ...this.resolveScopeFilters(input),
      limit: ListWorkspaceFilesFromManifestService.MAX_MANIFEST_ROWS_PER_LIST
    });

    type ChildEntry = {
      type: "file" | "directory";
      filePath: string;
      mimeType: string | null;
      sizeBytes: number;
      modifiedAt: string | null;
      shortDescription: string | null;
    };
    const byChildName = new Map<string, ChildEntry>();

    for (const row of rows) {
      const rest = row.path.slice(searchPrefix.length);
      if (rest.length === 0) {
        continue;
      }
      const slashIdx = rest.indexOf("/");
      if (slashIdx === -1) {
        byChildName.set(rest, {
          type: "file",
          filePath: row.path,
          mimeType: row.mimeType,
          sizeBytes: Number(row.sizeBytes),
          modifiedAt: row.updatedAt.toISOString(),
          shortDescription: row.shortDescription
        });
        continue;
      }
      const dirName = rest.slice(0, slashIdx);
      if (byChildName.get(dirName)?.type === "directory") {
        continue;
      }
      // Directory entries always win over a leaf entry at the same name;
      // a child with deeper descendants must be reported as a directory
      // even if a file at the exact path also exists.
      byChildName.set(dirName, {
        type: "directory",
        filePath: `${normalizedPrefix}/${dirName}`,
        mimeType: null,
        sizeBytes: 0,
        modifiedAt: null,
        shortDescription: null
      });
    }

    const items: RuntimeFilesToolItem[] = [];
    for (const [, entry] of byChildName) {
      items.push({
        path: entry.filePath,
        type: entry.type,
        sizeBytes: entry.sizeBytes,
        mimeType: entry.mimeType,
        modifiedAt: entry.modifiedAt,
        shortDescription: entry.shortDescription
      });
    }

    items.sort((left, right) => {
      if (left.type !== right.type) {
        return left.type === "directory" ? -1 : 1;
      }
      return left.path.localeCompare(right.path);
    });

    return { items };
  }

  private assertWorkspacePrefix(pathPrefix: string): void {
    if (normalizeActiveWorkspaceDirectoryPath(pathPrefix) === null) {
      throw new BadRequestException(
        'pathPrefix must be an active hierarchical "/workspace/..." directory.'
      );
    }
  }

  private normalizeDirectoryPrefix(pathPrefix: string): string {
    return pathPrefix.replace(/\/+$/, "") || "/workspace";
  }

  private resolveScopeFilters(input: ListWorkspaceFilesFromManifestInput): {
    originChatId?: string;
    originAssistantId?: string;
  } {
    if (input.scope === "chat") {
      return input.currentChatId === null
        ? { originChatId: "__persai_no_chat_scope__" }
        : { originChatId: input.currentChatId };
    }
    if (input.scope === "assistant") {
      return { originAssistantId: input.currentAssistantId };
    }
    return {};
  }

  private readScope(value: unknown): ListWorkspaceFilesFromManifestInput["scope"] {
    if (value === "assistant" || value === "workspace") {
      return value;
    }
    return "chat";
  }

  private readNullableString(value: unknown): string | null {
    if (typeof value !== "string") {
      return null;
    }
    const trimmed = value.trim();
    return trimmed.length === 0 ? null : trimmed;
  }

  private requiredString(value: unknown, field: string): string {
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new BadRequestException(`Field "${field}" must be a non-empty string.`);
    }
    return value.trim();
  }
}
