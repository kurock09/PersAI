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

// ADR-127 W1 — manifest-as-index reader for model-facing `files.list` over
// `/shared/...`. Returns one-level-deep entries derived from the
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
    this.assertSharedPrefix(input.pathPrefix);
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

  private assertSharedPrefix(pathPrefix: string): void {
    if (!pathPrefix.startsWith("/shared/") && pathPrefix !== "/shared") {
      throw new BadRequestException(
        'pathPrefix must start with "/shared/" (the manifest is only authoritative for shared paths).'
      );
    }
    if (pathPrefix.includes("..")) {
      throw new BadRequestException('pathPrefix must not contain "..".');
    }
  }

  private normalizeDirectoryPrefix(pathPrefix: string): string {
    return pathPrefix.replace(/\/+$/, "") || "/shared";
  }

  private classifyRole(path: string, assistantHandle: string): RuntimeFilesToolItem["role"] {
    if (path.startsWith("/workspace/") || path === "/workspace") {
      return "workspace";
    }
    if (path === "/shared/input" || path.startsWith("/shared/input/")) {
      return "shared_input";
    }
    if (path === "/shared/outbound" || path.startsWith("/shared/outbound/")) {
      const tail = path.slice("/shared/outbound/".length);
      const handle = tail.split("/", 1)[0] ?? "";
      if (handle.length > 0 && handle === assistantHandle) {
        return "shared_outbound_self";
      }
      return "shared_outbound_other";
    }
    return "shared_input";
  }

  private requiredString(value: unknown, field: string): string {
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new BadRequestException(`Field "${field}" must be a non-empty string.`);
    }
    return value.trim();
  }
}
