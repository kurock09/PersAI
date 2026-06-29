import { Body, Controller, HttpCode, Post, Req } from "@nestjs/common";
import { DocumentWorkspaceExtractionService } from "../../application/document-workspace-extraction.service";
import { assertPersaiInternalApiAuthorized } from "./assert-persai-internal-api-auth";

type InternalRequestLike = {
  headers: Record<string, string | string[] | undefined>;
};

@Controller("api/v1/internal/runtime")
export class InternalRuntimeDocumentExtractController {
  constructor(
    private readonly documentWorkspaceExtractionService: DocumentWorkspaceExtractionService
  ) {}

  @HttpCode(200)
  @Post("document-extract")
  async extract(@Req() req: InternalRequestLike, @Body() body: unknown) {
    this.assertAuthorized(req);
    const input = this.documentWorkspaceExtractionService.parseInput(body);
    const outcome = await this.documentWorkspaceExtractionService.execute(input);
    return {
      ok: true,
      ...outcome
    };
  }

  private assertAuthorized(req: InternalRequestLike): void {
    assertPersaiInternalApiAuthorized(
      req,
      "PERSAI_INTERNAL_API_TOKEN must be configured for the runtime document extract endpoint.",
      "Internal runtime document extract authorization failed."
    );
  }
}
