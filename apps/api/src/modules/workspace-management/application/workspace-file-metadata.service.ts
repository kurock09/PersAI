import { Inject, Injectable } from "@nestjs/common";
import {
  WORKSPACE_FILE_METADATA_REPOSITORY,
  type WorkspaceFileMetadataRepository,
  type WorkspaceFileMetadataRow
} from "../domain/workspace-file-metadata.repository";

@Injectable()
export class WorkspaceFileMetadataService {
  constructor(
    @Inject(WORKSPACE_FILE_METADATA_REPOSITORY)
    private readonly repository: WorkspaceFileMetadataRepository
  ) {}

  async upsert(input: {
    workspaceId: string;
    path: string;
    mimeType: string;
    sizeBytes: number | bigint;
    contentHash?: string;
    shortDescription?: string;
  }): Promise<void> {
    await this.repository.upsert({
      workspaceId: input.workspaceId,
      path: input.path,
      mimeType: input.mimeType,
      sizeBytes: typeof input.sizeBytes === "bigint" ? input.sizeBytes : BigInt(input.sizeBytes),
      contentHash: input.contentHash ?? null,
      shortDescription: input.shortDescription ?? null
    });
  }

  async get(input: {
    workspaceId: string;
    path: string;
  }): Promise<WorkspaceFileMetadataRow | null> {
    return this.repository.get(input);
  }

  async list(input: {
    workspaceId: string;
    pathPrefix?: string;
    limit?: number;
  }): Promise<WorkspaceFileMetadataRow[]> {
    return this.repository.list(input);
  }

  async delete(input: { workspaceId: string; path: string }): Promise<void> {
    await this.repository.delete(input);
  }
}
