export const WORKSPACE_FILE_METADATA_REPOSITORY = Symbol("WORKSPACE_FILE_METADATA_REPOSITORY");

export type WorkspaceFileMetadataRow = {
  workspaceId: string;
  path: string;
  mimeType: string;
  sizeBytes: bigint;
  contentHash: string | null;
  shortDescription: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type UpsertWorkspaceFileMetadataInput = {
  workspaceId: string;
  path: string;
  mimeType: string;
  sizeBytes: bigint;
  contentHash?: string | null;
  shortDescription?: string | null;
};

export interface WorkspaceFileMetadataRepository {
  upsert(input: UpsertWorkspaceFileMetadataInput): Promise<void>;
  get(input: { workspaceId: string; path: string }): Promise<WorkspaceFileMetadataRow | null>;
  list(input: {
    workspaceId: string;
    pathPrefix?: string;
    limit?: number;
  }): Promise<WorkspaceFileMetadataRow[]>;
  delete(input: { workspaceId: string; path: string }): Promise<void>;
}
