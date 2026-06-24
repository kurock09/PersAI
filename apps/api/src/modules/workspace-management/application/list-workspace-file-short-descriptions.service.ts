import { BadRequestException, Injectable } from "@nestjs/common";
import { WorkspaceFileMetadataService } from "./workspace-file-metadata.service";

export type ListWorkspaceFileShortDescriptionsInput = {
  workspaceId: string;
  paths: readonly string[];
};

export type ListWorkspaceFileShortDescriptionsRow = {
  path: string;
  shortDescription: string | null;
};

export type ListWorkspaceFileShortDescriptionsOutcome = {
  rows: ListWorkspaceFileShortDescriptionsRow[];
};

/** ADR-126 v3 — batch lookup of cached `workspace_file_metadata.shortDescription`. */
@Injectable()
export class ListWorkspaceFileShortDescriptionsService {
  constructor(private readonly workspaceFileMetadataService: WorkspaceFileMetadataService) {}

  parseInput(value: unknown): ListWorkspaceFileShortDescriptionsInput {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      throw new BadRequestException("Request body must be an object.");
    }
    const row = value as Record<string, unknown>;
    const workspaceId = this.requiredString(row.workspaceId, "workspaceId");
    if (!Array.isArray(row.paths)) {
      throw new BadRequestException('Field "paths" must be an array of strings.');
    }
    const paths = row.paths.filter(
      (entry): entry is string => typeof entry === "string" && entry.trim().length > 0
    );
    return { workspaceId, paths };
  }

  async execute(
    input: ListWorkspaceFileShortDescriptionsInput
  ): Promise<ListWorkspaceFileShortDescriptionsOutcome> {
    if (input.paths.length === 0) {
      return { rows: [] };
    }
    const rows = await Promise.all(
      input.paths.map(async (path) => {
        const metadata = await this.workspaceFileMetadataService.get({
          workspaceId: input.workspaceId,
          path
        });
        return {
          path,
          shortDescription: metadata?.shortDescription ?? null
        } satisfies ListWorkspaceFileShortDescriptionsRow;
      })
    );
    return { rows };
  }

  private requiredString(value: unknown, field: string): string {
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new BadRequestException(`Field "${field}" must be a non-empty string.`);
    }
    return value.trim();
  }
}
