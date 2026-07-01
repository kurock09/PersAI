import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Req
} from "@nestjs/common";
import { ListWorkspaceFilesFromManifestService } from "../../application/list-workspace-files-from-manifest.service";
import { UpsertWorkspaceFileMetadataFromRuntimeService } from "../../application/upsert-workspace-file-metadata-from-runtime.service";
import { WorkspaceFileMetadataService } from "../../application/workspace-file-metadata.service";
import { assertPersaiInternalApiAuthorized } from "./assert-persai-internal-api-auth";

type InternalRequestLike = {
  headers: Record<string, string | string[] | undefined>;
};

// ADR-127 W1 — workspace-scoped internal endpoints that treat
// `workspace_file_metadata` as the source of truth for the runtime
// `files.list` (over persisted `/workspace/...`) and `files.write` (manifest upsert)
// paths. Same internal-token auth pattern as the other `internal/runtime/*`
// surfaces.
@Controller("api/v1/internal/workspaces")
export class InternalWorkspaceFilesController {
  constructor(
    private readonly listWorkspaceFilesFromManifestService: ListWorkspaceFilesFromManifestService,
    private readonly upsertWorkspaceFileMetadataFromRuntimeService: UpsertWorkspaceFileMetadataFromRuntimeService,
    private readonly workspaceFileMetadataService: WorkspaceFileMetadataService
  ) {}

  @HttpCode(200)
  @Get(":workspaceId/files/list")
  async listFiles(
    @Req() req: InternalRequestLike,
    @Param("workspaceId") workspaceId: string,
    @Query("pathPrefix") pathPrefix: string | undefined,
    @Query("assistantHandle") assistantHandle: string | undefined,
    @Query("scope") scope: string | undefined,
    @Query("currentChatId") currentChatId: string | undefined,
    @Query("currentAssistantId") currentAssistantId: string | undefined
  ) {
    this.assertAuthorized(req);
    const input = this.listWorkspaceFilesFromManifestService.parseInput({
      workspaceId,
      pathPrefix,
      assistantHandle,
      scope,
      currentChatId,
      currentAssistantId
    });
    return this.listWorkspaceFilesFromManifestService.execute(input);
  }

  @HttpCode(200)
  @Get(":workspaceId/files/metadata")
  async getMetadata(
    @Req() req: InternalRequestLike,
    @Param("workspaceId") workspaceId: string,
    @Query("path") path: string | undefined
  ) {
    this.assertAuthorized(req);
    const trimmedPath = typeof path === "string" ? path.trim() : "";
    if (!trimmedPath.startsWith("/workspace/")) {
      throw new BadRequestException('path must start with "/workspace/".');
    }
    const row = await this.workspaceFileMetadataService.get({
      workspaceId,
      path: trimmedPath
    });
    return {
      file:
        row === null
          ? null
          : {
              path: row.path,
              mimeType: row.mimeType,
              sizeBytes: Number(row.sizeBytes),
              originChatId: row.originChatId,
              originAssistantId: row.originAssistantId,
              updatedAt: row.updatedAt.toISOString()
            }
    };
  }

  @HttpCode(204)
  @Post(":workspaceId/files/metadata")
  async upsertMetadata(
    @Req() req: InternalRequestLike,
    @Param("workspaceId") workspaceId: string,
    @Body() body: unknown
  ): Promise<void> {
    this.assertAuthorized(req);
    const bodyObject =
      body !== null && typeof body === "object" && !Array.isArray(body)
        ? (body as Record<string, unknown>)
        : {};
    const input = this.upsertWorkspaceFileMetadataFromRuntimeService.parseInput({
      ...bodyObject,
      workspaceId
    });
    await this.upsertWorkspaceFileMetadataFromRuntimeService.execute(input);
  }

  @HttpCode(204)
  @Delete(":workspaceId/files/metadata")
  async deleteMetadata(
    @Req() req: InternalRequestLike,
    @Param("workspaceId") workspaceId: string,
    @Query("path") path: string | undefined
  ): Promise<void> {
    this.assertAuthorized(req);
    const trimmedPath = typeof path === "string" ? path.trim() : "";
    if (!trimmedPath.startsWith("/workspace/")) {
      throw new BadRequestException('path must start with "/workspace/".');
    }
    await this.workspaceFileMetadataService.delete({
      workspaceId,
      path: trimmedPath
    });
  }

  private assertAuthorized(req: InternalRequestLike): void {
    assertPersaiInternalApiAuthorized(
      req,
      "PERSAI_INTERNAL_API_TOKEN must be configured for internal workspace file APIs.",
      "Internal workspace file authorization failed."
    );
  }
}
