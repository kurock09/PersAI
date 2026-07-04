import { BadRequestException, Injectable } from "@nestjs/common";
import { WorkspaceManagementPrismaService } from "../infrastructure/persistence/workspace-management-prisma.service";
import {
  resolveVisibleWorkspaceOutputFormatFromPath
} from "./document-workspace-deliverable-gating";
import { WorkspaceFileMetadataService } from "./workspace-file-metadata.service";

export type ListWorkspaceFileShortDescriptionsInput = {
  workspaceId: string;
  paths: readonly string[];
};

export type ListWorkspaceFileShortDescriptionsRow = {
  path: string;
  shortDescription: string | null;
  documentVersionNumber: number | null;
};

export type ListWorkspaceFileShortDescriptionsOutcome = {
  rows: ListWorkspaceFileShortDescriptionsRow[];
};

function readDocumentWorkspaceOutputPath(sourceJson: unknown): string | null {
  if (sourceJson === null || typeof sourceJson !== "object" || Array.isArray(sourceJson)) {
    return null;
  }
  const metadata = (sourceJson as Record<string, unknown>).metadata;
  if (metadata === null || typeof metadata !== "object" || Array.isArray(metadata)) {
    return null;
  }
  const documentWorkspace = (metadata as Record<string, unknown>).documentWorkspace;
  if (
    documentWorkspace === null ||
    typeof documentWorkspace !== "object" ||
    Array.isArray(documentWorkspace)
  ) {
    return null;
  }
  const outputPath = (documentWorkspace as Record<string, unknown>).outputPath;
  return typeof outputPath === "string" && outputPath.trim().length > 0 ? outputPath.trim() : null;
}

/** ADR-126 v3 — batch lookup of cached `workspace_file_metadata.shortDescription`. */
@Injectable()
export class ListWorkspaceFileShortDescriptionsService {
  constructor(
    private readonly workspaceFileMetadataService: WorkspaceFileMetadataService,
    private readonly prisma: WorkspaceManagementPrismaService
  ) {}

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
    const documentVersionByPath = await this.resolveDocumentVersionNumbers(
      input.workspaceId,
      input.paths
    );
    const rows = await Promise.all(
      input.paths.map(async (path) => {
        const metadata = await this.workspaceFileMetadataService.get({
          workspaceId: input.workspaceId,
          path
        });
        return {
          path,
          shortDescription: metadata?.shortDescription ?? null,
          documentVersionNumber: documentVersionByPath.get(path) ?? null
        } satisfies ListWorkspaceFileShortDescriptionsRow;
      })
    );
    return { rows };
  }

  private async resolveDocumentVersionNumbers(
    workspaceId: string,
    paths: readonly string[]
  ): Promise<Map<string, number>> {
    const documentPaths = paths.filter((path) => {
      const format = resolveVisibleWorkspaceOutputFormatFromPath(path);
      return format === "pdf" || format === "xlsx" || format === "docx";
    });
    if (documentPaths.length === 0) {
      return new Map();
    }
    const pathSet = new Set(documentPaths);
    const documents = await this.prisma.assistantDocument.findMany({
      where: {
        workspaceId,
        currentVersionId: { not: null }
      },
      select: {
        currentVersion: {
          select: {
            versionNumber: true,
            sourceJson: true
          }
        }
      }
    });
    const versionByPath = new Map<string, number>();
    for (const document of documents) {
      const currentVersion = document.currentVersion;
      if (currentVersion === null) {
        continue;
      }
      const outputPath = readDocumentWorkspaceOutputPath(currentVersion.sourceJson);
      if (outputPath === null || !pathSet.has(outputPath)) {
        continue;
      }
      versionByPath.set(outputPath, currentVersion.versionNumber);
    }
    return versionByPath;
  }

  private requiredString(value: unknown, field: string): string {
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new BadRequestException(`Field "${field}" must be a non-empty string.`);
    }
    return value.trim();
  }
}
