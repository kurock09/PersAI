import { Body, Controller, HttpCode, Post, Req } from "@nestjs/common";
import { ListWorkspaceFileShortDescriptionsService } from "../../application/list-workspace-file-short-descriptions.service";
import { SearchWorkspaceFilesFromManifestService } from "../../application/search-workspace-files-from-manifest.service";
import { RegisterChatAttachmentService } from "../../application/register-chat-attachment.service";
import { assertPersaiInternalApiAuthorized } from "./assert-persai-internal-api-auth";

type InternalRequestLike = {
  headers: Record<string, string | string[] | undefined>;
};

@Controller("api/v1/internal/runtime/files")
export class InternalRuntimeFilesController {
  constructor(
    private readonly listWorkspaceFileShortDescriptionsService: ListWorkspaceFileShortDescriptionsService,
    private readonly searchWorkspaceFilesFromManifestService: SearchWorkspaceFilesFromManifestService,
    private readonly registerChatAttachmentService: RegisterChatAttachmentService
  ) {}

  @HttpCode(200)
  @Post("search")
  async searchWorkspaceFiles(@Req() req: InternalRequestLike, @Body() body: unknown) {
    this.assertAuthorized(req);
    const input = this.searchWorkspaceFilesFromManifestService.parseInput(body);
    return this.searchWorkspaceFilesFromManifestService.execute(input);
  }

  @HttpCode(200)
  @Post("short-descriptions")
  async listShortDescriptions(@Req() req: InternalRequestLike, @Body() body: unknown) {
    this.assertAuthorized(req);
    const input = this.listWorkspaceFileShortDescriptionsService.parseInput(body);
    return this.listWorkspaceFileShortDescriptionsService.execute(input);
  }

  @HttpCode(200)
  @Post("chat-attachments")
  async registerChatAttachment(@Req() req: InternalRequestLike, @Body() body: unknown) {
    this.assertAuthorized(req);
    const input = this.registerChatAttachmentService.parseRuntimeInput(body);
    return this.registerChatAttachmentService.executeFromRuntime(input);
  }

  private assertAuthorized(req: InternalRequestLike): void {
    assertPersaiInternalApiAuthorized(
      req,
      "PERSAI_INTERNAL_API_TOKEN must be configured for internal runtime file APIs.",
      "Internal runtime file authorization failed."
    );
  }
}
