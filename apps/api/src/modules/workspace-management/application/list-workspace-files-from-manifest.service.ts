import { BadRequestException, Injectable } from "@nestjs/common";
import type { RuntimeFilesToolItem } from "@persai/runtime-contract";
import { WorkspaceFileMetadataService } from "./workspace-file-metadata.service";

export type ListWorkspaceFilesFromManifestInput = {
  workspaceId: string;
  pathPrefix: string;
  assistantHandle: string;
};

export type ListWorkspaceFilesFromManifestOutcome = {
  items: RuntimeFilesToolItem[];
};

// ADR-128 Slice 2 — manifest-as-index reader for model-facing `files.list` over
// persisted `/workspace/input/...` and `/workspace/outbound/...` paths. Returns one-level-deep entries derived from the
// `workspace_file_metadata` rows whose path falls under `pathPrefix`.
// Directories are synthesised from path components (no FS access).
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
      assistantHandle: this.requiredString(row.assistantHandle, "assistantHandle")
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
        role: this.classifyRole(entry.filePath, input.assistantHandle),
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
    if (!this.isPersistedWorkspacePrefix(pathPrefix)) {
      throw new BadRequestException(
        'pathPrefix must start with "/workspace/input" or "/workspace/outbound" (the manifest is authoritative for input/outbound workspace paths).'
      );
    }
    if (pathPrefix.includes("..")) {
      throw new BadRequestException('pathPrefix must not contain "..".');
    }
  }

  private normalizeDirectoryPrefix(pathPrefix: string): string {
    return pathPrefix.replace(/\/+$/, "") || "/workspace";
  }

  private isPersistedWorkspacePrefix(pathPrefix: string): boolean {
    return (
      pathPrefix === "/workspace/input" ||
      pathPrefix.startsWith("/workspace/input/") ||
      pathPrefix === "/workspace/outbound" ||
      pathPrefix.startsWith("/workspace/outbound/")
    );
  }

  private classifyRole(path: string, assistantHandle: string): RuntimeFilesToolItem["role"] {
    if (path === "/workspace/input" || path.startsWith("/workspace/input/")) {
      return "workspace_input";
    }
    if (path === "/workspace/outbound" || path.startsWith("/workspace/outbound/")) {
      const tail = path.slice("/workspace/outbound/".length);
      const handle = tail.split("/", 1)[0] ?? "";
      if (handle === "self" || (handle.length > 0 && handle === assistantHandle)) {
        return "workspace_outbound_self";
      }
      return "workspace_outbound_other";
    }
    return "workspace_scratch";
  }

  private requiredString(value: unknown, field: string): string {
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new BadRequestException(`Field "${field}" must be a non-empty string.`);
    }
    return value.trim();
  }
}
