import { Body, Controller, HttpCode, Post, Req } from "@nestjs/common";
import { ExtractInternalRuntimeAssistantFileService } from "../../application/extract-internal-runtime-assistant-file.service";
import { assertPersaiInternalApiAuthorized } from "./assert-persai-internal-api-auth";

type InternalRequestLike = {
  headers: Record<string, string | string[] | undefined>;
};

@Controller("api/v1/internal/runtime/files")
export class InternalRuntimeFilesController {
  constructor(
    private readonly extractInternalRuntimeAssistantFileService: ExtractInternalRuntimeAssistantFileService
  ) {}

  @HttpCode(200)
  @Post("extract")
  async extract(@Req() req: InternalRequestLike, @Body() body: unknown) {
    this.assertAuthorized(req);
    const input = this.extractInternalRuntimeAssistantFileService.parseInput(body);
    return this.extractInternalRuntimeAssistantFileService.execute(input);
  }

  private assertAuthorized(req: InternalRequestLike): void {
    assertPersaiInternalApiAuthorized(
      req,
      "PERSAI_INTERNAL_API_TOKEN must be configured for internal runtime file extraction.",
      "Internal runtime file extraction authorization failed."
    );
  }
}
