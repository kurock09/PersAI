import { BadRequestException, Injectable } from "@nestjs/common";
import { PersaiMediaObjectStorageService } from "./media/persai-media-object-storage.service";
import { WorkspaceFileMetadataService } from "./workspace-file-metadata.service";
import { resolveWorkspaceStorageSearchScope } from "./resolve-workspace-storage-search-scope";
import { matchesWorkspaceGlob, pathMatchesRipgrepType } from "./workspace-path-glob";

export type GrepWorkspaceFilesFromStorageInput = {
  workspaceId: string;
  assistantId: string;
  sessionId: string;
  pattern: string;
  path?: string | null;
  glob?: string | null;
  type?: string | null;
  caseInsensitive?: boolean;
};

export type GrepWorkspaceFilesFromStorageMatch = {
  file: string;
  line: number;
  text: string;
};

export type GrepWorkspaceFilesFromStorageOutcome = {
  matches: GrepWorkspaceFilesFromStorageMatch[];
  truncated: boolean;
  reason: string | null;
  warning: string | null;
};

const MAX_MATCHES = 200;
const LINE_BYTE_CAP = 2_000;
const MAX_FILE_BYTES = 1_048_576;

@Injectable()
export class GrepWorkspaceFilesFromStorageService {
  constructor(
    private readonly workspaceFileMetadataService: WorkspaceFileMetadataService,
    private readonly mediaObjectStorage: PersaiMediaObjectStorageService
  ) {}

  parseInput(value: unknown): GrepWorkspaceFilesFromStorageInput {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      throw new BadRequestException("Request body must be an object.");
    }
    const row = value as Record<string, unknown>;
    return {
      workspaceId: this.requiredString(row.workspaceId, "workspaceId"),
      assistantId: this.requiredString(row.assistantId, "assistantId"),
      sessionId: this.requiredString(row.sessionId, "sessionId"),
      pattern: this.requiredString(row.pattern, "pattern"),
      path: this.readNullableString(row.path),
      glob: this.readNullableString(row.glob),
      type: this.readNullableString(row.type),
      caseInsensitive: row.caseInsensitive === true
    };
  }

  async execute(
    input: GrepWorkspaceFilesFromStorageInput
  ): Promise<GrepWorkspaceFilesFromStorageOutcome> {
    const resolved = resolveWorkspaceStorageSearchScope({
      path: input.path ?? null,
      assistantId: input.assistantId,
      sessionId: input.sessionId
    });
    if (resolved.kind === "error") {
      return {
        matches: [],
        truncated: false,
        reason: resolved.reason,
        warning: resolved.warning
      };
    }
    const scope = resolved.scope;
    let matcher: RegExp;
    try {
      matcher = new RegExp(input.pattern, input.caseInsensitive === true ? "i" : undefined);
    } catch (error) {
      return {
        matches: [],
        truncated: false,
        reason: "grep_failed",
        warning: error instanceof Error ? error.message : "Invalid grep pattern."
      };
    }
    const rows =
      scope.singleFilePath === null
        ? await this.workspaceFileMetadataService.list({
            workspaceId: input.workspaceId,
            pathPrefix: scope.listPathPrefix,
            originAssistantId: input.assistantId,
            limit: 1_000
          })
        : await this.workspaceFileMetadataService
            .get({
              workspaceId: input.workspaceId,
              path: scope.singleFilePath
            })
            .then((row) => (row === null ? [] : [row]));
    const candidates = rows
      .filter((row) => Number(row.sizeBytes) <= MAX_FILE_BYTES)
      .filter((row) => this.isTextLikeMime(row.mimeType))
      .filter((row) =>
        input.type === null || input.type === undefined || input.type.trim().length === 0
          ? true
          : pathMatchesRipgrepType(row.path, input.type)
      )
      .filter((row) =>
        input.glob === null || input.glob === undefined || input.glob.trim().length === 0
          ? true
          : matchesWorkspaceGlob({
              filePath: row.path,
              searchRoot: scope.searchRoot,
              pattern: input.glob
            })
      )
      .sort((left, right) => left.path.localeCompare(right.path));
    const matches: GrepWorkspaceFilesFromStorageMatch[] = [];
    let truncated = false;
    for (const row of candidates) {
      if (matches.length > MAX_MATCHES) {
        truncated = true;
        break;
      }
      const objectKey = this.mediaObjectStorage.buildWorkspaceObjectKey({
        workspaceId: input.workspaceId,
        workspaceRelPath: row.path
      });
      const downloaded = await this.mediaObjectStorage.downloadObject(objectKey);
      if (downloaded === null || downloaded.buffer.length === 0) {
        continue;
      }
      if (this.looksBinary(downloaded.buffer, row.mimeType)) {
        continue;
      }
      const content = downloaded.buffer.toString("utf8");
      const lines = content.split("\n");
      for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
        const lineText = lines[lineIndex] ?? "";
        if (!matcher.test(lineText)) {
          continue;
        }
        matches.push({
          file: row.path,
          line: lineIndex + 1,
          text: lineText.slice(0, LINE_BYTE_CAP)
        });
        if (matches.length > MAX_MATCHES) {
          truncated = true;
          break;
        }
      }
      if (truncated) {
        break;
      }
    }
    return {
      matches: matches.slice(0, MAX_MATCHES),
      truncated,
      reason: null,
      warning: null
    };
  }

  private isTextLikeMime(mimeType: string): boolean {
    const normalized = mimeType.toLowerCase().split(";")[0]?.trim() ?? "";
    if (normalized.startsWith("text/")) {
      return true;
    }
    return (
      normalized === "application/json" ||
      normalized === "application/xml" ||
      normalized === "application/yaml" ||
      normalized === "application/javascript" ||
      normalized === "application/typescript" ||
      normalized === "application/markdown"
    );
  }

  private looksBinary(buffer: Buffer, mimeType: string): boolean {
    const normalized = mimeType.toLowerCase().split(";")[0]?.trim() ?? "";
    if (
      normalized.startsWith("image/") ||
      normalized.startsWith("audio/") ||
      normalized.startsWith("video/") ||
      normalized === "application/pdf" ||
      normalized === "application/zip" ||
      normalized === "application/octet-stream"
    ) {
      return true;
    }
    const sample = buffer.subarray(0, Math.min(buffer.length, 8_192));
    return sample.includes(0);
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
