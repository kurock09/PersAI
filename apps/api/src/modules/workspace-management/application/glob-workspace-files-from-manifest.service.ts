import { BadRequestException, Injectable } from "@nestjs/common";
import { WorkspaceFileMetadataService } from "./workspace-file-metadata.service";
import { matchesWorkspaceGlob } from "./workspace-path-glob";
import { resolveWorkspaceStorageSearchScope } from "./resolve-workspace-storage-search-scope";

export type GlobWorkspaceFilesFromManifestInput = {
  workspaceId: string;
  assistantId: string;
  sessionId: string;
  pattern: string;
  path?: string | null;
};

export type GlobWorkspaceFilesFromManifestOutcome = {
  paths: string[];
  truncated: boolean;
  reason: string | null;
  warning: string | null;
};

const MAX_GLOB_PATHS = 500;

@Injectable()
export class GlobWorkspaceFilesFromManifestService {
  constructor(private readonly workspaceFileMetadataService: WorkspaceFileMetadataService) {}

  parseInput(value: unknown): GlobWorkspaceFilesFromManifestInput {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      throw new BadRequestException("Request body must be an object.");
    }
    const row = value as Record<string, unknown>;
    const path = this.readNullableString(row.path);
    return {
      workspaceId: this.requiredString(row.workspaceId, "workspaceId"),
      assistantId: this.requiredString(row.assistantId, "assistantId"),
      sessionId: this.requiredString(row.sessionId, "sessionId"),
      pattern: this.requiredString(row.pattern, "pattern"),
      ...(path === null ? {} : { path })
    };
  }

  async execute(
    input: GlobWorkspaceFilesFromManifestInput
  ): Promise<GlobWorkspaceFilesFromManifestOutcome> {
    const resolved = resolveWorkspaceStorageSearchScope({
      path: input.path ?? null,
      assistantId: input.assistantId,
      sessionId: input.sessionId
    });
    if (resolved.kind === "error") {
      return {
        paths: [],
        truncated: false,
        reason: resolved.reason,
        warning: resolved.warning
      };
    }
    const scope = resolved.scope;
    const rows =
      scope.singleFilePath === null
        ? await this.workspaceFileMetadataService.list({
            workspaceId: input.workspaceId,
            pathPrefix: scope.listPathPrefix,
            originAssistantId: input.assistantId,
            limit: MAX_GLOB_PATHS + 1
          })
        : await this.workspaceFileMetadataService
            .get({
              workspaceId: input.workspaceId,
              path: scope.singleFilePath
            })
            .then((row) => (row === null ? [] : [row]));
    const paths = rows
      .map((row) => row.path)
      .filter((path) =>
        matchesWorkspaceGlob({
          filePath: path,
          searchRoot: scope.searchRoot,
          pattern: input.pattern
        })
      )
      .sort((left, right) => left.localeCompare(right));
    const truncated = paths.length > MAX_GLOB_PATHS;
    return {
      paths: paths.slice(0, MAX_GLOB_PATHS),
      truncated,
      reason: null,
      warning: null
    };
  }

  private requiredString(value: unknown, field: string): string {
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new BadRequestException(`Field "${field}" must be a non-empty string.`);
    }
    return value.trim();
  }

  private readNullableString(value: unknown): string | null {
    if (typeof value !== "string") {
      return null;
    }
    const trimmed = value.trim();
    return trimmed.length === 0 ? null : trimmed;
  }
}
