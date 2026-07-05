import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import { PersaiMediaObjectStorageService } from "./media/persai-media-object-storage.service";
import { WorkspaceFileMetadataService } from "./workspace-file-metadata.service";
import { normalizeActiveWorkspaceFilePath } from "./workspace-visible-paths";

@Injectable()
export class DeleteWorkspaceFileFromRuntimeService {
  private readonly logger = new Logger(DeleteWorkspaceFileFromRuntimeService.name);

  constructor(
    private readonly workspaceFileMetadataService: WorkspaceFileMetadataService,
    private readonly mediaObjectStorage: PersaiMediaObjectStorageService
  ) {}

  async execute(input: { workspaceId: string; path: string }): Promise<void> {
    const normalizedPath = normalizeActiveWorkspaceFilePath(input.path);
    if (normalizedPath === null) {
      throw new BadRequestException(
        'path must be an active hierarchical "/workspace/..." file path tracked by the manifest.'
      );
    }
    const objectKey = this.mediaObjectStorage.buildWorkspaceObjectKey({
      workspaceId: input.workspaceId,
      workspaceRelPath: normalizedPath
    });
    try {
      await this.mediaObjectStorage.deleteObject(objectKey);
    } catch (error) {
      this.logger.warn(
        `workspace_file_gcs_delete_failed workspace=${input.workspaceId} path=${normalizedPath} reason=${error instanceof Error ? error.message : String(error)}`
      );
    }
    await this.workspaceFileMetadataService.delete({
      workspaceId: input.workspaceId,
      path: normalizedPath
    });
  }
}
