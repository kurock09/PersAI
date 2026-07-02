import { Body, Controller, HttpCode, Post, Req } from "@nestjs/common";
import { DocumentWorkspaceExtractionService } from "../../application/document-workspace-extraction.service";
import { DocumentWorkspaceInspectionService } from "../../application/document-workspace-inspection.service";
import { assertPersaiInternalApiAuthorized } from "./assert-persai-internal-api-auth";

type InternalRequestLike = {
  headers: Record<string, string | string[] | undefined>;
};

@Controller("api/v1/internal/runtime")
export class InternalRuntimeDocumentInspectController {
  constructor(
    private readonly documentWorkspaceInspectionService: DocumentWorkspaceInspectionService,
    private readonly documentWorkspaceExtractionService: DocumentWorkspaceExtractionService
  ) {}

  @HttpCode(200)
  @Post("document-inspect")
  async inspect(@Req() req: InternalRequestLike, @Body() body: unknown) {
    this.assertAuthorized(req);
    const input = this.documentWorkspaceInspectionService.parseInput(body);
    try {
      await this.documentWorkspaceExtractionService.execute({
        assistantId: input.assistantId,
        workspaceId: input.workspaceId,
        path: input.path,
        mode: "auto",
        outputDir: null
      });
    } catch {
      // Best-effort only: inspect remains the user-visible source of truth and
      // still returns its own honest error if the source file is missing or unreadable.
    }
    const outcome = await this.documentWorkspaceInspectionService.execute(input);
    return {
      ok: true,
      ...outcome
    };
  }

  private assertAuthorized(req: InternalRequestLike): void {
    assertPersaiInternalApiAuthorized(
      req,
      "PERSAI_INTERNAL_API_TOKEN must be configured for the runtime document inspect endpoint.",
      "Internal runtime document inspect authorization failed."
    );
  }
}
