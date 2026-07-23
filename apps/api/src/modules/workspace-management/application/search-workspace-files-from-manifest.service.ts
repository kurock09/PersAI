import { BadRequestException, Injectable } from "@nestjs/common";
import { isSessionHiddenModelSupportPath } from "@persai/runtime-contract";
import { WorkspaceFileMetadataService } from "./workspace-file-metadata.service";

export type SearchWorkspaceFilesFromManifestInput = {
  workspaceId: string;
  assistantId: string;
  sessionId?: string | null;
  query: string;
  limit?: number;
};

export type SearchWorkspaceFilesFromManifestItem = {
  path: string;
  mimeType: string;
  sizeBytes: number;
  shortDescription: string | null;
  matchedTokenCount: number;
};

export type SearchWorkspaceFilesFromManifestOutcome = {
  items: SearchWorkspaceFilesFromManifestItem[];
};

function tokenizeSearchQuery(query: string): string[] {
  return query
    .toLowerCase()
    .split(/\s+/u)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);
}

function basenameFromPath(path: string): string {
  const parts = path.split("/").filter((part) => part.length > 0);
  return parts[parts.length - 1] ?? path;
}

function countMatchedTokens(haystack: string, tokens: readonly string[]): number {
  const normalized = haystack.toLowerCase();
  let count = 0;
  for (const token of tokens) {
    if (normalized.includes(token)) {
      count += 1;
    }
  }
  return count;
}

@Injectable()
export class SearchWorkspaceFilesFromManifestService {
  constructor(private readonly workspaceFileMetadataService: WorkspaceFileMetadataService) {}

  parseInput(value: unknown): SearchWorkspaceFilesFromManifestInput {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      throw new BadRequestException("Request body must be an object.");
    }
    const row = value as Record<string, unknown>;
    const workspaceId = this.requiredString(row.workspaceId, "workspaceId");
    const assistantId = this.requiredString(row.assistantId, "assistantId");
    const query = this.requiredString(row.query, "query");
    const sessionId =
      row.sessionId === undefined || row.sessionId === null
        ? null
        : this.requiredString(row.sessionId, "sessionId");
    const limitRaw = row.limit;
    const limit =
      typeof limitRaw === "number" && Number.isFinite(limitRaw) && limitRaw > 0
        ? Math.min(50, Math.floor(limitRaw))
        : 20;
    return { workspaceId, assistantId, sessionId, query, limit };
  }

  async execute(
    input: SearchWorkspaceFilesFromManifestInput
  ): Promise<SearchWorkspaceFilesFromManifestOutcome> {
    const tokens = tokenizeSearchQuery(input.query);
    if (tokens.length === 0) {
      return { items: [] };
    }
    const pathPrefix =
      input.sessionId === null
        ? `/workspace/assistants/${input.assistantId}/`
        : `/workspace/assistants/${input.assistantId}/sessions/${input.sessionId}/`;
    const rows = await this.workspaceFileMetadataService.list({
      workspaceId: input.workspaceId,
      pathPrefix,
      originAssistantId: input.assistantId,
      limit: 500
    });
    const ranked = rows
      .filter((row) => !isSessionHiddenModelSupportPath(row.path))
      .map((row) => {
        const displayName = basenameFromPath(row.path);
        const corpus = [row.path, displayName, row.shortDescription ?? ""].join(" ");
        const matchedTokenCount = countMatchedTokens(corpus, tokens);
        return {
          path: row.path,
          mimeType: row.mimeType,
          sizeBytes: Number(row.sizeBytes),
          shortDescription: row.shortDescription,
          matchedTokenCount
        };
      })
      .filter((row) => row.matchedTokenCount > 0)
      .sort((left, right) => {
        if (right.matchedTokenCount !== left.matchedTokenCount) {
          return right.matchedTokenCount - left.matchedTokenCount;
        }
        return left.path.localeCompare(right.path);
      })
      .slice(0, input.limit ?? 20);
    return { items: ranked };
  }

  private requiredString(value: unknown, field: string): string {
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new BadRequestException(`Field "${field}" must be a non-empty string.`);
    }
    return value.trim();
  }
}
